'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const runFile = promisify(execFile);
const MAX_READ = 2 * 1024 * 1024;
const { addCall, addResult, toolEvidence } = require('./terminalReviewTools');
const { archiveRequest, recordAnswer, reviewContext, assistantUpdates } = require('./terminalReviewContext');
const { acknowledgement } = require('./terminalReviewPolicy');
const { bounded } = require('./terminalReviewBudget');
const uuid = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value || '');
const textContent = value => typeof value === 'string' ? value : Array.isArray(value)
  ? value.filter(item => ['text', 'input_text', 'output_text'].includes(item?.type)).map(item => String(item.text || '')).join('\n') : '';

function applyClaudeRow(state, row, sessionId) {
  if (row.sessionId !== sessionId || row.isSidechain || row.isMeta) return;
  const at = Date.parse(row.timestamp);
  if (row.type === 'user' && row.message?.role === 'user') {
    const results = Array.isArray(row.message.content) ? row.message.content.filter(item => item?.type === 'tool_result') : [];
    if (results.length) {
      if (at >= state.requestAt) for (const item of results) addResult(state, item.tool_use_id, item.content, item.is_error);
      return;
    }
    const request = textContent(row.message.content);
    if (/^\[Request interrupted by user(?: for tool use)?\]/u.test(request)) { state.aborted = true; state.complete = false; return; }
    // Claude writes background-agent notifications as user rows, sometimes
    // without isMeta. They must not replace the human request or erase an
    // already completed answer (notifications can arrive after turn_duration).
    if (row.sourceToolUseID || /^\s*<(?:task-notification|task_notification|subagent_notification|agent_notification|collaboration_notification)(?:\s|>)/iu.test(request)) return;
    if (request && row.uuid && Number.isFinite(at) && row.uuid !== state.requestId) {
      const continuationOf = state.awaitingResponse && acknowledgement(request) ? state.rootRequestId || state.requestId : '';
      archiveRequest(state);
      Object.assign(state, { rootRequestId: continuationOf || row.uuid, continuationOf, aborted: false, awaitingResponse: false, request, requestId: row.uuid, requestAt: at, answer: '', complete: false, completedTail: '', turnFinishedAt: null, tools: [], toolsOmitted: 0, updates: [], updatesOmitted: 0 });
    }
  } else if (row.type === 'api-request') {
    state.aborted = false;
    state.complete = false;
    state.completedTail = '';
    state.turnFinishedAt = null;
  } else if (row.type === 'assistant' && state.requestId && row.message?.role === 'assistant' && at >= state.requestAt) {
    if (Array.isArray(row.message.content)) for (const item of row.message.content) {
      if (item?.type === 'tool_use') addCall(state, item.id, item.name, item.input);
    }
    const answer = textContent(row.message.content);
    recordAnswer(state, answer);
    state.awaitingResponse = state.tools?.some(tool => /^(?:AskUserQuestion|request_user_input)$/u.test(tool.name) && tool.status === 'called') || /(?:승인|허용|진행|선택|어느|어떤).{0,80}[?？]\s*$/u.test(answer) || /(?:shall I|may I|which option).{0,80}\?\s*$/iu.test(answer);
    state.complete = row.message.stop_reason === 'end_turn' && Boolean(state.answer);
    state.turnFinishedAt = null;
    state.completedTail = state.complete ? row.uuid : '';
    if (state.complete) state.completedAt = at;
  } else if (row.type === 'system' && state.complete && state.completedTail
    && row.parentUuid === state.completedTail && row.uuid && at >= state.completedAt) {
    // Claude can finish a reply while a background server keeps metadata in
    // `shell`. Require its linked turn-end record, not just a quiet shell.
    if (row.subtype === 'stop_hook_summary') state.completedTail = row.uuid;
    else if (row.subtype === 'turn_duration') state.turnFinishedAt = at;
  }
}

