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
const {
  assertCompleteReleaseAssetSet,
  assertReleaseAssetSelections,
  fixtureReleaseAssets,
  releaseAssetUrl,
  selectionDecoys,
} = require('./release-asset-contract');

if (process.platform !== 'win32') {
  console.log('Windows legacy update bridge integration skipped: win32 only.');
  process.exit(0);
}
const disposableGithubRunner = process.env.GITHUB_ACTIONS === 'true'
  && process.env.RUNNER_ENVIRONMENT === 'github-hosted';
if (!disposableGithubRunner && process.env.WHITEBOX_ALLOW_LEGACY_INSTALL_INTEGRATION !== 'true') {
  throw new Error('Refusing to modify the real per-user installer registry outside disposable CI. Set WHITEBOX_ALLOW_LEGACY_INSTALL_INTEGRATION=true only in an isolated Windows environment.');
}

const V163_INSTALLER_SHA256 = 'e38c38698335c2eec4aef8c6da6f1629470addaff1b881fe961172644c86db0f';
const V163_INSTALLER_SIZE = 92488826;
const V163_INSTALLER_NAME = 'LoadToAgent-Setup-1.6.3.exe';
const V1623_INSTALLER_SHA256 = '29e90370acd3a6f00d3da4a82a79045cf235e716dcccbbf34b2d2b4db9f4e112';
const V1623_INSTALLER_SIZE = 94506459;
const V1623_INSTALLER_NAME = 'LoadToAgent-Setup-1.6.23.exe';
const CANDIDATE_E2E = process.env.WHITEBOX_LEGACY_CANDIDATE_E2E === 'true';
const CURRENT_VERSION = CANDIDATE_E2E ? String(sourcePackageMetadata.version || '').trim() : '1.7.4';
const CURRENT_INSTALLER_SHA256 = CANDIDATE_E2E
  ? String(process.env.WHITEBOX_CURRENT_INSTALLER_SHA256 || '').trim().toLowerCase().replace(/^sha256:/, '')
  : '4d940cf16425436922a37746417b419c7671c47642c0f24b8c79197af99c2135';
const CURRENT_INSTALLER_SIZE = CANDIDATE_E2E
  ? Number(process.env.WHITEBOX_CURRENT_INSTALLER_SIZE)
  : 85296425;
const bridgeVersion = bridgeConfig.extraMetadata.version;
const releaseDir = path.resolve(process.env.WHITEBOX_LEGACY_BRIDGE_RELEASE_DIR
  || path.join(__dirname, '..', bridgeConfig.directories.output));
const sourceInstaller = path.resolve(String(process.env.WHITEBOX_V163_INSTALLER || ''));
const currentInstaller = path.resolve(String(process.env.WHITEBOX_CURRENT_INSTALLER || ''));
const manualInstallerInput = String(process.env.WHITEBOX_MANUAL_INSTALLER || '').trim();
const manualInstaller = path.resolve(manualInstallerInput);
const officialBridgeInput = String(process.env.WHITEBOX_V1623_INSTALLER || '').trim();
const bridgeInstaller = CANDIDATE_E2E
  ? path.resolve(officialBridgeInput)
  : path.join(releaseDir, `LoadToAgent-Setup-${bridgeVersion}.exe`);
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-legacy-bridge-integration-'));
const isolatedProfileRoot = path.join(testRoot, 'isolated-profile');
const isolatedAppDataRoot = path.join(isolatedProfileRoot, 'AppData', 'Roaming');
const isolatedLocalAppDataRoot = path.join(isolatedProfileRoot, 'AppData', 'Local');
const inheritedUserDataDir = path.join(isolatedAppDataRoot, 'Whitebox');
const directUserDataDir = path.join(isolatedLocalAppDataRoot, 'direct-electron-user-data');
const directUserDataArgument = `--user-data-dir=${directUserDataDir}`;
const isolatedBridgeHome = path.join(testRoot, 'isolated-bridge-home');
const installDir = path.join(testRoot, 'installed-v163');
const legacyExecutable = path.join(installDir, 'LoadToAgent.exe');
const currentExecutable = path.join(installDir, 'Whitebox.exe');
const uninstallRegistryKeyName = String(bridgeConfig.nsis?.guid || '').trim();
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const downloadedInstallerPaths = new Set();
const launchedUpdates = [];
let relaunchedPid = 0;
let installationStarted = false;
let uninstallerAttemptCount = 0;
let validUninstallerRunCount = 0;

function pathIsWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertPathWithin(root, candidate, label) {
  assert.equal(pathIsWithin(root, candidate), true, `${label} escaped ${root}: ${candidate}`);
}

function prepareIsolatedProfileEnvironment() {
  for (const [label, candidate] of [
    ['isolated profile root', isolatedProfileRoot],
    ['isolated APPDATA root', isolatedAppDataRoot],
    ['isolated LOCALAPPDATA root', isolatedLocalAppDataRoot],
    ['updater-inherited Electron user-data directory', inheritedUserDataDir],
    ['direct Electron user-data directory', directUserDataDir],
    ['isolated bridge home', isolatedBridgeHome],
  ]) {
    assertPathWithin(testRoot, candidate, label);
  }
  assert.notEqual(path.resolve(isolatedAppDataRoot).toLowerCase(), path.resolve(isolatedLocalAppDataRoot).toLowerCase(),
    'APPDATA and LOCALAPPDATA isolation roots must be distinct.');
  assert.equal(fs.existsSync(inheritedUserDataDir), false,
    'The updater-inherited Whitebox profile must begin absent for every legacy attempt.');
  assert.equal(fs.existsSync(directUserDataDir), false, 'The direct Electron profile must begin absent for every legacy attempt.');
  fs.mkdirSync(isolatedAppDataRoot, { recursive: true });
  fs.mkdirSync(isolatedLocalAppDataRoot, { recursive: true });
  fs.mkdirSync(isolatedBridgeHome, { recursive: true });
  for (const [label, candidate] of [
    ['isolated APPDATA root', isolatedAppDataRoot],
    ['isolated LOCALAPPDATA root', isolatedLocalAppDataRoot],
    ['isolated bridge home', isolatedBridgeHome],
  ]) {
    const state = fs.lstatSync(candidate);
    assert.equal(state.isDirectory() && !state.isSymbolicLink(), true, `${label} must be a real directory: ${candidate}`);
    assertPathWithin(fs.realpathSync(testRoot), fs.realpathSync(candidate), `${label} real path`);
    assert.deepStrictEqual(fs.readdirSync(candidate), [], `${label} was not fresh: ${candidate}`);
  }
  process.env.APPDATA = isolatedAppDataRoot;
  process.env.LOCALAPPDATA = isolatedLocalAppDataRoot;
  process.env.WHITEBOX_BRIDGE_HOME = isolatedBridgeHome;
  process.env.LOADTOAGENT_BRIDGE_HOME = isolatedBridgeHome;
}

