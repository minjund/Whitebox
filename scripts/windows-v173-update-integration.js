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
const { compareVersions } = require('../src/updateManager');

if (process.platform !== 'win32') {
  console.log('Windows v1.7.3 update integration skipped: win32 only.');
  process.exit(0);
}
const disposableGithubRunner = process.env.GITHUB_ACTIONS === 'true'
  && process.env.RUNNER_ENVIRONMENT === 'github-hosted';
if (!disposableGithubRunner && process.env.WHITEBOX_ALLOW_V173_UPDATE_INTEGRATION !== 'true') {
  throw new Error('Refusing to modify the real per-user installer registry outside a disposable GitHub-hosted runner. Set WHITEBOX_ALLOW_V173_UPDATE_INTEGRATION=true only in an isolated Windows environment.');
}

const SOURCE_VERSION = '1.7.3';
const SOURCE_INSTALLER_NAME = 'Whitebox-Setup-1.7.3.exe';
const SOURCE_INSTALLER_SIZE = 85_295_741;
const SOURCE_INSTALLER_SHA256 = '6b14caec7baeca5d6048c32121b9d7361f2bd56828aa6228f2322bf32da6f574';
const EXPECTED_FROZEN_BOOTSTRAP_ERRORS = Object.freeze([
  'bootstrapError=업데이트 설치 도우미가 10초 안에 준비되지 않았습니다.',
  'bootstrapError=업데이트 설치 도우미가 준비 전에 종료되었습니다. 코드: 0',
]);
const targetVersion = String(sourcePackageMetadata.version || '').trim();
const targetInstallerName = `Whitebox-Setup-${targetVersion}.exe`;
const sourceInstaller = path.resolve(String(process.env.WHITEBOX_V173_INSTALLER || ''));
const targetInstaller = path.resolve(String(process.env.WHITEBOX_CURRENT_INSTALLER || ''));
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-v173-update-integration-'));
const installDir = path.join(testRoot, 'installed-whitebox');
const installedExecutable = path.join(installDir, 'Whitebox.exe');
const installedAsar = path.join(installDir, 'resources', 'app.asar');
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
let activeAppPid = 0;

function existingFile(file, label) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.size <= 0) throw new Error(`${label} is missing or empty: ${file}`);
  return stat;
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
  const match = result.stdout.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match ? match[0] : '';
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
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

async function waitForProcessExit(pid, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!processAlive(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for process ${pid} to exit.`);
}

function runningProcessIds(executable) {
  const script = [
    "$ErrorActionPreference = 'Stop';",
    '$ids = @(Get-CimInstance Win32_Process -ErrorAction Stop |',
    '  Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and [string]$_.ExecutablePath -ieq $env:WHITEBOX_INTEGRATION_EXECUTABLE } |',
    '  ForEach-Object { [string]$_.ProcessId });',
    '[Console]::Write(($ids -join ","))',
  ].join(' ');
  const output = run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, WHITEBOX_INTEGRATION_EXECUTABLE: executable },
  }).stdout.trim();
  return output ? output.split(',').map(value => Number(value)).filter(Number.isSafeInteger) : [];
}

function stopProcessTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
}

function closeInstalledAppGracefully(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid app PID for graceful close: ${pid}`);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$process = Get-Process -Id ([int]$env:WHITEBOX_INTEGRATION_PID) -ErrorAction Stop',
    '$windowDeadline = [DateTime]::UtcNow.AddSeconds(15)',
    'while ([DateTime]::UtcNow -lt $windowDeadline) {',
    '  $process.Refresh()',
    '  if ($process.HasExited) { exit 0 }',
    '  if ($process.MainWindowHandle -ne 0) { break }',
    '  Start-Sleep -Milliseconds 100',
    '}',
    "if ($process.MainWindowHandle -eq 0) { throw 'Installed app never exposed a main window for graceful shutdown' }",
    "if (-not $process.CloseMainWindow()) { throw 'Installed app rejected its main-window close request' }",
    "if (-not $process.WaitForExit(30000)) { throw 'Installed app did not finish Electron before-quit cleanup in 30 seconds' }",
  ].join('\n');
  run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, WHITEBOX_INTEGRATION_PID: String(pid) },
    timeout: 50_000,
  });
  assert.equal(processAlive(pid), false, 'Installed app remained alive after its graceful Electron shutdown path.');
}