function applyCodexRow(state, row) {
  const event = row.payload || {};
  const at = Date.parse(row.timestamp);
  if (row.type === 'event_msg' && event.type === 'task_started') {
    const continuationParent = state.awaitingResponse ? state.rootRequestId || state.requestId : '';
    archiveRequest(state);
    Object.assign(state, { continuationParent, aborted: false, awaitingResponse: false, turnId: event.turn_id, request: '', requestId: '', requestAt: at, answer: '', complete: false, tools: [], toolsOmitted: 0, updates: [], updatesOmitted: 0 });
  } else if (row.type === 'response_item' && event.type === 'message' && event.role === 'user' && state.turnId) {
    const request = textContent(event.content);
    if (request) Object.assign(state, { request, requestId: state.turnId, rootRequestId: state.continuationParent && acknowledgement(request) ? state.continuationParent : state.turnId, requestAt: at, answer: '', complete: false });
  } else if (row.type === 'event_msg' && event.type === 'user_message' && state.turnId) {
    if (event.message) Object.assign(state, { request: String(event.message), requestId: state.turnId, rootRequestId: state.continuationParent && acknowledgement(event.message) ? state.continuationParent : state.turnId, requestAt: at, complete: false });
  } else if (row.type === 'event_msg' && event.type === 'task_complete' && event.turn_id === state.turnId && state.requestId) {
    recordAnswer(state, String(event.last_agent_message || ''));
    state.awaitingResponse = state.tools?.some(tool => /^(?:AskUserQuestion|request_user_input)$/u.test(tool.name) && tool.status === 'called') || /(?:승인|허용|진행|선택|어느|어떤).{0,80}[?？]\s*$/u.test(state.answer) || /(?:shall I|may I|which option).{0,80}\?\s*$/iu.test(state.answer);
    state.completedAt = at;
    state.complete = Boolean(event.last_agent_message && state.answer && at >= state.requestAt);
  } else if (row.type === 'event_msg' && ['turn_aborted', 'task_aborted'].includes(event.type)) {
    if (event.turn_id && event.turn_id !== state.turnId) return;
    state.complete = false;
    state.aborted = true;
  } else if (row.type === 'response_item' && state.requestId && at >= state.requestAt && (!event.turn_id || event.turn_id === state.turnId)) {
    if (event.type === 'message' && event.role === 'assistant' && ['commentary', 'final'].includes(event.channel)) recordAnswer(state, textContent(event.content));
    else if (['function_call', 'custom_tool_call'].includes(event.type)) addCall(state, event.call_id, event.name, event.arguments || event.input);
    else if (['function_call_output', 'custom_tool_call_output'].includes(event.type)) addResult(state, event.call_id, event.output, undefined);
    else if (event.type === 'web_search_call') {
      addCall(state, event.id, 'web_search', event);
      if (event.status === 'completed') addResult(state, event.id, 'Provider reports web search completed; fetched body not included.', false);
    }
  }
}

function project(state, idle = true) {
  const completed = state.complete && idle;
  const evidence = state.requestId && state.answer ? `USER:\n${String(state.request).slice(0, 8000)}\n\nASSISTANT (${completed ? 'completed answer' : 'current report'}):\n${bounded(state.answer, 16000)}` : '';
  return { available: true, state: state.aborted ? 'interrupted' : completed ? 'completed' : idle ? 'unconfirmed' : 'working',
    request: String(state.request || '').slice(0, 8000), requestId: state.requestId, rootRequestId: state.rootRequestId || state.requestId,
    requestAt: state.requestAt, completedAt: state.completedAt, awaitingResponse: Boolean(state.awaitingResponse),
    tools: toolEvidence(state), context: reviewContext(state), updates: assistantUpdates(state),
    partialEvidence: evidence, evidence: completed ? evidence : '' };
}