function assertIsolatedProfileEnvironment(label) {
  assert.equal(path.resolve(String(process.env.APPDATA || '')).toLowerCase(), path.resolve(isolatedAppDataRoot).toLowerCase(),
    `${label}: APPDATA no longer points at the attempt-local root.`);
  assert.equal(path.resolve(String(process.env.LOCALAPPDATA || '')).toLowerCase(), path.resolve(isolatedLocalAppDataRoot).toLowerCase(),
    `${label}: LOCALAPPDATA no longer points at the attempt-local root.`);
  assert.equal(path.resolve(String(process.env.WHITEBOX_BRIDGE_HOME || '')).toLowerCase(), path.resolve(isolatedBridgeHome).toLowerCase(),
    `${label}: WHITEBOX_BRIDGE_HOME no longer points at the attempt-local root.`);
  assert.equal(path.resolve(String(process.env.LOADTOAGENT_BRIDGE_HOME || '')).toLowerCase(), path.resolve(isolatedBridgeHome).toLowerCase(),
    `${label}: LOADTOAGENT_BRIDGE_HOME no longer points at the attempt-local root.`);
  assertPathWithin(testRoot, process.env.APPDATA, `${label} APPDATA`);
  assertPathWithin(testRoot, process.env.LOCALAPPDATA, `${label} LOCALAPPDATA`);
  assertPathWithin(testRoot, process.env.WHITEBOX_BRIDGE_HOME, `${label} WHITEBOX_BRIDGE_HOME`);
  assertPathWithin(testRoot, process.env.LOADTOAGENT_BRIDGE_HOME, `${label} LOADTOAGENT_BRIDGE_HOME`);
  const bridgeHomeState = fs.lstatSync(isolatedBridgeHome, { throwIfNoEntry: false });
  assert(bridgeHomeState && bridgeHomeState.isDirectory() && !bridgeHomeState.isSymbolicLink(),
    `${label}: isolated bridge home is not a real directory.`);
  assertPathWithin(fs.realpathSync(testRoot), fs.realpathSync(isolatedBridgeHome), `${label} isolated bridge home real path`);
}

function userDataReferences(commandLine) {
  const references = [];
  const pattern = /"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s"]+)|--user-data-dir\s+"([^"]+)"|--user-data-dir\s+([^\s"]+)/gi;
  let match;
  while ((match = pattern.exec(String(commandLine || ''))) !== null) {
    references.push(match.slice(1).find(Boolean));
  }
  return references;
}

function runningInstalledAppCommandLines() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$directory = [IO.Path]::GetFullPath($env:WHITEBOX_INTEGRATION_INSTALL_DIR).TrimEnd([char]92) + [char]92',
    '$records = @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {',
    '  $executablePath = [string]$_.ExecutablePath',
    '  if (-not [string]::IsNullOrWhiteSpace($executablePath) -and',
    '      $executablePath.StartsWith($directory, [StringComparison]::OrdinalIgnoreCase)) {',
    '    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_.CommandLine))',
    '    ([string]$_.ProcessId) + "|" + $encoded',
    '  }',
    '})',
    '[Console]::Write((@($records | Sort-Object -Unique) -join "`n"))',
  ].join('\n');
  const output = run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, WHITEBOX_INTEGRATION_INSTALL_DIR: installDir },
    timeout: 30_000,
  }).stdout.trim();
  return output ? output.split(/\r?\n/).filter(Boolean).map(record => {
    const separator = record.indexOf('|');
    assert(separator > 0, `Unexpected installed-app command-line record: ${record}`);
    const pid = Number(record.slice(0, separator));
    assert(Number.isSafeInteger(pid) && pid > 0, `Unexpected installed-app PID record: ${record}`);
    return {
      pid,
      commandLine: Buffer.from(record.slice(separator + 1), 'base64').toString('utf8'),
    };
  }) : [];
}

function assertInstalledAppProfileIsolation(expectedPid, label, requireDirectProfile = false) {
  assertIsolatedProfileEnvironment(label);
  const records = runningInstalledAppCommandLines();
  const expectedRecord = records.find(record => record.pid === expectedPid);
  assert(expectedRecord, `${label}: installed app process ${expectedPid} was not observable for profile verification.`);
  for (const record of records) {
    const references = userDataReferences(record.commandLine);
    for (const reference of references) {
      const isExpectedRoot = pathIsWithin(isolatedAppDataRoot, reference)
        || pathIsWithin(isolatedLocalAppDataRoot, reference);
      assert.equal(isExpectedRoot, true,
        `${label}: process ${record.pid} references a user-data path outside the attempt roots: ${reference}`);
    }
    if (record.pid === expectedPid && requireDirectProfile) {
      assert.deepStrictEqual(
        references.map(reference => path.resolve(reference).toLowerCase()),
        [path.resolve(directUserDataDir).toLowerCase()],
        `${label}: directly spawned app did not use exactly the fresh explicit Electron profile.`,
      );
    }
  }
}

function assertProfileDirectoryUsed(directory, label) {
  const state = fs.lstatSync(directory, { throwIfNoEntry: false });
  assert(state && state.isDirectory() && !state.isSymbolicLink(), `${label} was not created as a real directory: ${directory}`);
  assertPathWithin(fs.realpathSync(testRoot), fs.realpathSync(directory), `${label} real path`);
  assert(fs.readdirSync(directory).length > 0, `${label} remained unused: ${directory}`);
  assertPathWithin(testRoot, directory, label);
}

async function waitForProfileDirectoryUsed(directory, label, child, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`${label} app exited before creating its isolated profile (${child.exitCode}).`);
    }
    try {
      assertProfileDirectoryUsed(directory, label);
      if (child.exitCode !== null) {
        throw new Error(`${label} app exited while its isolated profile was being verified (${child.exitCode}).`);
      }
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error([
    `${label} was not created and used within ${timeoutMs}ms: ${directory}`,
    lastError && (lastError.stack || lastError.message),
  ].filter(Boolean).join('\n'));
}

prepareIsolatedProfileEnvironment();

function existingFile(file, label) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.size <= 0) throw new Error(`${label} is missing or empty: ${file}`);
  return stat;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertStableVersion(version, label) {
  assert.match(String(version || ''), /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, `${label} must be stable SemVer.`);
}

function assertPinnedInstaller(file, expected, label) {
  assert.equal(path.basename(file), expected.name, `${label} filename changed.`);
  const stat = existingFile(file, label);
  assert.equal(stat.size, expected.size, `${label} byte size changed.`);
  assert.equal(sha256(file), expected.sha256, `${label} SHA-256 changed.`);
}

function completeCandidateReleaseAssets() {
  const canonicalName = `Whitebox-Setup-${CURRENT_VERSION}.exe`;
  const manualName = `Whitebox-Manual-Setup-${CURRENT_VERSION}-x64.exe`;
  const assets = fixtureReleaseAssets(CURRENT_VERSION).map(asset => {
    const file = asset.name === canonicalName
      ? currentInstaller
      : asset.name === manualName ? manualInstaller : '';
    if (!file) return asset;
    return {
      ...asset,
      size: fs.statSync(file).size,
      digest: `sha256:${sha256(file)}`,
      browser_download_url: releaseAssetUrl(CURRENT_VERSION, asset.name),
    };
  });
  return assertCompleteReleaseAssetSet(assets, CURRENT_VERSION);
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
  assert.equal(processAlive(pid), false, 'Installed app remained alive after graceful shutdown.');
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
    timeout: 30_000,
  }).stdout.trim();
  return output
    ? output.split(',').map(value => Number(value)).filter(Number.isSafeInteger)
    : [];
}

