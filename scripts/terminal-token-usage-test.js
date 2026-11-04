'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { observeClaudeUsage, observeCodexUsage, tokenUsage } = require('../src/terminalTokenUsage');
const { TerminalReviewCompletion } = require('../src/terminalReviewCompletion');

module.exports = async function tokenChecks() {
  const claudeRow = (id, usage, extra = {}) => ({ type: 'assistant', sessionId: 'conversation', uuid: 'row-' + id,
    timestamp: '2026-11-04T01:00:00Z', message: { id, role: 'assistant', usage, content: [] }, ...extra });
  const state = {}, raw = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 800, cache_creation_input_tokens: 200 };
  assert.equal(tokenUsage(state), null, 'unobserved usage is not zero');
  const apply = row => observeClaudeUsage(state, row, 'conversation');
  apply(claudeRow('one', raw)); apply(claudeRow('one', raw));
  assert.equal(tokenUsage(state).total, 1120, 'repeated content blocks for one API request count once');
  apply(claudeRow('one', { ...raw, output_tokens: 50 }));
  apply(claudeRow('one', { ...raw, output_tokens: 1 }));
  assert.equal(tokenUsage(state).total, 1150, 'a shorter partial snapshot cannot erase final output');
  apply(claudeRow('foreign', raw, { sessionId: 'another' }));
  apply(claudeRow('sidechain', raw, { isSidechain: true }));
  assert.equal(tokenUsage(state).total, 1150, 'other AI conversations and subagent records never leak into this terminal');
  apply(claudeRow('two', { input_tokens: 10, output_tokens: 5 }, { isMeta: true }));
  assert.equal(tokenUsage(state).total, 1165, 'a primary-session internal API response still consumes tokens without exposing its content');
  apply(claudeRow('missing', undefined)); assert.equal(tokenUsage(state).partial, true);
  apply(claudeRow('missing', { input_tokens: 0, output_tokens: 0 })); assert.equal(tokenUsage(state).partial, false);
  state.tokenHistoryPartial = true; assert.equal(tokenUsage(state).partial, true, 'a bounded log tail is a lower bound, never a full-session claim');
  const bad = {};
  for (const usage of [{ input_tokens: -1, output_tokens: 1 }, { input_tokens: 10 }, { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: -1 }]) {
    observeClaudeUsage(bad, claudeRow('bad', usage), 'conversation'); assert.equal(tokenUsage(bad), null);
  }
  const codex = {};
  const event = total => ({ type: 'event_msg', timestamp: '2026-11-04T01:00:01Z', payload: { type: 'token_count', info: { total_token_usage: total } } });
  const snapshot = { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 150, reasoning_output_tokens: 100, total_tokens: 1150 };
  observeCodexUsage(codex, event(snapshot)); observeCodexUsage(codex, event(snapshot));
  assert.equal(tokenUsage(codex).total, 1150, 'cumulative, cached and reasoning counts are never added twice');
  observeCodexUsage(codex, event({ ...snapshot, input_tokens: 2000, total_tokens: 2150 }));
  assert.equal(tokenUsage(codex).total, 2150);
  observeCodexUsage(codex, event({ input_tokens: 0, output_tokens: 0, total_tokens: 0 }));
  assert.equal(tokenUsage(codex).total, 0, 'an explicitly observed zero is valid');
  observeCodexUsage(codex, event({ ...snapshot, cached_input_tokens: 2000 })); assert.equal(tokenUsage(codex), null);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-token-usage-'));
  try {
    const file = path.join(root, 'owned.jsonl'), reader = new TerminalReviewCompletion();
    await fs.writeFile(file, JSON.stringify(claudeRow('a', raw)) + '\n');
    assert.equal(tokenUsage(await reader.logState(file, 'claude', 'conversation')).total, 1120);
    assert.equal(tokenUsage(await reader.logState(file, 'claude', 'conversation')).total, 1120, 'unchanged scans never accumulate again');
    await fs.appendFile(file, JSON.stringify(claudeRow('a', { ...raw, output_tokens: 50 })) + '\n' + JSON.stringify(claudeRow('b', raw)) + '\n');
    assert.equal(tokenUsage(await reader.logState(file, 'claude', 'conversation')).total, 2270, 'incremental appends retain previous request accounting');
    await fs.writeFile(file, JSON.stringify(claudeRow('new', { input_tokens: 1, output_tokens: 2 })) + '\n');
    assert.equal(tokenUsage(await reader.logState(file, 'claude', 'conversation')).total, 3, 'truncation/replacement cannot retain old totals');
    const codexFile = path.join(root, 'codex.jsonl');
    await fs.writeFile(codexFile, JSON.stringify(event(snapshot)) + '\n');
    assert.equal((await reader.logState(codexFile, 'codex')).codexTokenUsage.total, 1150);
    const claudeHome = path.join(root, 'claude'), conversationId = 'afac24ae-2ef0-4f7f-8c8f-17c4c4274fdb';
    const metadataFile = path.join(claudeHome, 'sessions/101.json');
    const ownedLog = path.join(claudeHome, 'projects/-project', conversationId + '.jsonl');
    await fs.mkdir(path.dirname(metadataFile), { recursive: true }); await fs.mkdir(path.dirname(ownedLog), { recursive: true });
    const start = Date.parse('2026-11-04T00:00:00Z');
    const metadata = { pid: 101, kind: 'interactive', sessionId: conversationId, cwd: '/project', startedAt: start, status: 'idle' };
    await fs.writeFile(metadataFile, JSON.stringify(metadata));
    await fs.writeFile(ownedLog, JSON.stringify(claudeRow('owned', raw, { sessionId: conversationId })) + '\n');
    const ownedReader = new TerminalReviewCompletion({ claudeHome });
    const child = { provider: 'claude', pid: 101, startedAt: new Date(start).toISOString() };
    assert.equal((await ownedReader.observe(child)).usage.total, 1120, 'idle process-owned sessions expose counters even without a current user turn');
    await fs.writeFile(metadataFile, JSON.stringify({ ...metadata, pid: 102 }));
    const rejected = await ownedReader.observe(child);
    assert.equal(rejected.available, false); assert.equal(rejected.usage, undefined, 'unmatched process ownership never exposes usage');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
  console.log('PASS terminal tokens: provider counters, Claude call dedup/cache accounting, Codex cumulative snapshots, unknown/zero/partial history, incremental reads and session replacement');
};
if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
