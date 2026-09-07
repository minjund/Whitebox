'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { AgentRunner, MAX_AGENT_OUTPUT_LINE_BYTES, signalPosixProcessTree } = require('../../src/agentRunner');
const {
  COMPREHENSION_CONTRACT,
  MAX_RESPONSE_BYTES,
  PACKET_CLOSE,
  PACKET_OPEN,
} = require('../../src/comprehensionPacket');

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function runFixture(runsDir, id, pid, status = 'running') {
  const dir = path.join(runsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  return {
    id,
    provider: 'codex',
    dir,
    child: fakeChild(pid),
    state: {
      externalId: id,
      provider: 'codex',
      status,
      statusDetail: '실행 중',
      updatedAt: new Date().toISOString(),
      endedAt: null,
      lifecycle: [],
      messages: [],
      usage: { total: 0, input: 0 },
      turnUsage: { total: 0, input: 0 },
    },
    stdoutBuffer: '',
    stderrBuffer: '',
    stopping: false,
    processGroup: true,
  };
}

function comprehensionPacketFixture() {
  return {
    schemaVersion: 1,
    id: 'managed-packet',
    title: '관리 실행 이해 패킷',
    summary: '관리 실행에서 최종 응답과 패킷을 함께 보존한다.',
    difficulty: 2,
    difficultyReason: '실행 계약과 결과 분리가 핵심이다.',
    evidence: [{ id: 'evidence-managed', label: '관리 실행', detail: '동일 AI 응답에서 패킷이 생성됐다.' }],
    questions: [{
      id: 'question-managed',
      kind: 'integration',
      topics: ['change', 'decision', 'constraint-risk'],
      prompt: '관리 실행이 보존해야 하는 것은?',
      options: [
        { id: 'answer-managed', label: '원문 프롬프트와 보이는 답변' },
        { id: 'distractor-managed', label: '패킷 envelope만' },
      ],
      answerId: 'answer-managed',
      explanation: '계약은 제공사 입력에만 주입하고 사용자 문맥과 답변 본문은 보존한다.',
      evidenceIds: ['evidence-managed'],
      variant: {
        prompt: '별도 AI 호출 없이 저장해야 하는 것은?',
        options: [
          { id: 'variant-answer-managed', label: '같은 최종 응답의 검증된 패킷' },
          { id: 'variant-distractor-managed', label: '나중에 재생성한 패킷' },
        ],
        answerId: 'variant-answer-managed',
        explanation: '최초 최종 응답에 포함된 패킷만 허용한다.',
      },
    }],
  };
}

function registerAgentRunnerLifecycleTests(context) {
  const { test, temp, root } = context;

  test('관리 실행은 메인 프롬프트에 계약을 한 번만 주입하고 같은 최종 응답의 패킷을 저장한다', () => {
    const executableDir = path.join(temp, 'agent-runner-comprehension-bin');
    fs.mkdirSync(executableDir, { recursive: true });
    for (const name of ['codex', 'codex.cmd']) {
      const executable = path.join(executableDir, name);
      fs.writeFileSync(executable, '', 'utf8');
      fs.chmodSync(executable, 0o755);
    }
    const previousPath = process.env.PATH;
    const children = [];
    const spawnCalls = [];
    const runsDir = path.join(temp, 'agent-runner-comprehension');
    try {
      process.env.PATH = `${executableDir}${path.delimiter}${previousPath || ''}`;
      const runner = new AgentRunner({
        runsDir,
        platform: 'win32',
        spawn: (command, args, options) => {
          const child = fakeChild(7_100 + children.length);
          children.push(child);
          spawnCalls.push({ command, args, options });
          return child;
        },
      });
      const originalPrompt = '변경 사항을 구현해줘';
      const started = runner.start({ provider: 'codex', prompt: originalPrompt, title: '원래 제목', cwd: root });
      assert.equal(started.ok, true);
      assert.equal(spawnCalls.length, 1, '이해 패킷 때문에 별도 AI 프로세스를 시작하면 안 됩니다.');
      const launchedPrompt = spawnCalls[0].args.at(-1);
      assert.equal(launchedPrompt.startsWith(`${COMPREHENSION_CONTRACT}\n\n`), true);
      assert.equal(launchedPrompt.endsWith(originalPrompt), true);
      assert.equal(launchedPrompt.split('<whitebox-comprehension-contract').length - 1, 1);

      const run = runner.active.get(started.runId);
      assert.equal(run.state.comprehensionContractInjected, true);
      assert.equal(run.state.title, '원래 제목');
      assert.equal(run.state.messages[0].text, originalPrompt);
      const meta = JSON.parse(fs.readFileSync(path.join(runsDir, started.runId, 'meta.json'), 'utf8'));
      assert.equal(meta.prompt, originalPrompt);
      assert.equal(meta.prompt.includes('whitebox-comprehension-contract'), false);

      const visibleAnswer = `구현과 검증을 완료했습니다.\n${'긴 결과 본문 '.repeat(1_100)}`;
      assert(visibleAnswer.length > 8_000, 'fixture가 기존 결과 clip 한도를 넘어야 합니다.');
      const finalResponse = `${visibleAnswer}\n\n${PACKET_OPEN}\n${JSON.stringify(comprehensionPacketFixture())}\n${PACKET_CLOSE}`;
      runner.handleLine(run, 'stdout', JSON.stringify({
        type: 'item.completed',
        item: { id: 'managed-answer', type: 'agent_message', text: finalResponse },
      }));
      runner.handleLine(run, 'stdout', JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 4, output_tokens: 8 },
      }));
      runner.persist(run);

      assert.equal(run.state.status, 'completed');
      assert.equal(run.state.result, visibleAnswer);
      assert.equal(run.state.messages.find(message => message.id === 'managed-answer').text, visibleAnswer);
      assert.equal(run.state.comprehension.status, 'ready');
      assert.equal(run.state.comprehension.packet.id, 'managed-packet');
      assert.equal(spawnCalls.length, 1, '파싱이나 변형 문제 생성이 새 프로세스를 시작하면 안 됩니다.');
      const persisted = JSON.parse(fs.readFileSync(path.join(runsDir, started.runId, 'session.json'), 'utf8'));
      assert.equal(persisted.comprehension.status, 'ready');
      assert.equal(persisted.result, visibleAnswer);
      assert.equal(JSON.stringify(persisted).includes(PACKET_OPEN), false, '표시/저장 본문에 envelope를 노출하면 안 됩니다.');
      children[0].emit('close', 0, null);

      const subagent = runner.start({
        provider: 'codex', prompt: '하위 작업', cwd: root, parentId: 'main-session',
      });
      assert.equal(subagent.ok, true);
      assert.equal(spawnCalls[1].args.at(-1), '하위 작업');
      assert.equal(runner.active.get(subagent.runId).state.comprehensionContractInjected, false);
      children[1].emit('close', 0, null);
      assert.equal(runner.active.has(subagent.runId), false);

      const runCountBeforeReservedPrompt = fs.readdirSync(runsDir).length;
      const reserved = runner.start({
        provider: 'codex', prompt: '<whitebox-comprehension-packet version="1">예약됨', cwd: root,
      });
      assert.equal(reserved.ok, false);
      assert.match(reserved.error, /예약된 이해 패킷 태그/);
      assert.equal(spawnCalls.length, 2);
      assert.equal(fs.readdirSync(runsDir).length, runCountBeforeReservedPrompt,
        '거부된 프롬프트 때문에 빈 실행 디렉터리를 남기면 안 됩니다.');

      const monitorWorker = fs.readFileSync(path.join(root, 'src', 'monitorWorker.js'), 'utf8');
      assert.match(monitorWorker, /comprehensionContractInjected: session\.comprehensionContractInjected === true/);
      assert.match(monitorWorker, /comprehension: cardSessionComprehension\(session\)/);
      assert.match(monitorWorker, /comprehensionPresentationFingerprint\(session\)/);
    } finally {
      process.env.PATH = previousPath;
    }
    {
    const executableDir = path.join(temp, 'agent-runner-provider-stream-bin');
    fs.mkdirSync(executableDir, { recursive: true });
    for (const provider of ['codex', 'claude', 'gemini', 'grok']) {
      for (const name of [provider, `${provider}.cmd`]) {
        const executable = path.join(executableDir, name);
        fs.writeFileSync(executable, '', 'utf8');
        fs.chmodSync(executable, 0o755);
      }
    }
    const previousPath = process.env.PATH;
    const children = [];
    const spawnCalls = [];
    const runsDir = path.join(temp, 'agent-runner-provider-stream');
    try {
      process.env.PATH = `${executableDir}${path.delimiter}${previousPath || ''}`;
      const runner = new AgentRunner({
        runsDir,
        platform: 'win32',
        spawn: (command, args, options) => {
          const child = fakeChild(7_200 + children.length);
          children.push(child);
          spawnCalls.push({ command, args, options });
          return child;
        },
      });
      const visibleAnswer = `${'긴 스트림 본문 '.repeat(1_700)}\n공백을 포함한 최종 문장`;
      assert(visibleAnswer.length > 12_000, 'Claude 표시 버퍼보다 긴 fixture여야 합니다.');
      const finalResponse = `${visibleAnswer}\n\n${PACKET_OPEN}\n${JSON.stringify(comprehensionPacketFixture())}\n${PACKET_CLOSE}`;
      const boundaries = [0, 37, Math.floor(finalResponse.length / 2), finalResponse.length - 29, finalResponse.length];
      const chunks = boundaries.slice(0, -1).map((start, index) => finalResponse.slice(start, boundaries[index + 1]));

      for (const provider of ['codex', 'claude', 'gemini', 'grok']) {
        const started = runner.start({ provider, prompt: `${provider} 스트림 패킷`, cwd: root });
        assert.equal(started.ok, true, `${provider} 실행 fixture를 시작해야 합니다.`);
        const run = runner.active.get(started.runId);

        if (provider === 'codex') {
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'turn.started' }));
          chunks.forEach((delta, index) => runner.handleLine(run, 'stdout', JSON.stringify({
            type: index === 0 ? 'item.started' : (index === chunks.length - 1 ? 'item.completed' : 'item.updated'),
            item: { id: 'stream-answer', type: 'agent_message', delta },
          })));
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'turn.completed', usage: {} }));
        } else if (provider === 'claude') {
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-stream' }));
          runner.handleLine(run, 'stdout', JSON.stringify({
            type: 'stream_event', event: { type: 'message_start', message: { id: 'stream-answer' } },
          }));
          chunks.forEach(text => runner.handleLine(run, 'stdout', JSON.stringify({
            type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
          })));
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'result', is_error: false, usage: {} }));
        } else if (provider === 'gemini') {
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'init', session_id: 'gemini-stream' }));
          chunks.forEach((content, index) => runner.handleLine(run, 'stdout', JSON.stringify({
            type: 'message', role: 'assistant', id: `stream-event-${index}`, delta: true, content,
          })));
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'result', usage: {} }));
        } else {
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'session_start', session_id: 'grok-stream' }));
          chunks.forEach((delta, index) => runner.handleLine(run, 'stdout', JSON.stringify({
            type: 'message_delta', role: 'assistant', id: `stream-event-${index}`, delta,
          })));
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'completed', usage: {} }));
        }

        assert.equal(run.state.status, 'completed', `${provider} 스트림이 완료 상태여야 합니다.`);
        assert.equal(run.state.result, visibleAnswer, `${provider}가 분할 본문과 공백을 그대로 복원해야 합니다.`);
        assert.equal(run.state.comprehension?.status, 'ready', `${provider}가 분할 envelope를 검증해야 합니다.`);
        assert.equal(run.state.comprehension?.packet?.id, 'managed-packet');
        assert.equal(run.state.messages.some(message => String(message.text || '').includes(PACKET_OPEN)), false,
          `${provider} 표시 메시지에서 envelope를 제거해야 합니다.`);

        if (provider === 'codex') {
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'turn.started' }));
          runner.handleLine(run, 'stdout', JSON.stringify({
            type: 'item.completed', item: { id: 'second-tool', type: 'command_execution', command: 'npm test' },
          }));
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'turn.completed', usage: {} }));
          assert.equal(run.state.comprehension?.status, 'missing');
          assert.equal(run.state.result, '', 'Codex 후속 턴이 이전 응답을 재사용하면 안 됩니다.');
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'turn.failed', message: '후속 턴 실패' }));
        } else if (provider === 'claude') {
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-next' }));
          runner.handleLine(run, 'stdout', JSON.stringify({
            type: 'assistant', message: { id: 'second-tool', content: [{ type: 'tool_use', id: 'tool', name: 'test', input: {} }] },
          }));
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'result', is_error: false, usage: {} }));
          assert.equal(run.state.comprehension?.status, 'missing');
          assert.equal(run.state.result, '', 'Claude 후속 턴이 이전 응답을 재사용하면 안 됩니다.');
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'result', is_error: true, result: '후속 턴 실패', usage: {} }));
        } else if (provider === 'gemini') {
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'init', session_id: 'gemini-next' }));
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'tool_use', id: 'tool', name: 'test' }));
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'result', usage: {} }));
          assert.equal(run.state.comprehension?.status, 'missing');
          assert.equal(run.state.result, '', 'Gemini 후속 턴이 이전 응답을 재사용하면 안 됩니다.');
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'result', error: '후속 턴 실패', usage: {} }));
        } else {
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'session_start', session_id: 'grok-next' }));
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'tool_start', id: 'tool', name: 'test' }));
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'completed', usage: {} }));
          assert.equal(run.state.comprehension?.status, 'missing');
          assert.equal(run.state.result, '', 'Grok 후속 턴이 이전 응답을 재사용하면 안 됩니다.');
          runner.handleLine(run, 'stdout', JSON.stringify({ type: 'completed', error: '후속 턴 실패', usage: {} }));
        }

        assert.equal(run.state.status, 'failed', `${provider} 후속 실패가 최종 상태여야 합니다.`);
        assert.equal(run.state.completionObserved, false, `${provider} 실패는 완료 근거를 폐기해야 합니다.`);
        assert.equal(Object.hasOwn(run.state, 'comprehension'), false, `${provider} 실패에 이전 패킷이 남으면 안 됩니다.`);
        children.at(-1).emit('close', 0, null);
      }

      const oversized = runner.start({ provider: 'gemini', prompt: '응답 상한 검증', cwd: root });
      const oversizedRun = runner.active.get(oversized.runId);
      runner.handleLine(oversizedRun, 'stdout', JSON.stringify({ type: 'init', session_id: 'gemini-oversized' }));
      const oversizedChunk = 'x'.repeat(64 * 1024);
      const oversizedChunkCount = Math.ceil(MAX_RESPONSE_BYTES / oversizedChunk.length) + 1;
      for (let index = 0; index < oversizedChunkCount; index += 1) {
        runner.handleLine(oversizedRun, 'stdout', JSON.stringify({
          type: 'message', role: 'assistant', delta: true, content: oversizedChunk,
        }));
      }
      runner.handleLine(oversizedRun, 'stdout', JSON.stringify({ type: 'result', usage: {} }));
      assert.equal(oversizedRun.state.comprehension?.status, 'invalid',
        '분할 원문이 응답 상한을 넘으면 잘린 본문을 missing으로 오인하지 말고 invalid여야 합니다.');
      assert.equal(JSON.stringify(oversizedRun.state).includes('__assistantResponse'), false,
        '원문 스트림 누적기는 session.json에 중복 저장되면 안 됩니다.');
      children.at(-1).emit('close', 0, null);

      assert.equal(spawnCalls.length, 5, '원래 provider 실행 외에 패킷용 AI 프로세스를 만들면 안 됩니다.');
    } finally {
      process.env.PATH = previousPath;
    }
    }
  });

  test('provider 완료 이벤트 뒤 nonzero exit 또는 signal이면 최종 실패로 덮고 패킷을 제거한다', () => {
    const executableDir = path.join(temp, 'agent-runner-late-process-failure-bin');
    fs.mkdirSync(executableDir, { recursive: true });
    for (const name of ['codex', 'codex.cmd']) {
      const executable = path.join(executableDir, name);
      fs.writeFileSync(executable, '', 'utf8');
      fs.chmodSync(executable, 0o755);
    }
    const previousPath = process.env.PATH;
    const children = [];
    const runsDir = path.join(temp, 'agent-runner-late-process-failure');
    try {
      process.env.PATH = `${executableDir}${path.delimiter}${previousPath || ''}`;
      const runner = new AgentRunner({
        runsDir,
        platform: 'win32',
        spawn: () => {
          const child = fakeChild(7_300 + children.length);
          children.push(child);
          return child;
        },
      });
      const finalResponse = `완료처럼 보인 응답\n\n${PACKET_OPEN}\n${JSON.stringify(comprehensionPacketFixture())}\n${PACKET_CLOSE}`;
      const outcomes = [
        { code: 1, signal: null, label: 'nonzero' },
        { code: null, signal: 'SIGKILL', label: 'signal' },
      ];
      for (const outcome of outcomes) {
        const started = runner.start({
          provider: 'codex', prompt: `${outcome.label} 종료 검증`, cwd: root,
        });
        const run = runner.active.get(started.runId);
        runner.handleLine(run, 'stdout', JSON.stringify({
          type: 'item.completed',
          item: { id: `answer-${outcome.label}`, type: 'agent_message', text: finalResponse },
        }));
        runner.handleLine(run, 'stdout', JSON.stringify({
          type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 },
        }));
        assert.equal(run.state.status, 'completed');
        assert.equal(run.state.comprehension.status, 'ready');

        run.child.emit('close', outcome.code, outcome.signal);

        assert.equal(run.state.status, 'failed');
        assert.equal(run.state.completionObserved, false);
        assert.equal(run.state.activityState, 'error');
        assert.equal(Object.hasOwn(run.state, 'comprehension'), false);
        assert.equal(runner.active.has(started.runId), false);
        const persisted = JSON.parse(fs.readFileSync(path.join(runsDir, started.runId, 'session.json'), 'utf8'));
        assert.equal(persisted.status, 'failed');
        assert.equal(persisted.completionObserved, false);
        assert.equal(Object.hasOwn(persisted, 'comprehension'), false);
      }

      const errored = runner.start({ provider: 'codex', prompt: '프로세스 오류 뒤 지연 이벤트 검증', cwd: root });
      const erroredRun = runner.active.get(errored.runId);
      erroredRun.child.emit('error', new Error('spawn channel failed'));
      runner.handleLine(erroredRun, 'stdout', JSON.stringify({
        type: 'item.completed', item: { id: 'late-answer', type: 'agent_message', text: finalResponse },
      }));
      runner.handleLine(erroredRun, 'stdout', JSON.stringify({ type: 'turn.completed', usage: {} }));
      erroredRun.child.emit('close', 0, null);
      assert.equal(erroredRun.state.status, 'failed');
      assert.equal(erroredRun.state.completionObserved, false);
      assert.equal(Object.hasOwn(erroredRun.state, 'comprehension'), false,
        '프로세스 error 뒤 지연 provider 완료 이벤트가 패킷을 되살리면 안 됩니다.');
      assert.equal(runner.active.has(errored.runId), false);

      assert.equal(children.length, outcomes.length + 1, '실패 판정이나 패킷 정리에 별도 AI 실행을 만들면 안 됩니다.');
    } finally {
      process.env.PATH = previousPath;
    }
  });

  test('직접 실행 AI 출력은 줄 크기를 제한하고 디스크 저장을 묶어서 처리한다', () => {
    const runsDir = path.join(temp, 'agent-runner-output-bounds');
    const signals = [];
    const runner = new AgentRunner({
      runsDir,
      platform: 'linux',
      persistDelayMs: 1_000,
      killProcess: (pid, signal) => { signals.push([pid, signal]); },
    });
    const batched = runFixture(runsDir, 'batched-output-run', 5_100);
    runner.consume(batched, 'stdout', Buffer.from([
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } }),
      '',
    ].join('\n')));
    assert.equal(batched.pendingEventLines.length, 2);
    assert.equal(fs.existsSync(path.join(batched.dir, 'events.jsonl')), false,
      '각 출력 줄마다 즉시 디스크에 쓰면 안 됩니다.');
    runner.persist(batched);
    assert.equal(batched.persistTimer, null);
    assert.equal(fs.readFileSync(path.join(batched.dir, 'events.jsonl'), 'utf8').trim().split('\n').length, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(batched.dir, 'session.json'), 'utf8')).status, 'completed');

    const unicode = runFixture(runsDir, 'split-unicode-output-run', 5_102);
    const answer = '청크 경계에서도 한글과 이모지 😀 답변 보존';
    const encoded = Buffer.from(`${JSON.stringify({
      type: 'item.completed',
      item: { id: 'unicode-answer', type: 'agent_message', text: answer },
    })}\n`, 'utf8');
    // One-byte chunks force every multi-byte code point across stream events.
    for (let index = 0; index < encoded.length; index += 1) {
      runner.consume(unicode, 'stdout', encoded.subarray(index, index + 1));
    }
    assert.equal(unicode.stdoutBuffer, '');
    assert.equal(unicode.state.messages.find(message => message.id === 'unicode-answer')?.text, answer);
    assert.equal(unicode.pendingEventLines.length, 1, '분할 UTF-8 JSONL을 plain text로 잃으면 안 됩니다.');

    const oversized = runFixture(runsDir, 'oversized-output-run', 5_101);
    runner.consume(oversized, 'stdout', Buffer.alloc(MAX_AGENT_OUTPUT_LINE_BYTES + 1, 0x61));
    assert.equal(oversized.outputOverflow, true);
    assert.equal(oversized.stdoutBuffer, '');
    assert.equal(oversized.state.status, 'failed');
    assert.equal(oversized.state.activityState, 'error');
    assert.equal(oversized.state.completionObserved, false);
    assert.equal(oversized.state.lifecycle.some(item => item.id === 'output-overflow'), true);
    assert.deepStrictEqual(signals, [[-5_101, 'SIGKILL']]);
  });

  test('직접 실행 AI는 POSIX 프로세스 그룹 전체를 제어한다', async () => {
    const fallbackSignals = [];
    const fallback = signalPosixProcessTree(4_321, 'SIGTERM', (pid, signal) => {
      fallbackSignals.push([pid, signal]);
      if (pid < 0) throw Object.assign(new Error('missing group'), { code: 'ESRCH' });
    });
    assert.deepStrictEqual(fallback, { group: false, pid: 4_321, signal: 'SIGTERM' });
    assert.deepStrictEqual(fallbackSignals, [[-4_321, 'SIGTERM'], [4_321, 'SIGTERM']]);
    assert.throws(() => signalPosixProcessTree(1, 'SIGTERM', () => {}), /PID/);

    const executableDir = path.join(temp, 'agent-runner-bin');
    fs.mkdirSync(executableDir, { recursive: true });
    for (const name of ['codex', 'codex.cmd']) {
      const executable = path.join(executableDir, name);
      fs.writeFileSync(executable, '', 'utf8');
      fs.chmodSync(executable, 0o755);
    }
    const previousPath = process.env.PATH;
    const spawnCalls = [];
    const spawnedChild = fakeChild(5_001);
    const spawnedRunsDir = path.join(temp, 'agent-runner-spawn');
    try {
      process.env.PATH = `${executableDir}${path.delimiter}${previousPath || ''}`;
      const spawningRunner = new AgentRunner({
        runsDir: spawnedRunsDir,
        platform: 'darwin',
        spawn: (command, args, options) => {
          spawnCalls.push({ command, args, options });
          return spawnedChild;
        },
        killProcess: () => {},
      });
      const started = spawningRunner.start({ provider: 'codex', prompt: '프로세스 그룹 확인', cwd: root });
      assert.equal(started.ok, true);
      assert.equal(spawnCalls[0].options.detached, true);
      assert.equal(spawnCalls[0].options.shell, false);
      spawnedChild.emit('close', 0, null);
      assert.deepStrictEqual(spawningRunner.listActive(), []);
    } finally {
      process.env.PATH = previousPath;
    }

    const runsDir = path.join(temp, 'agent-runner-lifecycle');
    const signals = [];
    const runner = new AgentRunner({
      runsDir,
      platform: 'darwin',
      killProcess: (pid, signal) => { signals.push([pid, signal]); },
    });
    const controlled = runFixture(runsDir, 'controlled-run', 6_001);
    runner.active.set(controlled.id, controlled);

    assert.throws(() => runner.prepareForUpdate([]), /새 직접 실행 작업/);
    assert.deepStrictEqual(runner.prepareForUpdate([{ runId: controlled.id }]), { active: 1 });
    assert.match(runner.start({}).error, /종료 중/);
    assert.equal(runner.resumeAfterUpdateFailure(), true);

    assert.deepStrictEqual(await runner.pause(controlled.id), { ok: true, status: 'paused' });
    assert.deepStrictEqual(await runner.resume(controlled.id), { ok: true, status: 'running' });
    assert.deepStrictEqual(runner.stop(controlled.id), { ok: true });
    assert.deepStrictEqual(signals.slice(0, 3), [
      [-6_001, 'SIGSTOP'],
      [-6_001, 'SIGCONT'],
      [-6_001, 'SIGTERM'],
    ]);
    runner.active.delete(controlled.id);
    assert.deepStrictEqual(runner.prepareForUpdate([]), { active: 0 });
    assert.deepStrictEqual(await runner.dispose(), { stopped: 0, errors: [] });
    assert.equal(runner.resumeAfterUpdateFailure(), true, '성공적으로 종료된 빈 runner는 업데이트 재시도를 허용해야 합니다.');
    assert.deepStrictEqual(runner.prepareForUpdate([]), { active: 0 });
    await runner.dispose();
  });

  test('앱 종료는 POSIX 직접 실행 AI의 자연스러운 close를 기다리고 상태를 저장한다', async () => {
    const runsDir = path.join(temp, 'agent-runner-graceful-dispose');
    const signals = [];
    let reentrantStart = null;
    let reentrantRetry = null;
    let runner = null;
    runner = new AgentRunner({
      runsDir,
      platform: 'darwin',
      terminationGraceMs: 50,
      killProcess: (pid, signal) => {
        signals.push([pid, signal]);
        if (signal === 'SIGTERM') {
          reentrantStart = runner.start({});
          reentrantRetry = runner.retry('graceful-dispose-run');
        }
      },
    });
    const disposing = runFixture(runsDir, 'graceful-dispose-run', 6_002, 'paused');
    disposing.state.comprehension = { status: 'ready', schemaVersion: 1, packet: comprehensionPacketFixture() };
    runner.active.set(disposing.id, disposing);

    const disposal = runner.dispose();
    assert.strictEqual(runner.dispose(), disposal);
    assert.deepStrictEqual(signals, [[-6_002, 'SIGCONT'], [-6_002, 'SIGTERM']]);
    assert.equal(runner.listActive().length, 1);
    assert.equal(disposing.state.status, 'paused');
    assert.deepStrictEqual(reentrantStart, { ok: false, error: '프로그램이 종료 중이므로 새 작업을 시작할 수 없습니다.' });
    assert.deepStrictEqual(reentrantRetry, reentrantStart);
    assert.deepStrictEqual(runner.start({}), reentrantStart);
    assert.deepStrictEqual(runner.retry('graceful-dispose-run'), reentrantStart);

    disposing.child.emit('close', 0, 'SIGTERM');
    assert.deepStrictEqual(await disposal, { stopped: 1, errors: [] });
    assert.deepStrictEqual(signals, [[-6_002, 'SIGCONT'], [-6_002, 'SIGTERM']]);
    assert.deepStrictEqual(runner.listActive(), []);
    const persisted = JSON.parse(fs.readFileSync(path.join(disposing.dir, 'session.json'), 'utf8'));
    assert.equal(persisted.status, 'cancelled');
    assert.equal(Object.hasOwn(persisted, 'comprehension'), false,
      '취소된 실행에는 이전에 파싱된 패킷이 남으면 안 됩니다.');
    assert.equal(Boolean(persisted.endedAt), true);
    assert.equal(persisted.lifecycle.some(item => item.id === 'process-end'), true);

    const endedAt = persisted.endedAt;
    runner.consume(disposing, 'stdout', Buffer.from('{"type":"turn.started"}\n'));
    runner.handleChildError(disposing, new Error('늦은 프로세스 오류'));
    const afterLateEvents = JSON.parse(fs.readFileSync(path.join(disposing.dir, 'session.json'), 'utf8'));
    assert.equal(disposing.state.status, 'cancelled');
    assert.equal(afterLateEvents.status, 'cancelled');
    assert.equal(afterLateEvents.endedAt, endedAt);
    assert.equal(afterLateEvents.lifecycle.some(item => item.id === 'process-error'), false);
  });

  test('앱 종료는 SIGTERM을 무시하는 POSIX 직접 실행 AI 그룹에 SIGKILL을 전달한다', async () => {
    const runsDir = path.join(temp, 'agent-runner-forced-dispose');
    const signals = [];
    let forcedKillResolve;
    const forcedKill = new Promise(resolve => { forcedKillResolve = resolve; });
    const runner = new AgentRunner({
      runsDir,
      platform: 'linux',
      terminationGraceMs: 0,
      killProcess: (pid, signal) => {
        signals.push([pid, signal]);
        if (signal === 'SIGKILL') forcedKillResolve();
      },
    });
    const disposing = runFixture(runsDir, 'forced-dispose-run', 6_003);
    runner.active.set(disposing.id, disposing);

    let settled = false;
    const disposal = runner.dispose().then(result => {
      settled = true;
      return result;
    });
    assert.deepStrictEqual(signals, [[-6_003, 'SIGTERM']]);
    assert.equal(runner.listActive().length, 1);

    await forcedKill;
    assert.deepStrictEqual(signals, [[-6_003, 'SIGTERM'], [-6_003, 'SIGKILL']]);
    assert.equal(settled, false);
    assert.equal(runner.listActive().length, 1);
    disposing.child.emit('close', null, 'SIGKILL');
    assert.deepStrictEqual(await disposal, { stopped: 1, errors: [] });
    assert.deepStrictEqual(runner.listActive(), []);
  });

  test('앱 종료는 Windows taskkill 콜백이 완료될 때까지 직접 실행 AI를 유지한다', async () => {
    const runsDir = path.join(temp, 'agent-runner-windows-dispose');
    const calls = [];
    let taskkillCallback = null;
    const runner = new AgentRunner({
      runsDir,
      platform: 'win32',
      execFile: (command, args, options, callback) => {
        calls.push({ command, args, options });
        taskkillCallback = callback;
      },
    });
    const disposing = runFixture(runsDir, 'windows-dispose-run', 6_004);
    runner.active.set(disposing.id, disposing);

    let settled = false;
    const disposal = runner.dispose().then(result => {
      settled = true;
      return result;
    });
    assert.deepStrictEqual(calls, [{
      command: 'taskkill',
      args: ['/PID', '6004', '/T', '/F'],
      options: { windowsHide: true, timeout: 1_000 },
    }]);
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(runner.listActive().length, 1);

    taskkillCallback(null);
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(runner.listActive().length, 1);
    disposing.child.emit('close', null, 'SIGKILL');
    assert.deepStrictEqual(await disposal, { stopped: 1, errors: [] });
    assert.equal(settled, true);
    assert.deepStrictEqual(runner.listActive(), []);

    const timedOutDir = path.join(temp, 'agent-runner-windows-timeout');
    const timedOutRunner = new AgentRunner({
      runsDir: timedOutDir,
      platform: 'win32',
      terminationGraceMs: 0,
      execFile: () => {},
    });
    const timedOutRun = runFixture(timedOutDir, 'windows-timeout-run', 6_005);
    timedOutRunner.active.set(timedOutRun.id, timedOutRun);
    const timedOutResult = await timedOutRunner.dispose();
    assert.equal(timedOutResult.stopped, 1);
    assert.equal(timedOutResult.errors.length, 2);
    assert.match(timedOutResult.errors[0].error, /taskkill 응답 대기 시간/);
    assert.match(timedOutResult.errors[1].error, /taskkill 이후 프로그램 종료/);
    assert.deepStrictEqual(timedOutRunner.listActive(), []);
    assert.equal(timedOutRunner.resumeAfterUpdateFailure(), false,
      '종료 확인 오류가 난 runner도 업데이트 실패 뒤 새 실행을 허용하면 안 됩니다.');
    const timedOutState = JSON.parse(fs.readFileSync(path.join(timedOutRun.dir, 'session.json'), 'utf8'));
    assert.equal(timedOutState.status, 'cancelled');
    assert.equal(timedOutState.lifecycle.some(item => item.id === 'dispose-error'), true);

    const sessionEndDir = path.join(temp, 'agent-runner-windows-session-end');
    const sessionEndRunner = new AgentRunner({ runsDir: sessionEndDir, platform: 'win32' });
    const sessionEndRun = runFixture(sessionEndDir, 'windows-session-end-run', 6_006);
    sessionEndRunner.active.set(sessionEndRun.id, sessionEndRun);
    assert.deepStrictEqual(sessionEndRunner.prepareForSystemShutdown(), { stopped: 1, errors: [] });
    const checkpoint = JSON.parse(fs.readFileSync(path.join(sessionEndRun.dir, 'session.json'), 'utf8'));
    assert.equal(checkpoint.status, 'cancelled');
    assert.equal(Boolean(checkpoint.endedAt), true);
    assert.equal(checkpoint.lifecycle.some(item => item.id === 'process-end'), true);
    assert.equal(sessionEndRunner.listActive().length, 1);
    assert.equal(sessionEndRun.finalized, true);
    assert.match(sessionEndRunner.start({}).error, /종료 중/);
    assert.match(sessionEndRunner.retry('windows-session-end-run').error, /종료 중/);

    const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.match(mainSource, /mainWindow\.on\('query-session-end', persistDirectRunsForWindowsSessionEnd\)/);
    assert.match(mainSource, /runner\.prepareForSystemShutdown\(\)/);
    assert.match(mainSource, /reportAgentRunnerCleanupErrors\('before-quit:agent-runner', result\)/);
    assert.match(mainSource, /runner\.prepareForUpdate\(impact\.agentRuns\)/);
    assert.match(mainSource, /requireAgentRunnerUpdateShutdown\(await runner\.dispose\(\)\)/);
    assert.match(mainSource, /UPDATE_AGENT_RUNNER_SHUTDOWN_UNCONFIRMED/);
    assert.match(mainSource, /!runner\.resumeAfterUpdateFailure\(\)/);
    assert.match(mainSource, /update-agent-runner-remains-stopped/);
    assert.match(mainSource, /error\?\.code === 'UPDATE_HELPER_CANCELLATION_UNCONFIRMED'/);
    assert.match(mainSource, /앱을 종료하지 않은 채 최소 60초 기다린 뒤 업데이트를 다시 시도해 주세요/);
    assert.match(mainSource, /UPDATE_HELPER_CANCELLATION_GUARD_MS = 65_000/);
    assert.match(mainSource, /function preventQuitDuringUpdateHelperCancellation/);
    assert.match(mainSource, /if \(preventQuitDuringUpdateHelperCancellation\(event\)\) return/);
    assert.match(mainSource, /systemSessionEnding = true/);
    assert.match(mainSource, /process\.platform === 'win32'[\s\S]+!systemSessionEnding/);
  });
}

module.exports = { registerAgentRunnerLifecycleTests };
