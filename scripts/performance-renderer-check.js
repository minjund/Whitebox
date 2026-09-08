'use strict';

// Deterministic dashboard workload; no provider processes or user profiles.
const { app, BrowserWindow } = require('electron');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-performance-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const started = performance.now();
  const win = new BrowserWindow({ show: false, width: 1440, height: 940,
    webPreferences: { preload: path.join(__dirname, 'interaction-fixture-preload.js'),
      sandbox: false, contextIsolation: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  try {
    await win.loadFile(path.join(root, 'renderer/index.html'));
    const deadline = Date.now() + 15000;
    while (!(await win.webContents.executeJavaScript('Boolean(window.WhiteboxApp?.state?.snapshot)'))) {
      assert(Date.now() < deadline, 'Renderer bootstrap timed out');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const startupMs = performance.now() - started;
    if (process.env.WHITEBOX_PERFORMANCE_PROFILE === '1') {
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Profiler.enable');
      await win.webContents.debugger.sendCommand('Profiler.start');
    }
    const result = await win.webContents.executeJavaScript(`(async () => {
      const app = window.WhiteboxApp;
      const base = app.state.snapshot.sessions.find(row => row.id === 'fixture-root');
      const original = app.state.snapshot;
      const rows = Array.from({ length: 240 }, (_, i) => ({ ...base, id: 'perf-' + i,
        externalId: 'perf-' + i, parentId: null, childIds: [], runtimePresence: [],
        title: 'Performance task ' + i, cwd: 'D:/performance/project-' + (i % 24),
        originCwd: 'D:/performance/project-' + (i % 24), messages: [], lifecycle: [],
        executions: [], collaboration: null }));
      app.state.rawSnapshot = { ...original, sessions: rows };
      app.state.snapshot = app.projectVisibleSnapshot(app.state.rawSnapshot);
      app.state.workspace = 'all'; app.state.workspaceSource = 'all'; app.state.view = 'all';
      const times = [];
      for (let i = 0; i < 12; i++) {
        const start = performance.now(); app.render('refresh'); times.push(performance.now() - start);
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      const sidebar = document.querySelector('#projectSidebarList');
      const first = sidebar.firstElementChild;
      let replacements = 0;
      const observer = new MutationObserver(records => { replacements += records.filter(r => r.type === 'childList').length; });
      observer.observe(sidebar, { childList: true });
      app.render('refresh');
      await new Promise(resolve => requestAnimationFrame(resolve)); observer.disconnect();
      const retainedSidebar = sidebar.firstElementChild === first;
      app.state.workspace = rows[0].cwd; app.render('view');
      const selected = document.body.dataset.projectSelected;
      app.state.rawSnapshot = original; app.state.snapshot = app.projectVisibleSnapshot(original);
      app.state.workspace = 'all'; app.render('view');
      return { sessions: rows.length, projects: 24, times, replacements, retainedSidebar, selected,
        nodes: document.querySelectorAll('*').length };
    })()`);
    assert.equal(result.selected, 'true', 'Project selection remains functional');
    assert.equal(result.retainedSidebar, true, 'Unchanged refresh must retain sidebar nodes');
    assert.equal(result.replacements, 0, 'Unchanged refresh must not replace sidebar children');
    assert.deepEqual(errors, [], 'Renderer errors');
    const report = { startupMs, ...result };
    const output = path.join(root, 'artifacts/performance');
    fs.mkdirSync(output, { recursive: true });
    if (win.webContents.debugger.isAttached()) {
      const { profile: cpuProfile } = await win.webContents.debugger.sendCommand('Profiler.stop');
      fs.writeFileSync(path.join(output, 'renderer.cpuprofile'), JSON.stringify(cpuProfile));
      win.webContents.debugger.detach();
    }
    fs.writeFileSync(path.join(output, process.env.WHITEBOX_PERFORMANCE_OUTPUT || 'renderer.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { win.destroy(); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
app.on('quit', () => {
  // profile is the exact fresh directory returned by mkdtemp, never user data.
  if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('whitebox-performance-')) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
});