function packagedMetadata(asarPath) {
  asar.uncache(asarPath);
  return JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
}

function extractModuleTree(asarPath, targetDir, files) {
  asar.uncache(asarPath);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const relative of files) {
    fs.writeFileSync(path.join(targetDir, relative), asar.extractFile(asarPath, `src/${relative}`));
  }
}

function readLog(logPath) {
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
}

function logLines(logPath) {
  return readLog(logPath)
    .split(/\r?\n/)
    .map(line => line.replace(/^\uFEFF/, '').trim())
    .filter(Boolean);
}

function linesStarting(lines, prefix) {
  return lines.filter(line => line.startsWith(prefix));
}

function fatalLogLines(lines) {
  const hasVerifiedRelaunch = lines.some(line => (
    line.startsWith('rendererReady=true;') || line.startsWith('relaunchReady=true;')
  ));
  return lines.filter(line => (
    line.startsWith('readySignalError=')
    || line.startsWith('processLookupError=')
    || line.startsWith('registryLookupError=')
    || line.startsWith('installError=')
    || line === 'updateFailed=true'
    || line === 'versionMismatch=true'
    || line.startsWith('relaunchError=')
    || line.startsWith('recoveryRelaunchError=')
    || line.startsWith('recoveryRelaunchStarted=')
    || line.startsWith('rendererReadyTimeout=true')
    || line.startsWith('relaunchExited=true')
    || line.startsWith('stoppingUnreadyProcess=')
    || (line.startsWith('windowRestoreFailed=true') && !hasVerifiedRelaunch)
  ));
}

function assertCompletedInstall(logPath, options = {}) {
  const lines = logLines(logPath);
  const expectedStart = `helperStarted=true;parentPid=${options.parentPid};expectedVersion=${options.expectedVersion}`;
  assert.deepStrictEqual(linesStarting(lines, 'helperStarted='), [expectedStart], 'Exactly one expected packaged helper must run.');
  assert.deepStrictEqual(linesStarting(lines, 'exitCode='), ['exitCode=0'], 'Exactly one NSIS invocation must complete successfully.');
  assert.equal(lines.includes('allAppProcessesStopped=true'), true, 'The helper did not prove all old app processes stopped.');
  const relaunchPaths = linesStarting(lines, 'relaunchPath=');
  const expectedRelaunchPath = `relaunchPath=${installedExecutable};installedVersion=${options.expectedVersion};expectedVersion=${options.expectedVersion}`;
  if (options.allowFrozenBootstrapRace) {
    assert(relaunchPaths.length <= 1, 'The frozen helper resolved more than one installed executable.');
    if (relaunchPaths.length) assert.equal(relaunchPaths[0], expectedRelaunchPath, 'The frozen helper resolved an unexpected installed executable.');
  } else {
    assert.deepStrictEqual(relaunchPaths, [expectedRelaunchPath], 'The helper did not resolve the custom-path installed executable.');
    assert.equal(lines.includes(`candidate=${installedExecutable};version=${options.expectedVersion}`), true, 'The helper never found the expected custom-path candidate.');
  }
  const bootstrapErrors = linesStarting(lines, 'bootstrapError=');
  if (options.allowFrozenBootstrapRace) {
    assert.equal(bootstrapErrors.length, 1, 'A frozen bootstrap fallback requires exactly one bootstrap error.');
    assert.equal(EXPECTED_FROZEN_BOOTSTRAP_ERRORS.includes(bootstrapErrors[0]), true, `Unexpected frozen bootstrap failure: ${bootstrapErrors[0]}`);
  } else {
    assert.deepStrictEqual(bootstrapErrors, [], 'The bootstrap did not acknowledge the helper-ready signal.');
  }
  assert.deepStrictEqual(fatalLogLines(lines), [], `Updater helper logged a fatal marker:\n${readLog(logPath)}`);
  return lines;
}