// Read only logs explicitly owned by the already matched child process. Never
// pick the newest conversation, infer ownership from cwd, or inspect key files.
class TerminalReviewCompletion {
  constructor({ claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), platform = process.platform, execute = runFile } = {}) {
    this.claudeHome = claudeHome; this.codexHome = codexHome; this.platform = platform; this.execute = execute;
    this.logs = new Map(); this.paths = new Map();
  }

  async logState(file, provider, sessionId = '') {
    const stat = await fs.stat(file);
    let record = this.logs.get(file);
    if (record && record.size === stat.size && record.mtime === stat.mtimeMs) return record.state;
    const continuation = record && record.ino === stat.ino && stat.size > record.size && stat.size - record.size <= MAX_READ && record.sessionId === sessionId;
    const start = continuation ? Math.max(record.size, stat.size - MAX_READ) : Math.max(0, stat.size - MAX_READ);
    const handle = await fs.open(file, 'r');
    let bytes;
    try {
      bytes = Buffer.alloc(stat.size - start);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
      if (bytesRead !== bytes.length) throw new Error('Conversation changed while reading');
    }
    finally { await handle.close(); }
    let data = continuation ? Buffer.concat([record.carry, bytes]) : bytes;
    if (start > 0 && !continuation) data = data.subarray(data.indexOf(10) + 1);
    const boundary = data.lastIndexOf(10);
    const carry = Buffer.from(data.subarray(boundary + 1));
    const lines = data.subarray(0, boundary + 1).toString('utf8').split('\n');
    const state = continuation ? { ...record.state } : {};
    for (const line of lines) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (provider === 'claude') applyClaudeRow(state, row, sessionId); else applyCodexRow(state, row);
    }
    record = { size: stat.size, mtime: stat.mtimeMs, ino: stat.ino, carry, state, sessionId };
    this.logs.set(file, record);
    if (this.logs.size > 64) this.logs.delete(this.logs.keys().next().value);
    return state;
  }

  async observe(child) {
    try {
      if (child.provider === 'claude') {
        const file = path.join(this.claudeHome, 'sessions', `${child.pid}.json`);
        if ((await fs.stat(file)).size > 65536) return { available: false };
        const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
        const start = Date.parse(child.startedAt), recorded = Number(metadata.startedAt);
        if (metadata.pid !== child.pid || metadata.kind !== 'interactive' || !uuid(metadata.sessionId)
          || !Number.isFinite(start) || !Number.isFinite(recorded) || recorded < start - 2000 || recorded > start + 30000
          || typeof metadata.cwd !== 'string' || !path.isAbsolute(metadata.cwd)) return { available: false };
        const log = path.join(this.claudeHome, 'projects', metadata.cwd.replace(/[^a-zA-Z0-9]/gu, '-'), `${metadata.sessionId}.jsonl`);
        const state = await this.logState(log, 'claude', metadata.sessionId);
        const current = JSON.parse(await fs.readFile(file, 'utf8'));
        if (current.sessionId !== metadata.sessionId || current.startedAt !== metadata.startedAt || current.pid !== child.pid) return { available: false };
        const finishedWithBackgroundShell = current.status === 'shell'
          && Number.isFinite(state.turnFinishedAt) && state.turnFinishedAt >= state.completedAt
          && Number(current.statusUpdatedAt) >= state.turnFinishedAt;
        return { ...project(state, current.status === 'idle' || finishedWithBackgroundShell), conversationId: metadata.sessionId };
      }
      if (child.provider === 'codex' && ['darwin', 'linux'].includes(this.platform)) {
        const key = `${child.pid}:${child.startedAt}`;
        let owned = this.paths.get(key);
        if (!owned || Date.now() - owned.checkedAt > 10000) {
          const { stdout } = await this.execute('lsof', ['-a', '-p', String(child.pid), '-Fn'], { timeout: 2000, maxBuffer: 512 * 1024 });
          const root = path.resolve(this.codexHome) + path.sep;
          const files = [...new Set(stdout.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1))
            .filter(file => file.startsWith(root) && /[\\/]sessions[\\/].*[\\/]rollout-.*\.jsonl$/u.test(file)))];
          if (files.length !== 1) return { available: false };
          owned = { file: files[0], checkedAt: Date.now() }; this.paths.set(key, owned);
          if (this.paths.size > 64) this.paths.delete(this.paths.keys().next().value);
        }
        const state = await this.logState(owned.file, 'codex');
        return { ...project(state, Boolean(state.complete)), conversationId: path.basename(owned.file) };
      }
    } catch { /* Unknown versions, missing metadata and ambiguous identity fall back to screen signals. */ }
    return { available: false };
  }
}

module.exports = { TerminalReviewCompletion, applyClaudeRow, applyCodexRow };
