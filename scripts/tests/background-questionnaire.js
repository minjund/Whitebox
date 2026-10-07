'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');
const { BackgroundQuestionnaire: QuestionnaireService, AUTHORITY, explanationOnly, parseResult } = require('../../src/backgroundQuestionnaire');
const { questionnaireCommand, utf8PipeSpec } = require('../../src/questionnaireCommand');
const { CmuxMembership } = require('../../src/cmuxMembership');
const { AgentRunner } = require('../../src/agentRunner');
const { selectAgentProcesses } = require('../../src/processMonitor');
const { isEligibleSession } = require('../../renderer/comprehension-packet');

// These generation tests represent a user who has already opted in.
class BackgroundQuestionnaire extends QuestionnaireService {
  constructor(options) { super({ ...options, enabled: true }); }
}

function packet() {
  return { schemaVersion: 1, id: 'packet-1', title: '버튼 수정', summary: '버튼을 파란색으로 변경했다. 기존 테마와 통일하기 위해 선택했다. 색 대비 검사는 아직 하지 않았다.',
    difficulty: 1, difficultyReason: '간단한 색상 변경이다.', evidence: [{ id: 'e1', label: '완료 답변', detail: '버튼을 파란색으로 바꿨다.' }],
    questions: [{ id: 'q1', kind: 'comprehension', topics: ['change', 'decision', 'constraint-risk'], prompt: '검증 상태에 대한 올바른 설명은?',
      options: [{ id: 'a', label: '테마에 맞췄지만 색 대비 검사는 남았다.' }, { id: 'b', label: '색 대비 검사를 통과했다.' }], answerId: 'a', explanation: '완료 답변에 대비 검사가 남았다고 명시되어 있다.', evidenceIds: ['e1'],
      variant: { prompt: '아직 남아 있는 것은?', options: [{ id: 'a', label: '색 대비 검사' }, { id: 'b', label: '파란색 적용' }], answerId: 'a', explanation: '파란색 적용은 이미 완료되었다.' } }],
  };
}

const quiz = () => JSON.stringify({ kind: 'quiz', packet: packet() });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settled(service) {
  for (let count = 0; count < 50 && service.busy; count += 1) await tick();
  assert.equal(service.busy, false);
}
function session(id = 'task', turn = 1, prompt = '버튼을 파란색으로 바꿔줘') {
  return { id, provider: 'codex', depth: 0, status: 'completed', completionObserved: true,
    completedAt: new Date(2_000 + turn * 1_000).toISOString(), messages: [{ id: `${id}-u${turn}`, role: 'user', text: prompt }],
    questionnaireSource: { prompt, answer: '버튼을 파란색으로 변경했습니다. 기존 테마와 통일했습니다. 색 대비 검사는 아직 하지 않았습니다.' } };
}

