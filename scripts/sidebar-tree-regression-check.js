'use strict';

// Reproduce sidebar selection, keyboard and layout failures in the real renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-sidebar-regression-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1360, height: 800, show: false,
    webPreferences: { preload: path.join(__dirname, 'interaction-fixture-preload.js'), sandbox: false, backgroundThrottling: false } });
  let code = 0;
  try {
    await win.loadFile(path.join(root, 'renderer/index.html'));
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await win.webContents.executeJavaScript('Boolean(window.WhiteboxApp?.initialized)')) break;
      await wait(50);
    }
    assert.equal(await win.webContents.executeJavaScript('Boolean(window.WhiteboxApp?.initialized)'), true, 'renderer initialized');
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const a = window.WhiteboxApp, model = window.WhiteboxSidebarTree, state = a.state;
      const list = document.querySelector('#projectSidebarList');
      const base = state.snapshot.sessions.find(session => session.id === 'fixture-root');
      const check = (value, message) => { if (!value) throw new Error(message); };
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const press = (node, key) => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      const task = (id, cwd) => ({ ...base, id, title: id, parentId: null, childIds: [], cwd, originCwd: cwd,
        workspaceRoots: [cwd], updatedAt: new Date().toISOString() });
      const reset = (sessions, workspaces = [{ path: '/audit', name: 'Audit' }]) => {
        state.workspaces = workspaces; state.workspace = workspaces[0].path; state.workspaceSource = 'all';
        state.view = 'all'; state.search = ''; state.providerFilters.clear(); state.sidebarFolderFilter = null;
        state.sidebarProjectSearch = ''; state.sidebarTerminalEntries = []; state.dismissedProjects.clear();
        state.sidebarTree = model.normalize(); state.sidebarPathCollapsed = new Set();
        state.snapshot = { ...state.snapshot, sessions, tmux: { distros: [] } };
        state.sidebarExpandedProjects = new Set(workspaces.map(item => item.path.toLowerCase()));
        a.renderWorkspaces(); a.renderSessions();
      };
      const folder = id => list.querySelector('[data-tree-toggle="' + id + '"]');
      const remove = async id => {
        list.querySelector('[data-tree-manage="folder"][data-tree-id="' + id + '"]').click();
        document.querySelector('[data-tree-dialog="delete"]').click(); await frame();
      };
      const visibleIds = () => a.filteredSessions().map(session => session.id).sort().join(',');
      const renderedIds = () => [...document.querySelectorAll('#liveSessionGrid [data-control-session]')].map(node => node.dataset.controlSession).sort().join(',');

      for (const project of ['/audit', 'C:/audit']) {
        const ordinary = [task('ordinary', project + '/src'), task('dot-folder', project + '/.github')];
        const workspaces = [{ path: project, name: 'Audit' }];
        reset(ordinary, workspaces);
        const summary = () => [...list.querySelectorAll('.project-sidebar-item')].map(node => [
          node.dataset.workspace, node.dataset.liveSessionCount, node.dataset.attentionSessionCount,
          node.dataset.resultReadyCount, node.dataset.projectPriority,
        ]);
        const baseline = JSON.stringify(summary());
        const hidden = [
          task('specflow', project + '/.specflow/runs/run-id/planning-after'),
          task('git-internal', project + '/.git/worktrees/temp'),
          task('cache-internal', project + '/.cache/agent'),
          { ...task('declared-parent', project + '/.specflow/runs/child'), workspaceRoots: [project] },
          { ...task('internal-root', project), workspaceRoots: [project + '/.specflow/runs/child'] },
          task('unsaved-internal', '/other/.specflow/runs/temp'),
          task('windows-internal', ['C:', 'audit', '.SPECFLOW', 'runs', 'temp'].join(String.fromCharCode(92))),
        ];
        reset([...ordinary, ...hidden], [...workspaces, { path: project + '/.specflow', name: 'Internal saved folder' }]);
        state.sidebarTree = model.normalize({ folders: [{ id: 'manual', projectKey: project.toLowerCase(), name: 'Manual', parentId: '' }],
          assignments: [{ projectKey: project.toLowerCase(), sessionId: 'specflow', folderId: 'manual' }] });
        state.sidebarTerminalEntries = [{ ...task('internal-terminal', project + '/.specflow/runs/terminal'),
          cmuxWorkspace: true, members: [] }];
        a.renderWorkspaces();
        check(JSON.stringify(summary()) === baseline, 'internal sessions do not change sidebar projects, counts or priority');
        check(hidden.every(session => !list.querySelector('[data-sidebar-session-id="' + session.id + '"]')), 'internal sessions stay hidden, including manually assigned ones');
        check(!list.querySelector('[data-cmux-workspace="internal-terminal"]'), 'internal terminal entry stays hidden');
        check(list.querySelector('[data-sidebar-session-id="ordinary"]') && list.querySelector('[data-sidebar-session-id="dot-folder"]'), 'ordinary subfolders and .github stay visible');
        check(!list.textContent.includes('.specflow') && !list.textContent.includes('planning-after'), 'internal path folders stay hidden');
        check(state.snapshot.sessions.length === ordinary.length + hidden.length, 'sidebar filtering preserves source sessions');
        state.sidebarProjectSearch = 'specflow'; a.renderWorkspaces();
        check(!list.querySelector('[data-sidebar-session-id]'), 'search does not reveal internal sessions');
      }
      reset([task('similar-name', '/audit/.specflow-notes'), {
        ...task('mixed-roots', '/audit'), workspaceRoots: ['/audit/.specflow/runs/temp', '/audit/src'],
      }]);
      check(list.querySelector('[data-sidebar-session-id="similar-name"]'), 'internal names match complete path components only');
      check(list.querySelector('[data-sidebar-session-id="mixed-roots"]'), 'conversation with an ordinary project root stays visible');
      check(![...list.querySelectorAll('[data-path-tree-toggle]')].some(node => node.dataset.pathTreeToggle.includes('/.specflow/')), 'mixed project roots never render the internal path');

      reset([task('delete-session', '/audit')]);
      state.sidebarTree = model.normalize({ folders: [
        { id: 'parent', projectKey: '/audit', name: 'Parent', parentId: '' },
        { id: 'child', projectKey: '/audit', name: 'Child', parentId: 'parent' },
      ], assignments: [{ projectKey: '/audit', sessionId: 'delete-session', folderId: 'child' }], expanded: ['parent', 'child'] });
      a.renderWorkspaces(); folder('child').querySelector('b').click(); await frame();
      check(visibleIds() === 'delete-session', 'selected child contains its session');
      await remove('child');
      check(state.sidebarFolderFilter?.folderId === 'parent' && visibleIds() === 'delete-session', 'deleting selected child selects its parent');
      check(document.querySelector('#projectTaskProjectName').textContent === 'Parent', 'deleted child heading is removed');
      await remove('parent');
      check(!state.sidebarFolderFilter && visibleIds() === 'delete-session', 'deleting selected root folder clears its filter');
      check(document.querySelector('#projectTaskProjectName').textContent === 'Audit', 'deleted root heading returns to project');
      check(!!list.querySelector('[data-sidebar-session-id="delete-session"]'), 'deleted folder retains its session');

      reset([task('path-a', '/audit/src'), task('path-b', '/audit/src'), task('path-root', '/audit/src')]);
      state.sidebarTree = model.normalize({ folders: [
        { id: 'a', projectKey: '/audit', name: 'A', parentId: '' },
        { id: 'b', projectKey: '/audit', name: 'B', parentId: '' },
      ], assignments: [
        { projectKey: '/audit', sessionId: 'path-a', folderId: 'a' },
        { projectKey: '/audit', sessionId: 'path-b', folderId: 'b' },
      ], expanded: ['a', 'b'] }); a.renderWorkspaces();
      const paths = () => [...list.querySelectorAll('[data-path-tree-toggle]')];
      const pathRow = id => paths().find(node => node.closest('[data-tree-folder]')?.dataset.treeFolder === id);
      const ids = paths().map(node => node.getAttribute('aria-controls'));
      check(ids.length === 3 && new Set(ids).size === 3, 'same cwd has unique group IDs in every virtual parent');
      pathRow('b').focus(); press(pathRow('b'), 'ArrowRight'); await frame();
      check(document.activeElement.dataset.sidebarSessionId === 'path-b', 'right arrow enters the exact virtual parent');
      pathRow('b').querySelector('.sidebar-tree-chevron').click(); await frame();
      check(pathRow('b').getAttribute('aria-expanded') === 'false' && pathRow('a').getAttribute('aria-expanded') === 'true', 'collapse is local to one path row');
      check(document.activeElement === pathRow('b'), 'collapse restores the exact path row focus');
      press(pathRow('b'), 'ArrowRight'); await frame();
      check(document.activeElement === pathRow('b') && pathRow('b').getAttribute('aria-expanded') === 'true', 'keyboard expands and retains the exact path row');
      pathRow('a').querySelector('b').click(); await frame();
      check(visibleIds() === 'path-a' && renderedIds() === 'path-a', 'virtual path excludes siblings and project-root sessions in model and rendered graph');
      paths().find(node => !node.closest('[data-tree-folder]')).querySelector('b').click(); await frame();
      check(visibleIds() === 'path-root' && renderedIds() === 'path-root', 'root path excludes virtual-folder sessions');
      pathRow('a').querySelector('b').click(); await frame();
      await remove('a');
      check(state.sidebarFolderFilter?.folderId === '' && visibleIds() === 'path-a,path-root', 'deleting a virtual parent reconciles its selected path');
      check(renderedIds() === 'path-a,path-root', 'folder mutation immediately refreshes the main graph');

      // Keep focus when a different, auto-discovered project disappears.
      reset([task('focus-session', '/audit'), task('ahead-session', '/ahead')]);
      state.projectOrder = ['/ahead', '/audit']; a.renderWorkspaces();
      list.querySelector('[data-sidebar-session-id="focus-session"]').focus();
      state.snapshot = { ...state.snapshot, sessions: state.snapshot.sessions.filter(session => session.id !== 'ahead-session') };
      a.renderWorkspaces(); await frame();
      check(document.activeElement.dataset.sidebarSessionId === 'focus-session', 'unrelated project removal preserves task focus');
      // Folder indexes must not destabilize focus either.
      state.sidebarTree = model.normalize({ folders: [
        { id: 'unrelated', projectKey: '/audit', name: 'Unrelated', parentId: '' },
        { id: 'focused', projectKey: '/audit', name: 'Focused', parentId: '' },
      ], assignments: [{ projectKey: '/audit', sessionId: 'focus-session', folderId: 'focused' }], expanded: ['focused'] });
      a.renderWorkspaces(); list.querySelector('[data-sidebar-session-id="focus-session"]').focus();
      model.remove(state, 'unrelated'); a.renderWorkspaces(); await frame();
      check(document.activeElement.dataset.sidebarSessionId === 'focus-session', 'unrelated folder removal preserves task focus');

      const workspaces = Array.from({ length: 9 }, (_, index) => ({
        path: '/audit' + Array.from({ length: index }, (_, part) => '/folder' + part).join(''), name: 'Project at depth ' + (index + 1),
      }));
      reset([task('deep-task', workspaces.at(-1).path)], workspaces);
      const deepest = workspaces.at(-1).path;
      state.sidebarTree = model.normalize({ folders: Array.from({ length: 6 }, (_, index) => ({
        id: 'deep-' + index, projectKey: deepest, name: 'Virtual folder ' + index, parentId: index ? 'deep-' + (index - 1) : '',
      })), assignments: [{ projectKey: deepest, sessionId: 'deep-task', folderId: 'deep-5' }],
      expanded: Array.from({ length: 6 }, (_, index) => 'deep-' + index) });
      a.renderWorkspaces();
      return 'Selection/deletion, scoped path filters, unique IDs, local collapse and refresh focus passed';
    })()`));
    for (const width of [1360, 1024, 721]) {
      win.setContentSize(width, 800); await wait(100);
      for (const theme of ['dark', 'light']) {
        await win.webContents.executeJavaScript(`window.WhiteboxTheme.setTheme(${JSON.stringify(theme)})`);
        const metrics = await win.webContents.executeJavaScript(`(() => {
          const list = document.querySelector('#projectSidebarList'), bounds = list.getBoundingClientRect();
          const rows = [...list.querySelectorAll('[role="treeitem"]')];
          const labels = rows.map(row => row.querySelector('strong, b').getBoundingClientRect());
          return { rows: rows.length, minLabelWidth: Math.min(...labels.map(rect => rect.width)),
            labelsInside: labels.every(rect => rect.left >= bounds.left && rect.right <= bounds.right + 1),
            noHorizontalOverflow: list.scrollWidth <= list.clientWidth + 1 };
        })()`);
        assert.equal(metrics.rows, 16, 'nine projects, six folders and one session');
        assert.ok(metrics.minLabelWidth >= 60 && metrics.labelsInside && metrics.noHorizontalOverflow,
          `${width}px ${theme}: ${JSON.stringify(metrics)}`);
        console.log(`${width}px ${theme}: deepest tree labels >= ${Math.floor(metrics.minLabelWidth)}px, no horizontal clipping`);
      }
    }
    console.log('Sidebar tree regression checks passed');
  } catch (error) { console.error(error); code = 1; }
  finally { win.destroy(); fs.rmSync(profile, { recursive: true, force: true }); app.exit(code); }
});
