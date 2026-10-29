'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  AttentionActivationCoordinator,
} = require('../../src/attentionActivationCoordinator');

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