function registerBackgroundQuestionnaireTests({ test, temp }) {
  test('cmux 소속은 정확한 대화 ID로 유지하며 재시작 후에도 작업자와 오케스트레이터를 구분한다', () => {
    const processes = selectAgentProcesses([
      { pid: 1, parentPid: 0, name: '/Applications/cmux.app/Contents/MacOS/cmux' },
      { pid: 2, parentPid: 1, name: '/bin/zsh' },
      { pid: 3, parentPid: 2, name: 'agent' },
      { pid: 4, parentPid: 0, name: 'agent' },
    ], { environment: 'macos', providerResolver: row => row.name === 'agent' ? 'codex' : '' });
    assert.equal(processes.find(row => row.pid === 3).terminalHost, 'cmux');
    assert.equal(processes.find(row => row.pid === 4).terminalHost, undefined);
    const file = path.join(temp, 'cmux-membership.json');
    const membership = new CmuxMembership(file);
    const groups = [{ id: 'group', title: 'TAW', cwd: '/shared', members: [
      { id: 'leader', title: '오케스트레이션', sessionIds: ['leader-session', 'previous-session'], currentSessionId: 'leader-session', processIds: [100] },
      { id: 'worker', title: '작업자', sessionIds: ['worker-session'], processIds: [200] },
    ] }];
    membership.update(groups, [{ id: 'exact-pid', runtimePresence: [{ pid: 100 }] }, { id: 'wsl', environment: { kind: 'wsl' }, runtimePresence: [{ pid: 100 }] }]);
    assert.equal(membership.project({ id: 'leader-session' }).cmux.role, 'orchestrator');
    assert.equal(membership.project({ id: 'worker-session' }).cmux.role, 'worker');
    assert.equal(membership.project({ id: 'leader-session' }).cmux.active, true);
    assert.equal(membership.project({ id: 'previous-session' }).cmux.active, false);
    assert.equal(membership.project({ id: 'exact-pid' }).cmux.role, 'orchestrator');
    assert.equal(membership.project({ id: 'wsl' }).cmux, undefined);
    assert.equal(membership.project({ id: 'unrelated', cwd: '/shared' }).cmux, undefined);
    membership.update([], [{ id: 'new-while-disabled', runtimePresence: [{ terminalHost: 'cmux' }] }]);
    assert.equal(membership.project({ id: 'new-while-disabled' }).cmux.role, 'unknown');
    const reloaded = new CmuxMembership(file);
    assert.equal(reloaded.project({ id: 'worker-session' }).cmux.workspaceId, 'group');
    assert.equal(reloaded.project({ id: 'reused-pid', runtimePresence: [{ pid: 100 }] }).cmux, undefined);
  });

  test('cmux 설문지는 오케스트레이터의 완료 대화만 사용하고 작업자 결과는 생성하지 않는다', async () => {
    const leader = { ...session('leader'), cmux: { workspaceId: 'group', role: 'orchestrator', active: true } };
    const worker = { ...session('worker'), cmux: { workspaceId: 'group', role: 'worker', active: true } };
    const requests = [];
    const service = new BackgroundQuestionnaire({ file: path.join(temp, 'quiz-cmux.json'), now: () => 1000,
      requestDetail: async id => { requests.push(id); return id === leader.id ? leader : worker; },
      runner: { generateQuestionnaire: async () => quiz() } });
    const historical = { ...session('previous'), cmux: { workspaceId: 'group', role: 'orchestrator', active: false } };
    service.observe([]); service.observe([{ ...leader, cmux: { ...leader.cmux, active: false } }, worker, historical]); await settled(service);
    assert.deepEqual(requests, [], 'unconfirmed bindings cannot generate');
    service.observe([leader, worker, historical]); await settled(service);
    assert.deepEqual(requests, ['leader']);
    assert.equal(service.project(leader).comprehension.status, 'ready');
    assert.equal(service.project(worker).comprehension, undefined);
    assert.equal(service.project(historical).comprehension, undefined);
  });

  test('오케스트레이터 보고 생성은 같은 요청의 모니터 재개를 견디고 새 요청과 분리한다', async () => {
    let task = { ...session('report'), cmux: { role: 'orchestrator', active: true } };
    let resolve;
    const inputs = [];
    const service = new BackgroundQuestionnaire({ file: path.join(temp, 'quiz-report.json'), now: () => 1000,
      requestDetail: async () => task, runner: { generateQuestionnaire: input => { inputs.push(input); return new Promise(done => { resolve = done; }); } } });
    service.observe([]); service.observe([task]); await tick();
    assert(inputs[0].prompt.includes('completed milestones'));
    const completed = task;
    task = { ...task, status: 'running', completionObserved: false };
    service.observe([task]); resolve(quiz()); await settled(service);
    assert.equal(service.project(task).comprehension, undefined, 'in-progress report is never shown as complete');
    task = completed; service.observe([task]); await settled(service);
    assert.equal(service.project(task).comprehension.status, 'ready');
    assert.equal(inputs.length, 1, 'monitor activity does not discard or charge again for a completed quiz');
    task = { ...session('report', 2), cmux: completed.cmux };
    service.observe([task]); await tick();
    task = { ...session('report', 3), status: 'running', completionObserved: false, cmux: completed.cmux };
    service.observe([task]); resolve(quiz()); await settled(service);
    assert.equal(service.project(task).comprehension, undefined, 'changed human request cannot receive previous report');
  });

  test('오케스트레이터의 누락·건너뛴 결과는 명시적으로 다시 생성하되 작업자는 제외한다', async () => {
    const task = { ...session('manual-report'), cmux: { role: 'orchestrator', active: true } };
    let calls = 0;
    const service = new BackgroundQuestionnaire({ file: path.join(temp, 'quiz-manual-report.json'), now: () => 5000,
      requestDetail: async () => task, runner: { generateQuestionnaire: async () => { calls += 1; return calls === 1 ? '{"kind":"skip"}' : quiz(); } } });
    service.observe([task]); assert.equal(calls, 0, 'historical work is not billed automatically');
    assert.equal(service.retry(task.id).ok, true); await settled(service);
    assert.equal(service.project(task).comprehension.skipReason, 'no-deliverable');
    assert.equal(service.retry(task.id).ok, true); await settled(service);
    assert.equal(service.project(task).comprehension.status, 'ready');
    assert.equal(service.retry(task.id).ok, false, 'ready quiz is not regenerated');
    service.observe([{ ...task, cmux: { ...task.cmux, role: 'worker' } }]);
    assert.equal(service.retry(task.id).ok, false);
    assert.equal(parseResult('```json\n' + quiz() + '\n```').status, 'ready');
    assert.throws(() => parseResult('Here is your quiz: ' + quiz()));
  });

  test('설명·비교는 퀴즈 대상에서 제외하고 AI 결과는 엄격하게 검증한다', () => {
    for (const text of ['이게 무슨 뜻이야?', '어떤 방식이 더 좋아?', '아직 어떤 방식으로 할지 모르겠어', '1번 2번 무슨차이야?', 'Why does this happen?']) assert(explanationOnly(text), text);
    assert(!explanationOnly('설명하고 코드에 적용해줘'));
    assert(!explanationOnly('PT · GPT · giftshop-api-master에서 모듈로 나눠진 애들이랑 infra 모듈 안에 있는 애들의 나눈 기준이 궁금한데 분석해줘봐'));
    assert(!explanationOnly('Why are these modules separate? Analyze their responsibilities.'));
    assert.equal(parseResult(quiz()).status, 'ready');
    assert.equal(parseResult('{"kind":"skip"}').status, 'skipped');
    for (const bad of ['{}', '```json\n{}\n```', '{"kind":"skip","packet":{}}', JSON.stringify({ kind: 'quiz', packet: { ...packet(), summary: '<script>x</script>' } })]) assert.throws(() => parseResult(bad));
  });

  test('새 완료 작업만 한 번 생성하고 원래 대화·카드 수·내용을 보존한다', async () => {
    let calls = 0;
    const task = session();
    const runner = { generateQuestionnaire: async input => { calls += 1; assert(input.prompt.includes(task.questionnaireSource.answer)); return quiz(); } };
    const service = new BackgroundQuestionnaire({ file: path.join(temp, 'quiz-single.json'), runner, requestDetail: async () => task, now: () => 1_000 });
    const history = session('history');
    service.observe([history]);
    assert.equal(calls, 0, 'startup history must not consume tokens');
    const original = JSON.stringify(task);
    service.observe([history, task]);
    service.observe([history, task]);
    await settled(service);
    assert.equal(calls, 1);
    service.observe([history, { ...task, completedAt: new Date(10_000).toISOString() }]);
    await settled(service);
    assert.equal(calls, 1, 'completion metadata drift must not charge twice for the same user turn');
    assert.equal(JSON.stringify(task), original);
    const projected = service.project(task);
    assert.equal(projected.comprehension.status, 'ready');
    assert.equal(projected.comprehensionOrigin.authority, AUTHORITY);
    assert(isEligibleSession(projected));
    assert.equal(service.current.size, 2);
    const reloaded = new BackgroundQuestionnaire({ file: service.file, runner, requestDetail: async () => task });
    reloaded.observe([task]);
    assert.equal(reloaded.project(task).comprehension.status, 'ready');
    assert.equal(calls, 1);
    assert(!fs.readFileSync(service.file, 'utf8').includes('INPUT:'));
  });

  test('작업 이후 설명 질문은 이전 완료 퀴즈를 재사용하지 않고 추가 생성도 하지 않는다', async () => {
    let calls = 0;
    let task = session();
    const runner = { generateQuestionnaire: async () => { calls += 1; return quiz(); } };
    const service = new BackgroundQuestionnaire({ file: path.join(temp, 'quiz-info.json'), runner, requestDetail: async () => task, now: () => 1_000 });
    service.observe([]); service.observe([task]); await settled(service);
    task = session('task', 2, '이게 무슨 뜻이야?');
    service.observe([task]); await settled(service);
    assert.equal(calls, 1);
    assert.equal(service.project(task).comprehension.status, 'skipped');
    assert.equal(isEligibleSession(service.project(task)), false);
    const unknown = session('unknown', 1, '그럼 이 선택이 나한테 맞을까?');
    runner.generateQuestionnaire = async () => '{"kind":"skip"}';
    task = unknown; service.observe([unknown]); await settled(service);
    assert.equal(service.project(unknown).comprehension.status, 'skipped');
  });

  test('질문지 생성 중 새 턴이 시작되면 이전 결과를 붙이지 않고 요청을 순차 실행한다', async () => {
    const pending = [];
    const tasks = [session('first'), session('second')];
    const service = new BackgroundQuestionnaire({ file: path.join(temp, 'quiz-race.json'),
      runner: { generateQuestionnaire: () => new Promise(resolve => pending.push(resolve)) },
      requestDetail: async id => tasks.find(task => task.id === id), now: () => 1_000 });
    service.observe([]); service.observe(tasks); await tick();
    assert.equal(pending.length, 1);
    assert.equal(service.project(tasks[1]).comprehension.status, 'queued');
    tasks[0] = { ...tasks[0], status: 'running', completionObserved: false };
    service.observe(tasks); pending.shift()(quiz()); await tick();
    assert.equal(service.project(tasks[0]).comprehension, undefined);
    assert.equal(pending.length, 1);
    pending.shift()(quiz()); await settled(service);
    assert.equal(service.project(tasks[1]).comprehension.status, 'ready');
  });

  test('실패는 자동 재과금 없이 원래 작업에 남고 명시적 재시도·재시작 복구를 지원한다', async () => {
    const task = session(); let calls = 0;
    const runner = { generateQuestionnaire: async () => { calls += 1; return calls === 1 ? '{}' : quiz(); } };
    const service = new BackgroundQuestionnaire({ file: path.join(temp, 'quiz-retry.json'), runner, requestDetail: async () => task, now: () => 1_000 });
    service.observe([]); service.observe([task]); await settled(service);
    assert.equal(service.project(task).comprehension.status, 'failed');
    service.observe([task]); await settled(service); assert.equal(calls, 1);
    assert.equal(service.retry(task.id).ok, true); await settled(service);
    assert.equal(service.project(task).comprehension.status, 'ready'); assert.equal(calls, 2);
    const saved = JSON.parse(fs.readFileSync(service.file, 'utf8')); saved.records[0].status = 'generating';
    fs.writeFileSync(service.file, JSON.stringify(saved));
    const recovered = new BackgroundQuestionnaire({ file: service.file, runner, requestDetail: async () => task });
    recovered.observe([task]); assert.equal(recovered.project(task).comprehension.status, 'failed'); assert.equal(calls, 2);
  });

  test('백그라운드 CLI는 비영속·도구 제한·stdin 입력을 사용하고 프로세스 카드에 연결하지 않는다', () => {
    for (const provider of ['codex', 'claude']) {
      const spec = questionnaireCommand(provider, temp, '', 'linux');
      assert(spec.args.includes(provider === 'codex' ? '--ephemeral' : '--no-session-persistence'));
      assert(!spec.args.includes('resume'));
      const rows = [{ pid: 33, parentPid: 1, name: provider, commandLine: `${provider} ${spec.args.join(' ')}`, startedAt: new Date().toISOString() },
        { pid: 34, parentPid: 1, name: provider, commandLine: `${provider} interactive`, startedAt: new Date().toISOString() }];
      assert.deepEqual(selectAgentProcesses(rows, { providerResolver: () => provider }).map(row => row.pid), [34]);
    }
    if (process.platform === 'win32') {
      const dir = path.join(temp, 'quiz-utf8-shim'); fs.mkdirSync(dir);
      const shim = path.join(dir, 'provider.ps1');
      fs.writeFileSync(path.join(dir, 'echo.js'), "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({input:s,args:process.argv.slice(2)})));\n");
      fs.writeFileSync(shim, '& node "$PSScriptRoot/echo.js" @args\r\n');
      const modern = path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe');
      const file = fs.existsSync(modern) ? modern : 'powershell.exe';
      const spec = utf8PipeSpec({ file, args: ['-NoProfile', '-File', shim, '한글 인자', 'a"b'] });
      const input = '첫 줄 한글\n$() `test` & <xml>\n中文 🧪';
      const result = spawnSync(spec.file, spec.args, { input, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { input, args: ['한글 인자', 'a"b'] });
    }
  });

  test('백그라운드 runner는 기존 실행 수명주기로 추적하지만 대화 파일과 공개 작업을 만들지 않는다', async () => {
    const bin = path.join(temp, 'quiz-runner-bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'codex'), '');
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    let child; let input;
    try {
      const runner = new AgentRunner({ runsDir: path.join(temp, 'quiz-private-runs'), platform: 'linux', questionnaireTimeoutMs: 20, killProcess: () => {}, spawn: (_cmd, args, options) => {
        assert.equal(args.at(-1), '-'); assert.equal(options.stdio[0], 'pipe'); assert.equal(options.windowsHide, true);
        child = new EventEmitter(); child.pid = 12345; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
        child.stdin.end = value => { input = value; }; return child;
      } });
      const promise = runner.generateQuestionnaire({ provider: 'codex', prompt: 'Quoted result\n$() `text`' });
      assert.equal(input, 'Quoted result\n$() `text`');
      assert.equal(runner.listActive().length, 1); assert.equal(runner.listVisibleActive().length, 0);
      assert.deepEqual(fs.readdirSync(runner.runsDir), []);
      child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: quiz() } }) + '\n'));
      child.stdout.emit('data', Buffer.from('{"type":"turn.completed","usage":{}}\n'));
      child.emit('close', 0, null);
      assert.equal(parseResult(await promise).status, 'ready');
      assert.equal(runner.listActive().length, 0); assert.deepEqual(fs.readdirSync(runner.runsDir), []);
      const timedOut = runner.generateQuestionnaire({ provider: 'codex', prompt: 'timeout fixture' });
      await Promise.all([assert.rejects(timedOut, /시간이 초과/), new Promise(resolve => setTimeout(resolve, 30))]);
      assert.equal(runner.listenerCount('changed'), 0);
      assert.equal(runner.listActive().length, 1, 'unconfirmed child must remain tracked');
      await assert.rejects(runner.generateQuestionnaire({ provider: 'codex', prompt: 'retry too soon' }), /아직 종료되지/);
      child.emit('close', 0, null);
      assert.equal(runner.listActive().length, 0);
    } finally { process.env.PATH = previousPath; }
  });
}

module.exports = { registerBackgroundQuestionnaireTests };
