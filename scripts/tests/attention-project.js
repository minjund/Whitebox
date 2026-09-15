'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { attentionProject, workspaceRootsFromEnvironment } = require('../../src/attentionProject');
const { normalizeHookRequest } = require('../../src/attentionHookServer');
const { normalizeRequest } = require('../../src/attentionPopupManager');
const { AttentionNotifier } = require('../../src/attentionNotifier');
const { parseCodex } = require('../../src/agentMonitor');

const mainSource = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
function mainFunction(name) {
  const match = mainSource.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `Missing main function: ${name}`);
  return match[0];
}

function mainHarness(sessions = [], terminals = []) {
  const sent = [];
  const resolved = [];
  const sandbox = {
    attentionProject, appLocale: 'ko', lastSnapshot: { sessions },
    listWorkspaces: () => [{ path: 'D:\\projects\\project-alpha', name: 'project-alpha' }],
    providerList: () => [{ id: 'codex', label: 'GPT' }, { id: 'claude', label: 'Claude' }],
    terminalManager: { list: () => terminals },
    hookAttentionRequests: new Map(), isProviderVisible: () => true,
    attentionHookServer: { resolve: (...args) => resolved.push(args) },
    pendingAttentionSessionId: '', pendingAttentionEvent: 'attention', pendingAttentionTarget: {},
    rendererBootstrapped: true, showMainWindow: () => {},
    mainWindow: {
      isDestroyed: () => false, flashFrame: () => {},
      webContents: { isLoadingMainFrame: () => false, send: (...args) => sent.push(args) },
    },
    reportRecoverableError: (_scope, error) => { throw error; },
  };
  vm.createContext(sandbox);
  vm.runInContext([
    'popupText', 'popupProviderLabel', 'sessionForAttention', 'popupOwnerSession',
    'popupTerminalSession', 'popupSessionCopy', 'popupSessionMeta', 'popupAlwaysAllowLabel',
    'hookPopupRequest', 'structuredRequestDetail', 'snapshotPopupRequests',
    'handleAttentionPopupOpenMain', 'openAttentionSession',
  ].map(mainFunction).join('\n'), sandbox);
  return { sandbox, sent, resolved };
}

