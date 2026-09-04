'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const {
  PACKET_CLOSE,
  PACKET_OPEN,
  comprehensionPromptFingerprint,
  injectComprehensionContract,
} = require('../../src/comprehensionPacket');
const {
  ASIDE_MANIFEST,
  OMO_MANIFEST,
  OPENCODE_MANIFEST,
  bundledSourceDefinitions,
} = require('../../src/sourcePlugins/bundled');
const {
  canonicalSessionId,
  normalizeSourceSession,
} = require('../../src/sourcePlugins/contracts');
const {
  DELETE_TOKEN_TTL_MS,
  SourcePluginControlHost,
} = require('../../src/sourcePlugins/controlHost');
const { SourcePluginMonitorHost } = require('../../src/sourcePlugins/monitorHost');
const {
  DESKTOP_SOURCE_PLUGIN_IDS,
  SourcePluginSettingsStore,
  desktopSourcePluginId,
  isSourcePluginEnabled,
  normalizeSettings,
} = require('../../src/sourcePlugins/settingsStore');
const { discoverAsideTools } = require('../../src/sourcePlugins/bundled/aside/capabilities');
const { normalizeOfficialTask } = require('../../src/sourcePlugins/bundled/aside');
const { scanAsideHistoryFolders } = require('../../src/sourcePlugins/bundled/aside/folderHistory');
const {
  OmoOpenCodeMonitor,
  openCodeDbPath,
  openCodeDbPaths,
} = require('../../src/sourcePlugins/bundled/omo');
const {
  OPENCODE_PLUGIN_ID,
  OpenCodeHistoryMonitor,
} = require('../../src/sourcePlugins/bundled/opencode');
const { enrichSession } = require('../../src/sessionIntelligence');
const {
  McpStdioClient,
  createMessageParser,
  encodeJsonRpcMessage,
} = require('../../src/sourcePlugins/mcpClient');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (_unsupportedRuntime) {
  // The product reports node:sqlite as unavailable on older Node runtimes.
}

