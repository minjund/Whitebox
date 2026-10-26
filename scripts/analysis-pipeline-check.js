'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { ReviewEvidenceIndex } = require('../src/terminalReviewEvidence');
const { TerminalReviewCompletion } = require('../src/terminalReviewCompletion');
const { TerminalReview } = require('../src/terminalReview');
const { JevAnalysis } = require('../src/jevAnalysis');
const { TerminalCollaboration } = require('../src/terminalCollaboration');
const { bounded } = require('../src/terminalReviewBudget');
const wait = async check => { for (let n = 0; n < 200; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('fixture timeout'); };

module.exports = async function analysisPipelineChecks() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-analysis-'));
  const timings = [], reports = [];
  try {
    const reader = new TerminalReviewCompletion();
    const file = path.join(dir, 'fixture.jsonl');
    const row = (type, payload) => JSON.stringify({ type, timestamp: '2026-10-26T01:00:00Z', payload });
    const lines = [row('event_msg', { type: 'task_started', turn_id: 'first' }),
      row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ai-usage 사용처를 확인해줘. 파일은 삭제하지 마.' }] }),
      row('response_item', { type: 'function_call', call_id: 'check', name: 'exec_command', arguments: '{"cmd":"rg ai-usage"}' }),
      row('response_item', { type: 'function_call_output', call_id: 'check', output: 'ai-usage 사용처 없음. 범위 src와 renderer. Exit code: 0' }),
      row('event_msg', { type: 'task_complete', turn_id: 'first', last_agent_message: 'ai-usage 사용처가 src와 renderer에 없음을 확인했습니다.' }),
      row('event_msg', { type: 'task_started', turn_id: 'current' }),
      row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '패키지를 정리하고 판단 근거를 설명해줘. 앞의 삭제 금지는 철회한다.' }] }),
      row('response_item', { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'PRIVATE_REASONING_NEVER_RETRIEVE' }] }),
      row('response_item', { type: 'message', role: 'assistant', channel: 'commentary', content: [{ type: 'output_text', text: '12개 보드 기반. '.repeat(1800) }] }),
      row('response_item', { type: 'function_call', call_id: 'coverage', name: 'exec_command', arguments: '{}' }),
      row('response_item', { type: 'function_call_output', call_id: 'coverage', output: 'routine output '.repeat(1600) + '질문 로그 노출 검사는 제거했고 대체하지 않았다. 1 failed 뒤 복구하여 20 passed.' + 'routine output '.repeat(1600) }),
      row('event_msg', { type: 'task_complete', turn_id: 'current', last_agent_message: '패키지는 20개에서 15개로 정리했습니다. module-ai를 유지했습니다. 전체 테스트 통과.' })];
    await fs.writeFile(file, lines.join('\n') + '\n');
    const started = performance.now();
    const state = await reader.logState(file, 'codex');
    timings.push({ stage: 'initialIndexMs', value: performance.now() - started });
    const baseline = bounded(state.answer, 12000) + require('../src/terminalReviewTools').compactTools(require('../src/terminalReviewTools').toolEvidence(state)) + require('../src/terminalReviewContext').compactUpdates({ items: state.updates });
    assert.doesNotMatch(baseline, /대체하지 않았다/);
    const evidence = await reader.prepareEvidence(state.source, { items: state.context });
    assert.match(JSON.stringify(evidence.recovered), /대체하지 않았다/);
    assert.match(JSON.stringify(evidence.prior), /사용처 없음/);
    const repeated = [];
    for (let sample = 0; sample < 5; sample++) {
      const cachedStart = performance.now(); await reader.logState(file, 'codex');
      const preparedStart = performance.now(); await reader.prepareEvidence(state.source, { items: state.context });
      repeated.push({ cachedLogMs: preparedStart - cachedStart, evidencePreparationMs: performance.now() - preparedStart });
    }
    timings.push({ stage: 'repeatedLocalPreparation', samples: repeated });
    assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_REASONING/);
    assert.equal(state.context[0].request.includes('삭제하지 마'), true);
    assert.match(state.request, /철회/);
    const reference = evidence.records.find(item => item.role === 'tool');
    const missing = await reader.retrieveEvidence(state.source, ['../../private', reference.id]);
    assert.equal(missing[0].status, 'out-of-scope'); assert.equal(missing[1].status, 'available');
    assert.equal((await reader.retrieveEvidence({ file, requestId: 'different-request' }, [reference.id]))[0].status, 'out-of-scope');
    await fs.appendFile(file, '\n');
    assert.equal((await reader.retrieveEvidence(state.source, [reference.id]))[0].status, 'available', 'append preserves immutable referenced bytes');
    await fs.writeFile(file, 'replaced');
    assert.equal((await reader.retrieveEvidence(state.source, [reference.id]))[0].status, 'changed-or-unreadable');
    await fs.unlink(file);
    assert.equal((await reader.retrieveEvidence(state.source, [reference.id]))[0].status, 'expired');
    reports.push({ case: 'package-cleanup', before: 'Final report alone contains passing tests, but no removed check.', afterEvidence: 'Recovered removed check without replacement plus later recovery.', changedDecision: 'Passing tests do not cover the removed log exposure check; resolve coverage before accepting the same assurance.' });
    reports.push({ case: 'deletion-candidates', before: 'Requirement absence alone is not usage evidence.', afterEvidence: evidence.prior.map(item => item.text).join('\n'), changedDecision: 'Reuse the src/renderer usage result; check any uncovered scope before claiming deletion safety.' });

    let requests = 0;
    const secure = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text.split('').reverse().join('')), decryptString: bytes => bytes.toString().split('').reverse().join('') };
    const keyFile = path.join(dir, 'jev-key.json');
    const jev = new JevAnalysis({ file: keyFile, secure, fetchImpl: async (url, options) => {
      requests++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
      const body = JSON.parse(options.body); assert.equal(body.model, 'jev-latest'); assert.equal(Object.keys(body.questions).length, 5);
      return { ok: true, text: async () => JSON.stringify({ model: 'fixture-jev', answers: Object.fromEntries(Object.keys(body.questions).map(name => [name, { type: 'noul', noul: name === 'lostCoverage' ? .9 : .5 }])), usage: { input_tokens: 120, output_tokens: 10 } }) };
    } });
    assert.deepEqual(jev.configure({ apiKey: 'fixture-secret' }), { configured: true, model: 'jev-latest' });
    assert.doesNotMatch(await fs.readFile(keyFile, 'utf8'), /fixture-secret/);
    if (process.platform !== 'win32') assert.equal((await fs.stat(keyFile)).mode & 0o777, 0o600, 'POSIX key file permissions');
    const result = await jev.analyze({ request: '정리해줘', source: '검사를 제거하고 대체하지 않았다.' });
    assert.equal(result.task.typedAnalysis.judgments.fulfilled, 'uncertain');
    assert.equal(result.task.typedAnalysis.findings[0].kind, 'lostCoverage');
    assert.equal(result.task.analysisUsage.total, 130); assert.equal(result.task.alignment, 'unknown');
    const successTransport = jev.fetchImpl;
    jev.fetchImpl = async () => ({ ok: false, status: 401 });
    await assert.rejects(jev.analyze({ request: 'r', source: 's' }), /HTTP 401/);
    jev.fetchImpl = async () => ({ ok: true, text: async () => '{"answers":{}}' });
    await assert.rejects(jev.analyze({ request: 'r', source: 's' }), /판단 응답/);
    assert.equal(jev.configure({ remove: true }).configured, false);

    let remoteGets = 0;
    const session = { id: 'shell', creationId: 'c', pid: 1, status: 'running' };
    const collab = new TerminalCollaboration({ manager: () => ({ list: () => [session], get: () => { remoteGets++; throw new Error('blocked remote host'); } }), directory: path.join(dir, 'collaboration'), monitor: { scan: () => ({ available: true, processes: [] }) }, enableControl: false });
    await collab.sync({ groups: [{ id: 'panel', cwd: dir, members: [session] }], frames: [] });
    assert.equal(remoteGets, 0, 'routine collaboration sync cannot queue behind a remote create');
    const calls = [], pending = [];
    let available = false;
    const service = new TerminalReview({ manager: () => ({ get: id => ({ id, creationId: 'c', pid: 1, status: 'running' }) }),
      completion: {}, runner: { canGenerateTerminalReview: () => available, generateTerminalReview: options => { calls.push(options); return new Promise(resolve => pending.push(resolve)); } } });
    for (const [index, id] of ['background', 'foreground'].entries()) {
      const chunk = { taskId: id, request: `request ${id}`, text: `USER: request ${id}\nASSISTANT: Implemented the requested output, changed the visible message and confirmed it now includes the missing context for users.`, lifecycle: 'completed', submittedAt: index, observedAt: index, queuedAt: index };
      service.entries.set(id, { key: JSON.stringify([id, 'c', 1, undefined]), pending: [chunk], revision: 0, state: 'collecting', latest: {}, seen: {}, locale: 'en' });
      service.scheduling.set(id, { session: { id }, analysis: { provider: 'codex' }, foreground: id === 'foreground' });
    }
    service.drain(); assert.equal(calls.length, 0, 'busy questionnaire leaves review queued without failure');
    available = true; service.drain(); await wait(() => calls.length === 1);
    assert.match(calls[0].prompt, /request foreground/);
    pending.shift()(JSON.stringify({ tasks: [{ requestQuote: 'request foreground', evidenceQuote: 'Implemented the requested output', actual: 'changed', alignment: 'aligned' }] }));
    await wait(() => calls.length === 2);
    pending.shift()(JSON.stringify({ tasks: [{ requestQuote: 'request background', evidenceQuote: 'Implemented the requested output', actual: 'changed', alignment: 'aligned' }] }));
    await wait(() => !service.busy);
    assert.equal(service.entries.get('background').result.tasks[0].analysisMetrics.calls, 1);
    assert.equal(service.entries.get('foreground').result.tasks[0].analysisMetrics.calls, 1);
    let queryCalls = 0, rereads = 0;
    const queryService = new TerminalReview({ manager: () => ({ get: id => ({ id, creationId: 'c', pid: 1, status: 'running' }) }),
      completion: { prepareEvidence: async () => ({ records: [{ id: 'late' }], recovered: [], prior: [], readCount: 0, readChars: 0 }),
        retrieveEvidence: async (_source, ids) => { rereads++; assert.deepEqual(ids, ['late']); return [{ id: 'late', requestId: 'native-query', role: 'tool', status: 'available', text: 'late critical evidence' }]; } },
      runner: { generateTerminalReview: async () => {
        queryCalls++;
        return { text: JSON.stringify({ evidenceRequests: ['late', '../../private'], tasks: [{ requestQuote: 'request query', evidenceQuote: queryCalls === 1 ? 'Implemented the requested output' : 'late critical evidence', actual: 'source read', decision: null }] }), usage: { input: 10, output: 5, cachedInput: 0, cacheWrite: 0, total: 15 } };
      } } });
    const queryChunk = { taskId: 'query', request: 'request query', text: 'ASSISTANT: Implemented the requested output, changed the visible message and confirmed the missing context for the user.', lifecycle: 'completed', submittedAt: 1, observedAt: 1, queuedAt: 1, source: { file: 'owned-native-log', requestId: 'native-query' } };
    queryService.entries.set('query', { key: JSON.stringify(['query', 'c', 1, undefined]), pending: [queryChunk], revision: 0, state: 'collecting', latest: {}, seen: {}, locale: 'en' });
    queryService.scheduling.set('query', { session: { id: 'query' }, analysis: { provider: 'codex' } });
    queryService.drain(); await wait(() => !queryService.busy);
    assert.equal(rereads, 1); assert.equal(queryCalls, 2, 'retrieval plus quality repair never becomes an unbounded model loop');
    assert.equal(queryService.entries.get('query').result.tasks[0].analysisUsage.total, 30);
    const conditionQuote = '파일은 삭제하지 마.';
    for (const linked of [true, false]) {
      let conditionCalls = 0;
      const conditionService = new TerminalReview({ manager: () => ({ get: id => ({ id, creationId: 'c', pid: 1, status: 'running' }) }),
        completion: { prepareEvidence: async () => ({ records: [], recovered: [], prior: [], linkedRecords: [{ id: 'u1', requestId: 'prior-1', role: 'user' }], readCount: 0, readChars: 0 }) },
        runner: { generateTerminalReview: async () => { conditionCalls++; return JSON.stringify({ tasks: [{ requestQuote: 'request condition', evidenceQuote: 'Implemented the requested output', actual: 'checked', decision: {
          complexity: 'simple', conclusion: '삭제 없이 사용처를 확인할 수 있다.', reasons: [{ text: '사용자의 삭제 금지 조건이 유지된다.', evidenceQuote: conditionQuote }], caution: '', action: { kind: 'verify', text: '사용처 확인', why: '삭제하지 않고 판단 근거를 얻는다.', request: '파일은 삭제하지 말고 사용처를 확인해줘.' }, alternatives: []
        } }] }); } } });
      const conditionChunk = { taskId: 'condition', request: 'request condition', text: 'ASSISTANT: Implemented the requested output, changed the visible message and confirmed the missing context for users.', lifecycle: 'completed', observedAt: 0, queuedAt: 0,
        source: { file: 'owned-log', requestId: 'current-1' }, context: { items: [], conditions: [{ role: 'user', requestId: linked ? 'prior-1' : 'foreign', original: conditionQuote }] } };
      const conditionEntry = { key: JSON.stringify(['condition', 'c', 1, undefined]), provider: 'codex', pending: [conditionChunk], latest: { condition: conditionChunk }, seen: {}, revision: 0, locale: 'ko', state: 'collecting' };
      conditionService.entries.set('condition', conditionEntry); conditionService.scheduling.set('condition', { session: { id: 'condition' }, analysis: { provider: 'codex' } });
      conditionService.drain(); await wait(() => !conditionService.busy);
      assert.equal(conditionCalls, linked ? 1 : 2, 'linked user conditions avoid unnecessary repair; foreign context still fails');
      assert.equal(Boolean(conditionEntry.result.tasks[0].decision), linked);
    }
    let capacityNow = 0, capacityCalls = 0;
    const capacityFile = path.join(dir, 'capacity.json');
    const capacity = new TerminalReview({ file: capacityFile, now: () => capacityNow,
      manager: () => ({ get: id => ({ id, creationId: 'c', pid: 1, status: 'running' }) }), completion: {},
      runner: { canGenerateTerminalReview: () => true, generateTerminalReview: async options => {
        capacityCalls++;
        if (capacityCalls === 1) throw Object.assign(new Error('capacity'), { code: 'REVIEW_RATE_LIMITED', retryAfterMs: 1000 });
        const request = options.prompt.includes('request other-provider') ? 'request other-provider' : 'request capacity';
        return { text: JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: 'Implemented the requested output', actual: 'changed' }] }), usage: { input: 10, output: 5, cachedInput: 0, cacheWrite: 0, total: 15 } };
      } } });
    const addCapacity = (id, provider) => {
      const chunk = { taskId: id, request: `request ${id}`, text: 'ASSISTANT: Implemented the requested output, changed the visible message and confirmed the missing context for users.', lifecycle: 'completed', observedAt: 0, queuedAt: 0 };
      capacity.entries.set(id, { key: JSON.stringify([id, 'c', 1, undefined]), provider, pending: [chunk], latest: { [id]: chunk }, seen: {}, revision: 0, locale: 'en', state: 'collecting' });
      capacity.scheduling.set(id, { session: { id }, analysis: { provider } });
    };
    addCapacity('capacity', 'codex'); capacity.drain(); await wait(() => !capacity.busy);
    const deferred = capacity.entries.get('capacity');
    assert.equal(deferred.failed, null); assert.equal(deferred.pending.length, 1);
    assert.equal(capacity.project(deferred).phase, 'backoff'); assert.equal(deferred.retryAt, 1000);
    const reloadedCapacity = new TerminalReview({ file: capacityFile, now: () => capacityNow, runner: {} });
    assert.equal(reloadedCapacity.cooldowns.get('codex'), 1000, 'restart retains account cooldown');
    assert.equal(reloadedCapacity.saved.capacity.pending.length, 1, 'deferred work survives restart');
    for (let n = 0; n < 8; n++) capacity.drain();
    assert.equal(capacityCalls, 1, 'refresh and manual priority cannot bypass cooldown');
    addCapacity('other-provider', 'claude'); capacity.drain(); await wait(() => !capacity.busy);
    assert.equal(capacityCalls, 2, 'another provider can use the freed execution slot');
    capacityNow = 2000; capacity.drain(); await wait(() => !capacity.busy);
    assert.equal(capacityCalls, 3); assert.equal(deferred.state, 'ready');
    assert.equal(deferred.result.tasks[0].analysisUsage, null, 'unreported deferred usage must not count as zero');
    assert.equal(deferred.result.tasks[0].analysisMetrics.deferredAttempts.length, 1);
    clearTimeout(capacity.retryTimer);

    let limitNow = 0, limitCalls = 0;
    const limited = new TerminalReview({ now: () => limitNow, manager: () => ({ get: () => session }), completion: {},
      runner: { generateTerminalReview: async () => { limitCalls++; throw Object.assign(new Error('capacity'), { code: 'REVIEW_RATE_LIMITED', retryAfterMs: 1000 }); } } });
    const limitedChunk = { taskId: 'limited', request: 'request limited', text: 'ASSISTANT: Implemented the requested output, changed the visible message and confirmed the missing context for users.', lifecycle: 'completed', observedAt: 0, queuedAt: 0 };
    const limitedEntry = { key: JSON.stringify(['shell', 'c', 1, undefined]), provider: 'codex', pending: [limitedChunk], latest: { limited: limitedChunk }, seen: {}, revision: 0, locale: 'en', state: 'collecting' };
    limited.entries.set('shell', limitedEntry); limited.scheduling.set('shell', { session, analysis: { provider: 'codex' } });
    for (let n = 0; n < 3; n++) { limited.drain(); await wait(() => !limited.busy); limitNow += 2000; }
    assert.equal(limitCalls, 3); assert.equal(limitedEntry.state, 'error'); assert.equal(limitedEntry.pending.length, 0, 'capacity retries stop after three responses');
    limited.drain(); assert.equal(limitCalls, 3); clearTimeout(limited.retryTimer);
    const oversized = new ReviewEvidenceIndex();
    const hugeRow = { type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(2 * 1024 * 1024) } };
    oversized.add('owned-large-log', { ino: 1 }, 'codex', '', 'large', hugeRow, 0, Buffer.from(JSON.stringify(hugeRow)));
    const hugeId = oversized.manifest('owned-large-log', 'large').records[0].id;
    assert.equal((await oversized.retrieve('owned-large-log', 'large', [hugeId]))[0].status, 'limit', 'read-size limits remain explicit unknowns');
    jev.fetchImpl = successTransport; jev.configure({ apiKey: 'fixture-secret' });
    const jevService = new TerminalReview({ jev, manager: () => ({ get: id => ({ id, creationId: 'c', pid: 1, status: 'running' }) }), completion: {},
      runner: { canGenerateTerminalReview: () => false, generateTerminalReview: () => { throw new Error('Jev must not launch a CLI'); } } });
    const jevChunk = { taskId: 'typed', request: 'request typed', text: 'ASSISTANT: Implemented the requested output and confirmed that the visible message now includes the missing context for users.', lifecycle: 'completed', submittedAt: 1, observedAt: 1, queuedAt: 1 };
    jevService.entries.set('typed', { key: JSON.stringify(['typed', 'c', 1, undefined]), pending: [jevChunk], revision: 0, state: 'collecting', latest: {}, seen: {}, locale: 'en' });
    jevService.scheduling.set('typed', { session: { id: 'typed' }, analysis: { provider: 'jev' } });
    jevService.drain(); await wait(() => !jevService.busy);
    assert.equal(jevService.entries.get('typed').result.tasks[0].analysisProvider, 'jev');
    assert.equal(jevService.entries.get('typed').result.tasks[0].typedAnalysis.judgments.fulfilled, 'uncertain');
    assert.equal(requests, 2, 'each typed analysis bundles its five judgments in one fixture request');

    const out = path.resolve(__dirname, '../artifacts/analysis-pipeline-benchmark.json');
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify({ kind: 'local fixtures; no live-model quality or latency claim', timings, reports, sourceReads: evidence.readCount, readChars: evidence.readChars, baselineFinalChars: baseline.length, preparedEvidenceChars: JSON.stringify(evidence).length, realModelCalls: 0, jevFixtureCalls: requests }, null, 2));
    console.log('PASS source recovery, earlier verification reuse, changed/deleted/foreign record rejection, private reasoning exclusion; encrypted Jev key, typed uncertainty/HTTP errors/usage; collaboration zero remote polling gets; queue priority and automatic draining.');
    console.log(`BENCHMARK ${out}`);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
};
if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