function registerAttentionProjectTests({ test, temp, jsonl }) {
  test('Codex 앱 데이터 cwd와 별도로 명시된 프로젝트 경로를 권한 팝업까지 유지한다', () => {
    const cwd = 'C:\\Users\\test\\AppData\\Roaming\\loadtoagent';
    const project = 'D:\\projects\\project-alpha';
    const environment = `<environment_context><cwd>${cwd}</cwd><filesystem><workspace_roots><root>${project}</root></workspace_roots></filesystem></environment_context>`;
    assert.deepEqual(workspaceRootsFromEnvironment(environment), [project]);
    assert.equal(workspaceRootsFromEnvironment(`문서 예시: ${environment}`), null);
    assert.deepEqual(workspaceRootsFromEnvironment('<environment_context><workspace_roots><root>relative</root></workspace_roots></environment_context>'), []);
    for (const event of [false, true]) {
      const session = parseCodex(jsonl(path.join(temp, `popup-project-${event}.jsonl`), [
        { type: 'session_meta', timestamp: '2026-09-15T01:00:00Z', payload: { id: 'project-session', cwd, originator: 'Codex Desktop' } },
        event
          ? { type: 'event_msg', timestamp: '2026-09-15T01:00:01Z', payload: { type: 'user_message', message: environment } }
          : { type: 'response_item', timestamp: '2026-09-15T01:00:01Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: environment }] } },
      ]));
      assert.equal(session.originCwd, cwd, 'Project display must not change execution or resume cwd.');
      assert.deepEqual(session.workspaceRoots, [project]);
      const { sandbox } = mainHarness([session]);
      const hook = normalizeHookRequest({ session_id: session.externalId, cwd, tool_name: 'Bash', tool_input: { command: 'npm test' } }, { provider: 'codex' });
      const popup = normalizeRequest(sandbox.hookPopupRequest(hook));
      assert.equal(popup.project, 'project-alpha');
      assert.equal(popup.projectPath, project);
      assert.doesNotMatch(popup.meta, /loadtoagent|project-alpha/u);
    }
  });

  test('프로젝트 표시가 등록명·하위 폴더·WSL 경로를 구분하고 복수 프로젝트를 임의 선택하지 않는다', () => {
    const workspaces = [
      { path: 'D:\\projects\\repo', name: '저장소' },
      { path: 'D:\\projects\\repo\\api', name: 'API 서비스' },
    ];
    assert.equal(attentionProject({ originCwd: '/mnt/d/projects/repo/api/src' }, { workspaces }).project, 'API 서비스');
    assert.equal(attentionProject({ originCwd: 'D:\\projects\\repo-other' }, { workspaces }).project, 'repo-other');
    assert.equal(attentionProject({ workspace: 'loadtoagent' }, { requestCwd: '/work/mediagw' }).project, 'mediagw');
    assert.equal(attentionProject({ cwd: '/app/loadtoagent' }, { terminalCwd: '/work/project-alpha' }).project, 'project-alpha');
    assert.equal(attentionProject({ workspaceRoots: ['/work/api', '/work/web'] }).project, 'api · web');
    assert.equal(attentionProject({ title: '실행할 작업' }).project, '');
    assert.equal(attentionProject({ workspaceRoots: ['/'] }).projectPath, '/');
  });

  test('권한 훅이 세션 스캔보다 먼저 도착해도 요청 cwd로 프로젝트를 표시한다', () => {
    const { sandbox } = mainHarness();
    const hook = normalizeHookRequest({ session_id: 'new', cwd: '/work/mediagw', tool_name: 'Bash' });
    assert.equal(hook.cwd, '/work/mediagw');
    assert.equal(sandbox.hookPopupRequest(hook).project, 'mediagw');
    sandbox.lastSnapshot.sessions = [
      { id: 'claude:parent', provider: 'claude', originCwd: '/work/SupplierGW' },
      { id: 'claude:child', externalId: 'child', provider: 'claude', parentId: 'claude:parent', cwd: '/app/loadtoagent' },
    ];
    assert.equal(sandbox.popupSessionCopy(sandbox.lastSnapshot.sessions[1]).project, 'SupplierGW');
  });

  test('팝업 이동은 요청한 터미널 ID를 집중 화면까지 전달하고 연결 없는 작업도 관제 화면으로 보내지 않는다', async () => {
    const session = { id: 'codex:task', externalId: 'task', provider: 'codex', cwd: '/work/project-alpha' };
    const { sandbox, sent, resolved } = mainHarness([session], [
      { id: 'terminal:exact', bridgeId: session.id, type: 'agent', status: 'running', provider: 'codex', cwd: '/work/project-alpha' },
      { id: 'terminal:other', bridgeId: 'codex:other', type: 'agent', status: 'running', provider: 'codex', cwd: '/work/mediagw' },
    ]);
    sandbox.handleAttentionPopupOpenMain({}, { context: { kind: 'hook', hookKey: 'hook', rawSessionId: 'task', provider: 'codex' } });
    assert.equal(resolved[0][1].action, 'none');
    const payload = sent[0][1];
    assert.equal(payload.event, 'terminal');
    assert.equal(payload.sessionId, session.id);
    assert.equal(payload.terminalId, 'terminal:exact');
    assert.equal(payload.targetId, 'terminal:exact');
    sandbox.rendererBootstrapped = false;
    sandbox.openAttentionSession(session, 'terminal', { terminalId: 'terminal:exact' });
    assert.equal(sandbox.pendingAttentionTarget.terminalId, 'terminal:exact');

    const source = fs.readFileSync(path.join(__dirname, '../../renderer/app-bootstrap.js'), 'utf8');
    const start = source.indexOf('const handleAttentionRequested = async (payload) => {');
    const end = source.indexOf('const handleTerminalPromptResolved', start);
    for (const opened of [true, false]) {
      const mounts = [], focused = [], views = [];
      const renderer = {
        state: { snapshot: { sessions: [session] } }, passiveFocusGeneration: 0,
        attentionActivation: { userNavigated: () => {} },
        isProviderVisible: () => true, ownerRootSession: value => value,
        isPtyFocusActive: () => false,
        openPtyFocusVerified: async (id, options) => { mounts.push({ id, options }); return { opened }; },
        app: { canOpenResponsibleFocus: () => true, openResponsibleFocus: id => { focused.push(id); return true; } },
        showAttentionSession: () => views.push('overview'), selectView: value => views.push(value),
        toast: () => {}, t: key => key,
        window: { WhiteboxRendererUtils: { reportRecoverableError: (_scope, error) => { throw error; } } },
      };
      vm.createContext(renderer);
      vm.runInContext(`${source.slice(start, end)}\nglobalThis.handle = handleAttentionRequested;`, renderer);
      await renderer.handle(payload);
      assert.equal(mounts[0].id, session.id);
      assert.equal(mounts[0].options.terminalId, 'terminal:exact');
      assert.equal(mounts[0].options.targetId, 'terminal:exact');
      assert.deepEqual(focused, opened ? [] : [session.id]);
      assert.deepEqual(views, []);
    }
  });

  test('로그에서 감지한 권한 안내 팝업을 제거하고 실제 승인 훅과 질문 응답 창은 유지한다', () => {
    const session = { id: 'codex:task', externalId: 'task', provider: 'codex', cwd: '/work/project-alpha' };
    const { sandbox } = mainHarness([
      { ...session, attention: { required: true, source: 'execution-approval', requestId: 'approval' } },
      { ...session, id: 'codex:question', externalId: 'question', attention: { required: true, source: 'input-tool', requestId: 'question' } },
    ]);
    const requests = sandbox.snapshotPopupRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].sessionId, 'codex:question');
    const hook = normalizeHookRequest({ session_id: 'task', tool_name: 'Bash' }, { provider: 'codex' });
    assert.equal(sandbox.hookPopupRequest(hook).type, 'permission');
  });

  test('완료 전용 알림은 시작 복구·질문·권한·터미널 알림을 차단하고 성공 완료만 한 번 알린다', () => {
    const notifications = [], fallbacks = [];
    class Notification extends EventEmitter {
      constructor(options) { super(); this.options = options; notifications.push(this); }
      show() {}
      close() { this.emit('close'); }
    }
    const notifier = new AttentionNotifier({ completionOnly: true, Notification, completionStabilityMs: 0, onFallback: (...args) => fallbacks.push(args) });
    const session = { id: 'task', provider: 'codex', status: 'running', updatedAt: '2026-09-15T01:00:00Z' };
    const waiting = { ...session, status: 'waiting', attention: { category: 'required', source: 'input-tool', requestId: 'q', requestedAt: '2026-09-15T01:00:00Z' } };
    assert.deepEqual(notifier.sync({ generatedAt: '2026-09-15T01:00:01Z', sessions: [waiting] }), []);
    notifier.sync({ generatedAt: '2026-09-15T01:00:02Z', sessions: [session] });
    notifier.sync({ generatedAt: '2026-09-15T01:00:03Z', sessions: [{ ...waiting, attention: { ...waiting.attention, source: 'execution-approval' } }] });
    assert.equal(notifier.notifyExplicitPrompt(session, { kind: 'permission', fingerprint: 'p' }), null);
    assert.equal(notifier.notify(session, 'attention'), null);
    assert.equal(notifications.length, 0);
    const completed = { ...session, status: 'completed', completionObserved: true, completedAt: '2026-09-15T01:00:04Z', updatedAt: '2026-09-15T01:00:04Z' };
    notifier.sync({ generatedAt: '2026-09-15T01:00:05Z', sessions: [completed] });
    notifier.sync({ generatedAt: '2026-09-15T01:00:06Z', sessions: [completed] });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].options.title, '작업 완료');
    assert.deepEqual(fallbacks, []);
    notifier.dispose();
    assert.match(mainFunction('createAttentionNotifier'), /completionOnly: true/u);
  });
}

module.exports = { registerAttentionProjectTests };
