'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-sidebar-scroll-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  let exitCode = 0;
  const win = new BrowserWindow({ width: 1360, height: 800, show: false,
    webPreferences: { preload: path.join(__dirname, 'interaction-fixture-preload.js'), sandbox: false, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  try {
    require('./legacy-renderer-fixture').installLegacyRendererFixture();
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
    for (let i = 0; i < 100; i++) {
      if (await win.webContents.executeJavaScript('Boolean(window.WhiteboxApp?.initialized)')) break;
      await wait(50);
    }
    if (!await win.webContents.executeJavaScript('Boolean(window.WhiteboxApp?.initialized)')) {
      throw new Error('App initialization timed out');
    }
    await win.webContents.executeJavaScript(`(() => {
      const a = window.WhiteboxApp;
      a.state.workspaces = Array.from({length: 24}, (_, i) => ({ name: 'Scroll project ' + i, path: '/tmp/sidebar-scroll-' + i }));
      const base = a.state.snapshot.sessions.find(s => !s.parentId && s.status === 'running');
      if (!base) throw new Error('Missing running root session fixture');
      const multiRoot = { ...base, id: 'sidebar-multi-root', parentId: null, title: 'Multi-project conversation',
        workspaceRoots: ['/tmp/sidebar-scroll-0/Whitebox', '/tmp/sidebar-scroll-1'],
        cwd: '/tmp/sidebar-scroll-0/Whitebox', originCwd: '/tmp/sidebar-scroll-0/Whitebox' };
      a.state.snapshot = { ...a.state.snapshot, sessions: [multiRoot], tmux: { distros: [] } };
      a.state.sidebarTerminalEntries = [];
      a.renderWorkspaces();
      a.state.sidebarExpandedProjects = new Set([...document.querySelectorAll("[data-sidebar-project-key]")].map(e => e.dataset.sidebarProjectKey));
      a.renderWorkspaces();
    })()`);
    const results = [];
    for (const offset of ['/tmp/sidebar-scroll-0', '/tmp/sidebar-scroll-1', '/tmp/sidebar-scroll-0', 360, 0, 140, 99999]) {
      await win.webContents.executeJavaScript(typeof offset === 'string'
        ? `document.querySelector('.project-sidebar-item[data-workspace="${offset}"]').scrollIntoView({block: 'center', behavior: 'instant'})`
        : `document.querySelector('#projectSidebarList').scrollTop = ${offset}`);
      await wait(100);
      for (let attempt = 0; attempt < 4; attempt++) {
        const before = await win.webContents.executeJavaScript(`(() => {
          const l = document.querySelector('#projectSidebarList');
          const b = l.getBoundingClientRect();
          const items = [...l.querySelectorAll('.project-sidebar-item')].filter(e => {
            const r = e.getBoundingClientRect(); return r.top >= b.top && r.bottom <= b.bottom;
          });
          const e = ${typeof offset === 'string' ? `l.querySelector('.project-sidebar-item[data-workspace="${offset}"]')` : `items[${attempt} % Math.min(3, items.length)]`};
          if (!e) throw new Error('No visible project at scroll offset ' + l.scrollTop + ', viewport height ' + b.height);
          const r = e.getBoundingClientRect();
          return { folders: [...l.querySelectorAll('[data-path-tree-toggle]')].map(e => e.dataset.pathTreeToggle), scroll: l.scrollTop, path: e.dataset.workspace, top: r.top, x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2) };
        })()`);
        win.webContents.sendInputEvent({type: 'mouseDown', x: before.x, y: before.y, button: 'left', clickCount: 1});
        win.webContents.sendInputEvent({type: 'mouseUp', x: before.x, y: before.y, button: 'left', clickCount: 1});
        await wait(200);
        const after = await win.webContents.executeJavaScript(`(() => {
          const l = document.querySelector('#projectSidebarList');
          const e = [...l.querySelectorAll('.project-sidebar-item')].find(e => e.dataset.workspace === ${JSON.stringify(before.path)});
          return { folders: [...l.querySelectorAll('[data-path-tree-toggle]')].map(e => e.dataset.pathTreeToggle), scroll: l.scrollTop, top: e.getBoundingClientRect().top, selected: e.getAttribute('aria-selected') };
        })()`);
        results.push({ before, after });
      }
    }
    const failures = results.filter(({ before, after }) =>
      JSON.stringify(before.folders) !== JSON.stringify(after.folders)
      || after.selected !== 'true'
      || Math.abs(before.scroll - after.scroll) > 1
      || Math.abs(before.top - after.top) > 1);
    if (failures.length) throw new Error('Project selection moved the sidebar rows: ' + JSON.stringify(failures));
    await win.webContents.executeJavaScript(`(() => {
      const a = window.WhiteboxApp;
      const project = '/tmp/sidebar-pending-request';
      const task = { id: 'sidebar-pending-request', provider: 'codex', status: 'waiting',
        cwd: project, originCwd: project, title: '승인 대기 프로젝트', childIds: [],
        workspaceRoots: [project, '/Users/test/.codex/visualizations/2026/10/14/sidebar-chat-id'],
        updatedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
        attention: { category: 'required', required: true, source: 'input-tool', kind: 'approval',
          requestId: 'sidebar-request-a', requestedAt: new Date().toISOString(), summary: '승인해 주세요' } };
      a.state.snapshot = { ...a.state.snapshot, sessions: [task], tmux: { distros: [] } };
      a.state.workspaces = [];
      a.state.sidebarTerminalEntries = [];
      a.state.controlRoomObservedIds.clear();
      a.state.workspace = 'all';
      a.state.sidebarExpandedProjects = new Set([project]);
      if (a.isControlRoomSession(task)) throw new Error('Fixture must have no live runtime or retention');
      const check = () => {
        a.renderWorkspaces();
        if (!document.querySelector('.project-sidebar-item[data-workspace="' + project + '"]'))
          throw new Error('Pending request project disappeared');
        if (!document.querySelector('[data-sidebar-session-id="' + task.id + '"]'))
          throw new Error('Pending request task disappeared');
        if (document.querySelectorAll('[data-sidebar-session-id="' + task.id + '"]').length !== 1)
          throw new Error('Visualization output root duplicated the sidebar task');
      };
      check();
      a.markProjectNoticeSeen('attention', task);
      if (!a.isProjectNoticeSeen('attention', task)) throw new Error('Read receipt was not recorded');
      for (let refresh = 0; refresh < 4; refresh++) check();
      task.attention = { category: 'none', required: false };
      a.renderWorkspaces();
      if (document.querySelector('.project-sidebar-item[data-workspace="' + project + '"]'))
        throw new Error('Resolved historical request project remained in live sidebar');
    })()`);
    console.log('Pending request project survives read receipts and repeated refreshes; resolved history removed');
    console.log('Sidebar selection scroll retention passed (' + results.length + ' native clicks)');
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    win.destroy();
    await require('electron').session.defaultSession.clearStorageData();
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 });
    app.exit(exitCode);
  }
}).catch(error => { console.error(error); app.exit(1); });
