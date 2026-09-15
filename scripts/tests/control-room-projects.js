'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseCodex } = require('../../src/agentMonitor');

function dashboardHarness(root, sessions, workspaces = []) {
  const sidebar = { dataset: {}, innerHTML: '' };
  const sandbox = {
    window: { WhiteboxAppFactories: {}, WhiteboxI18n: { t: key => key } },
    document: { body: { dataset: {} } }, Intl,
  };
  for (const file of ['app-dashboard.js', 'app-graph-model.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(root, 'renderer', file), 'utf8'), sandbox);
  }
  const state = {
    snapshot: { sessions, tmux: { distros: [] } }, workspaces,
    workspace: 'all', workspaceSource: 'all', view: 'all', search: '',
    providerFilters: new Set(), providers: [], availability: {},
    dismissedProjects: new Set(), sourcePlugins: [],
  };
  const context = {
    state, visibleSessions: () => sessions, PROJECTLESS_WORKSPACE: 'projectless',
    $: selector => selector === '#projectSidebarList' ? sidebar : null,
    esc: value => String(value ?? ''), compact: value => String(value ?? ''),
    uiLocale: () => 'ko', isLiveSession: session => session.status === 'running',
  };
  context.isControlRoomSession = context.isLiveSession;
  const dashboard = sandbox.window.WhiteboxAppFactories.createDashboard(context);
  const graph = sandbox.window.WhiteboxAppFactories.createGraphModel(context);
  return { state, sidebar, dashboard, graph };
}

function registerControlRoomProjectTests({ test, root, temp, jsonl }) {
  test('GPT 앱 데이터 cwd의 실행 기록이 선택한 프로젝트 관제 흐름도에 나타난다', () => {
    const cwd = 'C:\\Users\\test\\AppData\\Roaming\\loadtoagent';
    const project = 'D:\\projects\\flow-project';
    const now = new Date().toISOString();
    const session = parseCodex(jsonl(path.join(temp, 'control-room-project.jsonl'), [
      { type: 'session_meta', timestamp: now, payload: { id: 'desktop-flow', cwd, originator: 'Codex Desktop' } },
      { type: 'response_item', timestamp: now, payload: { type: 'message', role: 'user', content: [{
        type: 'input_text', text: `<environment_context><cwd>${cwd}</cwd><filesystem><workspace_roots><root>${project}</root></workspace_roots></filesystem></environment_context>`,
      }] } },
      { type: 'event_msg', timestamp: now, payload: { type: 'task_started', turn_id: 'turn' } },
      { type: 'event_msg', timestamp: now, payload: { type: 'user_message', message: '관제 흐름도를 고쳐줘' } },
      { type: 'response_item', timestamp: now, payload: { type: 'function_call', name: 'exec_command', call_id: 'command', arguments: JSON.stringify({ cmd: 'npm test', workdir: project }) } },
    ]));
    session.childIds = ['codex:helper'];
    session.workspace = 'loadtoagent';
    const child = { id: 'codex:helper', provider: 'codex', parentId: session.id, status: 'running', cwd: '/tmp/helper', childIds: [] };
    const { state, sidebar, dashboard, graph } = dashboardHarness(root, [session, child], [{ path: project, name: 'Flow project' }]);
    state.workspace = project;
    state.workspaceSource = 'builtin.codex-desktop';
    assert.equal(session.status, 'running');
    assert.equal(dashboard.matchesWorkspaceFilter(session), true);
    assert.equal(dashboard.matchesWorkspaceFilter(child), true);
    assert.equal(dashboard.sessionOriginPath(session), project);
    assert.equal(dashboard.sessionWorkspaceLabel(session), 'Flow project');
    assert.equal(dashboard.controlRoomProject(session).path, project);
    assert.deepEqual(Array.from(graph.connectedGraphSessions(dashboard.graphFilteredSessions()).nodes, item => item.id), [session.id, child.id]);
    assert.ok(session.executions.some(item => item.status === 'running'));
    dashboard.renderWorkspaces();
    assert.ok(sidebar.innerHTML.includes(`data-open-session="${session.id}"`));
    assert.equal(dashboard.observedProjects().some(item => item.path === cwd), false);
    state.workspace = cwd;
    assert.equal(dashboard.matchesWorkspaceFilter(session), false);
    state.workspace = project;
    state.workspaceSource = 'direct';
    assert.equal(dashboard.matchesWorkspaceFilter(session), false);
    assert.equal(session.cwd, cwd);
    assert.equal(session.originCwd, cwd);
  });

  test('복수 프로젝트 GPT 작업은 각 프로젝트에 한 번씩 집계되고 선택한 프로젝트로 흐름도를 연다', () => {
    const session = { id: 'codex:multi', provider: 'codex', clientKind: 'codex-desktop', status: 'running', projectless: true,
      cwd: '/app/data', workspace: 'data', workspaceRoots: ['/work/api/src', '/work/api/tests', '/work/web'], childIds: [], attention: { required: true } };
    const { state, dashboard } = dashboardHarness(root, [session], [{ path: '/work/api', name: 'API' }, { path: '/work/web', name: 'Web' }]);
    assert.equal(dashboard.isProjectlessSession(session), false);
    assert.deepEqual(Array.from(dashboard.observedProjects(), item => [item.path, item.count, item.liveCount]), [['/work/api', 1, 1], ['/work/web', 1, 1]]);
    for (const project of ['/work/api', '/work/web']) {
      state.workspace = project;
      assert.equal(dashboard.matchesWorkspaceFilter(session), true);
      assert.equal(dashboard.controlRoomProject(session).path, project);
      assert.equal(dashboard.projectNoticeSignals(project).length, 1);
    }
    state.workspace = '/work/api-other';
    assert.equal(dashboard.matchesWorkspaceFilter(session), false);
  });

  test('프로젝트 메타데이터가 없는 CLI·WSL·프로젝트 없는 작업의 기존 분류를 유지한다', () => {
    const { state, dashboard } = dashboardHarness(root, []);
    state.workspace = 'D:\\repo';
    const cli = { provider: 'codex', clientKind: 'codex-cli', cwd: 'D:\\repo\\src', workspaceRoots: [] };
    assert.equal(dashboard.matchesWorkspaceFilter(cli), true);
    assert.equal(dashboard.sessionOriginPath(cli), cli.cwd);
    assert.equal(dashboard.matchesWorkspaceFilter({ ...cli, cwd: '/mnt/d/repo/src' }), true);
    assert.equal(dashboard.matchesWorkspaceFilter({ ...cli, cwd: 'D:\\repo-other' }), false);
    assert.equal(dashboard.sessionOriginPath({ ...cli, workspaceRoots: ['relative', null, 1] }), cli.cwd);
    assert.equal(dashboard.isProjectlessSession({ provider: 'codex', clientKind: 'codex-desktop', cwd: 'C:/Users/test/Documents/Codex/2026-09-15/new-chat' }), true);
  });
}

module.exports = { registerControlRoomProjectTests };
