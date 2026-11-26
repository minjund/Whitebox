'use strict';

// The conversation behind one terminal, for its chat pane: the exact Claude or
// Codex process running in the terminal, its own transcript file, and the
// user, assistant and tool rows parsed from the last part of that file.
// Only the tail is read and a file is parsed again only when it changed, so an
// idle chat pane costs a stat; thinking and tool output are never included.
const fs = require('fs');
const { exactProcess } = require('./terminalReview');
const { scanProcesses } = require('./processMonitor');

const CHAT_PROVIDERS = new Set(['claude', 'codex']);
const TAIL_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 300;
const MAX_CACHE = 16;
const safeId = value => /^[a-zA-Z0-9:._-]{1,200}$/u.test(value || '');

// Text the provider injects into the user's turn is not what the person typed.
function cleanUserText(text) {
  return String(text || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gu, '')
    .replace(/<local-command-(?:caveat|stdout|stderr)>[\s\S]*?<\/local-command-(?:caveat|stdout|stderr)>/gu, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/gu, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/gu, '$1')
    .replace(/<command-args>([\s\S]*?)<\/command-args>/gu, ' $1')
    .replace(/<\/?pasted_content(?:\s+id="[^"]*")?\s*>/gu, '')
    // Claude's wrapper around a message typed while it worked: keep the message.
    .replace(/^\s*The user sent a new message while you were working:\n([\s\S]*?)(?:\n\nThis is how Claude Code surfaces messages[\s\S]*)?$/u, '$1')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function chatRows(messages) {
  const rows = [];
  for (const message of messages || []) {
    if (!['user', 'assistant', 'tool'].includes(message.role)) continue;
    const text = message.role === 'user' ? cleanUserText(message.text) : String(message.text || '').trim();
    if (!text && message.role !== 'tool') continue;
    // The parser also turns Claude's "last-prompt" record into a user row; the
    // same words right after the real request are that record, not a new turn.
    const previous = rows.at(-1);
    if (message.role === 'user' && previous?.role === 'user' && previous.text === text) continue;
    rows.push({
      id: String(message.id || rows.length),
      role: message.role,
      text: message.role === 'tool' ? text.slice(0, 600) : text,
      title: message.role === 'tool' ? String(message.title || '').slice(0, 80) : '',
      timestamp: message.timestamp || '',
    });
  }
  return rows.slice(-MAX_MESSAGES);
}

// A message typed while Claude works is logged as a queued_command attachment
// where Claude took it in. Newer Claude also writes it into the next user row
// (wrapped, see cleanUserText); older Claude does not, so the chat adds it.
// The attachment keeps the time it was typed, so it is placed by file order:
// at the latest time seen before it.
function claudeQueued(file, size, tailBytes) {
  const start = Math.max(0, size - tailBytes);
  const buffer = Buffer.alloc(size - start);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buffer, 0, buffer.length, start); } finally { fs.closeSync(fd); }
  const lines = buffer.toString('utf8').split('\n');
  if (start > 0) lines.shift();
  const rows = [];
  let latest = 0;
  for (const line of lines) {
    const stamp = Date.parse(line.match(/"timestamp":"([^"]+)"/u)?.[1] || '');
    if (Number.isFinite(stamp) && !line.includes('"queued_command"')) latest = Math.max(latest, stamp);
    if (!line.includes('"queued_command"')) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const item = row?.attachment;
    if (item?.type !== 'queued_command' || typeof item.prompt !== 'string' || row.isSidechain) continue;
    if (item.origin?.kind && item.origin.kind !== 'human' || item.commandMode && item.commandMode !== 'prompt') continue;
    const typed = Date.parse(row.timestamp);
    const at = Math.max(Number.isFinite(typed) ? typed : 0, latest);
    rows.push({ id: `queued:${row.uuid || rows.length}`, role: 'user', text: item.prompt, timestamp: at ? new Date(at).toISOString() : '' });
  }
  return rows;
}

// Inserts each queued message before the first row recorded after it.
function mergeQueued(messages, queued) {
  if (!queued.length) return messages || [];
  const output = [], rest = [...queued];
  for (const message of messages || []) {
    const at = Date.parse(message.timestamp);
    while (rest.length && Number.isFinite(at) && Date.parse(rest[0].timestamp) <= at) output.push(rest.shift());
    output.push(message);
  }
  return [...output, ...rest];
}

class TerminalConversation {
  constructor({ manager, monitor, completion, parsers = null, tailBytes = TAIL_BYTES } = {}) {
    this.manager = manager;
    this.monitor = monitor;
    this.completion = completion;
    this.parsers = parsers;
    this.tailBytes = tailBytes;
    this.cache = new Map();
  }

  parser(provider) {
    if (!this.parsers) {
      const { parseClaude, parseCodex } = require('./agentMonitor');
      this.parsers = { claude: parseClaude, codex: parseCodex };
    }
    return this.parsers[provider];
  }

  async read({ id, creationId, revision = '' } = {}) {
    if (!safeId(id) || typeof creationId !== 'string' || !creationId) throw new Error('올바른 터미널이 필요합니다.');
    const live = await this.manager().get(id, false);
    if (!live || live.creationId !== creationId || live.status !== 'running') return { available: false, reason: 'session' };
    const child = exactProcess(live, await scanProcesses(this.monitor));
    if (!child || !CHAT_PROVIDERS.has(child.provider)) return { available: false, reason: 'provider', provider: child?.provider || '' };
    const observed = await this.completion.observe(child);
    const file = observed?.source?.file;
    if (!file) return { available: false, reason: 'log', provider: child.provider };
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat?.isFile()) return { available: false, reason: 'log', provider: child.provider };
    const next = `${child.provider}:${child.pid}:${stat.mtimeMs}:${stat.size}`;
    const base = { available: true, provider: child.provider, providerPid: child.pid, revision: next, working: observed.available && observed.state === 'working' };
    if (revision === next) return { ...base, unchanged: true };
    let cached = this.cache.get(file);
    if (!cached || cached.key !== `${stat.mtimeMs}:${stat.size}`) {
      const session = this.parser(child.provider)({ file, mtimeMs: stat.mtimeMs, size: stat.size }, { fullHistory: true, maxBytes: this.tailBytes });
      let messages = session?.messages;
      if (child.provider === 'claude') {
        try {
          const said = new Set((messages || []).filter(message => message.role === 'user').map(message => cleanUserText(message.text)));
          messages = mergeQueued(messages, claudeQueued(file, stat.size, this.tailBytes).filter(row => !said.has(cleanUserText(row.text))));
        } catch { /* the parsed rows stand */ }
      }
      cached = { key: `${stat.mtimeMs}:${stat.size}`, messages: chatRows(messages), truncated: stat.size > this.tailBytes };
      this.cache.delete(file);
      this.cache.set(file, cached);
      while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value);
    }
    return { ...base, truncated: cached.truncated, messages: cached.messages };
  }
}

module.exports = { TerminalConversation, chatRows, cleanUserText, claudeQueued, mergeQueued };
