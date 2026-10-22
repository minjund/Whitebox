'use strict';

const assert = require('node:assert/strict');
const { TerminalReview, exactProcess, parseReview, mergeTasks, screenDelta, stableScreen, reviewPrompt } = require('../src/terminalReview');
const { providerFromPosixProcess } = require('../src/processMonitor');
const { terminalReviewUsage } = require('../src/terminalReviewUsage');
const { normalizeReviewSettings, reviewModelCatalog } = require('../src/terminalReviewSettings');
const { clampPercent } = require('../src/providerUsage');
const layout = require('../renderer/terminal-workspace-layout');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function optimizationChecks() {
  const { submittedPrompt, completedTurn, completionStamp } = require('../src/terminalReviewTurns');
  assert.equal(submittedPrompt('❯ fix the bug\n────────\nstatus'), 'fix the bug');
  assert.equal(submittedPrompt('Accessing workspace:\n❯ No, exit\nYes, I trust this folder\nEnter to confirm · Esc to cancel'), '', 'CLI trust selection is not a user task');
  assert.equal(submittedPrompt('❯ /model\n────────'), '');
  for (const startup of ['claude', 'codex', 'claude --resume', 'codex resume --last', 'Ask Codex to do anything', 'Yes, I trust this folder', 'No, exit', 'Try "fix the bug"']) {
    assert.equal(submittedPrompt(`❯ ${startup}\n────────`), '', 'startup commands and suggested prompts are not user work');
  }

  assert.equal(submittedPrompt('❯ fix the bug\nWorking (esc to interrupt)'), '');
  assert.equal(submittedPrompt('❯ fix the bug\n  keep the API\n────────'), 'fix the bug\nkeep the API');
  const request = 'fix the bug';
  const modern = '› fix the bug\n• I could not reach the other terminal.\n  Worked for 13s • 3:25 PM\n› ';
  assert.ok(completedTurn(modern, request, 'codex'), 'Codex 0.160 footer without decorative rule completes even a failed task');
  assert.equal(completedTurn(modern + '\n• Working (1s • esc to interrupt)', request, 'codex'), '');
  assert.equal(completedTurn('› fix the bug\n• Worked for 13s • 3:25 PM\n› ', request, 'codex'), '', 'answer text is not a completion footer');
  const working = `› ${request}\n• Updating files\nWorking (esc to interrupt)\n› `;
  const complete = `› ${request}\n• Fixed the bug and ran tests. The error display now explains which input the user needs to correct before continuing.\n─ Worked for 12s ─────\nThe changes are ready. The updated error message now explains which value the user needs to correct.\n› `;
  assert.equal(completedTurn(working, request, 'codex'), '');
  assert.ok(completedTurn(complete, request, 'codex'));
  assert.equal(completedTurn(complete + '\nWorking (esc to interrupt)', request, 'codex'), '');
  assert.equal(completedTurn('❯ fix the bug\n⏺ Done\n✻ Cogitated for 5s · done 11:07 AM\n❯ ', request, 'claude').includes('⏺ Done'), true);
  assert.equal(completedTurn('✻ Cogitated for 5s · done 11:07 AM\n❯ fix the bug\n⏺ thinking\n❯ ', request, 'claude'), '', 'old completion cannot finish a new request');
  const oldAnswer = '❯ 뭐해?\n⏺ Waiting\n✻ Cogitated for 5s · done 11:07 AM\n❯ ㅎ';
  const newAnswer = '❯ 뭐해?\n⏺ Waiting\n✻ Cogitated for 5s · done 11:07 AM\n❯ ㅎㅇ\n⏺ ㅎㅇ! 뭐 도와줄까요?\n✻ Crunched for 4s · done 1:16 PM\n❯ ';
  const stamp = completionStamp(oldAnswer, 'claude');
  assert.equal(completedTurn(oldAnswer, 'ㅎ', 'claude', stamp), '', 'draft does not reuse a past completion');
  assert.ok(completedTurn(newAnswer, 'ㅎ', 'claude', stamp).startsWith('❯ ㅎㅇ'), 'late IME/PTY echo binds to the actual submitted request');
  const session = { id: 'opt', creationId: 'opt:1', pid: 10, status: 'running' };
  let now = 0;
  const calls = [];
  const service = new TerminalReview({ manager: () => ({ get: () => session }), now: () => now,
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'codex', pid: 11, ancestorPids: [10] }] }) },
    runner: { generateTerminalReview: ({ prompt }) => new Promise((resolve, reject) => calls.push({ prompt, resolve, reject })) } });
  const capture = (text, extra = {}) => service.capture({ id: session.id, creationId: session.creationId, text, ...extra });
  assert.equal((await capture(complete)).state, 'watching', 'old conversation never auto-starts review');
  now = 300000; await capture(complete); assert.equal(calls.length, 0, 'idle time alone never triggers analysis');
  const submission = { id: 'turn-1', request };
  assert.equal((await capture(working, { submission })).state, 'awaiting-answer');
  now += 300000; await capture(working, { submission, force: true });
  assert.equal(calls.length, 0, 'neither silence nor manual refresh interrupts an unfinished answer');
  await capture(complete, { submission });
  assert.equal(calls.length, 0, 'completion evidence must settle');
  now += 1000; assert.equal((await capture(complete, { submission })).state, 'reviewing');
  assert.equal(calls.length, 1);
  calls[0].resolve(JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: 'Fixed the bug', actual: 'Fixed', alignment: 'aligned' }] })); await tick();
  assert.equal(service.entries.get(session.id).result.tasks[0].request, request);
  now += 90000; await capture(complete, { submission });
  assert.equal(calls.length, 1, 'one analysis per completed submitted request');
  const next = { id: 'turn-2', request: 'another task' };
  const nextWorking = complete + '\n› another task\n• still working';
  await capture(nextWorking, { submission: next });
  now += 90000; await capture(nextWorking, { submission: next });
  assert.equal(calls.length, 1, 'long work does not receive timed intermediate analysis');
  const nextComplete = nextWorking + '\n─ Worked for 90s ───\nTask finished.\n› ';
  await capture(nextComplete, { submission: next }); now += 1000;
  await capture(nextComplete, { submission: next }); assert.equal(calls.length, 2);
  calls[1].reject(new Error('test timeout')); await tick();
  now += 90000;
  assert.equal((await capture(nextComplete, { submission: next })).message, 'test timeout');
  assert.equal(calls.length, 2, 'failed unchanged analysis never retries automatically');
  await capture(nextComplete, { submission: next, force: true });
  assert.equal(calls.length, 3, 'explicit retry retains completed evidence');
  calls[2].resolve(JSON.stringify({ tasks: [{ requestQuote: next.request, evidenceQuote: 'Task finished.', actual: 'Done', alignment: 'aligned' }] })); await tick();
  assert.equal(service.entries.get(session.id).result.tasks.length, 2);
  await capture(nextComplete, { submission: next }); assert.equal(calls.length, 3);
  const repeated = { id: 'turn-3', request: 'another task' };
  await capture(nextComplete + '\n› another task', { submission: repeated });
  now += 90000; await capture(nextComplete + '\n› another task', { submission: repeated });
  assert.equal(calls.length, 3, 'repeating the same request cannot reuse an old completion');
  console.log('PASS submitted request → completed answer → single analysis; no idle/stream/tool-pause triggers, manual retry');
}

