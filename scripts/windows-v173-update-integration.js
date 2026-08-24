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
const { cohortList, readCohortManifest } = require('./check-update-compatibility-cohorts');

if (process.platform !== 'win32') {
  console.log('Windows frozen-client update integration skipped: win32 only.');
  process.exit(0);
}
const disposableGithubRunner = process.env.GITHUB_ACTIONS === 'true'
  && process.env.RUNNER_ENVIRONMENT === 'github-hosted';
if (!disposableGithubRunner
  && process.env.WHITEBOX_ALLOW_FROZEN_UPDATE_INTEGRATION !== 'true'
  && process.env.WHITEBOX_ALLOW_V173_UPDATE_INTEGRATION !== 'true') {
  throw new Error('Refusing to modify the real per-user installer registry outside a disposable GitHub-hosted runner. Set WHITEBOX_ALLOW_FROZEN_UPDATE_INTEGRATION=true only in an isolated Windows environment.');
}

const SOURCE_COHORT_LIST = Object.freeze(cohortList(readCohortManifest()));
const SOURCE_COHORTS = Object.freeze(Object.fromEntries(
  SOURCE_COHORT_LIST.map(cohort => [
    cohort.version,
    Object.freeze({
      installerName: path.posix.basename(new URL(cohort.url).pathname),
      installerSize: cohort.size,
      installerSha256: cohort.sha256,
      installerEnv: cohort.env,
      installMode: cohort.installMode,
    }),
  ]),
));
const SOURCE_VERSION = String(process.env.WHITEBOX_FROZEN_VERSION || SOURCE_COHORT_LIST[0].version).trim();
const sourceCohort = SOURCE_COHORTS[SOURCE_VERSION];
if (!sourceCohort) throw new Error(`Unsupported frozen Whitebox cohort: ${SOURCE_VERSION}`);
const SOURCE_INSTALLER_NAME = sourceCohort.installerName;
const SOURCE_INSTALLER_SIZE = sourceCohort.installerSize;
const SOURCE_INSTALLER_SHA256 = sourceCohort.installerSha256;
const targetVersion = String(sourcePackageMetadata.version || '').trim();
const targetInstallerName = `Whitebox-Setup-${targetVersion}.exe`;
const manualBridgeInstallerName = `Whitebox-Manual-Setup-${targetVersion}-x64.exe`;
const sourceInstaller = path.resolve(String(process.env[sourceCohort.installerEnv] || ''));
const targetInstaller = path.resolve(String(process.env.WHITEBOX_CURRENT_INSTALLER || ''));
const manualBridgeInstaller = path.resolve(String(process.env.WHITEBOX_MANUAL_INSTALLER || ''));
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-v173-update-integration-'));
const installDir = path.join(testRoot, 'installed-whitebox');
const installedExecutable = path.join(installDir, 'Whitebox.exe');
const installedAsar = path.join(installDir, 'resources', 'app.asar');
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const updateInstallerPaths = new Set();
const trackedUpdateProcesses = new Map();
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

function stopProcessesAtExactPath(executable, label) {
  for (const pid of runningProcessIds(executable)) stopProcessTree(pid);
  const remaining = runningProcessIds(executable);
  if (remaining.length) throw new Error(`${label} processes remained after cleanup: ${remaining.join(',')}`);
}

function processCommandReferences(pid, file) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !file) return false;
  const script = [
    "$ErrorActionPreference = 'Stop';",
    "$process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $env:WHITEBOX_INTEGRATION_PID) -ErrorAction Stop;",
    'if ($process -and -not [string]::IsNullOrWhiteSpace([string]$process.CommandLine) -and',
    "    ([string]$process.CommandLine).IndexOf($env:WHITEBOX_INTEGRATION_COMMAND_PATH, [StringComparison]::OrdinalIgnoreCase) -ge 0) { [Console]::Write('match') }",
    "else { [Console]::Write('no-match') }",
  ].join(' ');
  const output = run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: {
      ...process.env,
      WHITEBOX_INTEGRATION_PID: String(pid),
      WHITEBOX_INTEGRATION_COMMAND_PATH: file,
    },
    timeout: 30_000,
  }).stdout.trim();
  if (output !== 'match' && output !== 'no-match') throw new Error(`Unexpected updater process lookup result: ${output}`);
  return output === 'match';
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

