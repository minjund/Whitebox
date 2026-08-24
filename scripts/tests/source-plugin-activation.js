'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { OPENCODE_MANIFEST } = require('../../src/sourcePlugins/bundled');
const { SourcePluginControlHost } = require('../../src/sourcePlugins/controlHost');
const { SourcePluginMonitorHost } = require('../../src/sourcePlugins/monitorHost');
const { applySourcePluginEnabled } = require('../../src/sourcePlugins/settingsActivation');
const { SourcePluginSettingsStore } = require('../../src/sourcePlugins/settingsStore');
const { summaryForSessions } = require('../../src/sourcePlugins/snapshotProjection');

function registerSourcePluginActivationTests(context) {
  const { temp, test } = context;

  test('source plugin 설정 적용은 control refresh 실패에도 저장값으로 monitor를 재시작한다', async () => {
    let value = { version: 2, enabledPluginIds: ['builtin.aside'], asideHistoryFolders: [] };
    let restartCalls = 0;
    const reports = [];
    const store = {
      setPluginEnabled(pluginId, enabled) {
        value = {
          ...value,
          enabledPluginIds: enabled ? [pluginId] : value.enabledPluginIds.filter(id => id !== pluginId),
        };
        return this.snapshot();
      },
      snapshot: () => ({ ...value, enabledPluginIds: [...value.enabledPluginIds] }),
    };
    const host = {
      listSources: () => [{ id: 'builtin.aside', enabled: false, state: 'disabled' }],
      refresh: async () => { throw new Error('fixture cleanup failed'); },
    };
    const result = await applySourcePluginEnabled({
      store,
      host,
      restartMonitor: async () => { restartCalls += 1; },
      reportError: (operation, error) => reports.push([operation, error.message]),
    }, 'builtin.aside', false);

    assert.equal(result.ok, true);
    assert.deepEqual(result.settings.enabledPluginIds, []);
    assert.equal(restartCalls, 1);
    assert.match(result.warning, /control refresh/);
    assert.deepEqual(reports, [['source-plugin-control-refresh', 'fixture cleanup failed']]);
  });

  test('source plugin 설정 파일 저장 실패는 메모리 활성화 상태도 바꾸지 않는다', () => {
    const blocker = path.join(temp, 'source-plugin-settings-blocker');
    fs.writeFileSync(blocker, 'not-a-directory');
    const store = new SourcePluginSettingsStore(path.join(blocker, 'source-plugins.json'));
    assert.deepEqual(store.snapshot().enabledPluginIds, []);
    assert.throws(() => store.setPluginEnabled('builtin.opencode', true));
    assert.deepEqual(store.snapshot().enabledPluginIds, []);
  });

  test('Whitebox가 실행한 작업이 남아 있으면 plugin 비활성화를 거절하고 stop 경로를 유지한다', async () => {
    const settings = { version: 2, enabledPluginIds: [OPENCODE_MANIFEST.id], asideHistoryFolders: [] };
    let restartCalls = 0;
    const store = {
      setPluginEnabled(pluginId, enabled) {
        settings.enabledPluginIds = enabled
          ? [...new Set([...settings.enabledPluginIds, pluginId])]
          : settings.enabledPluginIds.filter(id => id !== pluginId);
        return this.snapshot();
      },
      snapshot: () => ({ ...settings, enabledPluginIds: [...settings.enabledPluginIds] }),
    };
    const host = new SourcePluginControlHost({
      platform: 'linux',
      settingsStore: store,
      findExecutable: name => name === 'opencode' ? '/fixture/opencode' : '',
    });
    await host.initialize();
    host.children.set('managed-process', {
      id: 'managed-process', pluginId: OPENCODE_MANIFEST.id, externalId: 'managed-session', child: {}, stopping: false,
    });

    await assert.rejects(applySourcePluginEnabled({
      store,
      host,
      restartMonitor: async () => { restartCalls += 1; },
    }, OPENCODE_MANIFEST.id, false), /작업을 먼저 중지/);
    assert.deepEqual(store.snapshot().enabledPluginIds, [OPENCODE_MANIFEST.id]);
    assert.equal(host.listSources().find(source => source.id === OPENCODE_MANIFEST.id).enabled, true);
    assert.deepEqual(
      host.listSources().find(source => source.id === OPENCODE_MANIFEST.id).managedSessionIds,
      ['managed-session'],
    );
    assert.equal(restartCalls, 0);

    host.children.delete('managed-process');
    const disabled = await applySourcePluginEnabled({
      store,
      host,
      restartMonitor: async () => { restartCalls += 1; },
    }, OPENCODE_MANIFEST.id, false);
    assert.deepEqual(disabled.settings.enabledPluginIds, []);
    assert.equal(host.listSources().find(source => source.id === OPENCODE_MANIFEST.id).enabled, false);
    assert.equal(restartCalls, 1);
    await host.dispose();
  });

  test('Aside 비활성화는 connector 정리보다 먼저 snapshot과 모든 조작을 차단한다', async () => {
    const settings = { version: 2, enabledPluginIds: ['builtin.aside'], asideHistoryFolders: [] };
    let releaseDispose = null;
    let operationCalls = 0;
    const disposeGate = new Promise(resolve => { releaseDispose = resolve; });
    const host = new SourcePluginControlHost({
      platform: 'darwin',
      settingsStore: { snapshot: () => ({ ...settings, enabledPluginIds: [...settings.enabledPluginIds] }) },
      findExecutable: name => name === 'aside' ? '/fixture/aside' : '',
    });
    host.createAsideController = async () => ({
      probe: async () => ({
        available: true,
        platformSupported: true,
        sessions: [{ externalId: 'aside-session' }],
        capabilities: { start: true, sendInstruction: true, delete: true, detail: true, list: true },
      }),
      start: async () => { operationCalls += 1; return {}; },
      control: async () => { operationCalls += 1; return {}; },
      detail: async () => { operationCalls += 1; return {}; },
      dispose: async () => disposeGate,
    });
    await host.initialize();
    settings.enabledPluginIds = [];
    const refresh = host.refresh({ force: true });
    await Promise.resolve();

    assert.equal(host.listSources().find(source => source.id === 'builtin.aside').enabled, false);
    assert.equal(Object.hasOwn(host.monitorState().snapshots, 'builtin.aside'), false);
    const session = {
      id: 'builtin.aside:aside-session', externalId: 'aside-session', sourcePluginId: 'builtin.aside',
      controlAuthority: 'official-session-id', sourceControlCapabilities: { sendInstruction: true, delete: true },
    };
    assert.equal((await host.start('builtin.aside', { prompt: 'blocked', cwd: temp })).ok, false);
    await assert.rejects(host.control(session, 'send', { prompt: 'blocked' }), /비활성화/);
    assert.throws(() => host.prepareDelete(session), /비활성화/);
    await assert.rejects(host.detail(session), /비활성화/);
    assert.equal(operationCalls, 0);

    releaseDispose();
    await refresh;
    await host.dispose();
  });

  test('old monitor worker는 runtime disabled 상태를 받으면 DB scan과 watch를 즉시 중단한다', async () => {
    let scanCalls = 0;
    const host = new SourcePluginMonitorHost({
      platform: 'linux',
      settings: { version: 2, enabledPluginIds: ['builtin.opencode'], asideHistoryFolders: [] },
      definitions: [{
        manifest: OPENCODE_MANIFEST,
        createMonitor: () => ({
          watchRoots: () => ['/fixture/opencode'],
          scan: () => { scanCalls += 1; return [{ externalId: 'must-not-read' }]; },
        }),
      }],
    });
    host.setRuntimeStatuses([{
      id: 'builtin.opencode', enabled: false, available: false, state: 'disabled', reason: 'disabled', capabilities: {},
    }]);
    assert.deepEqual(host.watchRoots(), []);
    const result = await host.scan();
    assert.equal(scanCalls, 0);
    assert.deepEqual(result.sessions, []);
    assert.equal(result.statuses[0].enabled, false);
    await host.dispose();
  });

  test('OpenCode CLI만 준비되고 history DB가 없으면 ready 대신 원인을 포함한 degraded 상태다', async () => {
    const host = new SourcePluginMonitorHost({
      platform: 'linux',
      settings: { version: 2, enabledPluginIds: ['builtin.opencode'], asideHistoryFolders: [] },
      definitions: [{
        manifest: OPENCODE_MANIFEST,
        createMonitor: () => ({
          scan: () => ({
            sessions: [],
            status: { available: false, state: 'degraded', reason: 'OpenCode history DB missing.' },
          }),
        }),
      }],
    });
    host.setRuntimeStatuses([{
      id: 'builtin.opencode', enabled: true, available: true, state: 'ready', reason: '',
      capabilities: { start: true },
    }]);
    const result = await host.scan();
    assert.equal(result.statuses[0].available, true);
    assert.equal(result.statuses[0].state, 'degraded');
    assert.match(result.statuses[0].reason, /history DB missing/);
    assert.equal(result.statuses[0].capabilities.start, true);
    await host.dispose();
  });

  test('비활성 plugin session을 거른 snapshot summary는 provider 수치와 usage도 다시 계산한다', () => {
    const visible = [{
      id: 'direct', provider: 'codex', status: 'running', parentId: null,
      usage: { input: 3, output: 2, total: 5 },
    }];
    const summary = summaryForSessions({
      providers: [{ id: 'codex', sessions: 2, active: 2, usage: { total: 905 } }],
      totals: { sessions: 2, active: 2, usage: { total: 905 } },
    }, visible);
    assert.equal(summary.providers[0].sessions, 1);
    assert.equal(summary.providers[0].active, 1);
    assert.equal(summary.providers[0].usage.total, 5);
    assert.equal(summary.totals.sessions, 1);
    assert.equal(summary.totals.usage.total, 5);
  });
}

module.exports = { registerSourcePluginActivationTests };