async function startupChecks() {
  let now = 1000, completion = { available: true, state: 'completed', requestId: 'old', request: '기존 작업', requestAt: 100,
    evidence: 'ASSISTANT: 이전 작업을 완료했고 테스트를 통과했습니다.' };
  const calls = [];
  const session = { id: 'startup', creationId: 'startup:1', pid: 10, status: 'running' };
  const service = new TerminalReview({ now: () => now, quietMs: 0,
    manager: () => ({ get: () => session }), completion: { observe: async () => completion },
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'claude', pid: 11, ancestorPids: [10] }] }) },
    runner: { generateTerminalReview: options => { calls.push(options); return new Promise(() => {}); } } });
  const capture = extra => service.capture({ id: session.id, creationId: session.creationId, text: 'Claude Code welcome screen', ...extra });
  await capture({ force: true });
  assert.equal(calls.length, 0, 'initial capture never analyzes restored conversation history');
  for (const request of ['claude', 'codex --resume', 'Try "fix the bug"', 'Yes, I trust this folder', '<command-name>/clear</command-name>', '/reload-skills']) {
    now += 100;
    completion = { ...completion, requestId: String(now), request, requestAt: now };
    const view = await capture({ submission: { id: String(now), request, at: now }, force: true });
    assert.equal(view.state, 'watching');
    assert.equal(view.result, null, 'startup and setup controls do not create analysis cards');
    assert.equal(calls.length, 0);
  }
  now += 100;
  completion = { ...completion, requestId: 'real', request: '오류 문구 고쳐줘', requestAt: now,
    evidence: 'ASSISTANT: 오류 문구를 수정했고 테스트를 통과했습니다.' };
  await capture({ submission: { id: 'real', request: completion.request, at: now } });
  assert.equal(calls.length, 1, 'the first real user request still starts analysis');
  console.log('PASS terminal startup: no analysis or cards for launch, restored history, setup controls and suggested prompts; first user task is analyzed');
}