function runningProcessIdsReferencing(file) {
  if (!file) return [];
  const script = [
    "$ErrorActionPreference = 'Stop';",
    '$ids = @(Get-CimInstance Win32_Process -ErrorAction Stop |',
    '  Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.CommandLine) -and',
    '    ([string]$_.CommandLine).IndexOf($env:WHITEBOX_INTEGRATION_COMMAND_PATH, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |',
    '  ForEach-Object { [string]$_.ProcessId });',
    '[Console]::Write(($ids -join ","))',
  ].join(' ');
  const output = run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, WHITEBOX_INTEGRATION_COMMAND_PATH: file },
    timeout: 30_000,
  }).stdout.trim();
  return output
    ? output.split(',').map(value => Number(value)).filter(Number.isSafeInteger)
    : [];
}

function runningProcessesUnderDirectory(directory) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$directory = [IO.Path]::GetFullPath($env:WHITEBOX_INTEGRATION_INSTALL_DIR).TrimEnd([char]92) + [char]92',
    '$records = @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {',
    '  $executablePath = [string]$_.ExecutablePath',
    '  if (-not [string]::IsNullOrWhiteSpace($executablePath) -and',
    '      $executablePath.StartsWith($directory, [StringComparison]::OrdinalIgnoreCase)) {',
    '    ([string]$_.ProcessId) + "|" + $executablePath',
    '  }',
    '})',
    '[Console]::Write((@($records | Sort-Object -Unique) -join "`n"))',
  ].join('\n');
  const output = run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, WHITEBOX_INTEGRATION_INSTALL_DIR: directory },
    timeout: 30_000,
  }).stdout.trim();
  return output ? output.split(/\r?\n/).filter(Boolean).map(record => {
    const separator = record.indexOf('|');
    const pid = Number(separator >= 0 ? record.slice(0, separator) : '');
    if (!Number.isSafeInteger(pid) || pid <= 0 || separator < 0) {
      throw new Error(`Unexpected installed-path process record: ${record}`);
    }
    return { pid, executablePath: record.slice(separator + 1) };
  }) : [];
}

function stopProcessesUnderDirectory(directory, label) {
  for (const processRecord of runningProcessesUnderDirectory(directory)) stopProcessTree(processRecord.pid);
  const remaining = runningProcessesUnderDirectory(directory);
  if (remaining.length) {
    throw new Error(`${label} processes remained after cleanup: ${remaining.map(record => `${record.pid} (${record.executablePath})`).join(', ')}`);
  }
}

function perUserUninstallRegistryEntries() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$installDirectory = [IO.Path]::GetFullPath($env:WHITEBOX_INTEGRATION_INSTALL_DIR).TrimEnd([char]92)',
    '$expectedKeyName = $env:WHITEBOX_INTEGRATION_UNINSTALL_KEY',
    "$uninstallRootName = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'",
    '$records = @()',
    'foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {',
    '  $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)',
    '  try {',
    '    $uninstallRoot = $baseKey.OpenSubKey($uninstallRootName)',
    '    if ($null -eq $uninstallRoot) { continue }',
    '    try {',
    '      foreach ($keyName in $uninstallRoot.GetSubKeyNames()) {',
    '        $entry = $uninstallRoot.OpenSubKey($keyName)',
    '        if ($null -eq $entry) { continue }',
    '        try {',
    "          $installLocation = [string]$entry.GetValue('InstallLocation', '')",
    "          $uninstallString = [string]$entry.GetValue('UninstallString', '')",
    '          $matchesExpectedKey = [string]::Equals($keyName, $expectedKeyName, [StringComparison]::OrdinalIgnoreCase)',
    '          $matchesInstallLocation = -not [string]::IsNullOrWhiteSpace($installLocation) -and',
    '            [string]::Equals($installLocation.Trim().TrimEnd([char]92), $installDirectory, [StringComparison]::OrdinalIgnoreCase)',
    '          $matchesUninstaller = -not [string]::IsNullOrWhiteSpace($uninstallString) -and',
    '            $uninstallString.IndexOf($installDirectory, [StringComparison]::OrdinalIgnoreCase) -ge 0',
    '          if ($matchesExpectedKey -or $matchesInstallLocation -or $matchesUninstaller) {',
    '            $records += ([string]$view) + "|" + $keyName',
    '          }',
    '        } finally {',
    '          $entry.Dispose()',
    '        }',
    '      }',
    '    } finally {',
    '      $uninstallRoot.Dispose()',
    '    }',
    '  } finally {',
    '    $baseKey.Dispose()',
    '  }',
    '}',
    '[Console]::Write((@($records | Sort-Object -Unique) -join "`n"))',
  ].join('\n');
  const output = run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: {
      ...process.env,
      WHITEBOX_INTEGRATION_INSTALL_DIR: installDir,
      WHITEBOX_INTEGRATION_UNINSTALL_KEY: uninstallRegistryKeyName,
    },
    timeout: 30_000,
  }).stdout.trim();
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
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
  const hasVerifiedRelaunch = lines.some(line => line.startsWith('rendererReady=true;') || line.startsWith('relaunchReady=true;'));
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
    || line.startsWith('stoppingOrphanProcess=')
    || line.startsWith('stoppingUnreadyProcess=')
    || (line.startsWith('windowRestoreFailed=true') && !hasVerifiedRelaunch)
  ));
}

function assertCompletedInstall(logPath, options) {
  const lines = logLines(logPath);
  const expectedStart = `helperStarted=true;parentPid=${options.parentPid};expectedVersion=${options.expectedVersion}`;
  assert.deepStrictEqual(linesStarting(lines, 'helperStarted='), [expectedStart], 'Exactly one expected packaged helper must run.');
  assert.deepStrictEqual(linesStarting(lines, 'exitCode='), ['exitCode=0'], 'Exactly one NSIS invocation must complete successfully.');
  assert.equal(lines.includes('allAppProcessesStopped=true'), true, 'The helper did not prove all old app processes stopped.');
  assert.deepStrictEqual(
    linesStarting(lines, 'relaunchPath='),
    [`relaunchPath=${options.relaunchAppPath};installedVersion=${options.expectedVersion};expectedVersion=${options.expectedVersion}`],
    'The helper did not resolve exactly one expected relaunch path.',
  );
  assert.equal(lines.includes(`candidate=${options.relaunchAppPath};version=${options.expectedVersion}`), true,
    'The helper did not resolve the expected installed executable and version.');
  assert.deepStrictEqual(linesStarting(lines, 'bootstrapError='), [], 'The helper bootstrap was not acknowledged.');
  assert.equal(linesStarting(lines, 'relaunchStarted=').length, 1, 'The helper must start the app exactly once.');
  assert.equal(linesStarting(lines, 'rendererReady=').length, 1, 'The helper must observe renderer readiness exactly once.');
  assert.equal(linesStarting(lines, 'relaunchReady=').length, 1, 'The helper must finish one verified relaunch.');
  assert.deepStrictEqual(fatalLogLines(lines), [], `Updater helper logged a fatal marker:\n${readLog(logPath)}`);
}

