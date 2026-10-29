'use strict';
// Exercise the actual Electron worker/ASAR loader, not just a source-level mock.
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-process-worker-'));
app.setPath('userData', path.join(temporary, 'profile'));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const source = path.join(temporary, 'app');
    fs.mkdirSync(source);
    fs.cpSync(path.join(root, 'src'), path.join(source, 'src'), { recursive: true });
    fs.mkdirSync(path.join(source, 'renderer'));
    fs.copyFileSync(path.join(root, 'renderer/terminal-prompt.js'), path.join(source, 'renderer/terminal-prompt.js'));
    const archive = path.join(temporary, 'app.asar');
    await require('@electron/asar').createPackage(source, archive);
    const { ProcessMonitor } = require(path.join(archive, 'src/processMonitor.js'));
    const monitor = new ProcessMonitor();
    let ticks = 0, last = performance.now(), maximumGap = 0;
    const timer = setInterval(() => {
      const now = performance.now(); maximumGap = Math.max(maximumGap, now - last); last = now; ticks++;
    }, 5);
    let result;
    try { result = await monitor.scanAsync(); } finally { clearInterval(timer); }
    assert(result.available, result.error);
    assert(ticks > 0, 'main loop must keep processing timers during an OS snapshot');
    if (process.platform !== 'win32') assert(Array.isArray(result.activityRows));
    assert.equal(await monitor.scanAsync(), result, 'an unchanged snapshot is shared');
    console.log(JSON.stringify({ asarWorker: true, mainLoopTicks: ticks, maximumMainLoopGapMs: maximumGap }));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
app.on('quit', () => fs.rmSync(temporary, { recursive: true, force: true }));