async function commandBoundaryChecks() {
  const session = { id: 'commands', creationId: 'commands:1', pid: 10, status: 'running' };
  let now = 100, completion = { available: true, state: 'working' };
  const calls = [];
  const service = new TerminalReview({ manager: () => ({ get: () => session }), now: () => now, quietMs: 0,
    completion: { observe: async () => completion },
    monitor: { scan: () => ({ available: true, processes: [{ provider: 'claude', pid: 11, ancestorPids: [10] }] }) },
    runner: { generateTerminalReview: options => new Promise((resolve, reject) => calls.push({ ...options, resolve, reject })) } });
  const capture = extra => service.capture({ id: session.id, creationId: session.creationId, text: 'unrelated terminal history', ...extra });
  const submit = async (id, request) => {
    now += 100;
    completion = { available: true, state: 'working', requestId: id, request, requestAt: now };
    await capture({ submission: { id, request, at: now } });
    completion = { ...completion, state: 'completed', tools: { items: [{ name: 'Edit', status: 'returned', excerpt: 'The requested text was changed' }] }, evidence: `USER: ${request}\nASSISTANT: ${id} finished` };
    await capture();
  };
  const finish = async (call, id, request, total) => {
    call.resolve({ text: JSON.stringify({ tasks: [{ request: 'model summary', requestQuote: request, evidenceQuote: `${id} finished`, alignment: 'aligned', actual: 'AI reported done', verification: 'Not independently checked' }] }), usage: { total } });
    await tick();
  };
  await submit('a', '제목을 안녕으로 바꿔줘');
  await submit('b', '제목을 안녕으로 바꿔줘');
  await submit('c', '제목과 버튼 문구를 바꿔줘');
  assert.equal(calls.length, 1, 'analysis stays single-flight while later commands queue');
  assert.equal(service.entries.get(session.id).pending.length, 2, 'completed commands are not lost during analysis');
  await finish(calls[0], 'a', '제목을 안녕으로 바꿔줘', 101);
  await capture();
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /b finished/u);
  assert.doesNotMatch(calls[1].prompt, /a finished|c finished/u, 'each analysis gets only its command evidence');
  await finish(calls[1], 'b', '제목을 안녕으로 바꿔줘', 202);
  await capture();
  assert.equal(calls.length, 3);
  assert.doesNotMatch(calls[2].prompt, /a finished|b finished/u);
  await finish(calls[2], 'c', '제목과 버튼 문구를 바꿔줘', 303);
  const result = (await capture()).result;
  assert.equal(result.tasks.length, 3, 'text edits, identical repeats and multi-change requests each get one card');
  assert.equal(new Set(result.tasks.map(task => task.taskId)).size, 3);
  assert.deepEqual(result.tasks.map(task => task.analysisUsage.total), [101, 202, 303]);
  assert.equal(result.tasks[2].request, '제목과 버튼 문구를 바꿔줘', 'user request is not replaced by model summary');
  await capture({ force: true, text: 'changed screen' });
  assert.equal(calls.length, 3, 'successful identical evidence is not billed again on refresh');
  assert.equal((await capture()).result.tasks.length, 3);
  const item = { requestQuote: 'rename', evidenceQuote: 'done', alignment: 'aligned' };
  assert.throws(() => parseReview(JSON.stringify({ tasks: [item, item] }), 'rename done', 'en', 'rename'), /single request/u);
  assert.throws(() => parseReview('{"tasks":[]}', 'rename done', 'en', 'rename'), /single request/u, 'a tiny request cannot silently disappear');
  const mismatched = parseReview(JSON.stringify({ tasks: [item] }), 'old request: rename; done', 'ko', 'change title');
  assert.equal(mismatched.tasks[0].alignment, 'unknown', 'a previous request cannot justify current alignment');
  assert.equal(mismatched.tasks[0].request, 'change title');
  console.log('PASS one command per review: small edits, repeated requests, multi-change command, pending queue, isolated usage, deduplicated refresh and invalid model boundaries');
}