async function waitForPathRemoval(file, timeoutMs = 20_000) {
  if (!file) return;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!fs.existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for update artifact removal: ${file}`);
}

async function waitForUpdateArtifactCleanup(launched, timeoutMs = 20_000) {
  const files = [...new Set([
    launched.bootstrapPath,
    launched.helperPath,
    launched.helperPidPath,
    launched.readyPath,
    launched.rendererReadyPath,
    launched.integrationHelperPidPath,
    launched.integrationReadyPath,
  ].filter(Boolean))];
  await Promise.all(files.map(file => waitForPathRemoval(file, timeoutMs)));
}

async function waitForProcessesReferencingPathExit(file, label, timeoutMs = 30_000) {
  if (!file) return;
  const startedAt = Date.now();
  let remaining = [];
  while (Date.now() - startedAt < timeoutMs) {
    remaining = runningProcessIdsReferencing(file);
    if (!remaining.length) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${label} processes remained after the updater completed: ${remaining.join(',')}`);
}

async function waitForUpdateProcessCleanup(launched, timeoutMs = 30_000) {
  await waitForProcessesReferencingPathExit(launched.helperPath, 'Update helper', timeoutMs);
  await waitForProcessesReferencingPathExit(launched.bootstrapPath, 'Update bootstrap', timeoutMs);
}

async function waitForRelaunch(logPath, expectedVersion, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const lines = logLines(logPath);
    const bootstrapErrors = linesStarting(lines, 'bootstrapError=');
    if (bootstrapErrors.some(line => line === 'bootstrapError=업데이트 설치 도우미가 10초 안에 준비되지 않았습니다.')) {
      const error = new Error(`The frozen legacy bootstrap lost its ready-file race:\n${readLog(logPath)}`);
      error.code = 'LEGACY_BOOTSTRAP_READY_RACE';
      error.updateLog = readLog(logPath);
      throw error;
    }
    const fatal = fatalLogLines(lines);
    if (fatal.length) throw new Error(`Updater helper failed before relaunch: ${fatal.join(', ')}\n${readLog(logPath)}`);
    const ready = linesStarting(lines, 'relaunchReady=');
    if (ready.length) {
      assert.equal(ready.length, 1, 'The helper relaunched more than once.');
      const match = ready[0].match(/relaunchReady=true;attempt=1;pid=(\d+)$/);
      assert(match, `Unexpected relaunch-ready record: ${ready[0]}`);
      assert.equal(linesStarting(lines, 'relaunchStarted=').length, 1, 'The helper must start the app exactly once.');
      assert.equal(linesStarting(lines, 'rendererReady=').length, 1, 'The helper must observe renderer readiness exactly once.');
      assert.equal(linesStarting(lines, 'candidate=').some(line => line.endsWith(`;version=${expectedVersion}`)), true);
      const pid = Number(match[1]);
      assertInstalledAppProfileIsolation(pid, `updater relaunch ${expectedVersion}`);
      assertProfileDirectoryUsed(inheritedUserDataDir, 'Updater-inherited Whitebox Electron profile');
      return pid;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for updater relaunch ${expectedVersion}:\n${readLog(logPath) || '(no update log)'}`);
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
  const failureLines = fatalLogLines(lines);
  const relaunchLifecycle = lines.filter(line => (
    line.startsWith('relaunchStarted=')
    || line.startsWith('rendererReady=')
    || line.startsWith('relaunchReady=')
    || line.startsWith('recoveryRelaunchStarted=')
  ));
  const clean = helperStarts.length === 1
    && helperStarts[0] === expectedStart
    && installerExits.length === 1
    && installerExits[0] === 'exitCode=0'
    && bootstrapErrors.length === 1
    && bootstrapErrors[0] === expectedBootstrapError
    && failureLines.length === 0
    && relaunchLifecycle.length === 0;
  if (!clean) {
    throw new Error([
      'Refusing the legacy restart fallback without one clean, completed bridge installation.',
      `Expected helper start: ${expectedStart}`,
      `Observed fatal markers: ${failureLines.join(', ') || '(none)'}`,
      `Observed relaunch lifecycle: ${relaunchLifecycle.join(', ') || '(none)'}`,
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
  const releaseAssets = options.releaseAssets || [{
    name: assetName,
    size,
    state: 'uploaded',
    digest,
    browser_download_url: assetUrl,
  }];
  const releaseDecoys = options.releaseDecoys || [];
  const matchingAssets = releaseAssets.filter(asset => asset && asset.name === assetName);
  assert.equal(matchingAssets.length, 1, `Release fixture must contain exactly one ${assetName}.`);
  assert.equal(matchingAssets[0].browser_download_url, assetUrl, `Release fixture URL changed for ${assetName}.`);
  assert.equal(matchingAssets[0].state, 'uploaded', `Release fixture state changed for ${assetName}.`);
  assert.equal(matchingAssets[0].size, size, `Release fixture size differs from ${assetName}.`);
  assert.equal(matchingAssets[0].digest, digest, `Release fixture digest differs from ${assetName}.`);
  const release = {
    tag_name: `v${options.expectedVersion}`,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/minjund/${options.repository}/releases/tag/v${options.expectedVersion}`,
    published_at: '2026-08-24T00:00:00.000Z',
    body: 'Windows legacy bridge integration fixture',
    assets: [...releaseDecoys, ...releaseAssets],
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
  assert.equal(checked.asset && checked.asset.url, assetUrl);
  assert.equal(checked.asset && checked.asset.size, size);
  assert.equal(checked.asset && checked.asset.digest, digest);
  const downloaded = await updater.download();
  assert.equal(downloaded.status, 'downloaded');
  existingFile(downloaded.downloadedPath, `downloaded ${assetName}`);
  assert.equal(fs.statSync(downloaded.downloadedPath).size, size);
  assert.equal(sha256(downloaded.downloadedPath), digest.slice('sha256:'.length));
  return downloaded.downloadedPath;
}

async function installWithPackagedUpdater(options) {
  const downloadsDir = path.join(testRoot, options.label);
  fs.mkdirSync(downloadsDir, { recursive: true });
  const downloadedInstaller = await downloadWithPackagedUpdater(options, downloadsDir);
  downloadedInstallerPaths.add(path.resolve(downloadedInstaller));
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
    launchedUpdates.push(launched);
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
    const pid = await waitForRelaunch(launched.logPath, options.expectedVersion);
    await waitForInstalledPackage(options.relaunchAppPath, options.expectedVersion);
    await waitForUpdateArtifactCleanup(launched);
    assertCompletedInstall(launched.logPath, options);
    return { pid, launched, parentPid: options.parentPid, legacyFallback: false };
  } catch (error) {
    if (!options.allowLegacyBootstrapFallback || error.code !== 'LEGACY_BOOTSTRAP_READY_RACE') throw error;
    // v1.6.3 has two consumers racing to remove the same helper-ready file.
    // Release metadata cannot change that already-installed bootstrap. Accept
    // the fallback only after the same fresh helper logged one successful NSIS
    // exit with no fatal marker. Then prove both the EXE and app.asar reached
    // 1.6.23 and model the only required user fallback: reopen the updated app.
    await waitForInstalledPackage(options.appPath, options.expectedVersion);
    await waitForUpdateProcessCleanup(launched);
    await waitForUpdateArtifactCleanup(launched);
    assertCleanLegacyInstallBeforeRestartFallback(launched.logPath, options);
    const fallbackPid = await startInstalledAppWithRendererReady(options.appPath, options.expectedVersion);
    assertCleanLegacyInstallBeforeRestartFallback(launched.logPath, options);
    console.log(`✓ Legacy bootstrap relaunch fallback reopened installed ${options.expectedVersion}.`);
    return { pid: fallbackPid, launched, parentPid: options.parentPid, legacyFallback: true };
  }
}

