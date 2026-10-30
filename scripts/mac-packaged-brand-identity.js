'use strict';

// Run against a built app, with a fresh historical profile and the production
// updater environment. Never alter the user's installed application or store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { openInspectedApp } = require('./packaged-update-button');

if (process.platform !== 'darwin') throw new Error('Packaged identity verification requires macOS');
const appBundle = fs.realpathSync(process.argv[2]
  || path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Whitebox.app'));
const executable = path.join(appBundle, 'Contents', 'MacOS', 'Whitebox');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-packaged-brand-')));
const profile = path.join(root, 'loadtoagent');
const home = path.join(root, 'home');
const token = crypto.randomBytes(24).toString('hex');
const ready = path.join(profile, 'updates', `install-renderer-ready-${token}.json`);
const sentinel = path.join(profile, 'identity-sentinel.json');
fs.mkdirSync(path.dirname(ready), { recursive: true });
fs.mkdirSync(home);
fs.writeFileSync(sentinel, '{"preserved":true}');
let driver;
let hostPid = 0;
const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
async function waitForExit(pid) {
  for (let attempt = 0; attempt < 100 && alive(pid); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(alive(pid), false, `Owned process ${pid} did not exit`);
}

(async () => {
  try {
    driver = await openInspectedApp(executable, [], {
      ...process.env,
      WHITEBOX_BRIDGE_HOME: home,
      WHITEBOX_UPDATE_PROFILE_PATH: profile,
      WHITEBOX_UPDATE_READY_PATH: ready,
      WHITEBOX_UPDATE_READY_TOKEN: token,
    });
    const observed = await driver.evaluate(`(() => {
      const {app, BrowserWindow} = process.mainModule.require('electron');
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html'));
      return {version:app.getVersion(), profile:app.getPath('userData'), windowId:win.id};
    })()`);
    assert.equal(observed.version, require('../package.json').version);
    assert.equal(observed.profile, profile);
    // A window URL can exist before its document title has loaded. Require
    // both the authenticated renderer signal and the actual branded title of
    // that same window, within the original 30-second readiness budget.
    const readinessDeadline = Date.now() + 30000;
    let title = '';
    for (let attempt = 0; attempt < 300 && Date.now() < readinessDeadline; attempt += 1) {
      if (fs.existsSync(ready)) {
        title = await driver.evaluate(`process.mainModule.require('electron').BrowserWindow.fromId(${JSON.stringify(observed.windowId)}).getTitle()`);
        if (Date.now() <= readinessDeadline && /Whitebox/.test(title)) break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!fs.existsSync(ready) || !/Whitebox/.test(title) || Date.now() > readinessDeadline) {
      console.error(driver.diagnostics());
      console.error(await driver.evaluate(`(async () => {
        const w = process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html'));
        return w.webContents.executeJavaScript('JSON.stringify({ready:document.readyState,title:document.title,workspaceReady:!!window.WhiteboxWorkspace,text:document.body.innerText.slice(-1600)})');
      })()`));
    }
    assert(Date.now() <= readinessDeadline, 'packaged renderer and brand must be ready within 30 seconds');
    assert.match(title, /Whitebox/);
    const signal = JSON.parse(fs.readFileSync(ready, 'utf8'));
    assert.equal(signal.pid, driver.child.pid);
    assert.equal(signal.version, observed.version);
    assert.equal(signal.token, token);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(sentinel)), { preserved: true });
    assert.equal(fs.existsSync(path.join(home, '.loadtoagent')), false);
    assert(fs.existsSync(path.join(home, '.whitebox', 'bin', 'whitebox')));
    const nativeBundle = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
      `ObjC.import('AppKit'); const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${driver.child.pid}); ObjC.unwrap(app.bundleURL.path);`,
    ], { encoding: 'utf8' }).trim();
    assert.equal(fs.realpathSync(nativeBundle), appBundle, 'Dock must identify the .app bundle, not an exec file');
    const discovery = path.join(profile, 'terminal-host.json');
    if (fs.existsSync(discovery)) hostPid = JSON.parse(fs.readFileSync(discovery)).pid;
    console.log('PASS packaged update-scoped legacy profile: renderer ready, store preserved, Whitebox-only launchers');
    console.log('PASS native Dock bundle identity: ' + nativeBundle);
    await driver.evaluate(`setTimeout(()=>process.mainModule.require('electron').app.quit(),100); true`);
    driver.close();
    await waitForExit(driver.child.pid);
  } finally {
    if (driver) {
      driver.close();
      if (alive(driver.child.pid)) { process.kill(driver.child.pid, 'SIGTERM'); await waitForExit(driver.child.pid); }
    }
    const discovery = path.join(profile, 'terminal-host.json');
    if (!hostPid && fs.existsSync(discovery)) hostPid = JSON.parse(fs.readFileSync(discovery)).pid;
    if (hostPid && alive(hostPid)) {
      const mapped = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(hostPid), '-d', 'txt', '-Fn'], { encoding: 'utf8' });
      assert(mapped.split('\n').some(line => line.startsWith('n' + root + '/')), 'Refusing to stop an unrelated host');
      process.kill(hostPid, 'SIGTERM');
      await waitForExit(hostPid);
    }
    fs.rmSync(root, { recursive: true, force: true });
    console.log('PASS owned app, host and profile cleanup');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
