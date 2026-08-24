'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Readable } = require('stream');
const asar = require('@electron/asar');
const sourcePackageMetadata = require('../package.json');
const bridgeConfig = require('./legacy-update-bridge.config');

if (process.platform !== 'win32') {
  console.log('Windows legacy update bridge integration skipped: win32 only.');
  process.exit(0);
}
if (process.env.GITHUB_ACTIONS !== 'true' && process.env.WHITEBOX_ALLOW_LEGACY_INSTALL_INTEGRATION !== 'true') {
  throw new Error('Refusing to modify the real per-user installer registry outside disposable CI. Set WHITEBOX_ALLOW_LEGACY_INSTALL_INTEGRATION=true only in an isolated Windows environment.');
}

const V163_INSTALLER_SHA256 = 'e38c38698335c2eec4aef8c6da6f1629470addaff1b881fe961172644c86db0f';
const CURRENT_VERSION = '1.7.4';
const CURRENT_INSTALLER_SHA256 = '4d940cf16425436922a37746417b419c7671c47642c0f24b8c79197af99c2135';
const bridgeVersion = bridgeConfig.extraMetadata.version;
const releaseDir = path.resolve(process.env.WHITEBOX_LEGACY_BRIDGE_RELEASE_DIR
  || path.join(__dirname, '..', bridgeConfig.directories.output));
const sourceInstaller = path.resolve(String(process.env.WHITEBOX_V163_INSTALLER || ''));
const currentInstaller = path.resolve(String(process.env.WHITEBOX_CURRENT_INSTALLER || ''));
const bridgeInstaller = path.join(releaseDir, `LoadToAgent-Setup-${bridgeVersion}.exe`);
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-legacy-bridge-integration-'));
const installDir = path.join(testRoot, 'installed-v163');
const legacyExecutable = path.join(installDir, 'LoadToAgent.exe');
const currentExecutable = path.join(installDir, 'Whitebox.exe');
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
let relaunchedPid = 0;

