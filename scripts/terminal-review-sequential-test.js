'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { AgentRunner } = require('../src/agentRunner');
const { TerminalReview, parseReview } = require('../src/terminalReview');
const tick = () => new Promise(resolve => setImmediate(resolve));
const drain = async () => { for (let i = 0; i < 12; i++) await tick(); };

async function transportChecks() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-sequential-test-'));
  const oldPath = process.env.PATH;
  let child;
  try {
    const bin = path.join(folder, 'bin'); fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, 'claude'), '');
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
    const runner = new AgentRunner({ runsDir: path.join(folder, 'runs'), killProcess: () => {}, spawn: () => {
      child = new EventEmitter(); child.pid = 99999999;
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.end = () => {};
      return child;
    } });
    const emit = event => child.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
    for (let i = 0; i < 30; i++) {
      const text = JSON.stringify({ tasks: [{ requestQuote: '설명해줘', evidenceQuote: '결과', actual: `response-${i}` }] });
      const promise = runner.generateTerminalReview({ provider: 'claude', model: 'fixture', prompt: `request-${i}` });
      if (i % 2) emit({ type: 'assistant', message: { id: `m${i}`, content: [{ type: 'text', text: 'Preparing the analysis.' }] } });
      emit({ type: 'result', is_error: false, result: text, usage: { input_tokens: 2, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
      child.emit('close', 0, null);
      assert.equal((await promise).text, text, 'Terminal review must deliver the authoritative final result, including result-only streams');
      assert.equal(runner.listActive().length, 0);
      assert.equal(runner.listenerCount('changed'), 0);
    }
    const malformed = runner.generateTerminalReview({ provider: 'claude', prompt: 'malformed result' });
    emit({ type: 'assistant', message: { id: 'earlier', content: [{ type: 'text', text: '{"tasks":[]}' }] } });
    emit({ type: 'result', result: '{broken', usage: { input_tokens: 1, output_tokens: 1 } }); child.emit('close', 0, null);
    const value = await malformed;
    assert.throws(() => parseReview(value.text, '결과', 'ko', '설명해줘'), /형식/);
    const fallback = runner.generateTerminalReview({ provider: 'claude', prompt: 'assistant only' });
    emit({ type: 'assistant', message: { id: 'last', content: [{ type: 'text', text: '{"tasks":[]}' }] } });
    emit({ type: 'result', result: '', usage: { input_tokens: 1, output_tokens: 1 } }); child.emit('close', 0, null);
    assert.equal((await fallback).text, '{"tasks":[]}', 'An absent result does not erase a public assistant response');
    assert.deepEqual(fs.readdirSync(runner.runsDir), []);
  } finally { process.env.PATH = oldPath; fs.rmSync(folder, { recursive: true, force: true }); }
}

async function queueChecks() {
  let clock = 100, active = 0, maximum = 0;
  const sessions = Array.from({ length: 6 }, (_, i) => ({ id: `queue-${i}`, creationId: `epoch-${i}`, pid: 100 + i, status: 'running' }));
  const states = new Map(), calls = [];
  for (const session of sessions) states.set(session.pid + 1000, { available: true, state: 'working' });
  const service = new TerminalReview({ now: () => clock, quietMs: 0,
    manager: () => ({ get: id => sessions.find(s => s.id === id), list: () => sessions }),
    monitor: { scan: () => ({ available: true, processes: sessions.map(s => ({ provider: 'claude', pid: s.pid + 1000, ancestorPids: [s.pid] })) }) },
    completion: { observe: async process => states.get(process.pid) },
    runner: { canGenerateTerminalReview: () => active === 0, generateTerminalReview: options => new Promise((resolve, reject) => {
      active++; maximum = Math.max(maximum, active);
      calls.push({ ...options, resolve: text => { active--; resolve(text); }, reject: error => { active--; reject(error); } });
    }) } });
  const capture = (s, extra = {}) => service.capture({ id: s.id, creationId: s.creationId, text: 'frame', ...extra });
  for (const s of sessions) await capture(s);
  for (const [i, s] of sessions.entries()) {
    states.set(s.pid + 1000, { available: true, state: 'completed', requestId: `q${i}`, requestAt: ++clock, request: `설명해줘 ${i}`,
      evidence: `USER: 설명해줘 ${i}\nASSISTANT: 결과 ${i}는 isEmpty로 검사합니다. ${'빈 값이면 안내 문구를 보여 주고 다음 단계로 넘어가지 않습니다. '.repeat(20)}`, tools: { source: 'session', items: [] } }); // Long: summarized.
    await capture(s);
  }
  const answer = call => {
    const i = Number(call.prompt.match(/REQUEST: "설명해줘 (\d+)"/u)?.[1]);
    assert(Number.isInteger(i));
    return JSON.stringify({ tasks: [{ requestQuote: `설명해줘 ${i}`, evidenceQuote: `결과 ${i}는 isEmpty로 검사합니다.`, actual: `분석 ${i}`, alignment: 'aligned' }] });
  };
  for (let i = 0; i < 6; i++) { await drain(); assert.equal(calls.length, i + 1); calls[i].resolve(answer(calls[i])); }
  await drain(); assert.equal(maximum, 1);
  for (const [i, s] of sessions.entries()) { const v = await capture(s); assert.equal(v.state, 'ready'); assert.equal(v.result.tasks[0].actual, `분석 ${i}`); }
  for (let i = 0; i < 20; i++) {
    const before = calls.length;
    await capture(sessions[0], { reanalyze: true }); await drain();
    await Promise.all(Array.from({ length: 5 }, () => capture(sessions[0], { reanalyze: true })));
    assert.equal(calls.length, before + 1, 'Active duplicate clicks join the same analysis');
    calls.at(-1).resolve(answer(calls.at(-1))); await drain();
    assert.equal((await capture(sessions[0])).state, 'ready');
  }
  const offset = calls.length;
  for (let i = 0; i < 20; i++) {
    const n = 100 + i;
    states.set(sessions[0].pid + 1000, { available: true, state: 'completed', requestId: `next-${i}`, requestAt: ++clock,
      request: `설명해줘 ${n}`, evidence: `USER: 설명해줘 ${n}\nASSISTANT: 결과 ${n}는 isEmpty로 검사합니다. ${'빈 값이면 안내 문구를 보여 주고 다음 단계로 넘어가지 않습니다. '.repeat(20)}`, tools: { source: 'session', items: [] } });
    await capture(sessions[0]);
  }
  for (let i = 0; i < 20; i++) {
    await drain(); assert.equal(calls.length, offset + i + 1);
    assert(calls.at(-1).prompt.includes(`REQUEST: "설명해줘 ${100 + i}"`), 'Each queued turn keeps its own request');
    calls.at(-1).resolve(answer(calls.at(-1)));
  }
  await drain();
  const latest = await capture(sessions[0]);
  assert.equal(latest.state, 'ready'); assert.equal(latest.result.tasks.at(-1).actual, '분석 119');
  await capture(sessions[0], { reanalyze: true }); await drain();
  await capture(sessions[1], { reanalyze: true });
  calls.at(-1).resolve('{malformed'); await drain();
  assert.equal((await capture(sessions[0])).state, 'reviewing', 'format repair keeps ownership until its one replacement completes');
  assert.match(calls.at(-1).prompt, /QUALITY REPAIR/u);
  assert.match(calls.at(-1).prompt, /REQUEST: "설명해줘 119"/u, 'repair cannot use the next queued terminal request');
  assert.equal(maximum, 1);
  calls.at(-1).resolve('{malformed again'); await drain();
  assert.equal((await capture(sessions[0])).state, 'error');
  assert.equal(calls.at(-1).prompt.includes('REQUEST: "설명해줘 1"'), true, 'An error cannot block the next queued session');
  calls.at(-1).resolve(answer(calls.at(-1))); await drain();
  assert.equal((await capture(sessions[1])).state, 'ready');
  await capture(sessions[0], { reanalyze: true }); await drain(); calls.at(-1).resolve(answer(calls.at(-1))); await drain();
  assert.equal((await capture(sessions[0])).state, 'ready'); assert.equal(active, 0); assert.equal(service.busy, false);
  for (const s of sessions) service.forget(s.id);
}
async function main() {
  await transportChecks(); await queueChecks();
  console.log('PASS sequential review: 30 final-result transports, no stale response/listener leak; six-session queue; 20 sequential reanalyses and click bursts; 20 queued new turns in one session; malformed-response isolation, queue progress and explicit recovery');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
