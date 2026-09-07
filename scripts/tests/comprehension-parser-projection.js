'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { AgentMonitor, parseClaude, parseCodex, parseGeneric } = require('../../src/agentMonitor');
const {
  PACKET_CLOSE,
  PACKET_OPEN,
  comprehensionPromptFingerprint,
  injectComprehensionContract,
} = require('../../src/comprehensionPacket');
const { createSnapshotPublicationCoordinator } = require('../../src/monitorPublicationCoordinator');
const {
  applyRuntimePresence,
  inferredBridgeBindings,
  promptFingerprint: legacyPromptFingerprint,
} = require('../../src/processMonitor');

function packet(id = 'parser-packet') {
  const prefix = id.replace(/[^A-Za-z0-9._:-]/g, '-');
  return {
    schemaVersion: 1,
    id: prefix,
    title: '구현 이해 패킷',
    summary: '완료 응답의 본문과 근거를 보존하면서 이해 패킷을 분리 저장했습니다.',
    difficulty: 3,
    difficultyReason: '상태 전이와 소유권 판별을 함께 이해해야 합니다.',
    evidence: [{
      id: `${prefix}-evidence`,
      label: '파서 결과',
      detail: '완료 응답 본문은 표시용 메시지에 남고 패킷은 별도 상태로 검증됩니다.',
    }],
    questions: [{
      id: `${prefix}-question`,
      kind: '완료 흐름',
      topics: ['change', 'decision', 'constraint-risk'],
      prompt: '파서가 완료 응답을 다루는 방법은 무엇입니까?',
      options: [
        { id: `${prefix}-answer`, label: '본문과 검증된 패킷을 분리한다.' },
        { id: `${prefix}-distractor`, label: '패킷을 본문 대신 표시한다.' },
      ],
      answerId: `${prefix}-answer`,
      explanation: '사용자가 보는 답변은 그대로 보존하고 검증된 패킷만 구조화한다.',
      evidenceIds: [`${prefix}-evidence`],
      variant: {
        prompt: '잘못된 패킷이 있을 때 유지되어야 할 것은 무엇입니까?',
        options: [
          { id: `${prefix}-variant-answer`, label: '사용자용 답변 본문' },
          { id: `${prefix}-variant-distractor`, label: '무조건 ready 상태' },
        ],
        answerId: `${prefix}-variant-answer`,
        explanation: '검증 실패는 fail-closed 상태로 남기되 본문을 손실시켜서는 안 됩니다.',
      },
    }],
  };
}

function responseWithPacket(body, value = packet()) {
  return `${body}\n\n${PACKET_OPEN}\n${JSON.stringify(value)}\n${PACKET_CLOSE}`;
}

function parserCases() {
  const body = '완료 본문 첫 줄\n\n- 사용자에게 보일 결과를 보존했습니다.';
  return [
    { name: 'ready', response: responseWithPacket(body), body },
    { name: 'missing', response: body, body },
    {
      name: 'invalid',
      response: responseWithPacket(body, { schemaVersion: 1 }),
      body,
    },
  ];
}

function assertObservedCandidate(session, expectedStatus, visibleBody, userPrompt) {
  assert.equal(session.status, 'completed');
  assert.equal(session.completionObserved, true);
  assert.equal(session.comprehensionContractObserved, true);
  assert.equal(session.comprehensionContractInjected, false,
    '파서가 transcript의 contract marker만으로 Whitebox 소유권을 승격하면 안 됩니다.');
  assert.equal(session.comprehensionCandidate?.status, expectedStatus);
  assert.equal(session.comprehensionCandidate?.schemaVersion, 1);
  assert.equal(session.comprehensionCandidate?.packet?.id || null,
    expectedStatus === 'ready' ? 'parser-packet' : null);
  assert.equal(session.comprehension?.status, 'unsupported');
  assert.equal(session.comprehension?.packet, null);
  assert.equal(session.result, visibleBody);
  assert.equal(session.messages.find(message => message.role === 'user')?.text, userPrompt);
  assert.equal([...session.messages].reverse().find(message => message.role === 'assistant')?.text, visibleBody);
  assert.equal(session.messages.some(message => message.text.includes('whitebox-comprehension-')), false);
}