async function waitForPathRemoval(file, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!fs.existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for update artifact removal: ${file}`);
}

async function waitForUpdateArtifactCleanup(launched, timeoutMs = 20_000) {
  for (const file of [
    launched.bootstrapPath,
    launched.helperPath,
    launched.readyPath,
    launched.rendererReadyPath,
  ]) {
    if (file) await waitForPathRemoval(file, timeoutMs);
  }
}

async function waitForRelaunchLog(logPath, expectedVersion, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const lines = logLines(logPath);
    const fatal = fatalLogLines(lines);
    if (fatal.length) throw new Error(`Updater helper failed before relaunch: ${fatal.join(', ')}\n${readLog(logPath)}`);
    const ready = linesStarting(lines, 'relaunchReady=');
    if (ready.length) {
      assert.equal(ready.length, 1, 'The helper relaunched the app more than once.');
      const match = ready[0].match(/relaunchReady=true;attempt=1;pid=(\d+)$/);
      assert(match, `Unexpected relaunch-ready record: ${ready[0]}`);
      assert.equal(linesStarting(lines, 'relaunchStarted=').length, 1, 'The helper must start the app exactly once.');
      assert.equal(linesStarting(lines, 'rendererReady=').length, 1, 'The helper must observe one renderer-ready handshake.');
      assert.equal(linesStarting(lines, 'candidate=').some(line => line.endsWith(`;version=${expectedVersion}`)), true);
      return Number(match[1]);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for updater relaunch ${expectedVersion}:\n${readLog(logPath) || '(no update log)'}`);
}

