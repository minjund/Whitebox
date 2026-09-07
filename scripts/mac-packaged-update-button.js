'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const { openInspectedApp, clickPackagedUpdate } = require('./packaged-update-button');

if (process.platform !== 'darwin') throw new Error('Packaged macOS update button test requires macOS');
const version = require('../package.json').version;
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-mac-button-')));
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
  // process.title changes ps output; lsof's executable mapping is authoritative.
  const mapped = execFileSync('/usr/sbin/lsof', ['-a','-p',String(pid),'-d','txt','-Fn'], {encoding:'utf8'});
  assert(mapped.split('\n').includes('n'+executable), 'Refusing to stop unrelated process: ' + mapped);
  process.kill(pid, 'SIGTERM');
  await waitFor(() => !alive(pid), 'isolated app cleanup', 30000);
}
(async () => {
  fs.mkdirSync(path.dirname(app), {recursive:true});
  // Reproduce the reported installed macOS 1.7.3 cohort from official bytes.
  const pinned = process.arch === 'arm64'
    ? {size:118203096,sha256:'4de9ff62f526326d718bbd9de9b5ef296cf6236573c0910b85f40f6739a131ed'}
    : {size:119993464,sha256:'0cfbfa66d4ea202a0929b5f7eda1b72c2568d245df30ee5c5d15f642dc99e768'};
  const sourceName = `Whitebox-1.7.3-${process.arch}.dmg`;
  const sourceUrl = `https://github.com/minjund/Whitebox/releases/download/v1.7.3/${sourceName}`;
  const sourceResponse = await fetch(sourceUrl); assert(sourceResponse.ok);
  const sourceBytes = Buffer.from(await sourceResponse.arrayBuffer());
  assert.equal(sourceBytes.length,pinned.size);
  assert.equal(crypto.createHash('sha256').update(sourceBytes).digest('hex'),pinned.sha256);
  const sourceDmg = path.join(root,sourceName); fs.writeFileSync(sourceDmg,sourceBytes);
  const mount = path.join(root,'source-mount');
  execFileSync('/usr/bin/hdiutil',['attach',sourceDmg,'-nobrowse','-readonly','-mountpoint',mount]);
  try {execFileSync('/usr/bin/ditto',[path.join(mount,'Whitebox.app'),app]);}
  finally {execFileSync('/usr/bin/hdiutil',['detach',mount]);}
  const sourceMetadata=JSON.parse(asar.extractFile(path.join(app,'Contents','Resources','app.asar'),'package.json'));
  assert.equal(sourceMetadata.version,'1.7.3');
  console.log('PASS pinned official macOS v1.7.3 app.asar: '+sourceUrl+' '+pinned.size+' '+pinned.sha256);
  // Existing broken updaters require manual replacement once. Preserve the
  // profile across that replacement, then exercise the candidate's own updater.
  const sentinel=path.join(profile,'update-recovery-sentinel.json');
  fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(sentinel,'{"preserved":true}');
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  const env = {...process.env, HOME:home, WHITEBOX_TEST_INSTANCE:'1', WHITEBOX_DEMO_CAPTURE:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  driver = await openInspectedApp(executable, ['--user-data-dir=' + profile], env);
  assert.equal(await driver.evaluate(`process.mainModule.require('electron').app.getVersion()`),'1.7.3');
  await waitFor(async () => driver.evaluate(`(async () => {
    const w=process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html'));
    return w ? await w.webContents.executeJavaScript("document.querySelector('#currentVersion')?.textContent.trim() === '1.7.3'") : false;
  })()`),'official macOS 1.7.3 renderer');
  await driver.evaluate(`setTimeout(()=>process.mainModule.require('electron').app.quit(),100);true`);
  driver.close();await waitFor(()=>!alive(driver.child.pid),'official macOS 1.7.3 shutdown');
  fs.rmSync(app,{recursive:true,force:true});
  execFileSync('/usr/bin/ditto', [path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Whitebox.app'), app]);
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
  asar.uncache(path.join(app,'Contents','Resources','app.asar'));
  const metadata = JSON.parse(asar.extractFile(path.join(app,'Contents','Resources','app.asar'), 'package.json'));
  assert.equal(metadata.version, version);
  assert.equal(JSON.parse(fs.readFileSync(sentinel,'utf8')).preserved,true);
  assert.equal((log.match(/update installed and renderer ready;/g)||[]).length,1);
  await waitFor(() => !fs.existsSync(launch.readyPath) && !fs.existsSync(launch.rendererReadyPath)
    && fs.readdirSync(path.dirname(app)).every(name => !/\.update-|\.backup-|\.failed-/.test(name)), 'helper signals and staging cleanup');
  console.log('PASS packaged macOS update button: persistent failure, retry, actual install, renderer-ready relaunch and cleanup');
})().catch(error => {console.error(error.stack || error);process.exitCode=1;}).finally(async () => {
  try {
    if(driver) driver.close();
    await stopOwned(relaunchedPid);
    if(driver) await stopOwned(driver.child.pid);
    assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));
    if(!process.exitCode) fs.rmSync(root,{recursive:true,force:true});
    else console.error('Diagnostics preserved: ' + root);
  } catch(error) { console.error(error);process.exitCode=1; }
});