function dumpUpdateLogs(directory) {
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_missingDirectory) { return; }
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) dumpUpdateLogs(candidate);
    else if (entry.isFile() && entry.name === 'install-update.log') {
      console.error(`--- ${candidate} ---\n${readLog(candidate) || '(empty update log)'}`);
    }
  }
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
  assert.deepStrictEqual(relaunchPaths, [expectedRelaunchPath], 'The helper did not resolve the custom-path installed executable.');
  assert.equal(lines.includes(`candidate=${installedExecutable};version=${options.expectedVersion}`), true, 'The helper never found the expected custom-path candidate.');
  assert.deepStrictEqual(linesStarting(lines, 'bootstrapError='), [], 'The bootstrap did not acknowledge the helper-ready signal.');
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
    launched.helperPidPath,
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

async function waitForInstalledPackage(expectedVersion, timeoutMs = 120_000, stableChecksRequired = 3) {
  const startedAt = Date.now();
  const requiredChecks = Math.max(1, Number(stableChecksRequired) || 3);
  let stableChecks = 0;
  let lastVersion = '';
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastVersion = executableVersion(installedExecutable);
      const metadata = packagedMetadata(installedAsar);
      if (lastVersion === expectedVersion && metadata.version === expectedVersion) {
        stableChecks += 1;
        if (stableChecks >= requiredChecks) return metadata;
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

async function startInstalledApp(expectedVersion) {
  const rendererReadyToken = crypto.randomBytes(24).toString('hex');
  const rendererReadyPath = path.join(testRoot, `install-renderer-ready-${rendererReadyToken}.json`);
  const child = spawn(installedExecutable, [], {
    env: {
      ...process.env,
      WHITEBOX_UPDATE_READY_PATH: rendererReadyPath,
      WHITEBOX_UPDATE_READY_TOKEN: rendererReadyToken,
    },
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    try {
      const signal = JSON.parse(fs.readFileSync(rendererReadyPath, 'utf8').replace(/^\uFEFF/, '').trim());
      if (signal.token === rendererReadyToken
        && Number(signal.pid) === child.pid
        && signal.version === expectedVersion
        && String(signal.rendererReadyAt || '').trim()) {
        fs.rmSync(rendererReadyPath, { force: true });
        return child.pid;
      }
    } catch (_notReady) {}
    if (child.exitCode !== null) throw new Error(`Installed app exited before renderer readiness (${child.exitCode}).`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Installed app did not report renderer readiness for ${expectedVersion}: ${child.pid}`);
}

async function downloadWithFrozenUpdater(updaterModule, downloadsDir) {
  const selectedInstaller = sourceCohort.installMode === 'manual' ? manualBridgeInstaller : targetInstaller;
  const selectedInstallerName = sourceCohort.installMode === 'manual' ? manualBridgeInstallerName : targetInstallerName;
  const digest = `sha256:${sha256(selectedInstaller)}`;
  const size = fs.statSync(selectedInstaller).size;
  const releaseAsset = name => ({
    name,
    size,
    state: 'uploaded',
    digest,
    browser_download_url: `https://github.com/minjund/Whitebox/releases/download/v${targetVersion}/${name}`,
  });
  const canonicalAsset = releaseAsset(targetInstallerName);
  const portableAsset = releaseAsset(`Whitebox-${targetVersion}-portable.exe`);
  const manualBridgeAsset = releaseAsset(manualBridgeInstallerName);
  const release = {
    tag_name: `v${targetVersion}`,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/minjund/Whitebox/releases/tag/v${targetVersion}`,
    published_at: '2026-08-24T00:00:00.000Z',
    body: `Windows ${SOURCE_VERSION} packaged update integration fixture`,
    assets: [canonicalAsset, portableAsset, manualBridgeAsset],
  };
  const fetch = async url => {
    if (String(url) === updaterModule.RELEASE_API) {
      const body = Buffer.from(JSON.stringify(release));
      return new Response(body, {
        status: 200,
        headers: { 'content-length': String(body.length), 'content-type': 'application/json' },
      });
    }
    const selectedUrl = sourceCohort.installMode === 'manual'
      ? manualBridgeAsset.browser_download_url
      : canonicalAsset.browser_download_url;
    if (String(url) === selectedUrl) {
      return new Response(Readable.toWeb(fs.createReadStream(selectedInstaller)), {
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
  if (compareVersions(targetVersion, SOURCE_VERSION) === 0) {
    assert.equal(checked.status, 'current', 'A fixed cohort must not offer the same public version as an update.');
    const selected = updaterModule.selectReleaseAsset(release.assets, {
      platform: 'win32',
      arch: 'x64',
      version: targetVersion,
    });
    assert.equal(selected && selected.name, selectedInstallerName);
    const destination = path.join(downloadsDir, selectedInstallerName);
    fs.copyFileSync(selectedInstaller, destination);
    return destination;
  }
  assert.equal(checked.status, 'available');
  assert.equal(checked.asset && checked.asset.name, selectedInstallerName);
  assert.equal(checked.asset && checked.asset.digest, digest);
  const downloaded = await updater.download();
  assert.equal(downloaded.status, 'downloaded');
  existingFile(downloaded.downloadedPath, `v${SOURCE_VERSION} updater download`);
  assert.equal(sha256(downloaded.downloadedPath), digest.slice('sha256:'.length));
  return downloaded.downloadedPath;
}

async function launchPackagedInstaller(installerModule, options) {
  let helperCallbackCount = 0;
  let helperPid = 0;
  let bootstrapChild = null;
  let capturedLogPath = '';
  let capturedHelperPidPath = '';
  let capturedReadyPath = '';
  let capturedReadyToken = '';
  let capturedHelperPath = '';
  const wrappedSpawn = (command, args, spawnOptions) => {
    const valueAfter = name => {
      const index = args.indexOf(name);
      return index >= 0 ? String(args[index + 1] || '') : '';
    };
    bootstrapChild = spawn(command, args, spawnOptions);
    capturedLogPath = valueAfter('-LogPath');
    capturedHelperPidPath = valueAfter('-HelperPidPath');
    capturedReadyPath = valueAfter('-ReadyPath');
    capturedReadyToken = valueAfter('-RendererReadyToken');
    capturedHelperPath = valueAfter('-HelperPath');
    const bootstrapPath = valueAfter('-File');
    if (Number.isSafeInteger(bootstrapChild.pid) && bootstrapChild.pid > 0 && bootstrapPath) {
      trackedUpdateProcesses.set(bootstrapChild.pid, bootstrapPath);
    }
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
    spawn: wrappedSpawn,
    beforeAutomaticInstall: context => {
      helperCallbackCount += 1;
      helperPid = Number(context && context.helperPid || 0);
      if (Number.isSafeInteger(helperPid) && helperPid > 0 && capturedHelperPath) {
        trackedUpdateProcesses.set(helperPid, capturedHelperPath);
      }
      if (options.captureBootstrapAck) {
        assert(bootstrapChild, 'The target updater did not expose its real bootstrap process.');
        assert.equal(bootstrapChild.exitCode, 0, 'The shutdown boundary ran before bootstrap exit code 0.');
        assert.equal(bootstrapChild.signalCode, null, 'The bootstrap was signaled before acknowledgement.');
        const signal = JSON.parse(fs.readFileSync(capturedReadyPath, 'utf8').replace(/^\uFEFF/, '').trim());
        assert.equal(signal.token, capturedReadyToken);
        assert.equal(Number(signal.helperPid), helperPid);
        const helperIdentity = JSON.parse(fs.readFileSync(capturedHelperPidPath, 'utf8').replace(/^\uFEFF/, '').trim());
        assert.deepStrictEqual(helperIdentity, signal, 'The bootstrap helper PID sidecar did not authenticate the acknowledged helper.');
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
    integrationHelperPidPath: capturedHelperPidPath,
    integrationReadyPath: capturedReadyPath,
    integrationHelperPid: helperPid,
  };
}

async function main() {
  assert.match(targetVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(compareVersions(targetVersion, '1.7.4') > 0, true, 'The handshake fix must ship at a SemVer version newer than the already-published v1.7.4.');
  assert.equal(path.basename(sourceInstaller), SOURCE_INSTALLER_NAME);
  assert.equal(path.basename(targetInstaller), targetInstallerName);
  assert.equal(path.basename(manualBridgeInstaller), manualBridgeInstallerName);
  assert.equal(existingFile(sourceInstaller, `official v${SOURCE_VERSION} installer`).size, SOURCE_INSTALLER_SIZE);
  existingFile(targetInstaller, `freshly built ${targetInstallerName}`);
  existingFile(manualBridgeInstaller, `freshly prepared ${manualBridgeInstallerName}`);
  assert.equal(sha256(manualBridgeInstaller), sha256(targetInstaller), 'The public manual bridge alias must contain the verified NSIS installer bytes.');
  assert.equal(sha256(sourceInstaller), SOURCE_INSTALLER_SHA256, `The official v${SOURCE_VERSION} installer digest changed.`);

  process.env.WHITEBOX_DEMO_CAPTURE = '1';
  process.env.WHITEBOX_TEST_INSTANCE = '1';

  // This direct installer execution establishes the immutable frozen-client baseline.
  run(sourceInstaller, ['/S', '/currentuser', `/D=${installDir}`]);
  existingFile(installedExecutable, `installed v${SOURCE_VERSION} executable`);
  assert.equal(executableVersion(installedExecutable), SOURCE_VERSION);
  const v173Metadata = packagedMetadata(installedAsar);
  assert.equal(v173Metadata.version, SOURCE_VERSION);
  const v173AllowsUnsigned = v173Metadata.whitebox?.distributionChannel === 'internal'
    && v173Metadata.whitebox?.allowUnsignedWindowsUpdates === true;
  assert.equal(v173AllowsUnsigned, true, `Packaged v${SOURCE_VERSION} unsigned update policy changed.`);

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
  const downloadedTarget = await downloadWithFrozenUpdater(v173UpdaterModule, firstDownloadsDir);
  updateInstallerPaths.add(downloadedTarget);

  const v173ParentPid = await startInstalledApp(SOURCE_VERSION);
  activeAppPid = v173ParentPid;
  if (sourceCohort.installMode === 'manual') {
    let openedInstaller = '';
    try {
      const firstLaunch = await v173InstallerModule.launchDownloadedUpdate({
        installerPath: downloadedTarget,
        downloadsDir: firstDownloadsDir,
        platform: 'win32',
        installType: 'desktop',
        appPath: installedExecutable,
        expectedVersion: targetVersion,
        parentPid: v173ParentPid,
        allowUnsignedWindowsUpdates: v173AllowsUnsigned,
        environment: process.env,
        shell: {
          openPath: async installerPath => {
            openedInstaller = path.resolve(installerPath);
            return '';
          },
        },
        beforeAutomaticInstall: () => {
          throw new Error('The frozen client incorrectly entered its racy automatic installer path.');
        },
      });
      assert.equal(firstLaunch.mode, 'manual', 'The frozen client did not bypass its shared ready-file bootstrap.');
      assert.equal(openedInstaller, path.resolve(downloadedTarget), 'The frozen client opened an unexpected installer.');
      assert.equal(processAlive(v173ParentPid), true, `The manual bridge unexpectedly quit v${SOURCE_VERSION} before the installer UI opened.`);
      assert.equal(executableVersion(installedExecutable), SOURCE_VERSION, 'The manual bridge installed before the user completed its installer UI.');
      assert.deepStrictEqual(
        fs.readdirSync(firstDownloadsDir).filter(name => /^install-update.*\.ps1$/i.test(name)),
        [],
        'The manual bridge created the frozen automatic bootstrap scripts.',
      );
      closeInstalledAppGracefully(v173ParentPid);
    } finally {
      if (processAlive(v173ParentPid)) stopProcessTree(v173ParentPid);
      activeAppPid = 0;
    }
    await waitForProcessExit(v173ParentPid);
    assert.deepStrictEqual(runningProcessIds(installedExecutable), [], `The v${SOURCE_VERSION} app remained live before manual installer completion.`);
    run(downloadedTarget, ['/S', '/currentuser', `/D=${installDir}`]);
    await waitForInstalledPackage(targetVersion, 120_000, 8);
    activeAppPid = await startInstalledApp(targetVersion);
    assert.equal(processAlive(activeAppPid), true);
    console.log(`✓ Frozen Whitebox ${SOURCE_VERSION} selected and opened the verified manual installer bridge without creating its racy bootstrap.`);
  } else {
    let firstLaunch = null;
    try {
      firstLaunch = await launchPackagedInstaller(v173InstallerModule, {
        installerPath: downloadedTarget,
        downloadsDir: firstDownloadsDir,
        parentPid: v173ParentPid,
        allowUnsignedWindowsUpdates: v173AllowsUnsigned,
        captureBootstrapAck: true,
      });
      assert.equal(processAlive(v173ParentPid), true, 'The fixed source helper did not wait for its parent.');
      closeInstalledAppGracefully(v173ParentPid);
    } finally {
      if (processAlive(v173ParentPid)) stopProcessTree(v173ParentPid);
      activeAppPid = 0;
    }
    assert(firstLaunch, 'The fixed official cohort did not launch the automatic installer helper.');
    await waitForProcessExit(v173ParentPid);
    activeAppPid = await waitForRelaunchLog(firstLaunch.logPath, targetVersion);
    await waitForInstalledPackage(targetVersion, 120_000, 8);
    await waitForUpdateArtifactCleanup(firstLaunch);
    assertCompletedInstall(firstLaunch.logPath, { parentPid: v173ParentPid, expectedVersion: targetVersion });
    console.log(`✓ Fixed Whitebox ${SOURCE_VERSION} selected canonical Setup and completed the authenticated automatic installer handshake.`);
  }

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
  const targetUpdaterModule = require(path.join(targetModuleDir, 'updateManager.js'));
  assert.equal(typeof targetInstallerModule.waitForUpdateBootstrapExit, 'function', 'The target package lacks bootstrap acknowledgement support.');
  const releaseBase = `https://github.com/minjund/Whitebox/releases/download/v${targetVersion}/`;
  const fixedSelection = targetUpdaterModule.selectReleaseAsset([
    { name: manualBridgeInstallerName, state: 'uploaded', browser_download_url: `${releaseBase}${manualBridgeInstallerName}` },
    { name: targetInstallerName, state: 'uploaded', browser_download_url: `${releaseBase}${targetInstallerName}` },
  ], { platform: 'win32', arch: 'x64', version: targetVersion });
  assert.equal(fixedSelection && fixedSelection.name, targetInstallerName, 'The fixed updater selected the frozen-client manual bridge instead of canonical automatic Setup.');

  const reinstallDownloadsDir = path.join(testRoot, 'target-reinstall-downloads');
  fs.mkdirSync(reinstallDownloadsDir, { recursive: true });
  const reinstallInstaller = path.join(reinstallDownloadsDir, targetInstallerName);
  fs.copyFileSync(targetInstaller, reinstallInstaller);
  updateInstallerPaths.add(reinstallInstaller);
  assert.equal(sha256(reinstallInstaller), sha256(targetInstaller), 'The no-delay reinstall did not use the same target installer bytes.');

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
    assert.equal(fs.existsSync(reinstallLaunch.integrationHelperPidPath), false, 'The target updater did not remove the authenticated helper PID sidecar.');
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

  console.log(`✓ Official Whitebox ${SOURCE_VERSION} reached ${targetVersion} through its packaged ${sourceCohort.installMode} path; the candidate updater then acknowledged bootstrap and reinstalled/relaunched the same target exactly once.`);
}

main().catch(error => {
  console.error(error.stack || error);
  dumpUpdateLogs(testRoot);
  process.exitCode = 1;
}).finally(() => {
  for (const [pid, commandPath] of trackedUpdateProcesses) {
    try {
      if (processCommandReferences(pid, commandPath)) stopProcessTree(pid);
    } catch (error) {
      console.error(`Could not stop a tracked integration updater process during cleanup: ${error.message}`);
      process.exitCode = 1;
    }
  }
  for (const [pid, commandPath] of trackedUpdateProcesses) {
    if (!processCommandReferences(pid, commandPath)) continue;
    console.error(`A tracked integration updater process remained after cleanup: ${pid} (${commandPath})`);
    process.exitCode = 1;
  }
  for (const installerPath of updateInstallerPaths) {
    try {
      stopProcessesAtExactPath(installerPath, 'Integration installer');
    } catch (error) {
      console.error(`Could not stop integration installer processes during cleanup: ${error.message}`);
      process.exitCode = 1;
    }
  }
  try {
    stopProcessesAtExactPath(installedExecutable, 'Integration app');
  } catch (error) {
    console.error(`Could not stop integration app processes during cleanup: ${error.message}`);
    process.exitCode = 1;
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
  try {
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (error) {
    console.error(`Integration temporary directory cleanup failed: ${error.stack || error}`);
    process.exitCode = 1;
  }
});