async function waitForRendererReadyFile(launched, pid, expectedVersion, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const signal = JSON.parse(fs.readFileSync(launched.rendererReadyPath, 'utf8').replace(/^\uFEFF/, '').trim());
      if (signal.token === launched.rendererReadyToken
        && Number(signal.pid) === pid
        && signal.version === expectedVersion
        && String(signal.rendererReadyAt || '').trim()) return;
    } catch (_notReady) {}
    if (!processAlive(pid)) throw new Error(`The single frozen-helper relaunch exited before renderer readiness: ${pid}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`The single frozen-helper relaunch never became renderer-ready: ${pid}`);
}

async function waitForInstalledPackage(expectedVersion, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let stableChecks = 0;
  let lastVersion = '';
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastVersion = executableVersion(installedExecutable);
      const metadata = packagedMetadata(installedAsar);
      if (lastVersion === expectedVersion && metadata.version === expectedVersion) {
        stableChecks += 1;
        if (stableChecks >= 3) return metadata;
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
    `Timed out waiting for installed EXE and app.asar version ${expectedVersion}.`,
    `Last executable version: ${lastVersion || '(unavailable)'}`,
    lastError && (lastError.stack || lastError.message),
  ].filter(Boolean).join('\n'));
}

async function startInstalledApp() {
  const child = spawn(installedExecutable, [], {
    env: process.env,
    stdio: 'ignore',
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  await new Promise(resolve => setTimeout(resolve, 1_000));
  if (child.exitCode !== null) throw new Error(`Installed app exited early (${child.exitCode}).`);
  return child.pid;
}

async function downloadWithV173Updater(updaterModule, downloadsDir) {
  const assetUrl = `https://github.com/minjund/Whitebox/releases/download/v${targetVersion}/${targetInstallerName}`;
  const digest = `sha256:${sha256(targetInstaller)}`;
  const size = fs.statSync(targetInstaller).size;
  const release = {
    tag_name: `v${targetVersion}`,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/minjund/Whitebox/releases/tag/v${targetVersion}`,
    published_at: '2026-08-24T00:00:00.000Z',
    body: 'Windows v1.7.3 update integration fixture',
    assets: [{
      name: targetInstallerName,
      size,
      state: 'uploaded',
      digest,
      browser_download_url: assetUrl,
    }],
  };
  const fetch = async url => {
    if (String(url) === updaterModule.RELEASE_API) {
      const body = Buffer.from(JSON.stringify(release));
      return new Response(body, {
        status: 200,
        headers: { 'content-length': String(body.length), 'content-type': 'application/json' },
      });
    }
    if (String(url) === assetUrl) {
      return new Response(Readable.toWeb(fs.createReadStream(targetInstaller)), {
        status: 200,
        headers: { 'content-length': String(size), 'content-type': 'application/octet-stream' },
      });
    }
    return new Response('not found', { status: 404 });
  };
  const updater = new updaterModule.UpdateManager({
    currentVersion: SOURCE_VERSION,
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
  assert.equal(checked.asset && checked.asset.name, targetInstallerName);
  assert.equal(checked.asset && checked.asset.digest, digest);
  const downloaded = await updater.download();
  assert.equal(downloaded.status, 'downloaded');
  existingFile(downloaded.downloadedPath, 'v1.7.3 updater download');
  assert.equal(sha256(downloaded.downloadedPath), digest.slice('sha256:'.length));
  return downloaded.downloadedPath;
}

async function launchPackagedInstaller(installerModule, options) {
  let helperCallbackCount = 0;
  let helperPid = 0;
  let bootstrapChild = null;
  let capturedLogPath = '';
  let capturedReadyPath = '';
  let capturedReadyToken = '';
  const wrappedSpawn = (command, args, spawnOptions) => {
    bootstrapChild = spawn(command, args, spawnOptions);
    const valueAfter = name => {
      const index = args.indexOf(name);
      return index >= 0 ? String(args[index + 1] || '') : '';
    };
    capturedLogPath = valueAfter('-LogPath');
    capturedReadyPath = valueAfter('-ReadyPath');
    capturedReadyToken = valueAfter('-RendererReadyToken');
    return bootstrapChild;
  };
  const launched = await installerModule.launchDownloadedUpdate({
    installerPath: options.installerPath,
    downloadsDir: options.downloadsDir,
    platform: 'win32',
    installType: 'desktop',
    appPath: installedExecutable,
    expectedVersion: targetVersion,
    parentPid: options.parentPid,
    allowUnsignedWindowsUpdates: options.allowUnsignedWindowsUpdates,
    environment: process.env,
    readyTimeoutMs: 15_000,
    bootstrapTimeoutMs: 15_000,
    ...(options.captureBootstrapAck ? { spawn: wrappedSpawn } : {}),
    beforeAutomaticInstall: context => {
      helperCallbackCount += 1;
      helperPid = Number(context && context.helperPid || 0);
      if (options.captureBootstrapAck) {
        assert(bootstrapChild, 'The target updater did not expose its real bootstrap process.');
        assert.equal(bootstrapChild.exitCode, 0, 'The shutdown boundary ran before bootstrap exit code 0.');
        assert.equal(bootstrapChild.signalCode, null, 'The bootstrap was signaled before acknowledgement.');
        const signal = JSON.parse(fs.readFileSync(capturedReadyPath, 'utf8').replace(/^\uFEFF/, '').trim());
        assert.equal(signal.token, capturedReadyToken);
        assert.equal(Number(signal.helperPid), helperPid);
        assert.equal(processAlive(options.parentPid), true, 'The parent exited before bootstrap acknowledgement.');
        assert.equal(processAlive(helperPid), true, 'The helper exited before bootstrap acknowledgement.');
        const boundaryLines = logLines(capturedLogPath);
        assert.deepStrictEqual(linesStarting(boundaryLines, 'allAppProcessesStopped='), [], 'The helper crossed the parent shutdown boundary too early.');
        assert.deepStrictEqual(linesStarting(boundaryLines, 'exitCode='), [], 'NSIS ran before the parent shutdown boundary.');
      }
    },
  });
  assert.equal(helperCallbackCount, 1, 'The packaged updater did not cross its helper-ready boundary exactly once.');
  assert.equal(Number.isSafeInteger(helperPid) && helperPid > 0, true, 'The packaged updater did not report its helper PID.');
  assert.equal(launched.mode, 'automatic');
  return {
    ...launched,
    integrationReadyPath: capturedReadyPath,
    integrationHelperPid: helperPid,
  };
}

async function finishFrozenFirstHop(launched, parentPid) {
  await waitForPathRemoval(launched.bootstrapPath);
  let lines = logLines(launched.logPath);
  const bootstrapErrors = linesStarting(lines, 'bootstrapError=');
  if (!bootstrapErrors.length) {
    const pid = await waitForRelaunchLog(launched.logPath, targetVersion);
    await waitForInstalledPackage(targetVersion);
    await waitForUpdateArtifactCleanup(launched);
    lines = assertCompletedInstall(launched.logPath, { parentPid, expectedVersion: targetVersion });
    assert.equal(linesStarting(lines, 'relaunchStarted=').length, 1);
    assert.equal(processAlive(pid), true, 'The v1.7.3 helper relaunch did not survive.');
    return pid;
  }

  assert.equal(bootstrapErrors.length, 1);
  assert.equal(EXPECTED_FROZEN_BOOTSTRAP_ERRORS.includes(bootstrapErrors[0]), true, `Unexpected frozen bootstrap failure: ${bootstrapErrors[0]}`);
  lines = assertCompletedInstall(launched.logPath, {
    parentPid,
    expectedVersion: targetVersion,
    allowFrozenBootstrapRace: true,
  });
  await waitForInstalledPackage(targetVersion);
  lines = assertCompletedInstall(launched.logPath, {
    parentPid,
    expectedVersion: targetVersion,
    allowFrozenBootstrapRace: true,
  });

  const relaunchStarts = linesStarting(lines, 'relaunchStarted=');
  const relaunchReady = linesStarting(lines, 'relaunchReady=');
  const recoveryStarts = linesStarting(lines, 'recoveryRelaunchStarted=');
  assert.deepStrictEqual(recoveryStarts, [], 'The frozen helper used an unverified recovery relaunch.');
  assert(relaunchStarts.length <= 1, 'The frozen helper started the updated app more than once.');
  assert(relaunchReady.length <= 1, 'The frozen helper completed more than one relaunch.');

  if (relaunchReady.length === 1) {
    assert.equal(relaunchStarts.length, 1);
    const pid = Number(relaunchReady[0].match(/pid=(\d+)$/)?.[1] || 0);
    await waitForUpdateArtifactCleanup(launched);
    assert.equal(processAlive(pid), true, 'The single frozen-helper relaunch did not survive.');
    return pid;
  }
  if (relaunchStarts.length === 1) {
    const pid = Number(relaunchStarts[0].match(/pid=(\d+)$/)?.[1] || 0);
    assert.equal(Number.isSafeInteger(pid) && pid > 0, true);
    await waitForRendererReadyFile(launched, pid, targetVersion);
    assert.equal(processAlive(pid), true);
    return pid;
  }

  assert.deepStrictEqual(runningProcessIds(installedExecutable), [], 'Refusing a second restart while an updated app process already exists.');
  const fallbackPid = await startInstalledApp();
  assert.equal(processAlive(fallbackPid), true);
  console.log(`✓ Frozen v${SOURCE_VERSION} ready-file race required exactly one verified fallback restart.`);
  return fallbackPid;
}

async function main() {
  assert.match(targetVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(compareVersions(targetVersion, '1.7.4') > 0, true, 'The handshake fix must ship at a SemVer version newer than the already-published v1.7.4.');
  assert.equal(path.basename(sourceInstaller), SOURCE_INSTALLER_NAME);
  assert.equal(path.basename(targetInstaller), targetInstallerName);
  assert.equal(existingFile(sourceInstaller, 'official v1.7.3 installer').size, SOURCE_INSTALLER_SIZE);
  existingFile(targetInstaller, `freshly built ${targetInstallerName}`);
  assert.equal(sha256(sourceInstaller), SOURCE_INSTALLER_SHA256, 'The official v1.7.3 installer digest changed.');

  process.env.WHITEBOX_DEMO_CAPTURE = '1';
  process.env.WHITEBOX_TEST_INSTANCE = '1';

  // This is the only direct installer execution: it establishes the immutable
  // v1.7.3 baseline. Both target installations below must go through packaged
  // updateInstaller helpers.
  run(sourceInstaller, ['/S', '/currentuser', `/D=${installDir}`]);
  existingFile(installedExecutable, 'installed v1.7.3 executable');
  assert.equal(executableVersion(installedExecutable), SOURCE_VERSION);
  const v173Metadata = packagedMetadata(installedAsar);
  assert.equal(v173Metadata.version, SOURCE_VERSION);
  const v173AllowsUnsigned = v173Metadata.whitebox?.distributionChannel === 'internal'
    && v173Metadata.whitebox?.allowUnsignedWindowsUpdates === true;
  assert.equal(v173AllowsUnsigned, true, 'Packaged v1.7.3 unsigned update policy changed.');

  const v173ModuleDir = path.join(testRoot, 'v173-packaged-src');
  extractModuleTree(installedAsar, v173ModuleDir, [
    'diagnostics.js',
    'macUpdateHelper.js',
    'updateInstaller.js',
    'updateManager.js',
  ]);
  const v173InstallerModule = require(path.join(v173ModuleDir, 'updateInstaller.js'));
  const v173UpdaterModule = require(path.join(v173ModuleDir, 'updateManager.js'));
  const firstDownloadsDir = path.join(testRoot, 'v173-first-hop-downloads');
  fs.mkdirSync(firstDownloadsDir, { recursive: true });
  const downloadedTarget = await downloadWithV173Updater(v173UpdaterModule, firstDownloadsDir);

  const v173ParentPid = await startInstalledApp();
  activeAppPid = v173ParentPid;
  let firstLaunch = null;
  try {
    firstLaunch = await launchPackagedInstaller(v173InstallerModule, {
      installerPath: downloadedTarget,
      downloadsDir: firstDownloadsDir,
      parentPid: v173ParentPid,
      allowUnsignedWindowsUpdates: v173AllowsUnsigned,
    });
    assert.equal(processAlive(v173ParentPid), true, 'The frozen helper did not wait for its real v1.7.3 parent.');
    assert.equal(executableVersion(installedExecutable), SOURCE_VERSION, 'The target installer ran before v1.7.3 exited.');
    // Close the real packaged window so v1.7.3 runs window-all-closed and its
    // asynchronous Electron before-quit cleanup. A forced taskkill here would
    // hide field failures where the frozen bootstrap's 10-second deadline
    // collides with application shutdown.
    closeInstalledAppGracefully(v173ParentPid);
  } finally {
    if (processAlive(v173ParentPid)) stopProcessTree(v173ParentPid);
    activeAppPid = 0;
  }
  assert(firstLaunch, 'The v1.7.3 packaged updater did not launch its helper.');
  await waitForProcessExit(v173ParentPid);
  activeAppPid = await finishFrozenFirstHop(firstLaunch, v173ParentPid);
  assert.equal(processAlive(activeAppPid), true);

  const targetMetadata = await waitForInstalledPackage(targetVersion);
  const targetAllowsUnsigned = targetMetadata.whitebox?.distributionChannel === 'internal'
    && targetMetadata.whitebox?.allowUnsignedWindowsUpdates === true;
  assert.equal(targetAllowsUnsigned, true, 'Freshly packaged target cannot perform the unsigned CI reinstall.');
  const targetModuleDir = path.join(testRoot, 'target-packaged-src');
  extractModuleTree(installedAsar, targetModuleDir, [
    'diagnostics.js',
    'macUpdateHelper.js',
    'updateInstaller.js',
    'updateManager.js',
  ]);
  const targetInstallerModule = require(path.join(targetModuleDir, 'updateInstaller.js'));
  require(path.join(targetModuleDir, 'updateManager.js'));
  assert.equal(typeof targetInstallerModule.waitForUpdateBootstrapExit, 'function', 'The target package lacks bootstrap acknowledgement support.');

  const reinstallDownloadsDir = path.join(testRoot, 'target-reinstall-downloads');
  fs.mkdirSync(reinstallDownloadsDir, { recursive: true });
  const reinstallInstaller = path.join(reinstallDownloadsDir, targetInstallerName);
  fs.copyFileSync(targetInstaller, reinstallInstaller);
  assert.equal(sha256(reinstallInstaller), sha256(downloadedTarget), 'The no-delay reinstall did not use the same target installer bytes.');

  const reinstallParentPid = activeAppPid;
  let reinstallLaunch = null;
  try {
    reinstallLaunch = await launchPackagedInstaller(targetInstallerModule, {
      installerPath: reinstallInstaller,
      downloadsDir: reinstallDownloadsDir,
      parentPid: reinstallParentPid,
      allowUnsignedWindowsUpdates: targetAllowsUnsigned,
      captureBootstrapAck: true,
    });
    assert.equal(fs.existsSync(reinstallLaunch.bootstrapPath), false, 'The target updater returned before bootstrap acknowledgement.');
    assert.equal(fs.existsSync(reinstallLaunch.integrationReadyPath), false, 'The target updater did not remove the helper-ready file after both consumers acknowledged it.');
    assert.deepStrictEqual(linesStarting(logLines(reinstallLaunch.logPath), 'bootstrapError='), []);
    assert.equal(processAlive(reinstallParentPid), true, 'The target helper did not wait for its real parent.');
    assert.equal(processAlive(reinstallLaunch.integrationHelperPid), true, 'The acknowledged target helper exited before parent shutdown.');
    assert.equal(executableVersion(installedExecutable), targetVersion, 'The reinstall began before bootstrap acknowledgement and parent shutdown.');
    closeInstalledAppGracefully(reinstallParentPid);
  } finally {
    if (processAlive(reinstallParentPid)) stopProcessTree(reinstallParentPid);
    activeAppPid = 0;
  }
  assert(reinstallLaunch, 'The target packaged updater did not launch its acknowledged helper.');
  await waitForProcessExit(reinstallParentPid);

  activeAppPid = await waitForRelaunchLog(reinstallLaunch.logPath, targetVersion);
  await waitForInstalledPackage(targetVersion);
  await waitForUpdateArtifactCleanup(reinstallLaunch);
  const reinstallLines = assertCompletedInstall(reinstallLaunch.logPath, {
    parentPid: reinstallParentPid,
    expectedVersion: targetVersion,
  });
  assert.equal(linesStarting(reinstallLines, 'relaunchStarted=').length, 1, 'The no-delay reinstall relaunched more than once.');
  assert.equal(processAlive(activeAppPid), true);

  console.log(`✓ Official Whitebox ${SOURCE_VERSION} updated to ${targetVersion}; the packaged target updater then acknowledged bootstrap and reinstalled/relaunched the same target exactly once without delay.`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  try {
    for (const pid of runningProcessIds(installedExecutable)) stopProcessTree(pid);
  } catch (error) {
    console.warn(`Could not enumerate integration app processes during cleanup: ${error.message}`);
  }
  const uninstaller = path.join(installDir, 'Uninstall Whitebox.exe');
  if (fs.existsSync(uninstaller)) {
    const uninstallResult = spawnSync(uninstaller, ['/S', '/currentuser'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000,
    });
    if (uninstallResult.error || uninstallResult.status !== 0) {
      console.error([
        `Integration uninstaller cleanup failed (${uninstallResult.status ?? 'spawn error'}).`,
        uninstallResult.error && uninstallResult.error.stack,
        uninstallResult.stdout,
        uninstallResult.stderr,
      ].filter(Boolean).join('\n'));
      process.exitCode = 1;
    }
  }
  asar.uncacheAll();
  fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
});
