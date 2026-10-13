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
    console.log('Sidebar selection scroll retention passed (' + results.length + ' native clicks)');
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    win.destroy();
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(exitCode);
  }
});
