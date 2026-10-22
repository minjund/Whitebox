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
  for (const file of ['sidebar-tree.js', 'app-dashboard.js', 'app-graph-model.js']) {
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
  return { state, sidebar, dashboard, graph, context };
}

function registerControlRoomProjectTests({ test, root, temp, jsonl }) {
  test('등록한 하위 프로젝트는 가장 가까운 상위 프로젝트 안에 한 번만 표시한다', () => {
    for (const prefix of ['/work/project', 'C:\\work\\project']) {
      const separator = prefix.startsWith('C:') ? '\\' : '/';
      const child = `${prefix}${separator}Whitebox`;
      const nested = `${child}${separator}tools`;
      const session = { id: 'nested-terminal', provider: 'codex', status: 'running', cwd: nested, childIds: [] };
      const { state, sidebar, dashboard } = dashboardHarness(root, [session], [
        { path: nested, name: 'tools' }, { path: `${prefix}-other`, name: 'other' },
        { path: child, name: 'Whitebox' }, { path: prefix, name: 'project' },
      ]);
      const key = value => value.replace(/\\/g, '/').toLowerCase();
      dashboard.renderWorkspaces();
      const section = value => sidebar.innerHTML.indexOf(`data-sidebar-project-key="${key(value)}"`);
      assert.ok(section(prefix) < section(child) && section(child) < section(nested));
      assert.ok(sidebar.innerHTML.includes(`data-sidebar-project-key="${key(child)}" data-sidebar-parent-project="${key(prefix)}"`));
      assert.ok(sidebar.innerHTML.includes(`data-sidebar-project-key="${key(nested)}" data-sidebar-parent-project="${key(child)}"`));
      assert.ok(sidebar.innerHTML.includes(`data-sidebar-project-key="${key(`${prefix}-other`)}" data-sidebar-parent-project=""`));
      assert.equal(sidebar.innerHTML.split('data-sidebar-session-id="nested-terminal"').length - 1, 1);
      assert.ok(/data-sidebar-session-id="nested-terminal"[^>]*aria-level="4"/.test(sidebar.innerHTML));
      state.sidebarProjectSearch = 'tools';
      dashboard.renderWorkspaces();
      assert.ok(section(prefix) >= 0 && section(child) >= 0 && section(nested) >= 0);
      assert.equal(section(`${prefix}-other`), -1);
    }
  });

  test('읽은 확인 요청도 응답 전에는 실행 감지가 끝나도 사이드바 작업을 유지한다', () => {
    const session = { id: 'pending-sidebar-task', provider: 'codex', status: 'running',
      cwd: '/work/pending', childIds: [], attention: { category: 'required', source: 'input-tool' } };
    const { state, sidebar, dashboard, context } = dashboardHarness(root, [session]);
    let seen = false;
    context.needsUserResponse = task => task.attention?.category === 'required';
    context.needsManagementInbox = task => context.needsUserResponse(task) && !seen;
    context.isProjectNoticeSeen = () => seen;
    state.sidebarExpandedProjects = new Set(['/work/pending']);
    const assertTask = () => {
      dashboard.renderWorkspaces();
      assert.ok(sidebar.innerHTML.includes('data-workspace="/work/pending"'),
        '확인 요청이 남은 프로젝트 이름 줄이 사라지면 안 됩니다.');
      assert.ok(sidebar.innerHTML.includes('data-sidebar-session-id="pending-sidebar-task"'),
        '아직 응답하지 않은 작업 줄이 사라지면 안 됩니다.');
    };
    assertTask();
    session.status = 'waiting';
    assertTask();
    seen = true;
    assertTask();
    assert.ok(sidebar.innerHTML.includes('studio.sidebar.needs_review'));
    assert.ok(sidebar.innerHTML.includes('data-attention-session-count="0"'), '읽음 처리는 유지해야 합니다.');
    session.attention = { category: 'none' };
    dashboard.renderWorkspaces();
    assert.ok(!sidebar.innerHTML.includes('data-sidebar-session-id="pending-sidebar-task"'),
      '응답이 끝난 과거 기록을 실행 중 목록에 남기면 안 됩니다.');
  });

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

  test('상위 프로젝트를 선택해도 별도 등록된 하위 프로젝트 작업은 관제목록에 섞이지 않는다', () => {
    const sessions = [
      { id: 'parent-project-task', provider: 'codex', status: 'running', cwd: '/work/repo/app', childIds: [] },
      { id: 'nested-project-task', provider: 'codex', status: 'running', cwd: '/work/repo/packages/tool', childIds: [] },
    ];
    const { state, dashboard } = dashboardHarness(root, sessions, [
      { path: '/work/repo', name: 'Repository' },
      { path: '/work/repo/packages/tool', name: 'Tool' },
    ]);
    state.workspace = '/work/repo';
    assert.deepEqual(Array.from(sessions.filter(dashboard.matchesWorkspaceFilter), session => session.id), ['parent-project-task']);
    state.workspace = '/work/repo/packages/tool';
    assert.deepEqual(Array.from(sessions.filter(dashboard.matchesWorkspaceFilter), session => session.id), ['nested-project-task']);
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

  test('Codex 시각화 출력 권한 경로를 별도 프로젝트로 중복 표시하지 않는다', () => {
    const output = '/Users/test/.codex/visualizations/2026/10/14/chat-id';
    const session = { id: 'codex:output-root', provider: 'codex', clientKind: 'codex-desktop',
      status: 'running', cwd: '/work/Whitebox', childIds: [], workspaceRoots: ['/work/Whitebox', output] };
    const { state, dashboard, sidebar } = dashboardHarness(root, [session]);
    assert.deepEqual(Array.from(dashboard.observedProjects(), item => item.path), ['/work/Whitebox']);
    dashboard.renderWorkspaces();
    assert.equal((sidebar.innerHTML.match(/data-sidebar-session-id="codex:output-root"/g) || []).length, 1);
    assert.ok(!sidebar.innerHTML.includes(output));
    state.workspace = output;
    assert.equal(dashboard.matchesWorkspaceFilter(session), false);
    session.workspaceRoots = [output];
    assert.equal(dashboard.sessionOriginPath(session), '/work/Whitebox', '출력 폴더만 주어진 경우 실제 cwd 사용');
    session.workspaceRoots = ['C:\\Users\\test\\.codex\\visualizations\\2026\\10\\14\\chat-id', '/work/Whitebox'];
    assert.deepEqual(Array.from(dashboard.observedProjects(), item => item.path), ['/work/Whitebox']);
    session.workspaceRoots = ['/work/visualizations', '/work/Whitebox'];
    assert.equal(dashboard.observedProjects().length, 2, '실제 복수 프로젝트는 보존');
  });
}

module.exports = { registerControlRoomProjectTests };