function assertLongPromptBridgeBinding(session, rawPrompt, temp, label) {
  const injectedPrompt = injectComprehensionContract(rawPrompt);
  const expectedFingerprint = comprehensionPromptFingerprint(injectedPrompt);
  assert.deepEqual(session.comprehensionContractPromptFingerprints, [expectedFingerprint],
    `${label} parser가 clip 전 raw contract prompt의 fingerprint를 보존하지 않았습니다.`);
  assert.ok(JSON.stringify(session).includes(rawPrompt.slice(-256)) === false,
    `${label} parser가 private provenance에 raw prompt tail을 보존하면 안 됩니다.`);
  const visibleUser = session.messages.find(message => message.role === 'user')?.text || '';
  assert.ok(visibleUser.length <= 6001, `${label} 표시 메시지는 기존 6000자 경계를 지켜야 합니다.`);
  assert.notEqual(comprehensionPromptFingerprint(injectComprehensionContract(visibleUser)), expectedFingerprint,
    `${label} 회귀 fixture가 실제 clip을 거치지 않았습니다.`);

  const environment = process.platform === 'win32'
    ? 'windows'
    : (process.platform === 'darwin' ? 'macos' : 'linux');
  const bridge = {
    id: `long-prompt-${label}`,
    kind: 'bridge',
    terminalId: `terminal:long-prompt-${label}`,
    provider: session.provider,
    environment,
    distro: '',
    cwd: temp,
    startedAt: session.startedAt,
    initialPromptFingerprint: expectedFingerprint,
    initialPromptFingerprintVersion: 'raw-v1',
    comprehensionContractInjected: true,
    comprehensionOwnershipVerified: false,
    comprehensionProvenanceOnly: false,
  };
  const observed = applyRuntimePresence([{
    ...session,
    cwd: temp,
    originCwd: temp,
    environment: { kind: environment, distro: '' },
  }], { distros: [] }, { processes: [] }, Date.parse(session.updatedAt), [bridge]);
  const bound = observed.find(candidate => candidate.id === session.id);
  const bindings = inferredBridgeBindings(observed);
  assert.equal(bindings.length, 1, `${label} long prompt bridge가 정확한 transcript에 bind되지 않았습니다.`);
  assert.equal(bindings[0].sessionId, session.id);
  assert.equal(bindings[0].promptFingerprint, expectedFingerprint);
  assert.equal(bound?.comprehension?.status, 'ready',
    `${label} long prompt의 동일-generation packet이 bridge ownership으로 승격되지 않았습니다.`);

  if (label === 'generic') return;
  const legacyObserved = applyRuntimePresence([{
    ...session,
    cwd: temp,
    originCwd: temp,
    environment: { kind: environment, distro: '' },
  }], { distros: [] }, { processes: [] }, Date.parse(session.updatedAt), [{
    ...bridge,
    id: `legacy-long-prompt-${label}`,
    terminalId: `terminal:legacy-long-prompt-${label}`,
    initialPromptFingerprint: legacyPromptFingerprint(injectedPrompt),
    initialPromptFingerprintVersion: '',
  }]);
  assert.equal(inferredBridgeBindings(legacyObserved).length, 1,
    `${label} parser가 기존 persisted terminal의 display-clipped fingerprint fallback을 깨뜨렸습니다.`);
}

function assertHiddenInstructionBinding(session, prompt, temp) {
  assert.equal(session.comprehensionContractObserved, false);
  assert.equal(session.comprehensionContractInjected, false);
  assert.equal(session.comprehension.status, 'unsupported');
  assert.deepEqual(session.comprehensionUserPromptFingerprints, [comprehensionPromptFingerprint(prompt)]);
  const environment = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'macos' : 'linux');
  const bridge = {
    id: `hidden-${session.provider}`, kind: 'bridge', terminalId: `terminal:hidden-${session.provider}`,
    provider: session.provider, environment, distro: '', cwd: temp, startedAt: session.startedAt,
    initialPromptFingerprint: comprehensionPromptFingerprint(prompt),
    initialPromptFingerprintVersion: 'instructions-v1', comprehensionContractInjected: true,
  };
  const project = overrides => applyRuntimePresence([{
    ...session, cwd: temp, originCwd: temp, environment: { kind: environment, distro: '' },
  }], { distros: [] }, { processes: [] }, Date.parse(session.updatedAt), [{ ...bridge, ...overrides }]);
  const observed = project({});
  assert.equal(observed.find(value => value.id === session.id)?.comprehension.status, 'ready');
  assert.equal(inferredBridgeBindings(observed)[0]?.sessionId, session.id);
  for (const overrides of [
    { initialPromptFingerprint: 'a'.repeat(64) },
    { comprehensionContractInjected: false },
    { initialPromptFingerprintVersion: 'raw-v1' },
  ]) {
    assert.notEqual(project(overrides).find(value => value.id === session.id)?.comprehension.status, 'ready');
  }
}