async function main() {
  await require('./terminal-review-context-test')();
  await require('./terminal-review-tools-test')();
  await require('./terminal-review-budget-test')();
  await startupChecks();
  await commandBoundaryChecks();
  await require('./terminal-review-completion-test')();
  assert.equal(stableScreen('[Fable 5] | task | ⏱️ 40m'), stableScreen('[Fable 5] | task | ⏱️ 41m'));
  const idleBefore = '  [Fable 5 ◑ high] │ project │ ⏱️  1h 15m │ Cost $0.238\n  Context ░░░░░░ 4% │ Usage ░░░░░░ 2% (resets in 1h 38m)';
  const idleAfter = idleBefore.replace('1h 15m', '1h 16m').replace('1h 38m', '1h 37m');
  assert.equal(screenDelta(stableScreen(idleBefore), stableScreen(idleAfter)), '', 'actual CLI clocks do not trigger idle reanalysis');
  assert.notEqual(stableScreen(idleBefore), stableScreen(idleBefore.replace('4%', '5%')), 'meaningful status changes remain visible');
  assert.equal(stableScreen('Please document (resets in 1h 38m)'), 'Please document (resets in 1h 38m)', 'user evidence remains unchanged');
  assert.notEqual(stableScreen('request: wait 40m'), stableScreen('request: wait 41m'));
  assert.match(reviewPrompt('unchanged evidence', 'en'), /English/);
  assert.match(reviewPrompt('unchanged evidence', 'zh-CN'), /简体中文/);
  assert.equal(clampPercent(null), null);
  assert.equal(clampPercent(''), null);
  assert.equal(clampPercent(0), 0);
  const { codexUsageWindows } = require('../src/providerUsage');
  assert.equal(codexUsageWindows({ primary: { used_percent: 56, window_minutes: 10080 } }).weekly.usedPercent, 56, 'a weekly primary window must not be labeled short-term');
  assert.equal(codexUsageWindows({ primary: { used_percent: 7, window_minutes: 300 }, secondary: { used_percent: 3, window_minutes: 10080 } }).shortWindow.usedPercent, 7);
  assert.deepEqual(normalizeReviewSettings({ provider: 'invalid', models: { codex: '--help', claude: 'sonnet' } }), { provider: 'auto', models: { codex: '', claude: 'sonnet' } });
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const modelDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-review-models-'));
  try {
    await fs.writeFile(path.join(modelDir, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'fixture-model', display_name: 'Fixture model', visibility: 'list' }, { slug: 'hidden-model', visibility: 'hide' }] }));
    assert.deepEqual((await reviewModelCatalog(modelDir)).codex, [{ id: 'fixture-model', label: 'Fixture model' }]);
  } finally { await fs.rm(modelDir, { recursive: true, force: true }); }
  assert.deepEqual(terminalReviewUsage('codex', { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 150 }), { input: 1000, output: 150, cachedInput: 800, cacheWrite: 0, total: 1150 });
  assert.deepEqual(terminalReviewUsage('claude', { input_tokens: 100, cache_read_input_tokens: 800, cache_creation_input_tokens: 200, output_tokens: 150 }), { input: 1100, output: 150, cachedInput: 800, cacheWrite: 200, total: 1250 });
  assert.equal(terminalReviewUsage('codex', {}), null);
  assert.equal(terminalReviewUsage('claude', { input_tokens: -1, output_tokens: 10 }), null);
  assert.equal(terminalReviewUsage('codex', { input_tokens: 0, output_tokens: 0 }).total, 0);
  await optimizationChecks();
  assert.equal(providerFromPosixProcess({ name: '/usr/local/lib/n', commandLine: '/usr/local/lib/node_modules/@openai/codex/vendor/bin/codex' }), 'codex');
  assert.equal(providerFromPosixProcess({ name: '/usr/local/lib/n', commandLine: '/usr/local/lib/node_modules/@openai/codex/vendor/bin/codex app-server' }), null);
  assert.equal(providerFromPosixProcess({ name: '/bin/echo', commandLine: '/bin/echo /usr/local/bin/codex' }), null);
  assert.equal(providerFromPosixProcess({ name: '/usr/local/lib/n', commandLine: '/other/path/codex' }), null);
  const first = { id: 'one', creationId: 'workspace:one', pid: 100, status: 'running', cwd: '/same', createdAt: '2026-10-21T01:00:00Z' };
  const second = { ...first, id: 'two', creationId: 'workspace:two', pid: 200 };
  const process = { provider: 'codex', pid: 110, ancestorPids: [100, 50] };
  let snapshot = { available: true, processes: [process] };
  assert.equal(exactProcess(first, snapshot), process);
  assert.equal(exactProcess(second, snapshot), null, 'same cwd cannot bind another terminal');
  assert.equal(exactProcess(first, { available: false, processes: [process] }), null);
  assert.equal(exactProcess(first, { available: true, processes: [process, { provider: 'claude', pid: 111, ancestorPids: [100] }] }), null, 'ambiguous descendants fail closed');
  const source = 'USER: CSV 파일을 정렬해줘.\nAI: 두 열을 오름차순으로 정렬했습니다.\n' + '추가 관찰 문장. '.repeat(20);
  const raw = JSON.stringify({ tasks: [{ request: 'CSV 정렬', requestQuote: 'CSV 파일을 정렬해줘.', actual: '정렬 수행을 보고함', evidenceQuote: '두 열을 오름차순으로 정렬했습니다.', alignment: 'aligned', explanation: 'AI 설명상 요청과 부합', verification: '실제 테스트 미확인', understanding: '두 열을 기준으로 정렬', remaining: '결과 확인' }] });
  assert.equal(parseReview(raw, source).tasks[0].alignment, 'aligned');
  assert.deepEqual(parseReview('{"tasks":[]}\n\n현재는 인사뿐입니다.', source), { tasks: [] }, 'trailing prose reproduces and fixes the reported JSON position 14 error');
  assert.deepEqual(parseReview('분석 결과:\n```json\n' + raw + '\n```\n이상입니다.', source), parseReview(raw, source));
  assert.deepEqual(parseReview(raw + '\n' + raw, source), parseReview(raw, source), 'identical duplicate output is not a second analysis');
  assert.throws(() => parseReview(raw + '\n{"tasks":[]}', source), /분석 응답의 형식/u, 'conflicting results are never guessed');
  assert.throws(() => parseReview('{"tasks":[null]}', source), /분석 응답의 형식/u);
  assert.throws(() => parseReview('{"tasks":[', source, 'en'), /analysis response/u);
  const braceRaw = JSON.stringify({ tasks: [{ requestQuote: 'CSV 파일을 정렬해줘.', evidenceQuote: '두 열을 오름차순으로 정렬했습니다.', explanation: 'A } and "quoted" { brace', alignment: 'aligned' }] });
  assert.equal(parseReview('```json\n' + braceRaw + '\n```', source).tasks[0].explanation, 'A } and "quoted" { brace');
  const hallucinated = parseReview(raw, 'completely unrelated terminal output');
  assert.equal(hallucinated.tasks[0].alignment, 'unknown');
  assert.equal(hallucinated.tasks[0].requestQuote, '');
  assert.equal(hallucinated.tasks[0].actual, '작업 결과의 근거가 아직 부족합니다.');
  assert.throws(() => parseReview('not JSON', source));
  const oldTask = { requestQuote: '첫 번째 작업', actual: '완료' };
  const newTask = { requestQuote: '두 번째 작업', actual: '진행 중' };
  assert.deepEqual(mergeTasks([oldTask], [newTask]), [oldTask, newTask], 'separate tasks survive screen truncation');
  assert.deepEqual(mergeTasks([oldTask, newTask], [{ ...newTask, actual: '완료' }]), [oldTask, { ...newTask, actual: '완료' }]);
  const firstAnalysis = { ...oldTask, analysisId: 'first', analysisUsage: { total: 120 } };
  const nextAnalysis = { ...oldTask, analysisId: 'next', analysisUsage: { total: 240 } };
  assert.deepEqual(mergeTasks([firstAnalysis], [nextAnalysis]), [firstAnalysis, nextAnalysis], 'repeated request in a new analysis keeps both usage records');
  assert.deepEqual(mergeTasks([firstAnalysis, nextAnalysis], [nextAnalysis]), [firstAnalysis, nextAnalysis], 'polling the same analysis does not duplicate history or usage');
  await require('./terminal-review-policy-test')();
  const tree = layout.split(layout.split({ id: 'a' }, 'a', 'b'), 'b', 'c', 'column');
  assert.deepEqual(layout.ids(tree), ['a', 'b', 'c']);
  assert.deepEqual(layout.ids(layout.remove(tree, 'b')), ['a', 'c']);
  assert.deepEqual(layout.ids(layout.restore(tree, new Set(['a', 'c']))), ['a', 'c']);
  assert.deepEqual(layout.ids(layout.restore({ axis: 'row', first: { id: 'a' }, second: { id: 'a' } }, new Set(['a']))), ['a']);
  console.log('PASS terminal review: exact ownership, ambiguity, citation validation, concurrency, stale/restart/pause/exit isolation, split persistence');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
