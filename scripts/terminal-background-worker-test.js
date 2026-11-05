'use strict';
// End-to-end: the real monitor worker snapshot must let an AI terminal's
// background badge bind to its native log, and stay fresh while work is quiet.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { refreshedSnapshot } = require('../src/agentMonitor');
const { TerminalReviewCompletion } = require('../src/terminalReviewCompletion');
const { conversationBackground } = require('../src/terminalBackground');

function nextMessage(worker, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.off('message', onMessage); reject(new Error(`timed out waiting for ${type}`)); }, timeoutMs);
    function onMessage(message) {
      if (message?.type !== type) return;
      clearTimeout(timer); worker.off('message', onMessage); resolve(message);
    }
    worker.on('message', onMessage);
  });
}

async function main() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-background-worker-'));
  let worker;
  try {
    const now = Date.now(), start = now - 10000, stamp = delta => new Date(start + delta).toISOString();
    const sessionId = '5f1d7c1e-8a0b-4c55-9d1e-2b2f3a4b5c6d';
    const claudeHome = path.join(home, '.claude');
    const file = path.join(claudeHome, 'projects/-project', `${sessionId}.jsonl`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.mkdir(path.join(claudeHome, 'sessions'));
    await fs.writeFile(path.join(claudeHome, 'sessions/101.json'), JSON.stringify({ pid: 101, kind: 'interactive', sessionId, cwd: '/project', startedAt: start, status: 'idle' }));
    await fs.writeFile(file, [
      { type: 'user', sessionId, uuid: 'request', cwd: '/project', timestamp: stamp(1000), message: { role: 'user', content: 'run the checks in the background' } },
      { type: 'assistant', sessionId, uuid: 'call', cwd: '/project', timestamp: stamp(2000), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'sleep 30', description: 'Wait for checks', run_in_background: true } }] } },
      { type: 'user', sessionId, uuid: 'output', cwd: '/project', timestamp: stamp(3000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: 'Command running in background with ID: bg-1' }] } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');

    worker = new Worker(path.join(__dirname, '..', 'src', 'monitorWorker.js'), {
      workerData: { home, runsDir: path.join(home, 'runs'), intervalMs: 300, availability: {} },
    });
    worker.on('error', error => { throw error; });
    const snapshots = new Map();
    worker.on('message', message => { if (message?.type === 'snapshot') snapshots.set(message.snapshot.sequence, message.snapshot); });
    await nextMessage(worker, 'snapshot', 20000);
    // Status can settle over the first scans; wait until the content is quiet.
    const fresh = await nextMessage(worker, 'snapshot-fresh', 20000);
    const published = { snapshot: snapshots.get(fresh.sequence) };
    assert(published.snapshot, 'freshness refers to a published snapshot');
    const card = published.snapshot.sessions.find(session => session.file === file);
    assert(card, 'published cards carry the native log file path');
    assert(Number.isSafeInteger(published.snapshot.sequence) && published.snapshot.sequence > 0);

    const child = { provider: 'claude', pid: 101, startedAt: stamp(0) };
    const native = await new TerminalReviewCompletion({ claudeHome }).observe(child);
    const jobs = conversationBackground(native, child, published.snapshot, Date.parse(published.snapshot.generatedAt));
    assert.equal(jobs.length, 1, 'a running background Bash call in the real worker snapshot shows one job');

    // Nothing changes while the job runs: the worker still refreshes freshness.
    const refreshed = refreshedSnapshot(published.snapshot, fresh);
    assert(Date.parse(refreshed.generatedAt) > Date.parse(published.snapshot.generatedAt));
    const later = Date.parse(published.snapshot.generatedAt) + 20000;
    assert.equal(conversationBackground(native, child, published.snapshot, later).length, 0, 'an unrefreshed snapshot expires');
    assert.equal(conversationBackground(native, child, { ...refreshed, generatedAt: new Date(later - 1000).toISOString() }, later).length, 1, 'a refreshed snapshot keeps quiet work visible');
    assert.equal(refreshedSnapshot({ ...published.snapshot, sequence: published.snapshot.sequence + 1 }, fresh).generatedAt, published.snapshot.generatedAt, 'another sequence never inherits freshness');
    assert.equal(refreshedSnapshot(published.snapshot, { ...fresh, generatedAt: 'invalid' }), published.snapshot);
  } finally {
    if (worker) { worker.postMessage({ type: 'stop' }); await worker.terminate(); }
    await fs.rm(home, { recursive: true, force: true });
  }
}

module.exports = main;
if (require.main === module) main().then(() => console.log('terminal background worker test passed'), error => { console.error(error); process.exitCode = 1; });