function codexSession(jsonl, temp, name, response, prompt, hiddenInstructions = false) {
  const timestamp = '2026-09-04T01:00:00.000Z';
  return parseCodex(jsonl(path.join(temp, 'comprehension-parser', `codex-${name}.jsonl`), [
    { timestamp, type: 'session_meta', payload: { id: `codex-${name}`, cwd: temp, source: 'cli', thread_source: 'user' } },
    { timestamp: '2026-09-04T01:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: `turn-${name}` } },
    { timestamp: '2026-09-04T01:00:02.000Z', type: 'event_msg', payload: { type: 'user_message', message: hiddenInstructions ? prompt : injectComprehensionContract(prompt) } },
    { timestamp: '2026-09-04T01:00:03.000Z', type: 'event_msg', payload: { type: 'agent_message', phase: 'final_answer', message: response } },
    { timestamp: '2026-09-04T01:00:04.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: `turn-${name}`, last_agent_message: response } },
  ]));
}

function claudeSession(jsonl, temp, name, response, prompt, hiddenInstructions = false) {
  return parseClaude(jsonl(path.join(temp, 'comprehension-parser', `claude-${name}.jsonl`), [
    { type: 'user', uuid: `user-${name}`, timestamp: '2026-09-04T02:00:00.000Z', message: { role: 'user', content: hiddenInstructions ? prompt : injectComprehensionContract(prompt) } },
    { type: 'assistant', uuid: `assistant-${name}`, timestamp: '2026-09-04T02:00:01.000Z', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: response }] } },
    { type: 'system', subtype: 'turn_complete', timestamp: '2026-09-04T02:00:02.000Z' },
  ]));
}

function genericSession(jsonl, temp, name, response, prompt) {
  return parseGeneric(jsonl(path.join(temp, 'comprehension-parser', `generic-${name}.jsonl`), [
    { type: 'user_message', role: 'user', timestamp: '2026-09-04T03:00:00.000Z', text: injectComprehensionContract(prompt) },
    { type: 'assistant_message', role: 'assistant', timestamp: '2026-09-04T03:00:01.000Z', content: response },
    { type: 'session_end', timestamp: '2026-09-04T03:00:02.000Z' },
  ]), 'gemini');
}

function writeManagedSession(runsDir, name, overrides = {}) {
  const runDir = path.join(runsDir, name);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify({
    id: name,
    provider: 'codex',
    externalId: name,
    cwd: runsDir,
  }), 'utf8');
  const completedAt = '2026-09-04T04:00:02.000Z';
  fs.writeFileSync(path.join(runDir, 'session.json'), JSON.stringify({
    externalId: name,
    cwd: runsDir,
    originCwd: runsDir,
    title: name,
    status: 'completed',
    activityState: 'idle',
    statusDetail: '작업 완료',
    completionObserved: true,
    startedAt: '2026-09-04T04:00:00.000Z',
    updatedAt: completedAt,
    endedAt: completedAt,
    completedAt,
    messages: [{ id: `${name}:answer`, role: 'assistant', type: 'message', text: '완료', timestamp: completedAt }],
    lifecycle: [],
    executions: [],
    childIds: [],
    runtimePresence: [],
    collaboration: { spawns: [], communications: [], retainedAgents: [] },
    ...overrides,
  }), 'utf8');
}

