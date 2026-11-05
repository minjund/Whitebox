'use strict';

// Automatic review off/on resumption and the bounded model response cache.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TerminalReview } = require('../src/terminalReview');
const tick = () => new Promise(resolve => setImmediate(resolve));

const answer = request => `› ${request}\n• Fixed the bug and ran tests. The error display now explains which input the user needs to correct before continuing.\n─ Worked for 12s ─────\nThe changes are ready. The updated error message now explains which value.\n› `;
const reply = request => JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: 'Fixed the bug', actual: 'Fixed', alignment: 'aligned' }] });

function fixture(file = '') {
  const session = { id: 'cache', creationId: 'cache:1', pid: 10, status: 'running' };
  const state = { now: 0, calls: [] };
  const service = new TerminalReview({ file, manager: () => ({ get: () => session }), now: () => state.now,
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'codex', pid: 11, ancestorPids: [10] }] }) },
    runner: { generateTerminalReview: ({ prompt }) => new Promise((resolve, reject) => state.calls.push({ prompt, resolve, reject })) } });
  const capture = (text, extra = {}) => { state.now += 1000; return service.capture({ id: session.id, creationId: session.creationId, text, ...extra }); };
  async function complete(request, id, extra = {}) {
    const submission = { id, request };
    await capture(`${extra.prefix || ''}› ${request}\n• Working (esc to interrupt)`, { submission });
    await capture((extra.prefix || '') + answer(request), { submission });
    return capture((extra.prefix || '') + answer(request), { submission });
  }
  return { session, state, service, capture, complete };
}

(async () => {
  // Off while an analysis is running, then on: the work is resumed and the
  // response that finished meanwhile is reused instead of billing again.
  {
    const f = fixture();
    await f.capture('› ');
    assert.equal((await f.complete('fix the bug', 's1')).state, 'reviewing');
    assert.equal(f.state.calls.length, 1);
    assert.equal((await f.capture(answer('fix the bug'), { enabled: false })).state, 'paused');
    f.state.calls[0].resolve(reply('fix the bug')); await tick();
    assert.equal(f.service.entries.get('cache').result?.tasks.some(task => task.analysisId) || false, false, 'a paused review cannot publish a late result');
    await f.capture(answer('fix the bug'), { enabled: false });
    await f.capture(answer('fix the bug'), { submission: { id: 's1', request: 'fix the bug' } }); await tick();
    assert.equal(f.service.entries.get('cache').result?.tasks[0]?.actual, 'Fixed', 're-enabling resumes the interrupted analysis');
    assert.equal(f.state.calls.length, 1, 'resumed analysis reuses the cached response');
    assert.equal(f.service.entries.get('cache').result.tasks[0].analysisCached, true);
  }
  // Off while the AI is still answering, then on: the completed answer is analyzed.
  {
    const f = fixture();
    await f.capture('› ');
    const submission = { id: 's1', request: 'fix the bug' };
    assert.equal((await f.capture('› fix the bug\n• Working (esc to interrupt)', { submission })).state, 'awaiting-answer');
    await f.capture('› fix the bug\n• Working (esc to interrupt)', { enabled: false, submission });
    await f.capture(answer('fix the bug'), { submission });
    await f.capture(answer('fix the bug'), { submission });
    assert.equal(f.state.calls.length, 1, 'the request observed before pausing is still analyzed');
    // A request submitted while review was off is not analyzed, and new ones still are.
    f.state.calls[0].resolve(reply('fix the bug')); await tick();
    await f.capture(answer('fix the bug'), { enabled: false, submission });
    await f.capture(answer('fix the bug') + '\n› other', { enabled: false, submission: { id: 's2', request: 'other' } });
    await f.capture(answer('fix the bug'), { submission: { id: 's2', request: 'other' } });
    assert.equal(f.state.calls.length, 1);
    await f.complete('second task', 's3', { prefix: answer('fix the bug') + '\n' });
    assert.equal(f.state.calls.length, 2, 'new requests are analyzed after re-enabling');
  }
  // Cache key covers evidence: identical prompts hit, changed prompts miss,
  // failures are not cached, explicit reanalysis bypasses the lookup, and the
  // cache survives restart while staying bounded.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-review-cache-'));
    const file = path.join(dir, 'terminal-reviews.json');
    const f = fixture(file);
    const generate = (prompt, options) => f.service.generate({ provider: 'codex', model: 'm', prompt }, options);
    const first = generate('A');
    f.state.calls[0].resolve({ text: 'one', usage: { input: 5, output: 5, total: 10 } });
    assert.equal((await first).text, 'one');
    const hit = await generate('A');
    assert.equal(hit.text, 'one'); assert.equal(hit.cached, true); assert.equal(hit.usage.total, 0);
    assert.equal(f.state.calls.length, 1);
    const changed = generate('B'); f.state.calls[1].resolve('two'); assert.equal(await changed, 'two');
    assert.equal(f.state.calls.length, 2, 'different evidence is a cache miss');
    const otherModel = f.service.generate({ provider: 'codex', model: 'n', prompt: 'A' }); f.state.calls[2].resolve('three'); await otherModel;
    assert.equal(f.state.calls.length, 3, 'model is part of the key');
    const failed = generate('C'); f.state.calls[3].reject(new Error('down')); await assert.rejects(failed);
    const retry = generate('C'); assert.equal(f.state.calls.length, 5, 'failures are not cached'); f.state.calls[4].resolve('ok'); await retry;
    const fresh = generate('A', { fresh: true }); assert.equal(f.state.calls.length, 6, 'explicit reanalysis calls the model'); f.state.calls[5].resolve('again'); await fresh;
    const restarted = fixture(file);
    assert.equal((await restarted.service.generate({ provider: 'codex', model: 'm', prompt: 'B' })).text, 'two');
    assert.equal(restarted.state.calls.length, 0, 'cache persists across restart');
    for (let i = 0; i < 60; i++) {
      const pending = restarted.service.generate({ provider: 'codex', model: 'm', prompt: `fill-${i}` });
      restarted.state.calls.at(-1).resolve(`v${i}`); await pending;
    }
    assert.ok(restarted.service.responses.size <= 48, 'cache is bounded');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('terminal review cache and resume checks passed');
})().catch(error => { console.error(error); process.exit(1); });
