'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  AttentionActivationCoordinator,
} = require('../../src/attentionActivationCoordinator');
const {
  createAttentionActivationController,
} = require('../../renderer/attention-activation');

const flush = () => new Promise(resolve => setImmediate(resolve));

function namedFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} source is missing`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} source is incomplete`);
}

function fakeTimers() {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = new Map();
  let nextId = 1;
  global.setTimeout = callback => {
    const id = nextId++;
    scheduled.set(id, callback);
    return id;
  };
  global.clearTimeout = id => scheduled.delete(id);
  return {
    get size() { return scheduled.size; },
    runNext() {
      const entry = scheduled.entries().next().value;
      assert.ok(entry, '실행할 attention retry timer가 없습니다.');
      scheduled.delete(entry[0]);
      entry[1]();
    },
    restore() {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    },
  };
}

function activation(id, overrides = {}) {
  return {
    activationId: id,
    source: 'hook',
    provider: 'codex',
    sessionId: 'codex:session-1',
    rawSessionId: 'session-1',
    event: 'attention',
    deliveryToken: `delivery-${id}`,
    ...overrides,
  };
}

function registerAttentionActivationTests(context) {
  const { test } = context;

  test('Codex snapshot attention은 표시명 GPT가 아니라 canonical provider id로 exact 세션을 연다', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
    const sandbox = {
      crypto: require('crypto'),
      lastSnapshot: {
        sessions: [{
          id: 'codex:exact-snapshot',
          externalId: 'exact-snapshot',
          provider: 'codex',
        }],
      },
      isProviderVisible: () => true,
    };
    vm.runInNewContext([
      namedFunctionSource(mainSource, 'popupText'),
      namedFunctionSource(mainSource, 'sessionForAttention'),
      namedFunctionSource(mainSource, 'attentionActivationRecord'),
      `result = attentionActivationRecord('snapshot', {
        id: 'codex:exact-snapshot:input:request-1',
        requestId: 'request-1',
        sessionId: 'codex:exact-snapshot',
        provider: 'GPT',
        context: { kind: 'snapshot' },
      });`,
    ].join('\n'), sandbox, { filename: 'main-attention-provider-harness.js' });

    assert.equal(sandbox.result.provider, 'codex');
    assert.equal(sandbox.result.sessionId, 'codex:exact-snapshot');
  });

  test('알람 자동 이동은 설정을 따르고 처리된 요청을 renderer reload 뒤 다시 열지 않는다', () => {
    const shown = [];
    const delivered = [];
    const tokens = new Map();
    const coordinator = new AttentionActivationCoordinator({
      enabled: false,
      onShow: item => shown.push(item.activationId),
      onDeliver: item => { delivered.push(item.activationId); tokens.set(item.activationId, item.deliveryToken); return true; },
    });
    coordinator.rendererReady();
    coordinator.reconcile([activation('a')]);
    assert.deepEqual(shown, []);
    assert.deepEqual(delivered, []);

    coordinator.setEnabled(true);
    assert.deepEqual(shown, ['a']);
    assert.deepEqual(delivered, ['a']);
    assert.deepEqual(coordinator.acknowledge({ activationId: 'a', deliveryToken: tokens.get('a'), status: 'opened-pty' }), {
      ok: true, acknowledged: true, activationId: 'a', status: 'opened-pty',
    });
    coordinator.rendererUnavailable();
    coordinator.rendererReady();
    assert.deepEqual(delivered, ['a']);
    coordinator.dispose();
  });

  test('같은 논리 요청의 source 공백은 창 focus를 반복하지 않고 미처리 delivery만 복구한다', () => {
    const shown = [];
    const delivered = [];
    const cancelled = [];
    const tokens = new Map();
    const coordinator = new AttentionActivationCoordinator({
      enabled: true,
      tombstoneMs: 60_000,
      onShow: item => shown.push(item.activationId),
      onDeliver: item => { delivered.push(item.activationId); tokens.set(item.activationId, item.deliveryToken); return true; },
      onCancel: item => { cancelled.push(`${item.activationId}:${item.reason}`); return true; },
    });
    coordinator.rendererReady();
    coordinator.reconcile([activation('same')]);
    coordinator.reconcile([]);
    coordinator.reconcile([activation('same', { source: 'snapshot' })]);
    assert.deepEqual(shown, ['same']);
    assert.deepEqual(delivered, ['same', 'same']);
    assert.deepEqual(cancelled, ['same:resolved']);
    coordinator.acknowledge({ activationId: 'same', deliveryToken: tokens.get('same'), status: 'opened-session' });
    coordinator.reconcile([]);
    coordinator.reconcile([activation('same')]);
    assert.deepEqual(shown, ['same']);
    assert.deepEqual(delivered, ['same', 'same']);
    coordinator.dispose();
  });

  test('최신 foreground 알람이 정착하면 이전 미처리 알람은 작업 현황에 남긴다', () => {
    const delivered = [];
    const tokens = new Map();
    const coordinator = new AttentionActivationCoordinator({
      enabled: true,
      onShow: () => {},
      onDeliver: item => { delivered.push(item.activationId); tokens.set(item.activationId, item.deliveryToken); return true; },
    });
    coordinator.rendererReady();
    coordinator.reconcile([activation('older')]);
    coordinator.reconcile([activation('older'), activation('newer')]);
    assert.deepEqual(delivered, ['older', 'newer']);
    assert.deepEqual(coordinator.acknowledge({
      activationId: 'newer',
      deliveryToken: tokens.get('newer'),
      status: 'opened-pty',
    }), {
      ok: true,
      acknowledged: true,
      activationId: 'newer',
      status: 'opened-pty',
      suppressedActivationIds: ['older'],
    });
    assert.deepEqual(delivered, ['older', 'newer'],
      'foreground PTY가 정착한 뒤 오래된 알람이 다시 포커스를 가져가면 안 됩니다.');
    coordinator.reconcile([activation('older'), activation('newer')]);
    assert.deepEqual(delivered, ['older', 'newer'],
      '다음 snapshot도 정착된 foreground backlog를 다시 전달하면 안 됩니다.');
    assert.equal(coordinator.snapshot().phases.handled, 1);
    assert.equal(coordinator.snapshot().phases.suppressed, 1);
    coordinator.dispose();
  });

  test('manual navigation suppresses the superseded activation backlog', () => {
    const delivered = [];
    const tokens = new Map();
    const coordinator = new AttentionActivationCoordinator({
      enabled: true,
      onShow: () => {},
      onDeliver: item => {
        delivered.push(item.activationId);
        tokens.set(item.activationId, item.deliveryToken);
        return true;
      },
    });
    coordinator.rendererReady();
    coordinator.reconcile([activation('manual-older')]);
    coordinator.reconcile([activation('manual-older'), activation('manual-newer')]);
    assert.deepEqual(delivered, ['manual-older', 'manual-newer']);

    assert.deepEqual(coordinator.acknowledge({
      activationId: 'manual-newer',
      deliveryToken: tokens.get('manual-newer'),
      status: 'user-navigated',
    }), {
      ok: true,
      acknowledged: true,
      activationId: 'manual-newer',
      status: 'user-navigated',
      suppressedActivationIds: ['manual-older'],
    });
    assert.deepEqual(delivered, ['manual-older', 'manual-newer'],
      'manual navigation must not let an older activation steal PTY focus');
    coordinator.reconcile([activation('manual-older'), activation('manual-newer')]);
    assert.deepEqual(delivered, ['manual-older', 'manual-newer'],
      'a later snapshot must not redeliver a manually suppressed activation');
    assert.equal(coordinator.snapshot().phases.handled, 1);
    assert.equal(coordinator.snapshot().phases.suppressed, 1);
    coordinator.dispose();
  });

  test('renderer manual selection acknowledges with user-navigated', async () => {
    const timers = fakeTimers();
    const acknowledged = [];
    let controller;
    try {
      controller = createAttentionActivationController({
        retryDelaysMs: [1],
        getSessions: () => [],
        acknowledge: value => {
          acknowledged.push(value);
          return { acknowledged: true };
        },
      });
      controller.handle(activation('manual-renderer'));
      await flush();
      assert.equal(controller.pendingCount(), 1);
      controller.userNavigated();
      await flush();
      assert.deepEqual(acknowledged, [{
        activationId: 'manual-renderer',
        deliveryToken: 'delivery-manual-renderer',
        status: 'user-navigated',
      }]);
      assert.equal(controller.pendingCount(), 0);
    } finally {
      controller?.dispose();
      timers.restore();
    }
  });

  test('renderer는 opened-pty ACK 중 수동 이동도 user-navigated로 후속 전송한다', async () => {
    const acknowledged = [];
    let releaseOpenedPty;
    const controller = createAttentionActivationController({
      retryDelaysMs: [],
      getSessions: () => [{
        id: 'codex:session-1',
        externalId: 'session-1',
        provider: 'codex',
      }],
      canOpenPty: () => true,
      openPty: async () => ({ opened: true, retryable: false }),
      acknowledge: value => {
        acknowledged.push(value);
        if (value.status !== 'opened-pty') return { acknowledged: true };
        return new Promise(resolve => { releaseOpenedPty = resolve; });
      },
    });
    try {
      controller.handle(activation('manual-during-ack'));
      await flush();
      assert.equal(typeof releaseOpenedPty, 'function', 'opened-pty ACK가 in-flight 상태여야 합니다.');

      controller.userNavigated();
      releaseOpenedPty({ acknowledged: true });
      await flush();
      await flush();

      assert.deepEqual(acknowledged.map(value => value.status), ['opened-pty', 'user-navigated']);
      assert.equal(controller.pendingCount(), 0,
        '후속 user-navigated ACK가 완료된 뒤 activation을 보존하면 안 됩니다.');
    } finally {
      controller.dispose();
    }
  });

  test('작업 카드의 명시 PTY 진입은 생성된 resume와 Codex fork terminal만 verified mount한다', async () => {
    const root = path.resolve(__dirname, '..', '..');
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-drawer.js'), 'utf8');

    for (const scenario of [
      { name: 'resume', session: { id: 'claude:root', provider: 'claude', status: 'running' }, terminalId: 'terminal:resume' },
      { name: 'fork', session: { id: 'codex:desktop', provider: 'codex', clientKind: 'codex-desktop', status: 'completed' }, terminalId: 'terminal:fork' },
    ]) {
      const dispatchedEvents = [];
      const created = [];
      const mounted = [];
      const sandbox = {
        window: {
          WhiteboxAppFactories: {},
          WhiteboxI18n: { t: key => key },
          WhiteboxRendererUtils: {
            canForkCodexDesktopSession: session => scenario.name === 'fork' && session === scenario.session,
            reportRecoverableError: error => { throw error; },
          },
          WhiteboxTerminal: {
            resumeForAgent: async (...args) => {
              created.push(['resume', ...args]);
              return { id: scenario.terminalId, terminalId: scenario.terminalId };
            },
            forkForAgent: async (...args) => {
              created.push(['fork', ...args]);
              return { id: scenario.terminalId, terminalId: scenario.terminalId };
            },
          },
          addEventListener: () => {},
          dispatchEvent: event => dispatchedEvents.push(event.type),
        },
      };
      vm.runInNewContext(source, sandbox, { filename: `app-drawer-${scenario.name}.js` });
      const drawer = sandbox.window.WhiteboxAppFactories.createDrawer({
        state: { details: new Map(), selectedId: '' },
        snapshotSession: id => id === scenario.session.id ? scenario.session : null,
        resultReviewPtyTarget: () => null,
        signalManualTerminalSelection: () => dispatchedEvents.push('manual-selection'),
        canOpenPtyFocus: session => session === scenario.session,
        openPtyFocusVerified: async (sessionId, options) => {
          mounted.push({ sessionId, options });
          return { opened: true };
        },
      });

      assert.equal(await drawer.openDrawer(scenario.session.id, { focus: true }), true);
      assert.equal(created.length, 1);
      assert.equal(created[0][0], scenario.name);
      assert.strictEqual(created[0][1], scenario.session);
      assert.equal(created[0][2], '');
      assert.equal(created[0][3], false);
      assert.deepEqual(created[0][4], { focus: false });
      assert.equal(mounted.length, 1);
      assert.equal(mounted[0].sessionId, scenario.session.id);
      assert.equal(mounted[0].options.targetId, scenario.terminalId);
      assert.equal(mounted[0].options.terminalId, scenario.terminalId);
      assert.equal(mounted[0].options.focus, true);
      assert.equal(mounted[0].options.manualSelectionSignaled, true);
      assert.equal(mounted[0].options.isCurrent(), true);
      assert.deepEqual(dispatchedEvents, ['manual-selection']);
    }
  });

  test('renderer reload 전 delivery ACK는 새 delivery를 처리 완료시키지 못한다', () => {
    const deliveries = [];
    const coordinator = new AttentionActivationCoordinator({
      enabled: true,
      onShow: () => {},
      onDeliver: item => { deliveries.push(item); return true; },
    });
    coordinator.rendererReady();
    coordinator.reconcile([activation('reload')]);
    const oldToken = deliveries.at(-1).deliveryToken;
    coordinator.rendererUnavailable();
    coordinator.rendererReady();
    const newToken = deliveries.at(-1).deliveryToken;
    assert.notEqual(oldToken, newToken);
    assert.deepEqual(coordinator.acknowledge({
      activationId: 'reload', deliveryToken: oldToken, status: 'opened-pty',
    }), { ok: false, acknowledged: false });
    assert.deepEqual(coordinator.acknowledge({
      activationId: 'reload', deliveryToken: newToken, status: 'opened-pty',
    }), { ok: true, acknowledged: true, activationId: 'reload', status: 'opened-pty' });
    coordinator.dispose();
  });

  test('세션이나 정확한 PTY가 늦게 나타나도 새 프로세스 없이 재시도해 한 번만 연다', async () => {
    const timers = fakeTimers();
    let sessions = [];
    let ptyReady = false;
    const shown = [];
    const opened = [];
    const acknowledged = [];
    let controller;
    try {
      controller = createAttentionActivationController({
        retryDelaysMs: [1, 2],
        getSessions: () => sessions,
        isProviderVisible: () => true,
        showSession: session => shown.push(session.id),
        openPty: async session => {
          opened.push(session.id);
          return ptyReady ? { opened: true, retryable: false } : { opened: false, retryable: true };
        },
        acknowledge: value => { acknowledged.push(value); return { acknowledged: true }; },
      });
      controller.handle(activation('late'));
      await flush();
      assert.equal(controller.pendingCount(), 1);
      assert.equal(timers.size, 1);
      assert.deepEqual(opened, []);

      sessions = [{ id: 'codex:session-1', externalId: 'session-1', provider: 'codex' }];
      timers.runNext();
      await flush();
      assert.deepEqual(opened, ['codex:session-1']);
      assert.deepEqual(shown, ['codex:session-1']);
      assert.equal(controller.pendingCount(), 1);
      assert.equal(timers.size, 1);

      ptyReady = true;
      timers.runNext();
      await flush();
      assert.deepEqual(opened, ['codex:session-1', 'codex:session-1']);
      assert.deepEqual(shown, ['codex:session-1']);
      assert.deepEqual(acknowledged, [{ activationId: 'late', deliveryToken: 'delivery-late', status: 'opened-pty' }]);
      assert.equal(controller.pendingCount(), 0);
      assert.equal(timers.size, 0);
    } finally {
      controller?.dispose();
      timers.restore();
    }
  });

  test('activation의 내부 sessionId exact가 중복 externalId 후보보다 우선한다', async () => {
    const sessions = [
      { id: 'codex:session-1', externalId: 'shared-external', provider: 'codex' },
      { id: 'codex:other-a', externalId: 'session-1', provider: 'codex' },
      { id: 'codex:other-b', externalId: 'session-1', provider: 'codex' },
    ];
    const opened = [];
    const acknowledged = [];
    const controller = createAttentionActivationController({
      getSessions: () => sessions,
      isProviderVisible: () => true,
      openPty: async session => {
        opened.push(session.id);
        return { opened: true, retryable: false };
      },
      acknowledge: value => { acknowledged.push(value); return { acknowledged: true }; },
    });
    try {
      controller.handle(activation('exact-internal-priority'));
      await flush();
      assert.deepEqual(opened, ['codex:session-1']);
      assert.deepEqual(acknowledged, [{
        activationId: 'exact-internal-priority',
        deliveryToken: 'delivery-exact-internal-priority',
        status: 'opened-pty',
      }]);
      assert.equal(controller.pendingCount(), 0);
    } finally {
      controller.dispose();
    }
  });

  test('exact session 없이 externalId 후보가 중복되면 PTY를 추측하지 않고 bounded fallback한다', async () => {
    const timers = fakeTimers();
    const opened = [];
    const shown = [];
    const acknowledged = [];
    let controller;
    try {
      controller = createAttentionActivationController({
        retryDelaysMs: [1],
        getSessions: () => [
          { id: 'codex:duplicate-a', externalId: 'shared-external', provider: 'codex' },
          { id: 'codex:duplicate-b', externalId: 'shared-external', provider: 'codex' },
        ],
        isProviderVisible: () => true,
        showSession: session => shown.push(session?.id || null),
        openPty: async session => {
          opened.push(session.id);
          return { opened: true, retryable: false };
        },
        acknowledge: value => { acknowledged.push(value); return { acknowledged: true }; },
      });
      controller.handle(activation('ambiguous-external', {
        sessionId: 'codex:not-present',
        rawSessionId: 'shared-external',
        agentId: 'shared-external',
      }));
      await flush();
      assert.deepEqual(opened, []);
      assert.equal(controller.pendingCount(), 1);
      assert.equal(timers.size, 1);
      timers.runNext();
      await flush();
      assert.deepEqual(opened, [], '중복 externalId 후보 중 하나를 임의 PTY로 열면 안 됩니다.');
      assert.deepEqual(shown, [null]);
      assert.deepEqual(acknowledged, [{
        activationId: 'ambiguous-external',
        deliveryToken: 'delivery-ambiguous-external',
        status: 'opened-session',
      }]);
      assert.equal(controller.pendingCount(), 0);
      assert.equal(timers.size, 0);
    } finally {
      controller?.dispose();
      timers.restore();
    }
  });

  test('삭제된 popup 대신 bounded retry를 소진하면 작업 현황으로 fallback하고 hook을 해제한다', async () => {
    const timers = fakeTimers();
    const shown = [];
    const opened = [];
    const acknowledged = [];
    let controller;
    try {
      controller = createAttentionActivationController({
        retryDelaysMs: [1, 2],
        getSessions: () => [{ id: 'codex:session-1', externalId: 'session-1', provider: 'codex' }],
        isProviderVisible: () => true,
        showSession: session => shown.push(session?.id || null),
        openPty: async session => { opened.push(session.id); return { opened: false, retryable: true }; },
        acknowledge: value => { acknowledged.push(value); return { acknowledged: true }; },
      });
      controller.handle(activation('bounded-fallback'));
      await flush();
      assert.equal(controller.pendingCount(), 1);
      assert.equal(timers.size, 1);
      timers.runNext();
      await flush();
      assert.equal(controller.pendingCount(), 1);
      timers.runNext();
      await flush();

      assert.deepEqual(opened, ['codex:session-1', 'codex:session-1', 'codex:session-1']);
      assert.deepEqual(shown, ['codex:session-1']);
      assert.deepEqual(acknowledged, [{
        activationId: 'bounded-fallback', deliveryToken: 'delivery-bounded-fallback', status: 'opened-session',
      }]);
      assert.equal(controller.pendingCount(), 0);
      assert.equal(timers.size, 0);
    } finally {
      controller?.dispose();
      timers.restore();
    }
  });

  test('새 알람이 온 동안 오래된 PTY open Promise가 끝나도 담당 AI 선택을 되돌리지 않는다', async () => {
    let releaseOld;
    const sessions = [
      { id: 'codex:old', externalId: 'old', provider: 'codex' },
      { id: 'codex:new', externalId: 'new', provider: 'codex' },
      { id: 'codex:child', externalId: 'child', provider: 'codex', parentId: 'codex:new' },
    ];
    const opened = [];
    const shown = [];
    const acknowledged = [];
    const controller = createAttentionActivationController({
      getSessions: () => sessions,
      isProviderVisible: () => true,
      canOpenPty: session => session.id === 'codex:child' || !session.parentId,
      showSession: session => shown.push(session.id),
      openPty: (session, currentActivation) => {
        opened.push(`${session.id}:${currentActivation.preservePopupFocus}`);
        if (session.id === 'codex:old') return new Promise(resolve => { releaseOld = resolve; });
        return Promise.resolve({ opened: true, retryable: false });
      },
      acknowledge: value => { acknowledged.push(value); return { acknowledged: true }; },
    });
    controller.handle(activation('old-alert', { sessionId: 'codex:old', rawSessionId: 'old' }));
    await flush();
    controller.handle(activation('new-alert', { sessionId: 'codex:new', rawSessionId: 'new' }));
    releaseOld({ opened: true, retryable: false });
    await flush();
    await flush();
    assert.deepEqual(opened, ['codex:old:false', 'codex:new:false']);
    assert.deepEqual(acknowledged, [{ activationId: 'new-alert', deliveryToken: 'delivery-new-alert', status: 'opened-pty' }]);

    controller.handle(activation('child-alert', {
      sessionId: 'codex:child', rawSessionId: 'child', agentId: 'child',
    }));
    await flush();
    assert.deepEqual(shown, []);
    assert.deepEqual(acknowledged.at(-1), { activationId: 'child-alert', deliveryToken: 'delivery-child-alert', status: 'opened-pty' });
    assert.deepEqual(opened, ['codex:old:false', 'codex:new:false', 'codex:child:false']);

    controller.handle(activation('question-alert', {
      sessionId: 'codex:new', rawSessionId: 'new', preservePopupFocus: true,
    }));
    await flush();
    assert.equal(opened.at(-1), 'codex:new:true');
  });

  test('취소된 느린 PTY 이동은 UI를 커밋하지 않고 새 알람을 막지 않는다', async () => {
    let releaseOld;
    const committed = [];
    const acknowledged = [];
    const sessions = [
      { id: 'codex:old', externalId: 'old', provider: 'codex' },
      { id: 'codex:new', externalId: 'new', provider: 'codex' },
    ];
    const controller = createAttentionActivationController({
      getSessions: () => sessions,
      isProviderVisible: () => true,
      openPty: (session, _activation, operation) => {
        if (session.id === 'codex:old') {
          return new Promise(resolve => {
            releaseOld = () => {
              if (operation.isCurrent()) committed.push(session.id);
              resolve({ opened: operation.isCurrent(), retryable: true });
            };
          });
        }
        if (operation.isCurrent()) committed.push(session.id);
        return Promise.resolve({ opened: true, retryable: false });
      },
      acknowledge: value => { acknowledged.push(value); return { acknowledged: true }; },
    });
    controller.handle(activation('old-slow', { sessionId: 'codex:old', rawSessionId: 'old' }));
    await flush();
    controller.handle(activation('new-fast', { sessionId: 'codex:new', rawSessionId: 'new' }));
    await flush();
    assert.deepEqual(committed, ['codex:new']);
    assert.equal(acknowledged.at(-1).activationId, 'new-fast');
    releaseOld();
    await flush();
    assert.deepEqual(committed, ['codex:new']);
  });

  test('ACK 거절은 요청을 보존하고 재시도할 때 PTY를 다시 열지 않는다', async () => {
    const timers = fakeTimers();
    let ackCount = 0;
    let openCount = 0;
    let controller;
    try {
      controller = createAttentionActivationController({
        retryDelaysMs: [1],
        getSessions: () => [{ id: 'codex:session-1', externalId: 'session-1', provider: 'codex' }],
        isProviderVisible: () => true,
        openPty: async () => { openCount += 1; return { opened: true, retryable: false }; },
        acknowledge: () => ({ acknowledged: ++ackCount > 1 }),
      });
      controller.handle(activation('ack-retry'));
      await flush();
      assert.equal(controller.pendingCount(), 1);
      assert.equal(openCount, 1);
      assert.equal(timers.size, 1);
      timers.runNext();
      await flush();
      assert.equal(controller.pendingCount(), 0);
      assert.equal(openCount, 1);
      assert.equal(ackCount, 2);
    } finally {
      controller?.dispose();
      timers.restore();
    }
  });

  test('알람 activation은 exact PTY mount를 검증한 뒤에만 집중 화면 ACK를 허용한다', async () => {
    const root = path.resolve(__dirname, '..', '..');
    const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const bootstrapSource = fs.readFileSync(path.join(root, 'renderer', 'app-bootstrap.js'), 'utf8');
    const ptyFocusSource = fs.readFileSync(path.join(root, 'renderer', 'app-pty-focus.js'), 'utf8');
    const inlineSource = fs.readFileSync(path.join(root, 'renderer', 'inline-agent-terminal.js'), 'utf8');
    const terminalSource = fs.readFileSync(path.join(root, 'renderer', 'terminal.js'), 'utf8');
    const activationOpenIndex = bootstrapSource.indexOf('openPty: async (session, activation, operation) => {');
    const ptyFocusRouteIndex = bootstrapSource.indexOf('const outcome = await openPtyFocusVerified?.(session.id, {', activationOpenIndex);
    const activationResultIndex = bootstrapSource.indexOf('return outcome;', ptyFocusRouteIndex);
    assert(activationOpenIndex >= 0 && ptyFocusRouteIndex > activationOpenIndex && activationResultIndex > ptyFocusRouteIndex);
    assert.doesNotMatch(bootstrapSource, /onTargetReady: target => \{|selectView\(["']terminal["']\)/);
    assert.match(bootstrapSource, /targetId: activation\.targetId,[\s\S]*terminalId: activation\.terminalId,[\s\S]*attentionActivation: true,[\s\S]*isCurrent: operation\.isCurrent/u);
    assert.match(bootstrapSource, /whitebox:terminal-manual-selection[\s\S]*attentionActivation\?\.userNavigated\(\)/u);
    assert.match(mainSource, /suppressedActivationIds[\s\S]*attentionHookServer\?\.resolve/u,
      'manual navigation must release suppressed hooks back to the provider TUI');
    assert.match(
      bootstrapSource,
      /const showAttentionSession = \(session = null\) => \{[\s\S]*const root = ownerRootSession\?\.\(session\);[\s\S]*state\.ptyFocusSessionId[\s\S]*root\.id[\s\S]*closePtyFocus\?\.\(\{ restore: false, suppressManualSelection: true \}\)/u,
      'attention fallback은 실패한 activation과 같은 owner root의 PTY focus만 닫아야 합니다.',
    );
    assert.match(inlineSource, /const requestedTargetId = String\(options\.targetId \|\| focusTargetId \|\| rememberedTargetId\);/u);
    assert.match(inlineSource, /const requireTargetId = options\.requireTargetId === true \|\| Boolean\(focusTargetId\);/u);
    assert.match(inlineSource, /targetId: requestedTargetId,[\s\S]*requireTargetId,/u);
    assert.match(terminalSource, /requestedTargetId && options\.requireTargetId === true && !requested[\s\S]*reason: 'target-expired'/u,
      'exact attention target가 사라졌을 때 다른 PTY로 fallback하면 안 됩니다.');
    assert.match(ptyFocusSource, /options\.attentionActivation !== true[\s\S]*whitebox:terminal-manual-selection/u,
      '수동 PTY 선택만 이전 attention activation을 취소해야 합니다.');
    assert.match(ptyFocusSource, /attentionActivation: options\.attentionActivation === true/u,
      'verified API 호출자의 attention 여부를 실제 focus open까지 보존해야 합니다.');
    assert.match(ptyFocusSource, /function openPtyFocusForTerminal[\s\S]*whitebox:terminal-manual-selection[\s\S]*manualSelectionSignaled: options\.attentionActivation !== true/u,
      '사용자가 새로 만든 exact terminal focus는 pending 설정 전에 attention을 취소하고 재진입에서 중복 신호를 내면 안 됩니다.');
    assert.doesNotMatch(bootstrapSource, /openPtyFocusForTerminal/u,
      '자동 attention activation은 사용자 전용 pending terminal focus API를 호출하면 안 됩니다.');
    assert.match(ptyFocusSource, /const alreadyFocusedExact = isPtyFocusActive\(\)[\s\S]*const closeOperationFocus = \(\) => \{[\s\S]*!alreadyFocusedExact[\s\S]*state\.ptyFocusSessionId[\s\S]*state\.ptyFocusTargetId/u,
      '취소된 verified open은 자신이 새로 연 exact root/target focus만 닫아야 합니다.');
    assert.match(mainSource, /const ATTENTION_PTY_OPEN_TIMEOUT_MS = 12_000;[\s\S]*requestTimeoutMs: ATTENTION_PTY_OPEN_TIMEOUT_MS/u,
      'renderer ACK가 반복 실패해도 provider hook을 12초 안에 fail-open해야 합니다.');

    const instrumented = ptyFocusSource
      .replace(
        /(    if \(options\.attentionActivation !== true\r?\n      && options\.manualSelectionSignaled !== true\r?\n      && typeof CustomEvent === "function"\) \{\r?\n      window\.dispatchEvent\(new CustomEvent\("whitebox:terminal-manual-selection"\)\);\r?\n    \}\r?\n)/u,
        '$1    if (context.__verifiedHarness) { context.__openSpy?.(root.id, options); state.ptyFocusSessionId = root.id; state.ptyFocusTargetId = String(options.targetId || ""); focusSyncPromise = Promise.resolve(context.__syncResult); return context.__openResult !== false; }\n',
      )
      .replace(
        '  function closePtyFocus(options = {}) {',
        '  function closePtyFocus(options = {}) {\n    if (context.__closeSpy) { context.__closeSpy(options); state.ptyFocusSessionId = null; state.ptyFocusTargetId = ""; return true; }',
      );
    assert.ok(instrumented.includes('context.__verifiedHarness'), 'verified focus harness injection point is missing');
    const session = {
      id: 'codex:attention', provider: 'codex', status: 'running',
      controlCapabilities: { pty: true }, presentation: { conversationSurface: 'pty' },
      runtimePresence: [{
        kind: 'bridge', terminalId: 'terminal:manual-b', creationId: 'creation:manual-b', provider: 'codex',
      }],
    };
    const forkSession = {
      id: 'codex:desktop-fork-source', externalId: 'desktop-fork-source',
      provider: 'codex', clientKind: 'codex-desktop', status: 'running',
      controlCapabilities: { pty: true }, presentation: { conversationSurface: 'transcript' },
    };
    const forkTarget = {
      id: 'terminal:desktop-fork', terminalId: 'terminal:desktop-fork', kind: 'terminal',
    };
    let embedded = { connected: true, agentSessionId: session.id, terminalId: 'terminal:exact' };
    const dispatched = [];
    const forkTargetRequests = [];
    let cancelSlowActivationOnManualSelection = false;
    let slowActivationCurrent = true;
    const sandbox = {
      Date, Map, Promise, Set,
      CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
      window: {
        WhiteboxAppFactories: {},
        WhiteboxI18n: { t: key => key },
        dispatchEvent: event => {
          dispatched.push(event.type);
          if (cancelSlowActivationOnManualSelection && event.type === 'whitebox:terminal-manual-selection') {
            slowActivationCurrent = false;
          }
        },
        WhiteboxRendererUtils: {
          isWritableDirectSession: value => value === session,
          canForkCodexDesktopSession: () => false,
        },
        WhiteboxTerminal: {
          agentTargets: value => value === forkSession ? [] : [
              { id: 'terminal:exact', terminalId: 'terminal:exact', kind: 'terminal' },
              { id: 'terminal:manual-b', terminalId: 'terminal:manual-b', kind: 'terminal' },
            ],
          forkTargetForAgent: value => {
            forkTargetRequests.push(value?.id || '');
            return value === forkSession ? forkTarget : null;
          },
          embeddedState: () => ({ ...embedded }),
        },
      },
    };
    vm.runInNewContext(instrumented, sandbox, { filename: 'app-pty-focus-verified.js' });
    const focusState = { snapshot: { sessions: [session] }, ptyFocusSessionId: null, ptyFocusTargetId: '' };
    const closed = [];
    const focusContext = {
      state: focusState,
      $: () => null,
      __verifiedHarness: true,
      __syncResult: { ok: true, target: { id: 'terminal:exact', terminalId: 'terminal:exact' } },
      __closeSpy: options => closed.push(options),
    };
    const focus = sandbox.window.WhiteboxAppFactories.createPtyFocusMode(focusContext);

    focusState.snapshot.sessions.push(forkSession);
    embedded = {
      connected: true,
      agentSessionId: forkSession.id,
      terminalId: forkTarget.terminalId,
    };
    focusContext.__syncResult = { ok: true, target: forkTarget };
    assert.deepEqual(await focus.openPtyFocusVerified(forkSession.id, {
      targetId: forkTarget.terminalId,
      terminalId: forkTarget.terminalId,
      attentionActivation: true,
    }), { opened: true, retryable: false, target: forkTarget },
    '다시 실행 중이 된 Codex Desktop 메인 노드도 기존 signed fork target으로 PTY 집중모드를 열어야 합니다.');
    assert.equal(forkTargetRequests.includes(forkSession.id), true,
      'Codex Desktop 메인 노드 검증은 일반 agentTargets가 아니라 fork 전용 association을 조회해야 합니다.');
    assert.deepEqual(await focus.openPtyFocusVerified(forkSession.id, {
      targetId: 'terminal:fork-decoy',
      terminalId: 'terminal:fork-decoy',
    }), { opened: false, retryable: true, reason: 'target-expired' },
    '서명된 fork target과 다른 PTY id를 메인 노드 focus 대상으로 받아들이면 안 됩니다.');
    focus.closePtyFocus({ restore: false });
    closed.length = 0;
    embedded = { connected: true, agentSessionId: session.id, terminalId: 'terminal:exact' };
    focusContext.__syncResult = { ok: true, target: { id: 'terminal:exact', terminalId: 'terminal:exact' } };

    assert.deepEqual(await focus.openPtyFocusVerified(session.id, {
      targetId: 'terminal:exact', terminalId: 'terminal:other',
    }), { opened: false, retryable: true, reason: 'identity-mismatch' });
    assert.deepEqual(await focus.openPtyFocusVerified(session.id, {
      targetId: 'terminal:missing', terminalId: 'terminal:missing',
    }), { opened: false, retryable: true, reason: 'target-expired' });
    embedded = { connected: true, agentSessionId: session.id, terminalId: 'terminal:wrong' };
    assert.deepEqual(await focus.openPtyFocusVerified(session.id, {
      targetId: 'terminal:exact', terminalId: 'terminal:exact', attentionActivation: true,
    }), { opened: false, retryable: true, reason: 'mount-unverified' });
    assert.equal(closed.length, 1, '검증 실패 시 자신이 연 exact focus를 닫아 작업 현황으로 fallback해야 합니다.');
    embedded = { connected: true, agentSessionId: session.id, terminalId: 'terminal:exact' };
    const verified = await focus.openPtyFocusVerified(session.id, {
      targetId: 'terminal:exact', terminalId: 'terminal:exact', attentionActivation: true,
    });
    assert.equal(verified.opened, true);
    assert.equal(verified.retryable, false);
    assert.deepEqual(dispatched, [], 'attention 내부 verified open이 스스로를 수동 선택으로 취소하면 안 됩니다.');

    await focus.openPtyFocusVerified(session.id, {
      targetId: 'terminal:exact', terminalId: 'terminal:exact',
    });
    assert.deepEqual(dispatched, ['whitebox:terminal-manual-selection'],
      '일반 verified PTY 선택은 stale attention을 취소하는 수동 선택 신호를 보내야 합니다.');

    let releaseSlowSync;
    focusContext.__syncResult = new Promise(resolve => { releaseSlowSync = resolve; });
    const slowActivation = focus.openPtyFocusVerified(session.id, {
      targetId: 'terminal:exact', terminalId: 'terminal:exact', attentionActivation: true,
      isCurrent: () => slowActivationCurrent,
    });
    await flush();
    const signalsBeforeManualB = dispatched.length;
    cancelSlowActivationOnManualSelection = true;
    assert.equal(focus.openPtyFocusForTerminal('terminal:manual-b', {
      creationId: 'creation:manual-b', focus: true,
    }), true);
    assert.equal(dispatched.length, signalsBeforeManualB + 1,
      'pending terminal 진입과 실제 open 재진입이 manual-selection을 중복 발생시키면 안 됩니다.');
    releaseSlowSync({ ok: true, target: { id: 'terminal:exact', terminalId: 'terminal:exact' } });
    assert.deepEqual(await slowActivation, { opened: false, retryable: true, reason: 'cancelled' });
    assert.equal(focusState.ptyFocusSessionId, session.id);
    assert.equal(focusState.ptyFocusTargetId, 'terminal:manual-b');
    assert.equal(closed.length, 1,
      '취소된 A activation이 같은 root에서 사용자가 새로 고른 B target focus를 닫으면 안 됩니다.');
  });
}

async function run() {
  const tests = [];
  registerAttentionActivationTests({ test: (name, fn) => tests.push({ name, fn }) });
  let passed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      process.stdout.write(`PASS ${item.name}\n`);
    } catch (error) {
      process.stderr.write(`FAIL ${item.name}\n${error.stack}\n`);
      process.exitCode = 1;
    }
  }
  process.stdout.write(`${passed}/${tests.length} attention activation tests passed\n`);
}

if (require.main === module) run();

module.exports = { registerAttentionActivationTests };