function waitForWorkerSnapshot(worker, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('monitorWorker snapshot 대기 시간이 초과되었습니다.'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const onMessage = message => {
      if (!message || message.type !== 'snapshot') return;
      cleanup();
      resolve(message.snapshot);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const onExit = code => {
      cleanup();
      reject(new Error(`monitorWorker가 snapshot 전에 종료됨: ${code}`));
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
  });
}

function requestWorkerDetail(worker, sessionId, requestId, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('monitorWorker detail 대기 시간이 초과되었습니다.'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const onMessage = message => {
      if (!message || message.type !== 'detail-result' || message.requestId !== requestId) return;
      cleanup();
      if (message.error) reject(new Error(message.error));
      else resolve(message.session);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const onExit = code => {
      cleanup();
      reject(new Error(`monitorWorker가 detail 전에 종료됨: ${code}`));
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    worker.postMessage({ type: 'detail', sessionId, requestId });
  });
}

function registerComprehensionParserProjectionTests(context) {
  const { test, temp, jsonl, root } = context;
  const prompt = '완료 응답과 이해 패킷을 만들어줘';
  const longPrompt = `8천자 입력도 정확히 연결해줘\n${'긴'.repeat(7_500)}\nLONG-PROMPT-UNIQUE-TAIL`;

  test('Codex parser는 완료 본문과 ready/missing/invalid candidate를 보존하고 marker를 소유권으로 믿지 않는다', () => {
    assertHiddenInstructionBinding(codexSession(jsonl, temp, 'hidden', responseWithPacket('완료'), longPrompt, true), longPrompt, temp);
    for (const scenario of parserCases()) {
      assertObservedCandidate(codexSession(jsonl, temp, scenario.name, scenario.response, prompt), scenario.name, scenario.body, prompt);
    }
    assertLongPromptBridgeBinding(
      codexSession(jsonl, temp, 'long-prompt', responseWithPacket('긴 Codex 작업 완료'), longPrompt),
      longPrompt,
      temp,
      'codex',
    );
  });

  test('Claude parser는 완료 본문과 ready/missing/invalid candidate를 보존하고 marker를 소유권으로 믿지 않는다', () => {
    assertHiddenInstructionBinding(claudeSession(jsonl, temp, 'hidden', responseWithPacket('완료'), longPrompt, true), longPrompt, temp);
    for (const scenario of parserCases()) {
      assertObservedCandidate(claudeSession(jsonl, temp, scenario.name, scenario.response, prompt), scenario.name, scenario.body, prompt);
    }
    assertLongPromptBridgeBinding(
      claudeSession(jsonl, temp, 'long-prompt', responseWithPacket('긴 Claude 작업 완료'), longPrompt),
      longPrompt,
      temp,
      'claude',
    );
  });

  test('generic parser는 완료 본문과 ready/missing/invalid candidate를 보존하고 marker를 소유권으로 믿지 않는다', () => {
    for (const scenario of parserCases()) {
      assertObservedCandidate(genericSession(jsonl, temp, scenario.name, scenario.response, prompt), scenario.name, scenario.body, prompt);
    }
    assertLongPromptBridgeBinding(
      genericSession(jsonl, temp, 'long-prompt', responseWithPacket('긴 generic 작업 완료'), longPrompt),
      longPrompt,
      temp,
      'generic',
    );

    const firstBody = '첫 번째 턴 완료 본문';
    const secondBody = '두 번째 턴의 새 완료 본문';
    const firstResponse = responseWithPacket(firstBody, packet('generic-first-turn'));
    const multiTurn = parseGeneric(jsonl(path.join(temp, 'comprehension-parser', 'generic-multi-turn.jsonl'), [
      { type: 'user_message', role: 'user', timestamp: '2026-09-04T03:10:00.000Z', text: injectComprehensionContract('첫 번째 작업') },
      { type: 'assistant_message', role: 'assistant', timestamp: '2026-09-04T03:10:01.000Z', content: firstResponse },
      { type: 'turn_completed', timestamp: '2026-09-04T03:10:02.000Z', result: firstResponse },
      { type: 'user_message', role: 'user', timestamp: '2026-09-04T03:10:03.000Z', text: injectComprehensionContract('두 번째 작업') },
      { type: 'assistant_message', role: 'assistant', timestamp: '2026-09-04T03:10:04.000Z', content: secondBody },
      { type: 'turn_completed', timestamp: '2026-09-04T03:10:05.000Z' },
    ]), 'gemini');

    assert.equal(multiTurn.status, 'completed');
    assert.equal(multiTurn.completionObserved, true);
    assert.equal(multiTurn.comprehensionCandidate?.status, 'missing',
      '새 completion은 이전 턴의 packet을 같은 생성의 결과처럼 재사용하면 안 됩니다.');
    assert.equal(multiTurn.comprehensionCandidate?.packet, null);
    assert.equal(multiTurn.result, secondBody,
      'result/output 없는 completion도 현재 턴 assistant 본문을 표시해야 합니다.');
    assert.equal([...multiTurn.messages].reverse().find(message => message.role === 'assistant')?.text, secondBody);
    assert.equal(multiTurn.result.includes('첫 번째 턴'), false);
  });

  test('watcher가 새 전사를 놓쳐도 fresh bridge 생존·종료 전환은 warm 음수 캐시를 우회해 3초 안에 패킷을 찾는다', () => {
    const localEnvironment = process.platform === 'win32'
      ? 'windows'
      : (process.platform === 'darwin' ? 'macos' : 'linux');
    const bridge = (terminalId, environment = localEnvironment, distro = '') => ({
      kind: 'bridge',
      terminalId,
      provider: 'codex',
      environment,
      distro,
      comprehensionContractInjected: true,
      comprehensionOwnershipVerified: false,
      comprehensionProvenanceOnly: false,
    });
    const rows = (id, response) => [
      { timestamp: '2026-09-04T00:00:00.000Z', type: 'session_meta', payload: { id, cwd: temp, source: 'cli', thread_source: 'user' } },
      { timestamp: '2026-09-04T00:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: `turn-${id}` } },
      { timestamp: '2026-09-04T00:00:02.000Z', type: 'event_msg', payload: { type: 'user_message', message: injectComprehensionContract(`${id} 작업`) } },
      { timestamp: '2026-09-04T00:00:03.000Z', type: 'event_msg', payload: { type: 'agent_message', phase: 'final_answer', message: response } },
      { timestamp: '2026-09-04T00:00:04.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: `turn-${id}`, last_agent_message: response } },
    ];
    const makeMonitor = (name, { wsl = false } = {}) => {
      const home = path.join(temp, name, 'local');
      const historyHome = wsl ? path.join(temp, name, 'wsl-home') : home;
      const sessionRoot = path.join(historyHome, '.codex', 'sessions', '2026', '09', '04');
      fs.mkdirSync(sessionRoot, { recursive: true });
      const historyHomes = wsl ? [{
        home: historyHome,
        kind: 'wsl',
        distro: 'Ubuntu',
        label: 'WSL · Ubuntu',
        // Reproduces a tmux discovery snapshot that missed the new file.
        files: { claude: [], codex: [], gemini: [], grok: [] },
      }] : [];
      return { home, sessionRoot, monitor: new AgentMonitor({ home, historyHomes, intervalMs: 2_000 }) };
    };
    const originalNow = Date.now;
    let clock = originalNow();
    Date.now = () => clock;
    try {
      const active = makeMonitor('comprehension-watcher-miss-active');
      active.monitor.scanNow();
      assert.ok([...active.monitor.listCache.values()].some(entry => entry.paths.length === 0),
        '사전 조건인 warm 음수 목록 캐시가 만들어지지 않았습니다.');
      active.monitor.setBridgePresence([bridge('terminal:fresh-active')]);
      active.monitor.scanNow();
      const activeCreatedAt = clock + 500;
      clock = activeCreatedAt;
      const activeResponse = responseWithPacket('생존 중 브리지 완료 본문', packet('bridge-active-packet'));
      jsonl(path.join(active.sessionRoot, 'rollout-bridge-active.jsonl'), rows('bridge-active', activeResponse));
      clock += 2_000;
      const activeSession = active.monitor.scanNow().sessions.find(session => session.externalId === 'bridge-active');
      assert.ok(activeSession, '다음 2초 스캔에서 watcher가 놓친 전사를 발견하지 못했습니다.');
      assert.equal(activeSession.comprehensionCandidate?.status, 'ready');
      assert.ok(clock - activeCreatedAt <= 3_000, 'fresh bridge 생존 중 발견이 3초 목표를 넘었습니다.');

      const exiting = makeMonitor('comprehension-watcher-miss-exit', { wsl: true });
      exiting.monitor.scanNow();
      exiting.monitor.setBridgePresence([bridge('terminal:fresh-exit', 'wsl', 'Ubuntu')]);
      exiting.monitor.scanNow();
      const exitCreatedAt = clock + 500;
      clock = exitCreatedAt;
      const exitResponse = responseWithPacket('종료 브리지 완료 본문', packet('bridge-exit-packet'));
      jsonl(path.join(exiting.sessionRoot, 'rollout-bridge-exit.jsonl'), rows('bridge-exit', exitResponse));
      exiting.monitor.setBridgePresence([]);
      assert.equal(exiting.monitor.listCache.size, 0, 'bridge 종료 전환이 warm 목록 캐시를 비우지 않았습니다.');
      const exitSession = exiting.monitor.scanNow().sessions.find(session => session.externalId === 'bridge-exit');
      assert.ok(exitSession, 'bridge 종료 직후 스캔에서 watcher가 놓친 전사를 발견하지 못했습니다.');
      assert.equal(exitSession.comprehensionCandidate?.status, 'ready');
      assert.ok(clock - exitCreatedAt <= 3_000, 'fresh bridge 종료 시 발견이 3초 목표를 넘었습니다.');
    } finally {
      Date.now = originalNow;
    }
  });

  test('monitorWorker card projection은 완료 main의 인증된 상태만 표시하고 외부·서브·실패 상태를 fail-closed 처리한다', async () => {
    const runsDir = path.join(temp, 'comprehension-worker-runs');
    const home = path.join(temp, 'comprehension-worker-home');
    fs.mkdirSync(home, { recursive: true });
    writeManagedSession(runsDir, 'trusted-ready', {
      comprehensionContractObserved: true,
      comprehensionContractInjected: true,
      comprehension: { status: 'ready', schemaVersion: 1, packet: packet('trusted-ready-packet') },
    });
    writeManagedSession(runsDir, 'runtime-promoted', {
      comprehensionContractObserved: true,
      comprehensionContractPromptFingerprints: ['a'.repeat(64)],
      comprehensionContractInjected: false,
      comprehensionCandidate: { status: 'ready', schemaVersion: 1, packet: packet('runtime-promoted-packet') },
      comprehension: { status: 'unsupported', schemaVersion: 1, packet: null },
    });
    writeManagedSession(runsDir, 'untrusted-ready', {
      comprehensionContractObserved: true,
      comprehensionContractInjected: false,
      comprehensionCandidate: { status: 'ready', schemaVersion: 1, packet: packet('untrusted-ready-packet') },
      comprehension: { status: 'ready', schemaVersion: 1, packet: packet('untrusted-stale-packet') },
    });
    writeManagedSession(runsDir, 'trusted-invalid', {
      comprehensionContractObserved: true,
      comprehensionContractInjected: true,
      comprehension: { status: 'ready', schemaVersion: 1, packet: { schemaVersion: 1 } },
    });
    writeManagedSession(runsDir, 'trusted-missing', {
      comprehensionContractObserved: true,
      comprehensionContractInjected: true,
    });
    writeManagedSession(runsDir, 'trusted-subagent', {
      parentId: 'codex:trusted-ready',
      depth: 1,
      comprehensionContractObserved: true,
      comprehensionContractInjected: true,
      comprehension: { status: 'ready', schemaVersion: 1, packet: packet('trusted-sub-packet') },
    });
    writeManagedSession(runsDir, 'trusted-failed', {
      status: 'failed',
      statusDetail: '작업 실패',
      comprehensionContractObserved: true,
      comprehensionContractInjected: true,
      comprehension: { status: 'ready', schemaVersion: 1, packet: packet('trusted-failed-packet') },
    });

    const worker = new Worker(path.join(root, 'src', 'monitorWorker.js'), {
      workerData: {
        runsDir,
        home,
        intervalMs: 60_000,
        availability: {},
        bridges: [{
          id: 'runtime-promoted-provenance',
          bridgeId: 'runtime-promoted-provenance',
          provider: 'codex',
          linkedSessionId: 'codex:runtime-promoted',
          comprehensionBoundSessionId: 'codex:runtime-promoted',
          comprehensionContractInjected: true,
          comprehensionOwnershipVerified: true,
          comprehensionProvenanceOnly: true,
          initialPromptFingerprint: 'a'.repeat(64),
          comprehensionPromptFingerprint: 'a'.repeat(64),
        }],
        sourcePluginSettings: { schemaVersion: 2, enabledPluginIds: [] },
        sourcePluginStatuses: [],
        sourcePluginSnapshots: {},
      },
    });
    try {
      const snapshot = await waitForWorkerSnapshot(worker);
      const byExternalId = new Map(snapshot.sessions.map(session => [session.externalId, session]));
      assert.equal(byExternalId.get('trusted-ready')?.comprehension?.status, 'ready');
      assert.equal(byExternalId.get('trusted-ready')?.comprehension?.packet?.id, 'trusted-ready-packet');
      assert.equal(byExternalId.get('runtime-promoted')?.comprehension?.status, 'ready');
      assert.equal(byExternalId.get('runtime-promoted')?.comprehension?.packet?.id, 'runtime-promoted-packet');
      assert.equal(Object.prototype.hasOwnProperty.call(
        byExternalId.get('runtime-promoted'),
        'comprehensionContractPromptFingerprints',
      ), false, 'private prompt fingerprint는 public card에 노출되면 안 됩니다.');
      assert.equal(byExternalId.get('untrusted-ready')?.comprehension?.status, 'unsupported');
      assert.equal(byExternalId.get('untrusted-ready')?.comprehension?.packet, null);
      assert.equal(byExternalId.get('trusted-invalid')?.comprehension?.status, 'invalid');
      assert.equal(byExternalId.get('trusted-missing')?.comprehension?.status, 'missing');
      assert.equal(byExternalId.get('trusted-subagent')?.comprehension, null);
      assert.equal(byExternalId.get('trusted-failed')?.comprehension, null);

      const promotedDetail = await requestWorkerDetail(
        worker,
        byExternalId.get('runtime-promoted').id,
        'runtime-promoted-detail',
      );
      assert.equal(promotedDetail.comprehensionContractInjected, true,
        'detail 재파싱은 runtime에서 인증된 contract 소유권을 되돌리면 안 됩니다.');
      assert.equal(promotedDetail.comprehension?.status, 'ready');
      assert.equal(promotedDetail.comprehension?.packet?.id, 'runtime-promoted-packet');
      for (const field of [
        'comprehensionCandidate',
        'comprehensionOrigin',
        'comprehensionContractObserved',
        'comprehensionContractPromptFingerprints',
        'comprehensionProvenanceOnly',
      ]) {
        assert.equal(Object.prototype.hasOwnProperty.call(promotedDetail, field), false, `${field}는 public detail에 노출되면 안 됩니다.`);
      }

      const untrustedDetail = await requestWorkerDetail(
        worker,
        byExternalId.get('untrusted-ready').id,
        'untrusted-ready-detail',
      );
      assert.equal(untrustedDetail.comprehensionContractInjected, false);
      assert.equal(untrustedDetail.comprehension?.status, 'unsupported');
      assert.equal(untrustedDetail.comprehension?.packet, null);
      assert.equal(Object.prototype.hasOwnProperty.call(untrustedDetail, 'comprehensionCandidate'), false,
        '검증되었더라도 소유권이 없는 candidate packet은 public detail에서 숨겨야 합니다.');
    } finally {
      await worker.terminate();
    }
  });

  test('느린 source plugin scan은 완료된 core packet snapshot 게시를 지연하지 않는다', async () => {
    let resolveSlowScan;
    let slowScanStarted = false;
    const slowScan = new Promise(resolve => { resolveSlowScan = resolve; });
    const publications = [];
    const coordinator = createSnapshotPublicationCoordinator({
      initialSourceSnapshot: {
        sessions: [{ id: 'cached-source' }],
        statuses: [{ id: 'cached-source-status' }],
      },
      scanSource() {
        slowScanStarted = true;
        return slowScan;
      },
      publish(coreSnapshot, sourceSnapshot) {
        publications.push({ coreSnapshot, sourceSnapshot });
      },
    });

    const startedAt = Date.now();
    try {
      const published = await coordinator.observeCore({
        generatedAt: new Date().toISOString(),
        sessions: [{ id: 'completed-core', comprehension: { status: 'ready' } }],
      });
      assert.equal(published, true);
      assert.equal(slowScanStarted, true);
      assert.equal(publications.length, 1,
        '끝나지 않은 source scan보다 last-known source를 사용한 core snapshot이 먼저 게시되어야 합니다.');
      assert.equal(publications[0].coreSnapshot.sessions[0].id, 'completed-core');
      assert.equal(publications[0].sourceSnapshot.sessions[0].id, 'cached-source');
      assert.ok(Date.now() - startedAt < 3_000, 'core packet snapshot은 3초 목표 안에 게시되어야 합니다.');

      resolveSlowScan({
        sessions: [{ id: 'fresh-source' }],
        statuses: [{ id: 'fresh-source-status' }],
      });
      await coordinator.whenIdle();
      assert.equal(publications.length, 2);
      assert.equal(publications[1].sourceSnapshot.sessions[0].id, 'fresh-source',
        'source scan 완료 후 최신 core와 새 source snapshot을 다시 게시해야 합니다.');
    } finally {
      resolveSlowScan({ sessions: [], statuses: [] });
      coordinator.stop();
    }
  });
}

module.exports = { registerComprehensionParserProjectionTests };
