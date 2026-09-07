'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const { openInspectedApp, clickPackagedUpdate } = require('./packaged-update-button');

if (process.platform !== 'darwin') throw new Error('Packaged macOS update button test requires macOS');
const version = require('../package.json').version;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-mac-button-'));
const app = path.join(root, 'Applications', 'Whitebox.app');
const executable = path.join(app, 'Contents', 'MacOS', 'Whitebox');
const profile = path.join(root, 'profile');
const installer = path.resolve('release', `Whitebox-${version}-${process.arch}.dmg`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let driver;
let relaunchedPid = 0;
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function waitFor(predicate, label, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() >= deadline) throw new Error('Timed out: ' + label); await pause(200); }
}
async function stopOwned(pid) {
  if (!pid || !alive(pid)) return;
  const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], {encoding:'utf8'}).trim();
  assert(command.startsWith(executable), 'Refusing to stop unrelated process: ' + command);
  process.kill(pid, 'SIGTERM');
  await waitFor(() => !alive(pid), 'isolated app cleanup', 30000);
}
(async () => {
  fs.mkdirSync(path.dirname(app), {recursive:true});
  execFileSync('/usr/bin/ditto', [path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Whitebox.app'), app]);
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  const env = {...process.env, HOME:home, WHITEBOX_TEST_INSTANCE:'1', WHITEBOX_DEMO_CAPTURE:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  driver = await openInspectedApp(executable, ['--user-data-dir=' + profile], env);
  await clickPackagedUpdate(driver, installer, version, {retryAfterFailure:true});
  driver.close();
  const attempts = path.join(profile, 'updates', 'install-attempts.jsonl');
  let events = [], launch;
  await waitFor(() => {
    if (!fs.existsSync(attempts)) return false;
    events = fs.readFileSync(attempts,'utf8').trim().split('\n').map(JSON.parse);
    assert(events.filter(e => e.stage === 'failed').length <= 1, JSON.stringify(events));
    launch = events.find(e => e.stage === 'helper-ready'); return Boolean(launch);
  }, 'production main helper acknowledgement');
  await waitFor(() => !alive(driver.child.pid), 'production app quit');
  let log = '';
  await waitFor(() => {
    log = fs.existsSync(launch.logPath) ? fs.readFileSync(launch.logPath,'utf8') : '';
    assert(!/update failed:|rollback failed|relaunch failed/.test(log), log);
    const match = log.match(/update installed and renderer ready;pid=(\d+);version=([^;]+)/);
    if (!match) return false;
    assert.equal(match[2], version); relaunchedPid = Number(match[1]); return true;
  }, 'packaged macOS replacement and renderer readiness');
  assert(alive(relaunchedPid));
  const metadata = JSON.parse(asar.extractFile(path.join(app,'Contents','Resources','app.asar'), 'package.json'));
  assert.equal(metadata.version, version);
  assert.equal((log.match(/update installed and renderer ready;/g)||[]).length,1);
  await waitFor(() => !fs.existsSync(launch.readyPath) && !fs.existsSync(launch.rendererReadyPath)
    && fs.readdirSync(path.dirname(app)).every(name => !/\.update-|\.backup-|\.failed-/.test(name)), 'helper signals and staging cleanup');
  console.log('PASS packaged macOS update button: persistent failure, retry, actual install, renderer-ready relaunch and cleanup');
})().catch(error => {console.error(error.stack || error);process.exitCode=1;}).finally(async () => {
  try {
    if(driver) driver.close();
    await stopOwned(relaunchedPid);
    if(driver) await stopOwned(driver.child.pid);
    assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
    if(!process.exitCode) fs.rmSync(root,{recursive:true,force:true});
    else console.error('Diagnostics preserved: ' + root);
  } catch(error) { console.error(error);process.exitCode=1; }
});