function existingFile(file, label) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.size <= 0) throw new Error(`${label} is missing or empty: ${file}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      `${path.basename(command)} failed (${result.status ?? 'spawn error'})`,
      result.error && result.error.stack,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function executableVersion(file) {
  const result = run(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-Item -LiteralPath $env:WHITEBOX_INTEGRATION_EXECUTABLE).VersionInfo.ProductVersion',
  ], { env: { ...process.env, WHITEBOX_INTEGRATION_EXECUTABLE: file } });
  return result.stdout
    .trim()
    .split(/[+\s]/, 1)[0]
    .replace(/^(\d+\.\d+\.\d+)\.0$/, '$1');
}

function processAlive(pid) {
  const result = spawnSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'if (Get-Process -Id $env:WHITEBOX_INTEGRATION_PID -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }',
  ], {
    encoding: 'utf8',
    env: { ...process.env, WHITEBOX_INTEGRATION_PID: String(pid) },
    windowsHide: true,
    timeout: 30_000,
  });
  return result.status === 0;
}

function extractModuleTree(asarPath, targetDir, files) {
  // The installer replaces app.asar in place between hops. @electron/asar
  // caches archive offsets by path, so invalidate them before reading the
  // newly installed archive at that same path.
  asar.uncache(asarPath);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const relative of files) {
    fs.writeFileSync(path.join(targetDir, relative), asar.extractFile(asarPath, `src/${relative}`));
  }
}

function packagedMetadata(asarPath) {
  asar.uncache(asarPath);
  return JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
}

async function waitForRelaunch(logPath, expectedVersion, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    const ready = log.match(/relaunchReady=true;attempt=\d+;pid=(\d+)/);
    if (ready) {
      const selectedExpectedVersion = log
        .split(/\r?\n/)
        .some(line => line.includes('candidate=') && line.endsWith(`;version=${expectedVersion}`));
      assert.equal(selectedExpectedVersion, true, `Updater helper did not select version ${expectedVersion}.`);
      assert.doesNotMatch(log, /relaunchError=|rendererReadyTimeout=true/);
      await new Promise(resolve => setTimeout(resolve, 500));
      return Number(ready[1]);
    }
    if (/bootstrapError=.*10초 안에 준비되지 않았습니다/.test(log)) {
      const error = new Error(`The frozen legacy bootstrap lost its ready-file race:\n${log}`);
      error.code = 'LEGACY_BOOTSTRAP_READY_RACE';
      error.updateLog = log;
      throw error;
    }
    if (/relaunchError=renderer did not become ready after three attempts/.test(log)) {
      throw new Error(`Updater helper could not relaunch ${expectedVersion}:\n${log}`);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '(no update log)';
  throw new Error(`Timed out waiting for updater relaunch ${expectedVersion}:\n${log}`);
}

function assertCleanLegacyInstallBeforeRestartFallback(logPath, options) {
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const lines = log
    .split(/\r?\n/)
    .map(line => line.replace(/^\uFEFF/, '').trim())
    .filter(Boolean);
  const expectedStart = `helperStarted=true;parentPid=${options.parentPid};expectedVersion=${options.expectedVersion}`;
  const helperStarts = lines.filter(line => line.startsWith('helperStarted='));
  const installerExits = lines.filter(line => line.startsWith('exitCode='));
  const bootstrapErrors = lines.filter(line => line.startsWith('bootstrapError='));
  const expectedBootstrapError = 'bootstrapError=업데이트 설치 도우미가 10초 안에 준비되지 않았습니다.';
  const failureLines = lines.filter(line => (
    line.startsWith('installError=')
    || line === 'updateFailed=true'
    || line === 'versionMismatch=true'
    || line.startsWith('relaunchError=')
    || line.startsWith('recoveryRelaunchError=')
    || line.startsWith('rendererReadyTimeout=true')
    || line.startsWith('relaunchExited=true')
  ));
  const clean = helperStarts.length === 1
    && helperStarts[0] === expectedStart
    && installerExits.length === 1
    && installerExits[0] === 'exitCode=0'
    && bootstrapErrors.length === 1
    && bootstrapErrors[0] === expectedBootstrapError
    && failureLines.length === 0;
  if (!clean) {
    throw new Error([
      'Refusing the legacy restart fallback without one clean, completed bridge installation.',
      `Expected helper start: ${expectedStart}`,
      `Observed fatal markers: ${failureLines.join(', ') || '(none)'}`,
      log || '(no update log)',
    ].join('\n'));
  }
}

async function waitForInstalledPackage(appPath, expectedVersion, timeoutMs = 120_000) {
  const appAsar = path.join(path.dirname(appPath), 'resources', 'app.asar');
  const startedAt = Date.now();
  let stableChecks = 0;
  let lastVersion = '';
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastVersion = executableVersion(appPath);
      const metadata = packagedMetadata(appAsar);
      if (lastVersion === expectedVersion && metadata.version === expectedVersion) {
        stableChecks += 1;
        if (stableChecks >= 3) return;
      } else {
        stableChecks = 0;
      }
      lastError = null;
    } catch (error) {
      stableChecks = 0;
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error([
    `Timed out waiting for the installed package ${expectedVersion}.`,
    `Last executable version: ${lastVersion || '(unavailable)'}`,
    lastError && (lastError.stack || lastError.message),
  ].filter(Boolean).join('\n'));
}

async function downloadWithPackagedUpdater(options, downloadsDir) {
  const assetName = path.basename(options.installer);
  const assetUrl = `https://github.com/minjund/${options.repository}/releases/download/v${options.expectedVersion}/${assetName}`;
  const digest = `sha256:${sha256(options.installer)}`;
  const size = fs.statSync(options.installer).size;
  const release = {
    tag_name: `v${options.expectedVersion}`,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/minjund/${options.repository}/releases/tag/v${options.expectedVersion}`,
    published_at: '2026-08-24T00:00:00.000Z',
    body: 'Windows legacy bridge integration fixture',
    assets: [{
      name: assetName,
      size,
      state: 'uploaded',
      digest,
      browser_download_url: assetUrl,
    }],
  };
  const fetch = async url => {
    if (String(url) === options.updaterModule.RELEASE_API) {
      const body = Buffer.from(JSON.stringify(release));
      return new Response(body, {
        status: 200,
        headers: { 'content-length': String(body.length), 'content-type': 'application/json' },
      });
    }
    if (String(url) === assetUrl) {
      return new Response(Readable.toWeb(fs.createReadStream(options.installer)), {
        status: 200,
        headers: { 'content-length': String(size), 'content-type': 'application/octet-stream' },
      });
    }
    return new Response('not found', { status: 404 });
  };
  const updater = new options.updaterModule.UpdateManager({
    currentVersion: options.currentVersion,
    platform: 'win32',
    arch: 'x64',
    installType: 'desktop',
    targetInstallType: 'desktop',
    installMode: 'automatic',
    currentVersionKnown: true,
    downloadsDir,
    fetch,
  });
  const checked = await updater.check({ surfaceError: true });
  assert.equal(checked.status, 'available');
  assert.equal(checked.asset && checked.asset.name, assetName);
  assert.equal(checked.asset && checked.asset.digest, digest);
  const downloaded = await updater.download();
  assert.equal(downloaded.status, 'downloaded');
  existingFile(downloaded.downloadedPath, `downloaded ${assetName}`);
  assert.equal(sha256(downloaded.downloadedPath), digest.slice('sha256:'.length));
  return downloaded.downloadedPath;
}

async function installWithPackagedUpdater(options) {
  const downloadsDir = path.join(testRoot, options.label);
  fs.mkdirSync(downloadsDir, { recursive: true });
  const downloadedInstaller = await downloadWithPackagedUpdater(options, downloadsDir);
  let launched = null;
  try {
    launched = await options.installerModule.launchDownloadedUpdate({
      installerPath: downloadedInstaller,
      downloadsDir,
      platform: 'win32',
      installType: 'desktop',
      appPath: options.appPath,
      expectedVersion: options.expectedVersion,
      parentPid: options.parentPid,
      allowUnsignedWindowsUpdates: options.allowUnsignedWindowsUpdates,
      environment: process.env,
      readyTimeoutMs: 15_000,
      // Current Whitebox performs real shutdown preparation before deleting
      // the helper-ready signal. Keep the signal visible long enough for its
      // bootstrap process when exercising the packaged current updater here.
      beforeAutomaticInstall: async () => new Promise(resolve => setTimeout(resolve, 500)),
    });
    assert.equal(processAlive(options.parentPid), true, 'The packaged helper did not wait for its real parent process.');
    assert.equal(executableVersion(options.appPath), options.currentVersion, 'The installer ran before the parent process exited.');
  } finally {
    // launchDownloadedUpdate returns only after the helper is ready and waiting
    // for its parent. Ending the real installed app here models main-process
    // quit and proves the packaged helper observes that shutdown boundary.
    stopProcessTree(options.parentPid);
  }
  assert.equal(processAlive(options.parentPid), false, 'The installed parent app did not exit before replacement.');
  assert.equal(launched.mode, 'automatic');
  try {
    return await waitForRelaunch(launched.logPath, options.expectedVersion);
  } catch (error) {
    if (!options.allowLegacyBootstrapFallback || error.code !== 'LEGACY_BOOTSTRAP_READY_RACE') throw error;
    // v1.6.3 has two consumers racing to remove the same helper-ready file.
    // Release metadata cannot change that already-installed bootstrap. Accept
    // the fallback only after the same fresh helper logged one successful NSIS
    // exit with no fatal marker. Then prove both the EXE and app.asar reached
    // 1.6.23 and model the only required user fallback: reopen the updated app.
    assertCleanLegacyInstallBeforeRestartFallback(launched.logPath, options);
    await waitForInstalledPackage(options.appPath, options.expectedVersion);
    assertCleanLegacyInstallBeforeRestartFallback(launched.logPath, options);
    const fallbackPid = await startInstalledApp(options.appPath);
    console.log(`✓ Legacy bootstrap relaunch fallback reopened installed ${options.expectedVersion}.`);
    return fallbackPid;
  }
}

function stopProcessTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
}

async function startInstalledApp(executable) {
  const child = spawn(executable, [], {
    env: process.env,
    stdio: 'ignore',
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  await new Promise(resolve => setTimeout(resolve, 1_000));
  if (child.exitCode !== null) throw new Error(`Installed parent app exited early (${child.exitCode}): ${executable}`);
  return child.pid;
}

async function main() {
  assert.equal(sourcePackageMetadata.version, CURRENT_VERSION, 'The audited bridge source version changed.');
  existingFile(sourceInstaller, 'v1.6.3 installer');
  existingFile(bridgeInstaller, 'legacy bridge installer');
  existingFile(currentInstaller, `Whitebox ${CURRENT_VERSION} installer`);
  assert.equal(sha256(sourceInstaller), V163_INSTALLER_SHA256, 'The historical v1.6.3 installer digest changed.');
  assert.equal(sha256(currentInstaller), CURRENT_INSTALLER_SHA256, `The Whitebox ${CURRENT_VERSION} installer digest changed.`);

  process.env.WHITEBOX_DEMO_CAPTURE = '1';
  process.env.WHITEBOX_TEST_INSTANCE = '1';
  process.env.LOADTOAGENT_DEMO_CAPTURE = '1';
  process.env.LOADTOAGENT_TEST_INSTANCE = '1';

  // /D must be the final NSIS argument. A custom location proves that both
  // later installers reuse the previous product identity rather than creating
  // independent default-path installations.
  run(sourceInstaller, ['/S', '/currentuser', `/D=${installDir}`]);
  existingFile(legacyExecutable, 'installed v1.6.3 executable');
  assert.equal(executableVersion(legacyExecutable), '1.6.3');

  const installedAsar = path.join(installDir, 'resources', 'app.asar');
  const v163Metadata = packagedMetadata(installedAsar);
  const v163AllowsUnsigned = v163Metadata.loadToAgent?.distributionChannel === 'internal'
    && v163Metadata.loadToAgent?.allowUnsignedWindowsUpdates === true;
  assert.equal(v163AllowsUnsigned, true, 'Packaged v1.6.3 unsigned update policy changed.');
  const v163ModuleDir = path.join(testRoot, 'v163-packaged-src');
  extractModuleTree(installedAsar, v163ModuleDir, [
    'diagnostics.js',
    'updateInstaller.js',
    'updateManager.js',
  ]);
  const v163InstallerModule = require(path.join(v163ModuleDir, 'updateInstaller.js'));
  const v163UpdaterModule = require(path.join(v163ModuleDir, 'updateManager.js'));
  const v163ParentPid = await startInstalledApp(legacyExecutable);
  relaunchedPid = await installWithPackagedUpdater({
    label: 'first-hop-downloads',
    installerModule: v163InstallerModule,
    updaterModule: v163UpdaterModule,
    installer: bridgeInstaller,
    repository: 'LodeToAgent',
    currentVersion: '1.6.3',
    parentPid: v163ParentPid,
    allowUnsignedWindowsUpdates: v163AllowsUnsigned,
    appPath: legacyExecutable,
    expectedVersion: bridgeVersion,
    allowLegacyBootstrapFallback: true,
  });
  existingFile(legacyExecutable, 'upgraded legacy bridge executable');
  assert.equal(executableVersion(legacyExecutable), bridgeVersion);

  const bridgeAsar = path.join(installDir, 'resources', 'app.asar');
  const bridgeMetadata = packagedMetadata(bridgeAsar);
  const bridgeAllowsUnsigned = bridgeMetadata.whitebox?.distributionChannel === 'internal'
    && bridgeMetadata.whitebox?.allowUnsignedWindowsUpdates === true;
  assert.equal(bridgeAllowsUnsigned, true, 'Packaged bridge unsigned second-hop policy changed.');
  const bridgeModuleDir = path.join(testRoot, 'bridge-packaged-src');
  extractModuleTree(bridgeAsar, bridgeModuleDir, [
    'diagnostics.js',
    'macUpdateHelper.js',
    'updateInstaller.js',
    'updateManager.js',
  ]);
  const bridgeInstallerModule = require(path.join(bridgeModuleDir, 'updateInstaller.js'));
  const bridgeUpdaterModule = require(path.join(bridgeModuleDir, 'updateManager.js'));
  relaunchedPid = await installWithPackagedUpdater({
    label: 'second-hop-downloads',
    installerModule: bridgeInstallerModule,
    updaterModule: bridgeUpdaterModule,
    installer: currentInstaller,
    repository: 'Whitebox',
    currentVersion: bridgeVersion,
    parentPid: relaunchedPid,
    allowUnsignedWindowsUpdates: bridgeAllowsUnsigned,
    appPath: legacyExecutable,
    expectedVersion: CURRENT_VERSION,
  });
  existingFile(currentExecutable, 'second-hop Whitebox executable');
  assert.equal(executableVersion(currentExecutable), CURRENT_VERSION);

  console.log(`✓ Packaged v1.6.3 helper upgraded in place to ${bridgeVersion}; the packaged bridge helper then upgraded and relaunched Whitebox ${CURRENT_VERSION}.`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  stopProcessTree(relaunchedPid);
  const uninstallers = [
    path.join(installDir, 'Uninstall Whitebox.exe'),
    path.join(installDir, 'Uninstall LoadToAgent.exe'),
  ];
  const uninstaller = uninstallers.find(file => fs.existsSync(file));
  if (uninstaller) {
    spawnSync(uninstaller, ['/S', '/currentuser'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000,
    });
  }
  fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
});