function registerSourcePluginTests(context) {
  const { root, temp, test } = context;

  test('source plugin manifest와 canonical ID가 출처·모델·환경·런타임을 분리한다', () => {
    assert.equal(Object.isFrozen(OPENCODE_MANIFEST), true);
    assert.equal(Object.isFrozen(OMO_MANIFEST), true);
    assert.equal(Object.isFrozen(ASIDE_MANIFEST), true);
    assert.notEqual(OPENCODE_MANIFEST.id, OMO_MANIFEST.id);
    assert.notEqual(OPENCODE_MANIFEST.source.id, OMO_MANIFEST.source.id);
    assert.notEqual(OMO_MANIFEST.id, ASIDE_MANIFEST.id);
    assert.notEqual(OMO_MANIFEST.source.id, ASIDE_MANIFEST.source.id);
    assert.equal(canonicalSessionId(OMO_MANIFEST.id, 'shared-id'), 'builtin.omo:shared-id');
    assert.equal(canonicalSessionId(ASIDE_MANIFEST.id, 'shared-id'), 'builtin.aside:shared-id');
    assert.equal(canonicalSessionId(OPENCODE_MANIFEST.id, 'shared-id'), 'builtin.opencode:shared-id');

    assert.deepEqual(
      bundledSourceDefinitions().map(definition => definition.manifest.id),
      ['builtin.opencode', 'builtin.aside'],
    );

    const normalized = normalizeSourceSession({
      externalId: 'shared-id',
      title: 'fixture',
      modelProvider: 'openai',
      modelProviderLabel: 'OpenAI',
      environment: { kind: 'windows', label: 'Windows' },
      provenance: { runtime: { kind: 'opencode', label: 'OpenCode' } },
      updatedAt: '2026-08-13T00:00:00.000Z',
    }, OMO_MANIFEST, { platform: 'win32' });

    assert.equal(normalized.id, 'builtin.omo:shared-id');
    assert.equal(normalized.provenance.source.id, 'omo');
    assert.equal(normalized.provenance.provider.id, 'openai');
    assert.equal(normalized.provenance.environment.kind, 'windows');
    assert.equal(normalized.provenance.runtime.kind, 'opencode');
    assert.equal(normalized.provenance.runtime.label, 'OpenCode');
  });

  test('source plugin 설정은 OpenCode·Aside만 opt-in으로 정규화하고 방어 복사해 저장한다', () => {
    const settingsFile = path.join(temp, 'source-plugin-settings-v2.json');
    // Legacy (pre-v3) input: desktop toggles did not exist yet, so they are
    // migrated in as enabled instead of being treated as an opt-out.
    const normalized = normalizeSettings({
      enabledPluginIds: ['builtin.opencode', 'builtin.opencode', 'builtin.unknown', 'builtin.aside'],
      asideHistoryFolders: [temp, temp],
    });
    assert.deepEqual(normalized, {
      version: 3,
      enabledPluginIds: ['builtin.opencode', 'builtin.aside', ...DESKTOP_SOURCE_PLUGIN_IDS],
      asideHistoryFolders: [path.resolve(temp)],
    });

    const store = new SourcePluginSettingsStore(settingsFile);
    assert.deepEqual(store.snapshot().enabledPluginIds, [...DESKTOP_SOURCE_PLUGIN_IDS]);
    const enabled = store.setPluginEnabled('builtin.opencode', true);
    enabled.enabledPluginIds.push('builtin.aside');
    assert.deepEqual(store.snapshot().enabledPluginIds, [...DESKTOP_SOURCE_PLUGIN_IDS, 'builtin.opencode']);
    assert.deepEqual(
      new SourcePluginSettingsStore(settingsFile).snapshot().enabledPluginIds,
      [...DESKTOP_SOURCE_PLUGIN_IDS, 'builtin.opencode'],
    );
    assert.throws(() => store.setPluginEnabled('builtin.unknown', true), /지원하지 않는/);
  });

  test('데스크톱 앱 토글은 기본 켜짐이고 v3 파일의 명시적 opt-out만 유지된다', () => {
    assert.equal(desktopSourcePluginId('claude-desktop'), 'builtin.claude-desktop');
    assert.equal(desktopSourcePluginId('Codex-Desktop'), 'builtin.codex-desktop');
    assert.equal(desktopSourcePluginId('claude-cli'), '');
    assert.equal(desktopSourcePluginId(''), '');

    // Missing settings (store not ready yet) must keep desktop history visible.
    assert.equal(isSourcePluginEnabled(undefined, 'builtin.claude-desktop'), true);
    assert.equal(isSourcePluginEnabled({ version: 2, enabledPluginIds: [] }, 'builtin.codex-desktop'), true);
    // A v3 file that omits a desktop id records a deliberate opt-out.
    assert.equal(isSourcePluginEnabled({ version: 3, enabledPluginIds: [] }, 'builtin.claude-desktop'), false);

    const settingsFile = path.join(temp, 'source-plugin-settings-desktop.json');
    const store = new SourcePluginSettingsStore(settingsFile);
    assert.equal(isSourcePluginEnabled(store.snapshot(), 'builtin.claude-desktop'), true);
    assert.equal(isSourcePluginEnabled(store.snapshot(), 'builtin.codex-desktop'), true);

    store.setPluginEnabled('builtin.claude-desktop', false);
    assert.equal(isSourcePluginEnabled(store.snapshot(), 'builtin.claude-desktop'), false);
    assert.equal(isSourcePluginEnabled(store.snapshot(), 'builtin.codex-desktop'), true);
    // The opt-out survives a reload of the persisted v3 file.
    const reloaded = new SourcePluginSettingsStore(settingsFile);
    assert.equal(isSourcePluginEnabled(reloaded.snapshot(), 'builtin.claude-desktop'), false);
    assert.equal(isSourcePluginEnabled(reloaded.snapshot(), 'builtin.codex-desktop'), true);

    store.setPluginEnabled('builtin.claude-desktop', true);
    assert.equal(isSourcePluginEnabled(store.snapshot(), 'builtin.claude-desktop'), true);
  });

  test('런타임 준비 전 bootstrap도 데스크톱 기록 기본값을 숨기지 않는다', () => {
    const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const rendererCore = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
    assert.equal(main.includes('version: SOURCE_PLUGIN_SETTINGS_VERSION'), true);
    assert.equal(main.includes('enabledPluginIds: [...DESKTOP_SOURCE_PLUGIN_IDS]'), true);
    assert.match(rendererCore,
      /sourcePluginSettings:\s*\{\s*version:\s*3,\s*enabledPluginIds:\s*\["builtin\.claude-desktop",\s*"builtin\.codex-desktop"\]/,
      'renderer cold-start defaults must enable both desktop history sources.');

    // A loaded v3 snapshot remains authoritative, including an explicit opt-out.
    assert.deepEqual(normalizeSettings({
      version: 3,
      enabledPluginIds: ['builtin.codex-desktop'],
      asideHistoryFolders: [],
    }).enabledPluginIds, ['builtin.codex-desktop']);
  });

  test('비활성 source plugin은 monitor factory·watch·scan·외부 snapshot을 사용하지 않는다', async () => {
    let factoryCalls = 0;
    let scanCalls = 0;
    const definition = {
      manifest: OPENCODE_MANIFEST,
      createMonitor: () => {
        factoryCalls += 1;
        return {
          watchRoots: () => ['/must-not-watch'],
          scan: () => {
            scanCalls += 1;
            return [{ externalId: 'must-not-load' }];
          },
        };
      },
    };
    const disabled = new SourcePluginMonitorHost({
      platform: 'linux',
      settings: { version: 2, enabledPluginIds: [], asideHistoryFolders: [] },
      definitions: [definition],
    });
    assert.equal(factoryCalls, 0);
    assert.deepEqual(disabled.watchRoots(), []);
    assert.equal(disabled.setExternalSnapshot(OPENCODE_MANIFEST.id, { sessions: [{ externalId: 'external' }] }), false);
    const disabledResult = await disabled.scan();
    assert.equal(scanCalls, 0);
    assert.deepEqual(disabledResult.sessions, []);
    assert.equal(disabledResult.statuses[0].enabled, false);
    assert.equal(disabledResult.statuses[0].state, 'disabled');
    assert.equal(disabledResult.statuses[0].sessionCount, 0);
    await disabled.dispose();

    const enabled = new SourcePluginMonitorHost({
      platform: 'linux',
      settings: { version: 2, enabledPluginIds: [OPENCODE_MANIFEST.id], asideHistoryFolders: [] },
      definitions: [definition],
    });
    const enabledResult = await enabled.scan();
    assert.equal(factoryCalls, 1);
    assert.equal(scanCalls, 1);
    assert.equal(enabledResult.sessions[0].id, 'builtin.opencode:must-not-load');
    await enabled.dispose();
  });

  test('control host는 비활성 OpenCode·Aside를 probe하거나 실행하지 않는다', async () => {
    let executableChecks = 0;
    let spawnCalls = 0;
    const settings = { version: 2, enabledPluginIds: [], asideHistoryFolders: [] };
    const host = new SourcePluginControlHost({
      platform: 'linux',
      settingsStore: { snapshot: () => ({ ...settings, enabledPluginIds: [...settings.enabledPluginIds] }) },
      findExecutable: () => { executableChecks += 1; return '/fixture/tool'; },
      spawn: () => { spawnCalls += 1; throw new Error('must not spawn'); },
    });
    await host.initialize();
    assert.equal(executableChecks, 0);
    assert.equal(host.listSources().find(source => source.id === OPENCODE_MANIFEST.id).enabled, false);
    assert.equal(host.listSources().find(source => source.id === ASIDE_MANIFEST.id).enabled, false);
    const rejected = await host.start(OPENCODE_MANIFEST.id, { prompt: 'blocked', cwd: temp });
    assert.equal(rejected.ok, false);
    assert.equal(spawnCalls, 0);

    settings.enabledPluginIds = [OPENCODE_MANIFEST.id];
    await host.refresh({ force: true });
    assert.equal(executableChecks, 1);
    assert.equal(host.listSources().find(source => source.id === OPENCODE_MANIFEST.id).available, true);
    await host.dispose();
  });

  test('공개 source start는 가져온 OpenCode externalId 재개를 거절하고 새 세션만 실행한다', async () => {
    const spawnCalls = [];
    const settings = { version: 2, enabledPluginIds: [OPENCODE_MANIFEST.id], asideHistoryFolders: [] };
    const host = new SourcePluginControlHost({
      platform: 'linux',
      settingsStore: { snapshot: () => ({ ...settings, enabledPluginIds: [...settings.enabledPluginIds] }) },
      findExecutable: name => name === 'opencode' ? '/fixture/opencode' : '',
      spawn: (executable, args) => {
        spawnCalls.push({ executable, args });
        return { pid: 424242, once: () => {} };
      },
    });
    await host.initialize();

    const rejected = await host.start(OPENCODE_MANIFEST.id, {
      prompt: 'resume imported history', cwd: temp, externalId: 'read-only-session', requestId: 'unsafe-resume',
    });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /재개할 수 없습니다/);
    assert.equal(spawnCalls.length, 0);

    const started = await host.start(OPENCODE_MANIFEST.id, {
      prompt: 'start a fresh task', cwd: temp, requestId: 'fresh-start',
    });
    assert.equal(started.ok, true);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].args.includes('--session'), false);
    host.children.clear();
    await host.dispose();
  });

  test('Whitebox source 최초 작업만 계약을 주입하고 첫 top-level ID ownership을 재시작 뒤에도 보존한다', async () => {
    const settingsFile = path.join(temp, 'source-comprehension-settings.json');
    const settings = { version: 2, enabledPluginIds: [OPENCODE_MANIFEST.id], asideHistoryFolders: [] };
    const settingsStore = {
      file: settingsFile,
      snapshot: () => ({ ...settings, enabledPluginIds: [...settings.enabledPluginIds] }),
    };
    const launches = [];
    const children = [];
    const makeChild = () => {
      const child = new EventEmitter();
      child.pid = 610000 + children.length;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => true;
      children.push(child);
      return child;
    };
    const host = new SourcePluginControlHost({
      platform: 'linux',
      settingsStore,
      findExecutable: name => name === 'opencode' ? '/fixture/opencode' : '',
      spawn: (executable, args) => {
        launches.push({ executable, args: [...args] });
        return makeChild();
      },
      now: () => Date.parse('2026-09-04T00:00:00.000Z'),
    });
    await host.initialize();

    const originalPrompt = '사용자에게 보일 원문 source 작업';
    const started = await host.start(OPENCODE_MANIFEST.id, {
      prompt: originalPrompt, cwd: temp, requestId: 'source-owned-start',
    });
    assert.equal(started.ok, true);
    const injectedPrompt = launches[0].args.at(-1);
    assert.equal(injectedPrompt.endsWith(originalPrompt), true);
    assert.equal(injectedPrompt.split('<whitebox-comprehension-contract').length - 1, 1);
    assert.notEqual(injectedPrompt, originalPrompt);

    children[0].stdout.write(`${JSON.stringify({ sessionID: 'source-owned-session' })}\n`);
    const ownerships = host.monitorState().snapshots[OPENCODE_MANIFEST.id].comprehensionOwnerships;
    assert.equal(ownerships.length, 1);
    assert.equal(ownerships[0].externalId, 'source-owned-session');
    assert.equal(ownerships[0].promptFingerprint, comprehensionPromptFingerprint(injectedPrompt));
    assert.equal(Object.hasOwn(host.listSources()[0], 'comprehensionOwnerships'), false,
      'ownership proof는 renderer용 source status에 노출하면 안 됩니다.');

    const reloaded = new SourcePluginControlHost({
      platform: 'linux', settingsStore, findExecutable: () => '',
    });
    assert.equal(
      reloaded.monitorState().snapshots[OPENCODE_MANIFEST.id].comprehensionOwnerships[0].externalId,
      'source-owned-session',
    );

    await host.start(OPENCODE_MANIFEST.id, {
      prompt: '기존 source 세션 후속 지시', cwd: temp, externalId: 'source-owned-session', requestId: 'source-followup',
    }, { allowExistingSession: true });
    assert.equal(launches[1].args.at(-1), '기존 source 세션 후속 지시');
    assert.equal(launches[1].args.at(-1).includes('whitebox-comprehension-contract'), false);

    children[0].stdout.write(`${JSON.stringify({ sessionID: 'conflicting-top-level-session' })}\n`);
    assert.deepEqual(host.monitorState().snapshots[OPENCODE_MANIFEST.id].comprehensionOwnerships, [],
      '한 child가 다른 top-level ID를 주장하면 기존 ownership도 폐기해야 합니다.');
    const afterConflict = new SourcePluginControlHost({
      platform: 'linux', settingsStore, findExecutable: () => '',
    });
    assert.deepEqual(afterConflict.comprehensionOwnershipSnapshot(OPENCODE_MANIFEST.id), [],
      'ownership 충돌 폐기는 재시작 뒤에도 유지되어야 합니다.');

    const asidePrompt = 'Aside에서 사용자에게 보일 원문 작업';
    let asideInput = null;
    const asideChanges = [];
    const asideHost = new SourcePluginControlHost({
      platform: 'darwin',
      comprehensionOwnershipFile: path.join(temp, 'aside-comprehension-ownership.json'),
      findExecutable: () => '',
      now: () => Date.parse('2026-09-04T00:00:00.000Z'),
    });
    asideHost.statuses.set(ASIDE_MANIFEST.id, {
      id: ASIDE_MANIFEST.id, enabled: true, available: true,
      capabilities: { start: true },
    });
    asideHost.aside = {
      start: async input => { asideInput = input; return { taskId: 'aside-owned-session' }; },
      detail: async () => normalizeOfficialTask({
        taskId: 'aside-owned-session',
        status: 'completed',
        updatedAt: '2026-09-04T00:01:00.000Z',
        messages: [
          { role: 'user', text: asideInput.prompt, timestamp: '2026-09-04T00:00:00.000Z' },
          { role: 'assistant', text: `${'Aside 원문 완료 응답'}\n\n${PACKET_OPEN}\n${JSON.stringify({
            schemaVersion: 1,
            id: 'aside-source-packet',
            title: 'Aside source 이해 패킷',
            summary: 'Aside 작업의 변경과 판단을 설명합니다.',
            difficulty: 2,
            difficultyReason: '작업 흐름과 제약을 함께 이해해야 합니다.',
            evidence: [{ id: 'aside-evidence', label: 'Aside 기록', detail: '공식 완료 기록입니다.' }],
            questions: [{
              id: 'aside-question', kind: 'source-flow', topics: ['change', 'decision', 'constraint-risk'],
              prompt: '이 작업의 핵심은?',
              options: [{ id: 'aside-answer', label: '근거와 제약' }, { id: 'aside-wrong', label: '점수만' }],
              answerId: 'aside-answer', explanation: '근거와 제약을 확인합니다.', evidenceIds: ['aside-evidence'],
              variant: {
                prompt: '다음 작업에서는?',
                options: [{ id: 'aside-variant-answer', label: '맥락을 확인' }, { id: 'aside-variant-wrong', label: '무시' }],
                answerId: 'aside-variant-answer', explanation: '맥락을 확인해야 합니다.',
              },
            }],
          })}\n${PACKET_CLOSE}`, timestamp: '2026-09-04T00:01:00.000Z' },
        ],
      }, { capabilities: {} }, { fullHistory: true }),
      dispose: async () => {},
    };
    asideHost.on('changed', state => asideChanges.push(state));
    const asideStarted = await asideHost.start(ASIDE_MANIFEST.id, {
      prompt: asidePrompt, cwd: temp, requestId: 'aside-owned-start',
    });
    assert.equal(asideStarted.ok, true);
    assert.equal(asideInput.userPrompt, asidePrompt);
    assert.equal(asideInput.title, asidePrompt);
    assert.equal(asideInput.prompt.endsWith(asidePrompt), true);
    assert.equal(
      asideChanges.at(-1).snapshots[ASIDE_MANIFEST.id].comprehensionOwnerships[0].externalId,
      'aside-owned-session',
      '동기 start 결과의 ownership도 즉시 worker snapshot에 전달해야 합니다.',
    );
    const asideDetail = await asideHost.detail({
      sourcePluginId: ASIDE_MANIFEST.id, externalId: 'aside-owned-session',
    });
    assert.equal(asideDetail.completionObserved, true);
    assert.equal(asideDetail.completedAt, '2026-09-04T00:01:00.000Z');
    assert.equal(asideDetail.comprehensionContractInjected, true);
    assert.equal(asideDetail.comprehension.status, 'ready');
    assert.equal(asideDetail.messages[0].text, asidePrompt);
    assert.equal(asideDetail.messages[1].text, 'Aside 원문 완료 응답');

    const persistenceBlocker = path.join(temp, 'ownership-parent-file');
    fs.writeFileSync(persistenceBlocker, 'not a directory');
    const persistenceHost = new SourcePluginControlHost({
      comprehensionOwnershipFile: path.join(persistenceBlocker, 'ownership.json'),
    });
    let persistenceError = null;
    persistenceHost.on('cleanup-error', error => { persistenceError = error; });
    const persistedOwnership = persistenceHost.rememberComprehensionOwnership(OPENCODE_MANIFEST.id, 'persistence-error-session', {
      requestId: 'persistence-error-request', promptFingerprint: 'f'.repeat(64),
    });
    assert.ok(persistenceError, 'ownership 저장 실패는 기존 recoverable error 채널로 보고해야 합니다.');
    assert.equal(persistedOwnership, false,
      'ownership 저장 실패를 성공으로 보고하면 재시작 후 패킷 상태가 달라질 수 있습니다.');
    assert.deepEqual(
      persistenceHost.comprehensionOwnershipSnapshot(OPENCODE_MANIFEST.id),
      [],
      '디스크에 남길 수 없는 ownership은 현재 실행에서도 승인 근거로 노출하면 안 됩니다.',
    );
    host.children.clear();
    reloaded.children.clear();
    afterConflict.children.clear();
    await host.dispose();
    await reloaded.dispose();
    await afterConflict.dispose();
    await asideHost.dispose();
    await persistenceHost.dispose();
  });

  test('source monitor는 persisted ownership을 복원하되 관측된 계약 prompt hash 불일치는 거절한다', async () => {
    const originalPrompt = 'source ownership 검증 작업';
    const injectedPrompt = injectComprehensionContract(originalPrompt);
    const packet = {
      schemaVersion: 1,
      id: 'source-packet',
      title: 'Source 이해 패킷',
      summary: 'source task가 수행한 변경과 판단을 설명합니다.',
      difficulty: 2,
      difficultyReason: 'source 흐름과 제약을 함께 이해해야 합니다.',
      evidence: [{ id: 'source-evidence', label: 'source 기록', detail: '동일 source 세션의 실제 완료 기록입니다.' }],
      questions: [{
        id: 'source-question', kind: 'source-flow', topics: ['change', 'decision', 'constraint-risk'],
        prompt: '이 source 작업에서 확인해야 할 핵심은?',
        options: [{ id: 'source-answer', label: '변경과 판단 및 위험' }, { id: 'source-wrong', label: '점수만 확인' }],
        answerId: 'source-answer', explanation: '다음 지시를 정확히 하기 위한 오픈북 확인입니다.',
        evidenceIds: ['source-evidence'],
        variant: {
          prompt: '같은 원리를 다음 작업에 적용한다면?',
          options: [{ id: 'source-variant-answer', label: '근거와 제약을 함께 본다' }, { id: 'source-variant-wrong', label: '결과만 본다' }],
          answerId: 'source-variant-answer', explanation: '근거와 제약이 후속 지시의 정확도를 높입니다.',
        },
      }],
    };
    const visibleAnswer = 'source 작업을 완료했고 원문 응답은 보존됩니다.';
    const response = `${visibleAnswer}\n\n${PACKET_OPEN}\n${JSON.stringify(packet)}\n${PACKET_CLOSE}`;
    const row = externalId => ({
      externalId,
      title: injectedPrompt.slice(0, 240),
      status: 'completed',
      completionObserved: true,
      updatedAt: '2026-09-04T00:01:00.000Z',
      startedAt: '2026-09-04T00:00:00.000Z',
      messages: [
        { id: `${externalId}-user`, role: 'user', text: injectedPrompt, timestamp: '2026-09-04T00:00:00.000Z' },
        { id: `${externalId}-assistant`, role: 'assistant', text: response, timestamp: '2026-09-04T00:01:00.000Z' },
      ],
      result: response,
      outcome: { verification: 'source finish event', summary: response },
      comprehensionContractInjected: true,
      comprehension: { status: 'ready', schemaVersion: 1, packet },
    });
    const trimmedOwned = row('source-owned-trimmed');
    trimmedOwned.title = '최근 후속 지시';
    trimmedOwned.messages = [
      { id: 'trimmed-followup', role: 'user', text: '최근 후속 지시', timestamp: '2026-09-04T00:00:30.000Z' },
      { id: 'trimmed-assistant', role: 'assistant', text: response, timestamp: '2026-09-04T00:01:00.000Z' },
    ];
    const externalWithoutContract = row('source-external-no-contract');
    externalWithoutContract.messages[0].text = '외부 세션의 일반 프롬프트';
    externalWithoutContract.title = '외부 세션의 일반 프롬프트';
    const rows = [
      row('source-owned-session'),
      trimmedOwned,
      row('source-external-spoof'),
      externalWithoutContract,
    ];
    const definition = {
      manifest: OPENCODE_MANIFEST,
      createMonitor: () => ({
        scan: () => rows,
        detail: externalId => rows.find(item => item.externalId === externalId),
      }),
    };
    const ownership = {
      pluginId: OPENCODE_MANIFEST.id,
      externalId: 'source-owned-session',
      promptFingerprint: comprehensionPromptFingerprint(injectedPrompt),
      requestId: 'persisted-source-start',
      boundAt: '2026-09-04T00:00:00.000Z',
    };
    const monitor = new SourcePluginMonitorHost({ platform: 'linux', definitions: [definition] });
    monitor.setRuntimeStatuses([{
      id: OPENCODE_MANIFEST.id, enabled: true, available: true, capabilities: { start: true },
    }]);
    monitor.setExternalSnapshot(OPENCODE_MANIFEST.id, {
      comprehensionOwnerships: [
        ownership,
        { ...ownership, externalId: 'source-owned-trimmed', requestId: 'persisted-source-trimmed' },
      ],
    });
    const scanned = await monitor.scan();
    const owned = scanned.sessions.find(session => session.externalId === 'source-owned-session');
    const trimmed = scanned.sessions.find(session => session.externalId === 'source-owned-trimmed');
    const spoof = scanned.sessions.find(session => session.externalId === 'source-external-spoof');
    const noContractSpoof = scanned.sessions.find(session => session.externalId === 'source-external-no-contract');
    assert.equal(owned.comprehensionContractInjected, true);
    assert.equal(owned.comprehension.status, 'ready');
    assert.equal(owned.comprehension.packet.id, 'source-packet');
    assert.equal(owned.messages[0].text, originalPrompt);
    assert.equal(owned.messages[1].text, visibleAnswer);
    assert.equal(owned.result, visibleAnswer);
    assert.equal(owned.title, originalPrompt);
    assert.equal(spoof.comprehensionContractInjected, false);
    assert.equal(spoof.comprehension.status, 'unsupported');
    assert.equal(spoof.comprehensionCandidate.status, 'ready');
    assert.equal(trimmed.comprehensionContractInjected, true,
      '최초 prompt가 잘린 최근 기록 창은 exact persisted binding으로 복원해야 합니다.');
    assert.equal(trimmed.comprehension.status, 'ready');
    assert.equal(trimmed.messages[0].text, '최근 후속 지시',
      '최근 plain follow-up은 최초 prompt hash 불일치 증거가 아닙니다.');
    assert.equal(trimmed.messages[1].text, visibleAnswer);
    assert.equal(noContractSpoof.comprehensionContractInjected, false);
    assert.equal(noContractSpoof.comprehension.status, 'unsupported');
    assert.equal(noContractSpoof.messages[1].text, visibleAnswer,
      '외부 packet envelope는 승격하지 않되 transcript에는 누출하지 않습니다.');

    const detail = await monitor.detail(owned.id);
    assert.equal(detail.comprehensionContractInjected, true);
    assert.equal(detail.comprehension.status, 'ready');
    assert.equal(detail.messages[1].text, visibleAnswer);

    const mismatched = new SourcePluginMonitorHost({ platform: 'linux', definitions: [definition] });
    mismatched.setRuntimeStatuses([{
      id: OPENCODE_MANIFEST.id, enabled: true, available: true, capabilities: { start: true },
    }]);
    mismatched.setExternalSnapshot(OPENCODE_MANIFEST.id, {
      comprehensionOwnerships: [{ ...ownership, promptFingerprint: '0'.repeat(64) }],
    });
    const mismatch = (await mismatched.scan()).sessions.find(session => session.externalId === 'source-owned-session');
    assert.equal(mismatch.comprehensionContractInjected, false);
    assert.equal(mismatch.comprehension.status, 'unsupported');
    await monitor.dispose();
    await mismatched.dispose();
  });

  test('OpenCode adapter가 OMO parser 결과의 canonical ID·provenance·하위 작업을 OpenCode 출처로 교체한다', () => {
    let closed = false;
    const raw = {
      id: 'builtin.opencode:parent',
      externalId: 'parent',
      parentId: null,
      childIds: ['builtin.opencode:child'],
      source: 'omo',
      sourceLabel: 'OMO · OpenCode',
      sourcePluginId: 'builtin.omo',
      sourcePlugin: { id: 'builtin.omo', version: '1.0.0', label: 'OMO · OpenCode', mark: 'OMO', trust: 'bundled' },
      orchestrator: 'omo',
      clientKind: 'opencode-omo',
      provenance: {
        source: { id: 'omo', label: 'OMO · OpenCode', pluginId: 'builtin.omo', trust: 'bundled' },
        provider: { id: 'openai', label: 'OpenAI', family: 'codex' },
        runtime: { kind: 'opencode', label: 'OpenCode' },
        orchestrator: { id: 'omo', label: 'Oh My OpenAgent' },
        client: { id: 'opencode', label: 'OpenCode' },
      },
      executions: [{ id: 'exec', source: 'omo-opencode-tool' }],
      artifacts: [{ id: 'artifact', source: 'omo-opencode-tool' }],
      outcome: { artifacts: [{ id: 'artifact', source: 'omo-opencode-tool' }] },
      collaboration: {
        spawns: [{ childId: 'builtin.opencode:child', taskName: 'OMO 하위 작업' }],
        communications: [{ to: 'builtin.opencode:child', from: 'OMO', label: 'OMO 하위 작업 배정', taskName: 'OMO 하위 작업' }],
      },
      controlUnavailableReasons: { stop: 'Whitebox에서 시작해 현재 소유 중인 OMO 프로세스만 중지할 수 있습니다.' },
    };
    const delegate = {
      watchRoots: () => ['/fixture/opencode'],
      watchFiles: () => ['/fixture/opencode/opencode.db'],
      status: () => ({ id: 'builtin.omo', available: true }),
      scan: () => [raw],
      detail: () => raw,
      close: () => { closed = true; },
    };
    const monitor = new OpenCodeHistoryMonitor({ monitor: delegate });
    const [session] = monitor.scan();
    const detail = monitor.detail('parent');

    assert.equal(OPENCODE_PLUGIN_ID, 'builtin.opencode');
    assert.equal(session.id, 'builtin.opencode:parent');
    assert.deepEqual(session.childIds, ['builtin.opencode:child']);
    assert.equal(session.sourcePluginId, 'builtin.opencode');
    assert.equal(session.sourcePlugin.id, 'builtin.opencode');
    assert.equal(session.sourcePlugin.label, 'OpenCode');
    assert.equal(session.provenance.source.id, 'opencode');
    assert.equal(session.provenance.source.pluginId, 'builtin.opencode');
    assert.equal(session.provenance.orchestrator.id, 'opencode');
    assert.equal(session.collaboration.spawns[0].childId, 'builtin.opencode:child');
    assert.equal(session.collaboration.spawns[0].taskName, 'OpenCode 하위 작업');
    assert.equal(session.collaboration.communications[0].from, 'OpenCode');
    assert.equal(session.executions[0].source, 'opencode-tool');
    assert.equal(session.outcome.artifacts[0].source, 'opencode-tool');
    assert.match(session.controlUnavailableReasons.stop, /OpenCode 프로세스/);
    assert.equal(detail.sourcePluginId, 'builtin.opencode');
    assert.equal(monitor.status().id, 'builtin.opencode');
    assert.deepEqual(monitor.watchRoots(), ['/fixture/opencode']);
    assert.deepEqual(monitor.watchFiles(), ['/fixture/opencode/opencode.db']);
    monitor.close();
    assert.equal(closed, true);
    assert.equal(raw.sourcePluginId, 'builtin.omo');
  });

  test('OpenCode monitor가 OMO 설정 유무와 관계없이 전체 local history를 소유하도록 delegate를 구성한다', () => {
    const monitor = new OpenCodeHistoryMonitor({
      dbPath: path.join(temp, 'missing-opencode.db'),
      DatabaseSync: class FixtureDatabase {},
      omoConfigured: false,
    });
    assert.equal(monitor.monitor.idPrefix, 'builtin.opencode');
    assert.equal(monitor.monitor.omoConfigured, true);
    monitor.close();
  });

  test('OpenCode DB 탐색은 OPENCODE_DB·XDG_DATA_HOME·canonical·channel 우선순위를 따른다', () => {
    const xdgRoot = path.join(temp, 'opencode-path-xdg');
    const dataDir = path.join(xdgRoot, 'opencode');
    const canonical = path.join(dataDir, 'opencode.db');
    const dev = path.join(dataDir, 'opencode-dev.db');
    const preview = path.join(dataDir, 'opencode-preview.42.db');
    fs.mkdirSync(dataDir, { recursive: true });
    for (const file of [canonical, dev, preview, `${dev}-wal`, path.join(dataDir, 'backup.db')]) {
      fs.writeFileSync(file, 'fixture');
    }

    assert.deepEqual(openCodeDbPaths({ env: { XDG_DATA_HOME: xdgRoot }, homeDir: temp }), [
      canonical,
      dev,
      preview,
    ]);
    assert.equal(openCodeDbPath({ env: { XDG_DATA_HOME: xdgRoot }, homeDir: temp }), canonical);

    const absoluteOverride = path.join(temp, 'absolute-opencode.db');
    assert.deepEqual(openCodeDbPaths({
      env: { XDG_DATA_HOME: xdgRoot, OPENCODE_DB: absoluteOverride },
      homeDir: temp,
    }), [absoluteOverride]);
    assert.deepEqual(openCodeDbPaths({
      env: { XDG_DATA_HOME: xdgRoot, OPENCODE_DB: path.join('custom', 'relative.db') },
      homeDir: temp,
    }), [path.join(dataDir, 'custom', 'relative.db')]);

    const legacyDataDir = path.join(temp, 'legacy-opencode-data');
    assert.deepEqual(openCodeDbPaths({ env: { OPENCODE_DATA_DIR: legacyDataDir }, homeDir: temp }), [
      path.join(legacyDataDir, 'opencode.db'),
    ]);
    assert.deepEqual(openCodeDbPaths({
      dbPath: absoluteOverride,
      env: { OPENCODE_DB: path.join(temp, 'ignored.db') },
    }), [absoluteOverride]);

    fs.unlinkSync(canonical);
    assert.equal(openCodeDbPath({ env: { XDG_DATA_HOME: xdgRoot }, homeDir: temp }), dev);
  });

  test('OpenCode adapter가 canonical·channel DB를 read-only로 합치고 중복 detail 소유 DB를 보존한다', () => {
    if (!DatabaseSync) return;
    const xdgRoot = path.join(temp, 'opencode-aggregate-xdg');
    const dataDir = path.join(xdgRoot, 'opencode');
    const canonical = path.join(dataDir, 'opencode.db');
    const channel = path.join(dataDir, 'opencode-dev.db');
    fs.mkdirSync(dataDir, { recursive: true });

    const createFixture = (file, sessions) => {
      const db = new DatabaseSync(file);
      try {
        db.exec(`
          CREATE TABLE session (
            id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT,
            directory TEXT, title TEXT, version TEXT,
            summary_additions INTEGER, summary_deletions INTEGER,
            summary_files INTEGER, summary_diffs TEXT,
            time_created INTEGER, time_updated INTEGER,
            time_compacting INTEGER, time_archived INTEGER
          );
          CREATE TABLE message (
            id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER,
            time_updated INTEGER, data TEXT
          );
          CREATE TABLE part (
            id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
            time_created INTEGER, time_updated INTEGER, data TEXT
          );
        `);
        const insert = db.prepare(`
          INSERT INTO session (
            id, project_id, parent_id, slug, directory, title, version,
            summary_additions, summary_deletions, summary_files, summary_diffs,
            time_created, time_updated, time_compacting, time_archived
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const session of sessions) {
          insert.run(
            session.id, 'aggregate-project', null, session.id, dataDir, session.title, '1',
            0, 0, 0, '[]', session.created, session.updated, null, null,
          );
        }
      } finally {
        db.close();
      }
    };

    const base = 1_760_100_000_000;
    createFixture(canonical, [
      { id: 'ses-shared', title: 'canonical older', created: base, updated: base + 1_000 },
      { id: 'ses-canonical', title: 'canonical only', created: base, updated: base + 2_000 },
    ]);
    createFixture(channel, [
      { id: 'ses-shared', title: 'channel newer', created: base, updated: base + 3_000 },
      { id: 'ses-channel', title: 'channel only', created: base, updated: base + 4_000 },
    ]);

    const opened = [];
    function RecordingDatabase(file, options) {
      opened.push({ file, options });
      return new DatabaseSync(file, options);
    }
    const monitor = new OpenCodeHistoryMonitor({
      env: { XDG_DATA_HOME: xdgRoot },
      homeDir: temp,
      DatabaseSync: RecordingDatabase,
      platform: process.platform,
      now: () => base + 100_000,
    });
    try {
      const sessions = monitor.scan({ limit: 10 });
      assert.deepEqual(sessions.map(session => session.externalId).sort(), [
        'ses-canonical',
        'ses-channel',
        'ses-shared',
      ]);
      const shared = sessions.find(session => session.externalId === 'ses-shared');
      assert.equal(shared.title, 'channel newer');
      assert.equal(shared.file, channel);
      assert.equal(shared.id, 'builtin.opencode:ses-shared');
      assert.equal(shared.readOnly, true);
      assert.equal(shared.controlAuthority, 'read-only-import');
      assert.equal(shared.sourceControlCapabilities.sendInstruction, false);
      assert.equal(shared.sourceControlCapabilities.delete, false);
      assert.equal(monitor.detail(shared.id).file, channel);
      assert.equal(monitor.detail(shared.id).title, 'channel newer');
      assert.equal(monitor.status().available, true);
      assert.equal(monitor.status().databaseCount, 2);
      assert.equal(monitor.watchFiles().includes(canonical), true);
      assert.equal(monitor.watchFiles().includes(channel), true);
      assert.deepEqual(opened.map(item => item.file).sort(), [canonical, channel].sort());
      assert.equal(opened.every(item => item.options && item.options.readOnly === true), true);
    } finally {
      monitor.close();
    }
  });

  test('OMO OpenCode SQLite fixture가 부모·모델 제공자·대화·도구·산출물을 복원한다', () => {
    if (!DatabaseSync) return;
    const dbFile = path.join(temp, 'source-plugin-opencode.db');
    const fixtureCwd = path.join(temp, 'omo-workspace');
    fs.mkdirSync(fixtureCwd, { recursive: true });
    const db = new DatabaseSync(dbFile);
    try {
      db.exec(`
        CREATE TABLE session (
          id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT,
          directory TEXT, title TEXT, version TEXT,
          summary_additions INTEGER, summary_deletions INTEGER,
          summary_files INTEGER, summary_diffs TEXT,
          time_created INTEGER, time_updated INTEGER,
          time_compacting INTEGER, time_archived INTEGER
        );
        CREATE TABLE message (
          id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER,
          time_updated INTEGER, data TEXT
        );
        CREATE TABLE part (
          id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
          time_created INTEGER, time_updated INTEGER, data TEXT
        );
      `);
      const base = 1_760_000_000_000;
      const insertSession = db.prepare(`
        INSERT INTO session (
          id, project_id, parent_id, slug, directory, title, version,
          summary_additions, summary_deletions, summary_files, summary_diffs,
          time_created, time_updated, time_compacting, time_archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertSession.run(
        'ses-parent', 'project-fixture', null, 'parent', fixtureCwd, 'Parent fixture', '1',
        4, 1, 1, '[]', base, base + 9_000, null, null,
      );
      insertSession.run(
        'ses-child', 'project-fixture', 'ses-parent', 'child', fixtureCwd, 'Child fixture', '1',
        0, 0, 0, '[]', base + 4_000, base + 8_000, null, null,
      );

      const insertMessage = db.prepare(
        'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
      );
      insertMessage.run('msg-parent-user', 'ses-parent', base, base, JSON.stringify({
        role: 'user', time: { created: base }, model: { providerID: 'openai', modelID: 'gpt-fixture' },
      }));
      insertMessage.run('msg-parent-assistant', 'ses-parent', base + 1_000, base + 9_000, JSON.stringify({
        role: 'assistant', agent: '\u200BHephaestus', providerID: 'openai', modelID: 'gpt-fixture',
        finish: 'stop', time: { created: base + 1_000, completed: base + 9_000 },
        tokens: { input: 10, output: 5 },
      }));
      insertMessage.run('msg-child-user', 'ses-child', base + 4_000, base + 4_000, JSON.stringify({
        role: 'user', time: { created: base + 4_000 }, model: { providerID: 'anthropic', modelID: 'claude-fixture' },
      }));
      insertMessage.run('msg-child-assistant', 'ses-child', base + 5_000, base + 8_000, JSON.stringify({
        role: 'assistant', agent: 'librarian', providerID: 'anthropic', modelID: 'claude-fixture',
        finish: 'stop', time: { created: base + 5_000, completed: base + 8_000 },
      }));

      const insertPart = db.prepare(
        'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const part = (id, messageId, sessionId, created, data) => insertPart.run(
        id, messageId, sessionId, created, data.state?.time?.end || created, JSON.stringify(data),
      );
      part('part-user-text', 'msg-parent-user', 'ses-parent', base, {
        type: 'text', text: 'Create the deterministic fixture.',
      });
      part('part-assistant-text', 'msg-parent-assistant', 'ses-parent', base + 8_000, {
        type: 'text', text: 'The deterministic fixture is complete.',
      });
      part('part-shell', 'msg-parent-assistant', 'ses-parent', base + 2_000, {
        type: 'tool', tool: 'bash', callID: 'call-shell',
        state: {
          status: 'completed', input: { command: 'npm test' }, output: 'fixture tests passed',
          time: { start: base + 2_000, end: base + 3_000 }, metadata: { exit: 0 },
        },
      });
      part('part-patch', 'msg-parent-assistant', 'ses-parent', base + 3_000, {
        type: 'tool', tool: 'apply_patch', callID: 'call-patch',
        state: {
          status: 'completed', input: {},
          time: { start: base + 3_000, end: base + 3_500 },
          metadata: { files: [{ relativePath: 'src/result.js', type: 'update' }] },
        },
      });
      part('part-task', 'msg-parent-assistant', 'ses-parent', base + 4_000, {
        type: 'tool', tool: 'task', callID: 'call-task',
        state: {
          status: 'completed', input: { description: 'Inspect fixture', prompt: 'Inspect only the fixture.' },
          time: { start: base + 4_000, end: base + 8_000 },
          metadata: { sessionId: 'ses-child', agent: 'librarian' },
        },
      });
      part('part-child-user-text', 'msg-child-user', 'ses-child', base + 4_000, {
        type: 'text', text: 'Inspect the fixture.',
      });
      part('part-child-assistant-text', 'msg-child-assistant', 'ses-child', base + 7_000, {
        type: 'text', text: 'Fixture inspected.',
      });
    } finally {
      db.close();
    }

    const monitor = new OmoOpenCodeMonitor({
      dbPath: dbFile,
      DatabaseSync,
      omoConfigured: true,
      platform: 'linux',
      arch: 'x64',
      now: () => 1_760_000_100_000,
    });
    try {
      const sessions = monitor.scan({ limit: 10 });
      assert.equal(sessions.length, 2);
      const parent = sessions.find(session => session.externalId === 'ses-parent');
      const child = sessions.find(session => session.externalId === 'ses-child');
      assert.ok(parent);
      assert.ok(child);
      assert.equal(child.parentId, parent.id);
      assert.equal(parent.childIds.includes(child.id), true);
      assert.equal(parent.collaboration.spawns.some(spawn => spawn.childId === child.id), true);
      assert.equal(parent.modelProvider, 'openai');
      assert.equal(child.modelProvider, 'anthropic');
      assert.deepEqual(parent.messages.map(message => message.role), ['user', 'assistant']);
      assert.equal(parent.messages[1].text, 'The deterministic fixture is complete.');
      assert.equal(parent.executions.some(execution => execution.command === 'npm test' && execution.status === 'completed'), true);
      assert.equal(parent.artifacts.some(artifact => artifact.name === 'result.js'), true);
      const enrichedParent = enrichSession(parent, sessions, 1_760_000_100_000);
      assert.equal(enrichedParent.outcome.artifacts.some(artifact => artifact.value.endsWith('result.js')), true);
      assert.equal(parent.provenance.source.id, 'omo');
      assert.equal(parent.provenance.provider.id, 'openai');
      assert.equal(parent.provenance.runtime.kind, 'opencode');
    } finally {
      monitor.close();
    }

    const directMonitor = new OpenCodeHistoryMonitor({
      dbPath: dbFile,
      DatabaseSync,
      platform: 'linux',
      arch: 'x64',
      now: () => 1_760_000_100_000,
    });
    try {
      const sessions = directMonitor.scan({ limit: 10 });
      const parent = sessions.find(session => session.externalId === 'ses-parent');
      const child = sessions.find(session => session.externalId === 'ses-child');
      assert.ok(parent);
      assert.ok(child);
      assert.equal(parent.id, 'builtin.opencode:ses-parent');
      assert.equal(child.parentId, parent.id);
      assert.equal(parent.childIds.includes('builtin.opencode:ses-child'), true);
      assert.equal(parent.collaboration.spawns.some(spawn => spawn.childId === 'builtin.opencode:ses-child'), true);
      assert.equal(parent.sourcePluginId, 'builtin.opencode');
      assert.equal(parent.sourcePlugin.id, 'builtin.opencode');
      assert.equal(parent.provenance.source.id, 'opencode');
      assert.equal(parent.provenance.source.pluginId, 'builtin.opencode');
      assert.equal(parent.provenance.orchestrator.id, 'opencode');
      assert.equal(parent.provenance.runtime.kind, 'opencode');
      assert.equal(directMonitor.detail(parent.id).sourcePluginId, 'builtin.opencode');
    } finally {
      directMonitor.close();
    }
  });

  test('Aside 선택 폴더 기록은 전역 기능이 켜져 있어도 control host에서 읽기 전용이다', async () => {
    const host = new SourcePluginControlHost({ platform: 'darwin', findExecutable: () => null });
    let calls = 0;
    host.aside = { control: async () => { calls += 1; return { accepted: true }; } };
    host.statuses.set(ASIDE_MANIFEST.id, {
      capabilities: { sendInstruction: true, stop: true, archive: true, delete: true },
      controlUnavailableReasons: {},
    });
    const folderSession = {
      id: 'builtin.aside:folder-fixture',
      externalId: 'folder-fixture',
      sourcePluginId: ASIDE_MANIFEST.id,
      readOnly: true,
      controlAuthority: 'read-only-import',
      sourceControlCapabilities: { sendInstruction: false, stop: false, archive: false, delete: false },
      sourcePlugin: { revision: 'folder-r1' },
      updatedAt: '2026-08-13T00:00:00.000Z',
    };

    await assert.rejects(
      host.control(folderSession, 'send', { prompt: 'must not be sent' }),
      /읽기 전용|공식 Aside/,
    );
    assert.throws(() => host.prepareDelete(folderSession), /읽기 전용|공식 Aside/);
    assert.equal(calls, 0);
  });

  test('Aside 폴더 캐시는 transcript가 그대로여도 산출물 추가·수정·삭제를 반영한다', () => {
    const selectedRoot = path.join(temp, 'aside-artifact-cache');
    const taskDir = path.join(selectedRoot, 'task-one');
    const transcript = path.join(taskDir, 'task.json');
    const artifact = path.join(taskDir, 'result.txt');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(transcript, JSON.stringify({
      id: 'aside-artifact-cache-task', source: 'Aside Browser',
      messages: [{ role: 'user', text: '산출물을 만들어줘' }],
    }));
    const cache = new Map();
    const scan = () => scanAsideHistoryFolders([selectedRoot], { cache, fullHistory: true });

    assert.deepStrictEqual(scan().sessions[0].artifacts, []);
    fs.writeFileSync(artifact, 'one');
    let artifacts = scan().sessions[0].artifacts;
    assert.deepStrictEqual(artifacts.map(item => item.path), [fs.realpathSync(artifact)]);
    assert.equal(artifacts[0].size, 3);

    fs.writeFileSync(artifact, 'updated artifact');
    artifacts = scan().sessions[0].artifacts;
    assert.equal(artifacts[0].size, Buffer.byteLength('updated artifact'));

    fs.unlinkSync(artifact);
    assert.deepStrictEqual(scan().sessions[0].artifacts, []);
  });

  test('Aside CLI가 있어도 macOS 15 미만이면 시작과 제어를 fail closed한다', async () => {
    const host = new SourcePluginControlHost({
      platform: 'darwin',
      findExecutable: name => name === 'aside' ? '/fixture/aside' : '',
    });
    host.createAsideController = async () => ({
      probe: async () => ({
        available: false,
        platformSupported: false,
        reason: 'Aside Browser requires macOS 15 or newer.',
        capabilities: {},
      }),
      dispose: async () => {},
    });
    await host.refresh();
    const status = host.listSources().find(item => item.id === ASIDE_MANIFEST.id);
    assert.equal(status.installed, true);
    assert.equal(status.available, false);
    assert.equal(status.capabilities.start, false);
    assert.match(status.reason, /macOS 15/);
    await host.dispose();
  });

  test('Whitebox가 실행한 OpenCode 세션만 관찰된 stop 권한을 활성화한다', async () => {
    const controlHost = new SourcePluginControlHost({ platform: 'linux', findExecutable: () => null });
    controlHost.statuses.set(OPENCODE_MANIFEST.id, {
      id: OPENCODE_MANIFEST.id,
      capabilities: { stop: false, readConversation: true, readSteps: true, readArtifacts: true },
      controlUnavailableReasons: { stop: '관리 중인 OpenCode 프로세스만 중지할 수 있습니다.' },
    });
    controlHost.children.set('managed-process', {
      id: 'managed-process', pluginId: OPENCODE_MANIFEST.id, externalId: 'managed-session', child: {},
    });

    const monitorHost = new SourcePluginMonitorHost({
      platform: 'linux',
      definitions: [{
        manifest: OPENCODE_MANIFEST,
        createMonitor: () => ({
          scan: () => [
            {
              externalId: 'managed-session', title: 'Managed', status: 'running',
              updatedAt: '2026-08-13T00:00:00.000Z',
              sourceControlCapabilities: { stop: true, readConversation: true, readSteps: true, readArtifacts: true },
            },
            {
              externalId: 'external-session', title: 'External', status: 'running',
              updatedAt: '2026-08-13T00:00:00.000Z',
              sourceControlCapabilities: { stop: true, readConversation: true, readSteps: true, readArtifacts: true },
            },
          ],
        }),
      }],
    });
    monitorHost.setRuntimeStatuses(controlHost.listSources());
    const result = await monitorHost.scan();
    const managed = result.sessions.find(session => session.externalId === 'managed-session');
    const external = result.sessions.find(session => session.externalId === 'external-session');

    assert.deepEqual(
      controlHost.listSources().find(source => source.id === OPENCODE_MANIFEST.id).managedSessionIds,
      ['managed-session'],
    );
    assert.equal(managed.sourceControlCapabilities.stop, true);
    assert.equal(external.sourceControlCapabilities.stop, false);
    await monitorHost.dispose();
  });

  test('source delete 확인 토큰은 대상에 묶이고 한 번만 사용할 수 있다', async () => {
    let deleteCalls = 0;
    const host = new SourcePluginControlHost({
      platform: 'linux',
      findExecutable: () => null,
      execFile: async () => { deleteCalls += 1; return { stdout: '', stderr: '' }; },
    });
    host.statuses.set(OMO_MANIFEST.id, {
      executable: 'opencode-fixture', capabilities: { delete: true }, controlUnavailableReasons: {},
    });
    const session = {
      id: 'builtin.omo:delete-fixture', externalId: 'delete-fixture', sourcePluginId: OMO_MANIFEST.id,
      sourcePlugin: { revision: 'r1' }, updatedAt: '2026-08-13T00:00:00.000Z', cwd: temp,
      sourceControlCapabilities: { delete: true },
    };
    const prepared = host.prepareDelete(session);
    await host.control(session, 'delete', { deleteToken: prepared.token });
    assert.equal(deleteCalls, 1);
    await assert.rejects(
      host.control(session, 'delete', { deleteToken: prepared.token }),
      /만료|다시 확인/,
    );
    assert.equal(deleteCalls, 1);
  });

  test('source delete 확인 토큰은 리비전 변경과 만료 뒤 거절된다', async () => {
    let now = 10_000;
    let deleteCalls = 0;
    const host = new SourcePluginControlHost({
      platform: 'linux',
      now: () => now,
      findExecutable: () => null,
      execFile: async () => { deleteCalls += 1; return { stdout: '', stderr: '' }; },
    });
    host.statuses.set(OMO_MANIFEST.id, {
      executable: 'opencode-fixture', capabilities: { delete: true }, controlUnavailableReasons: {},
    });
    const session = {
      id: 'builtin.omo:revision-fixture', externalId: 'revision-fixture', sourcePluginId: OMO_MANIFEST.id,
      sourcePlugin: { revision: 'r1' }, updatedAt: '2026-08-13T00:00:00.000Z', cwd: temp,
      sourceControlCapabilities: { delete: true },
    };
    const revisionToken = host.prepareDelete(session).token;
    await assert.rejects(
      host.control({ ...session, sourcePlugin: { revision: 'r2' } }, 'delete', { deleteToken: revisionToken }),
      /변경|다시/,
    );

    const expiring = host.prepareDelete(session);
    now = expiring.expiresAt + 1;
    assert.ok(now > 10_000 + DELETE_TOKEN_TTL_MS);
    await assert.rejects(
      host.control(session, 'delete', { deleteToken: expiring.token }),
      /만료|다시 확인/,
    );
    assert.equal(deleteCalls, 0);
  });

  test('Aside MCP discovery가 attachment·credential 같은 유사 파괴 도구를 task 삭제로 오인하지 않는다', () => {
    const identitySchema = {
      type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'],
    };
    const sendSchema = {
      type: 'object',
      properties: { taskId: { type: 'string' }, message: { type: 'string' } },
      required: ['taskId', 'message'],
    };
    const discovery = discoverAsideTools([
      { name: 'delete_task_attachment', inputSchema: identitySchema },
      { name: 'remove_task_credentials', inputSchema: identitySchema },
      { name: 'send_task_message', inputSchema: sendSchema },
    ]);
    assert.equal(discovery.capabilities.delete, false);
    assert.equal(discovery.operations.delete, null);
    assert.equal(discovery.capabilities.sendInstruction, true);

    const explicit = discoverAsideTools([{ name: 'delete_task', inputSchema: identitySchema }]);
    assert.equal(explicit.capabilities.delete, true);
    assert.equal(explicit.operations.delete.name, 'delete_task');
  });

  test('MCP parser가 UTF-8 Content-Length와 newline frame의 분할 입력을 보존한다', () => {
    const messages = [];
    const warnings = [];
    const parser = createMessageParser(
      message => messages.push(message),
      warning => warnings.push(warning),
    );
    const framed = encodeJsonRpcMessage({ jsonrpc: '2.0', id: 1, result: { text: '한글 ✓' } }, 'content-length');
    for (let offset = 0; offset < framed.length; offset += 3) parser.push(framed.subarray(offset, offset + 3));
    const newline = encodeJsonRpcMessage({ jsonrpc: '2.0', method: 'tools/list_changed' }, 'newline');
    for (let offset = 0; offset < newline.length; offset += 5) parser.push(newline.subarray(offset, offset + 5));
    parser.end();

    assert.deepEqual(messages, [
      { jsonrpc: '2.0', id: 1, result: { text: '한글 ✓' } },
      { jsonrpc: '2.0', method: 'tools/list_changed' },
    ]);
    assert.deepEqual(warnings, []);
  });

  test('MCP server request의 ID가 pending response ID와 같아도 client 요청을 가로채지 않는다', () => {
    const writes = [];
    const client = new McpStdioClient();
    let resolved = false;
    client.child = {
      stdin: {
        destroyed: false,
        write(value) { writes.push(Buffer.from(value)); },
      },
    };
    client.pending.set('7', {
      resolve() { resolved = true; },
      reject() {},
      timer: null,
      method: 'tools/list',
    });
    client._handleMessage({ jsonrpc: '2.0', id: 7, method: 'ping' });

    assert.equal(resolved, false);
    assert.equal(client.pending.has('7'), true);
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(writes[0].toString('utf8')), { jsonrpc: '2.0', id: 7, result: {} });
    client.pending.clear();
    client.child = null;
  });

  test('renderer가 source·provider·environment·runtime 4개 배지와 source 삭제 확인을 유지한다', () => {
    const renderer = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
    for (const dimension of ['source', 'provider', 'environment', 'runtime']) {
      assert.equal(renderer.includes(`session-dimension ${dimension}`), true, `${dimension} 배지가 없습니다.`);
    }
    assert.equal(renderer.includes('읽기 전용 폴더'), true);
    assert.equal(renderer.includes('읽기 전용 기록'), true);
    assert.equal(renderer.includes('session.controlAuthority === "read-only-import" || session.importMode === "selected-folder"'), false);
    assert.equal(renderer.includes('session.controlAuthority === "read-only-import" || session.importMode === "local-history"'), true);
    assert.equal(renderer.includes('공식 연결'), true);
    assert.equal(renderer.includes('data-session-source='), true);
    assert.equal(renderer.includes('data-session-provider='), true);
    assert.equal(renderer.includes('data-session-environment='), true);
    assert.equal(renderer.includes('data-session-runtime='), true);

    const actions = fs.readFileSync(path.join(root, 'renderer', 'app-agent-actions.js'), 'utf8');
    assert.equal(actions.includes('prepareSourceDelete(sessionId)'), true);
    assert.equal(actions.includes('window.confirm('), true);
    assert.equal(actions.includes('deleteToken: prepared.token'), true);

    const worker = fs.readFileSync(path.join(root, 'src', 'monitorWorker.js'), 'utf8');
    assert.equal(worker.includes('provenance: session.provenance || null'), true);
    assert.equal(worker.includes("controlAuthority: session.controlAuthority || ''"), true);
    assert.equal(worker.includes('readOnly: Boolean(session.readOnly)'), true);
    assert.equal(worker.includes('JSON.stringify(item.managedSessionIds || [])'), true);

    const runModal = fs.readFileSync(path.join(root, 'renderer', 'app-run-modal.js'), 'utf8');
    assert.equal(runModal.includes('data-aside-history-remove='), true);
    assert.equal(runModal.includes('읽기 전용 기록 연결 가능'), true);
    assert.equal(runModal.includes('source.id === "builtin.aside" && state.platform.id === "darwin"'), true);

    const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const visibility = fs.readFileSync(path.join(root, 'renderer', 'app-provider-visibility.js'), 'utf8');
    assert.equal(main.includes('if (session.sourcePluginId) return isSourcePluginEnabled('), true);
    assert.equal(visibility.includes('isSessionVisible(session)'), true);
    assert.equal(visibility.includes('visibleSessionProjection(sessions = [])'), true);
    assert.equal(visibility.includes('visibleSessionProjection(snapshot.sessions || [])'), true);
  });
}

module.exports = { registerSourcePluginTests };