async function installCandidateWithManualBridge(options) {
  const downloadsDir = path.join(testRoot, 'second-hop-manual-downloads');
  fs.mkdirSync(downloadsDir, { recursive: true });
  const downloadedInstaller = await downloadWithPackagedUpdater({
    ...options,
    installer: manualInstaller,
    releaseAssets: options.releaseAssets,
  }, downloadsDir);
  downloadedInstallerPaths.add(path.resolve(downloadedInstaller));
  assert.equal(sha256(downloadedInstaller), sha256(currentInstaller),
    'The bridge did not download the byte-identical candidate manual alias.');

  let openCount = 0;
  let openedInstaller = '';
  const launched = await options.installerModule.launchDownloadedUpdate({
    installerPath: downloadedInstaller,
    downloadsDir,
    platform: 'win32',
    installType: 'desktop',
    appPath: legacyExecutable,
    expectedVersion: CURRENT_VERSION,
    parentPid: options.parentPid,
    allowUnsignedWindowsUpdates: options.allowUnsignedWindowsUpdates,
    environment: process.env,
    shell: {
      openPath: async installerPath => {
        openCount += 1;
        openedInstaller = path.resolve(installerPath);
        return '';
      },
    },
    beforeAutomaticInstall: () => {
      throw new Error('The immutable bridge incorrectly entered its automatic bootstrap path.');
    },
  });
  assert.equal(launched.mode, 'manual', 'The immutable bridge did not use the manual compatibility alias.');
  assert.equal(openCount, 1, 'The immutable bridge did not open exactly one manual installer.');
  assert.equal(openedInstaller, path.resolve(downloadedInstaller), 'The immutable bridge opened an unexpected installer.');
  assert.equal(processAlive(options.parentPid), true, 'The manual bridge closed its parent before the installer was opened.');
  assert.equal(executableVersion(legacyExecutable), bridgeVersion, 'The manual installer ran before parent shutdown.');
  assert.deepStrictEqual(
    fs.readdirSync(downloadsDir).filter(name => /^install-(?:update|renderer-ready)/i.test(name)),
    [],
    'The manual bridge created automatic bootstrap artifacts.',
  );

  closeInstalledAppGracefully(options.parentPid);
  await waitForProcessExit(options.parentPid);
  assert.deepStrictEqual(runningProcessIds(legacyExecutable), [], 'LoadToAgent remained live before manual installation.');
  run(downloadedInstaller, ['/S', '/currentuser', `/D=${installDir}`]);
  await waitForInstalledPackage(currentExecutable, CURRENT_VERSION);
  const pid = await startInstalledAppWithRendererReady(currentExecutable, CURRENT_VERSION);
  assert.equal(processAlive(pid), true, 'The manually installed candidate did not remain live after renderer readiness.');
  return { pid, parentPid: options.parentPid, downloadedInstaller, mode: 'manual' };
}

async function reinstallCandidateWithPackagedUpdater(options) {
  assert.equal(typeof options.updaterModule.selectReleaseAsset, 'function', 'The candidate package lacks its release selector.');
  assertReleaseAssetSelections(options.releaseAssets, CURRENT_VERSION, options.updaterModule.selectReleaseAsset);

  const downloadsDir = path.join(testRoot, 'candidate-reinstall-downloads');
  fs.mkdirSync(downloadsDir, { recursive: true });
  // A production updater correctly reports "current" for an equal version. This
  // isolated manager presents the immediately preceding bridge version so the
  // updater extracted from the installed candidate must check the complete
  // release fixture, reject its decoys, and download the candidate's own bytes.
  const reinstallInstaller = await downloadWithPackagedUpdater({
    updaterModule: options.updaterModule,
    installer: currentInstaller,
    repository: 'Whitebox',
    currentVersion: bridgeVersion,
    expectedVersion: CURRENT_VERSION,
    releaseAssets: options.releaseAssets,
    releaseDecoys: selectionDecoys(CURRENT_VERSION),
  }, downloadsDir);
  downloadedInstallerPaths.add(path.resolve(reinstallInstaller));
  assert.equal(path.basename(reinstallInstaller), path.basename(currentInstaller),
    'The candidate updater did not download canonical Setup for automatic reinstall.');
  assert.equal(fs.statSync(reinstallInstaller).size, CURRENT_INSTALLER_SIZE,
    'The same-candidate reinstall size changed while downloading canonical Setup.');
  assert.equal(sha256(reinstallInstaller), CURRENT_INSTALLER_SHA256,
    'The same-candidate reinstall did not use canonical Setup bytes.');

  let helperCallbackCount = 0;
  let bootstrapSpawnCount = 0;
  let helperPid = 0;
  let bootstrapChild = null;
  let capturedLogPath = '';
  let capturedHelperPidPath = '';
  let capturedReadyPath = '';
  let capturedReadyToken = '';
  let capturedHelperPath = '';
  let trackedLaunch = null;
  const wrappedSpawn = (command, args, spawnOptions) => {
    bootstrapSpawnCount += 1;
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
    trackedLaunch = {
      bootstrapPath: valueAfter('-File'),
      helperPath: capturedHelperPath,
      helperPidPath: capturedHelperPidPath,
      logPath: capturedLogPath,
      readyPath: capturedReadyPath,
      rendererReadyPath: valueAfter('-RendererReadyPath'),
    };
    launchedUpdates.push(trackedLaunch);
    return bootstrapChild;
  };

  const launched = await options.installerModule.launchDownloadedUpdate({
    installerPath: reinstallInstaller,
    downloadsDir,
    platform: 'win32',
    installType: 'desktop',
    appPath: currentExecutable,
    expectedVersion: CURRENT_VERSION,
    parentPid: options.parentPid,
    allowUnsignedWindowsUpdates: options.allowUnsignedWindowsUpdates,
    environment: process.env,
    spawn: wrappedSpawn,
    beforeAutomaticInstall: context => {
      helperCallbackCount += 1;
      helperPid = Number(context && context.helperPid || 0);
      assert(bootstrapChild, 'The candidate updater did not expose its real bootstrap process.');
      assert.equal(bootstrapChild.exitCode, 0, 'The shutdown boundary ran before bootstrap acknowledgement.');
      assert.equal(bootstrapChild.signalCode, null, 'The bootstrap was signaled before acknowledgement.');
      const signal = JSON.parse(fs.readFileSync(capturedReadyPath, 'utf8').replace(/^\uFEFF/, '').trim());
      assert.equal(signal.token, capturedReadyToken, 'The helper-ready token was not authenticated.');
      assert.equal(Number(signal.helperPid), helperPid, 'The acknowledged helper PID changed.');
      const helperIdentity = JSON.parse(fs.readFileSync(capturedHelperPidPath, 'utf8').replace(/^\uFEFF/, '').trim());
      assert.deepStrictEqual(helperIdentity, signal, 'The helper PID sidecar did not authenticate the ready signal.');
      assert.equal(processAlive(options.parentPid), true, 'The candidate parent exited before bootstrap acknowledgement.');
      assert.equal(processAlive(helperPid), true, 'The candidate helper exited before parent shutdown.');
      const boundaryLines = logLines(capturedLogPath);
      assert.deepStrictEqual(linesStarting(boundaryLines, 'allAppProcessesStopped='), [],
        'The helper crossed the parent shutdown boundary before acknowledgement.');
      assert.deepStrictEqual(linesStarting(boundaryLines, 'exitCode='), [],
        'NSIS ran before the parent shutdown boundary.');
    },
  });
  assert(trackedLaunch, 'The candidate updater did not spawn its packaged bootstrap.');
  Object.assign(trackedLaunch, launched);
  assert.equal(launched.mode, 'automatic', 'The candidate updater did not use canonical automatic Setup.');
  assert.equal(bootstrapSpawnCount, 1, 'The candidate updater spawned its bootstrap more than once.');
  assert.equal(helperCallbackCount, 1, 'The candidate updater crossed its helper-ready boundary more than once.');
  assert.equal(Number.isSafeInteger(helperPid) && helperPid > 0, true, 'The candidate updater did not report a helper PID.');
  assert.equal(fs.existsSync(launched.bootstrapPath), false, 'The acknowledged bootstrap script remained on disk.');
  assert.equal(fs.existsSync(launched.helperPidPath), false, 'The authenticated helper PID sidecar remained on disk.');
  assert.equal(fs.existsSync(launched.readyPath), false, 'The helper-ready signal remained on disk.');
  assert.equal(processAlive(options.parentPid), true, 'The candidate helper did not wait for its parent.');
  assert.equal(processAlive(helperPid), true, 'The acknowledged helper exited before candidate shutdown.');
  assert.equal(executableVersion(currentExecutable), CURRENT_VERSION, 'Reinstall began before candidate shutdown.');

  closeInstalledAppGracefully(options.parentPid);
  await waitForProcessExit(options.parentPid);
  const pid = await waitForRelaunch(launched.logPath, CURRENT_VERSION);
  await waitForInstalledPackage(currentExecutable, CURRENT_VERSION);
  await waitForUpdateArtifactCleanup(launched);
  await waitForProcessExit(helperPid, 30_000);
  assertCompletedInstall(launched.logPath, {
    parentPid: options.parentPid,
    expectedVersion: CURRENT_VERSION,
    relaunchAppPath: currentExecutable,
  });
  assert.equal(processAlive(pid), true, 'The automatically reinstalled candidate did not remain live.');
  return { pid, launched, parentPid: options.parentPid, helperPid };
}

function stopProcessTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (processAlive(pid)) {
    throw new Error([
      `Process tree ${pid} remained after taskkill (${result.status ?? 'spawn error'}).`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
}

function stopProcessesAtExactPath(executable, label) {
  for (const pid of runningProcessIds(executable)) stopProcessTree(pid);
  const remaining = runningProcessIds(executable);
  if (remaining.length) throw new Error(`${label} processes remained after cleanup: ${remaining.join(',')}`);
}

function stopProcessesReferencingPath(file, label) {
  if (!file) return;
  for (const pid of runningProcessIdsReferencing(file)) stopProcessTree(pid);
  const remaining = runningProcessIdsReferencing(file);
  if (remaining.length) throw new Error(`${label} processes remained after cleanup: ${remaining.join(',')}`);
}

async function startInstalledApp(executable) {
  assertIsolatedProfileEnvironment(`direct app start ${path.basename(executable)}`);
  const child = spawn(executable, [directUserDataArgument], {
    env: process.env,
    stdio: 'ignore',
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  await waitForProfileDirectoryUsed(directUserDataDir, 'Explicit direct Electron profile', child);
  if (child.exitCode !== null) throw new Error(`Installed parent app exited early (${child.exitCode}): ${executable}`);
  assertInstalledAppProfileIsolation(child.pid, `direct app start ${path.basename(executable)}`, true);
  return child.pid;
}

async function startInstalledAppWithRendererReady(executable, expectedVersion) {
  const rendererReadyToken = crypto.randomBytes(24).toString('hex');
  const rendererReadyPath = path.join(testRoot, `manual-install-renderer-ready-${rendererReadyToken}.json`);
  assertIsolatedProfileEnvironment(`direct renderer-ready start ${expectedVersion}`);
  const child = spawn(executable, [directUserDataArgument], {
    env: {
      ...process.env,
      WHITEBOX_UPDATE_READY_PATH: rendererReadyPath,
      WHITEBOX_UPDATE_READY_TOKEN: rendererReadyToken,
    },
    stdio: 'ignore',
    windowsHide: true,
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
        assertInstalledAppProfileIsolation(child.pid, `direct renderer-ready start ${expectedVersion}`, true);
        assertProfileDirectoryUsed(directUserDataDir, 'Explicit direct Electron profile');
        return child.pid;
      }
    } catch (_notReady) {}
    if (child.exitCode !== null) throw new Error(`Installed app exited before renderer readiness (${child.exitCode}).`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Installed app did not report renderer readiness for ${expectedVersion}: ${child.pid}`);
}

async function waitForInstallCleanup(timeoutMs = 30_000) {
  const startedAt = Date.now();
  let remainingRegistryEntries = [];
  while (Date.now() - startedAt < timeoutMs) {
    remainingRegistryEntries = perUserUninstallRegistryEntries();
    if (!fs.existsSync(installDir) && remainingRegistryEntries.length === 0) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error([
    `Timed out waiting for the installed directory and per-user uninstall registry entries to be removed: ${installDir}`,
    remainingRegistryEntries.length && `Remaining registry entries: ${remainingRegistryEntries.join(', ')}`,
  ].filter(Boolean).join('\n'));
}

function runUninstaller(uninstaller) {
  assert.equal(installationStarted, true, 'The installed-product uninstaller cannot run before installation starts.');
  assert.equal(uninstallerAttemptCount, 0, 'The installed-product uninstaller must be invoked exactly once per attempt.');
  assert([
    path.resolve(installDir, 'Uninstall Whitebox.exe'),
    path.resolve(installDir, 'Uninstall LoadToAgent.exe'),
  ].includes(path.resolve(uninstaller)), `Unexpected installed-product uninstaller path: ${uninstaller}`);
  existingFile(uninstaller, 'installed-product uninstaller');
  uninstallerAttemptCount += 1;
  const result = spawnSync(uninstaller, ['/S', '/currentuser'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      `Integration uninstaller failed (${result.status ?? 'spawn error'}): ${uninstaller}`,
      result.error && result.error.stack,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  validUninstallerRunCount += 1;
}

async function cleanupIntegration() {
  const failures = [];
  const capture = async (label, action) => {
    try {
      await action();
    } catch (error) {
      failures.push(`${label}: ${error.stack || error}`);
    }
  };

  await capture('stop recorded relaunched process', async () => stopProcessTree(relaunchedPid));
  for (const launched of launchedUpdates) {
    for (const [label, file] of [
      ['update helper', launched.helperPath],
      ['update bootstrap', launched.bootstrapPath],
    ]) {
      await capture(`stop ${label}`, async () => stopProcessesReferencingPath(file, label));
    }
  }
  for (const installer of downloadedInstallerPaths) {
    await capture('stop downloaded installer', async () => stopProcessesAtExactPath(installer, 'Downloaded installer'));
  }
  await capture('stop installed-path processes', async () => stopProcessesUnderDirectory(installDir, 'Installed-path'));
  for (const launched of launchedUpdates) {
    await capture('verify update artifact cleanup', async () => waitForUpdateArtifactCleanup(launched, 2_000));
  }

  asar.uncacheAll();
  const uninstallers = [
    path.join(installDir, 'Uninstall Whitebox.exe'),
    path.join(installDir, 'Uninstall LoadToAgent.exe'),
  ];
  if (installationStarted) {
    await capture('verify installed-product uninstall registry entry', async () => {
      const registryEntries = perUserUninstallRegistryEntries();
      assert(registryEntries.length > 0, 'No per-user product uninstall registry entry existed after installation started.');
      assert(registryEntries.every(entry => entry.toLowerCase().endsWith(`|${uninstallRegistryKeyName.toLowerCase()}`)),
        `Unexpected per-user uninstall registry entries referenced the integration install: ${registryEntries.join(', ')}`);
    });
    const existingUninstallers = uninstallers.filter(uninstaller => fs.existsSync(uninstaller));
    if (existingUninstallers.length !== 1) {
      failures.push(`select one installed-product uninstaller: expected 1, observed ${existingUninstallers.length} (${existingUninstallers.join(', ') || 'none'})`);
    }
    const selectedUninstaller = existingUninstallers.find(uninstaller => path.basename(uninstaller) === 'Uninstall Whitebox.exe')
      || existingUninstallers[0];
    if (selectedUninstaller) {
      await capture('run installed-product uninstaller exactly once', async () => runUninstaller(selectedUninstaller));
    }
    if (uninstallerAttemptCount !== 1) {
      failures.push(`run installed-product uninstaller exactly once: expected 1 invocation, observed ${uninstallerAttemptCount}`);
    }
    if (validUninstallerRunCount !== 1) {
      failures.push(`run one valid installed-product uninstaller: expected 1 successful invocation, observed ${validUninstallerRunCount}`);
    }
    await capture('wait for installed product cleanup', async () => waitForInstallCleanup());
    await capture('verify installed-path process cleanup', async () => {
      const remainingProcesses = runningProcessesUnderDirectory(installDir);
      assert.deepStrictEqual(remainingProcesses, [],
        `Installed-path processes remained after uninstall: ${remainingProcesses.map(record => `${record.pid} (${record.executablePath})`).join(', ')}`);
    });
    await capture('verify install directory cleanup', async () => {
      assert.equal(fs.existsSync(installDir), false, `Installed directory remained after uninstall: ${installDir}`);
    });
    await capture('verify per-user uninstall registry cleanup', async () => {
      assert.deepStrictEqual(perUserUninstallRegistryEntries(), [],
        'Per-user product uninstall registry entries remained after uninstall.');
    });
  } else {
    assert.equal(uninstallerAttemptCount, 0, 'The uninstaller ran without an installation attempt.');
    assert.equal(validUninstallerRunCount, 0, 'A valid uninstaller run was recorded without an installation attempt.');
  }

  for (const installer of downloadedInstallerPaths) {
    await capture('verify installer process cleanup', async () => stopProcessesAtExactPath(installer, 'Downloaded installer'));
  }
  for (const launched of launchedUpdates) {
    for (const [label, file] of [
      ['update helper', launched.helperPath],
      ['update bootstrap', launched.bootstrapPath],
    ]) {
      await capture(`verify ${label} process cleanup`, async () => stopProcessesReferencingPath(file, label));
    }
  }

  if (failures.length) {
    console.error(`Legacy bridge integration cleanup was not fully verified; retaining ${testRoot} for inspection:\n${failures.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  await capture('remove integration temporary root', async () => {
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    assert.equal(fs.existsSync(testRoot), false, `Integration temporary root remained after cleanup: ${testRoot}`);
    assert.equal(fs.existsSync(isolatedProfileRoot), false, `Isolated profile root remained after cleanup: ${isolatedProfileRoot}`);
    assert.equal(fs.existsSync(isolatedAppDataRoot), false, `Isolated APPDATA root remained after cleanup: ${isolatedAppDataRoot}`);
    assert.equal(fs.existsSync(isolatedLocalAppDataRoot), false, `Isolated LOCALAPPDATA root remained after cleanup: ${isolatedLocalAppDataRoot}`);
    assert.equal(fs.existsSync(inheritedUserDataDir), false, `Updater-inherited Electron profile remained after cleanup: ${inheritedUserDataDir}`);
    assert.equal(fs.existsSync(directUserDataDir), false, `Explicit Electron profile remained after cleanup: ${directUserDataDir}`);
    assert.equal(fs.existsSync(isolatedBridgeHome), false, `Isolated bridge home remained after cleanup: ${isolatedBridgeHome}`);
  });
  if (failures.length) {
    console.error(`Legacy bridge integration temporary directory cleanup failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
}

async function main() {
  assertIsolatedProfileEnvironment('legacy-bridge attempt initialization');
  assert.equal(fs.existsSync(directUserDataDir), false,
    'The direct Electron profile was touched before the legacy installer/app attempt began.');
  assert.equal(bridgeVersion, '1.6.23', 'The immutable bridge version changed.');
  assert.match(uninstallRegistryKeyName, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'The legacy and Whitebox NSIS per-user uninstall registry key must be pinned by GUID.');
  assert.equal(String(sourcePackageMetadata.build?.nsis?.guid || '').trim(), uninstallRegistryKeyName,
    'The candidate and immutable bridge no longer share one uninstall registry identity.');
  assertStableVersion(CURRENT_VERSION, 'Target Whitebox version');
  assert.equal(sourcePackageMetadata.version, CURRENT_VERSION, CANDIDATE_E2E
    ? 'The candidate package version changed while preparing the integration.'
    : 'The audited bridge source version changed.');
  assert.match(CURRENT_INSTALLER_SHA256, /^[0-9a-f]{64}$/, 'The target installer SHA-256 must be one lowercase digest.');
  assert.equal(Number.isSafeInteger(CURRENT_INSTALLER_SIZE) && CURRENT_INSTALLER_SIZE > 0, true,
    'The target installer size must be a positive safe integer.');
  if (CANDIDATE_E2E) {
    assert.notEqual(officialBridgeInput, '', 'WHITEBOX_V1623_INSTALLER is required in candidate E2E mode.');
    assert.notEqual(manualInstallerInput, '', 'WHITEBOX_MANUAL_INSTALLER is required in candidate E2E mode.');
  }

  assertPinnedInstaller(sourceInstaller, {
    name: V163_INSTALLER_NAME,
    size: V163_INSTALLER_SIZE,
    sha256: V163_INSTALLER_SHA256,
  }, 'official v1.6.3 installer');
  if (CANDIDATE_E2E) {
    assertPinnedInstaller(bridgeInstaller, {
      name: V1623_INSTALLER_NAME,
      size: V1623_INSTALLER_SIZE,
      sha256: V1623_INSTALLER_SHA256,
    }, 'official immutable v1.6.23 bridge installer');
  } else {
    assert.equal(path.basename(bridgeInstaller), V1623_INSTALLER_NAME, 'Locally built bridge filename changed.');
    existingFile(bridgeInstaller, 'locally built legacy bridge installer');
  }
  assertPinnedInstaller(currentInstaller, {
    name: `Whitebox-Setup-${CURRENT_VERSION}.exe`,
    size: CURRENT_INSTALLER_SIZE,
    sha256: CURRENT_INSTALLER_SHA256,
  }, `Whitebox ${CURRENT_VERSION} target installer`);
  if (CANDIDATE_E2E) {
    assertPinnedInstaller(manualInstaller, {
      name: `Whitebox-Manual-Setup-${CURRENT_VERSION}-x64.exe`,
      size: CURRENT_INSTALLER_SIZE,
      sha256: CURRENT_INSTALLER_SHA256,
    }, `Whitebox ${CURRENT_VERSION} manual compatibility alias`);
    assert.equal(sha256(manualInstaller), sha256(currentInstaller),
      'Canonical Setup and the manual compatibility alias are not byte-identical.');
  }

  process.env.WHITEBOX_DEMO_CAPTURE = '1';
  process.env.WHITEBOX_TEST_INSTANCE = '1';
  process.env.LOADTOAGENT_DEMO_CAPTURE = '1';
  process.env.LOADTOAGENT_TEST_INSTANCE = '1';

  // /D must be the final NSIS argument. A custom location proves that both
  // later installers reuse the previous product identity rather than creating
  // independent default-path installations.
  installationStarted = true;
  run(sourceInstaller, ['/S', '/currentuser', `/D=${installDir}`]);
  existingFile(legacyExecutable, 'installed v1.6.3 executable');
  assert.equal(executableVersion(legacyExecutable), '1.6.3');

  const installedAsar = path.join(installDir, 'resources', 'app.asar');
  const v163Metadata = packagedMetadata(installedAsar);
  assert.equal(v163Metadata.version, '1.6.3', 'The official installer did not contain the expected v1.6.3 app.asar.');
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
  const firstHop = await installWithPackagedUpdater({
    label: 'first-hop-downloads',
    installerModule: v163InstallerModule,
    updaterModule: v163UpdaterModule,
    installer: bridgeInstaller,
    repository: 'LodeToAgent',
    currentVersion: '1.6.3',
    parentPid: v163ParentPid,
    allowUnsignedWindowsUpdates: v163AllowsUnsigned,
    appPath: legacyExecutable,
    relaunchAppPath: legacyExecutable,
    expectedVersion: bridgeVersion,
    allowLegacyBootstrapFallback: true,
  });
  relaunchedPid = firstHop.pid;
  assert.equal(processAlive(relaunchedPid), true, 'The installed bridge was not running after the first hop.');
  existingFile(legacyExecutable, 'upgraded legacy bridge executable');
  assert.equal(executableVersion(legacyExecutable), bridgeVersion);

  const bridgeAsar = path.join(installDir, 'resources', 'app.asar');
  const bridgeMetadata = packagedMetadata(bridgeAsar);
  assert.equal(bridgeMetadata.version, bridgeVersion, 'The first hop did not install the expected bridge app.asar.');
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
  const candidateAssets = CANDIDATE_E2E ? completeCandidateReleaseAssets() : null;
  const secondHop = CANDIDATE_E2E
    ? await installCandidateWithManualBridge({
      installerModule: bridgeInstallerModule,
      updaterModule: bridgeUpdaterModule,
      repository: 'Whitebox',
      currentVersion: bridgeVersion,
      parentPid: relaunchedPid,
      allowUnsignedWindowsUpdates: bridgeAllowsUnsigned,
      expectedVersion: CURRENT_VERSION,
      releaseAssets: candidateAssets,
    })
    : await installWithPackagedUpdater({
      label: 'second-hop-downloads',
      installerModule: bridgeInstallerModule,
      updaterModule: bridgeUpdaterModule,
      installer: currentInstaller,
      repository: 'Whitebox',
      currentVersion: bridgeVersion,
      parentPid: relaunchedPid,
      allowUnsignedWindowsUpdates: bridgeAllowsUnsigned,
      appPath: legacyExecutable,
      relaunchAppPath: currentExecutable,
      expectedVersion: CURRENT_VERSION,
    });
  relaunchedPid = secondHop.pid;
  assert.equal(processAlive(relaunchedPid), true, 'The target Whitebox app was not running after the second hop.');
  existingFile(currentExecutable, 'second-hop Whitebox executable');
  assert.equal(executableVersion(currentExecutable), CURRENT_VERSION);

  if (CANDIDATE_E2E) {
    const candidateAsar = path.join(installDir, 'resources', 'app.asar');
    const candidateMetadata = packagedMetadata(candidateAsar);
    assert.equal(candidateMetadata.version, CURRENT_VERSION, 'The manual second hop installed an unexpected candidate app.asar.');
    const candidateAllowsUnsigned = candidateMetadata.whitebox?.distributionChannel === 'internal'
      && candidateMetadata.whitebox?.allowUnsignedWindowsUpdates === true;
    assert.equal(candidateAllowsUnsigned, true, 'The installed candidate cannot perform its unsigned CI reinstall.');
    const candidateModuleDir = path.join(testRoot, 'candidate-packaged-src');
    extractModuleTree(candidateAsar, candidateModuleDir, [
      'diagnostics.js',
      'macUpdateHelper.js',
      'updateInstaller.js',
      'updateManager.js',
    ]);
    const candidateInstallerModule = require(path.join(candidateModuleDir, 'updateInstaller.js'));
    const candidateUpdaterModule = require(path.join(candidateModuleDir, 'updateManager.js'));
    assert.equal(typeof candidateInstallerModule.waitForUpdateBootstrapExit, 'function',
      'The installed candidate lacks bootstrap acknowledgement support.');
    const reinstall = await reinstallCandidateWithPackagedUpdater({
      installerModule: candidateInstallerModule,
      updaterModule: candidateUpdaterModule,
      parentPid: relaunchedPid,
      allowUnsignedWindowsUpdates: candidateAllowsUnsigned,
      releaseAssets: candidateAssets,
    });
    relaunchedPid = reinstall.pid;
  }

  assertProfileDirectoryUsed(directUserDataDir, 'Explicit direct Electron profile');
  assertProfileDirectoryUsed(inheritedUserDataDir, 'Updater-inherited Whitebox Electron profile');
  assertInstalledAppProfileIsolation(relaunchedPid, 'completed legacy-bridge attempt');

  console.log(CANDIDATE_E2E
    ? `✓ Packaged v1.6.3 reached the immutable ${bridgeVersion} bridge, selected the manual alias for Whitebox ${CURRENT_VERSION}, and the installed candidate then reinstalled itself through one acknowledged automatic handshake.`
    : `✓ Packaged v1.6.3 helper upgraded in place to ${bridgeVersion}; the packaged bridge helper then upgraded and relaunched Whitebox ${CURRENT_VERSION}.`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(cleanupIntegration);
