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
const {
  assertReleaseAssetSelections,
  fixtureReleaseAssets,
} = require('./release-asset-contract');

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
const isolatedProfileRoot = path.join(testRoot, 'isolated-profile');
const isolatedAppDataRoot = path.join(isolatedProfileRoot, 'AppData', 'Roaming');
const isolatedLocalAppDataRoot = path.join(isolatedProfileRoot, 'AppData', 'Local');
const inheritedUserDataDir = path.join(isolatedAppDataRoot, 'Whitebox');
const directUserDataDir = path.join(isolatedLocalAppDataRoot, 'direct-electron-user-data');
const directUserDataArgument = `--user-data-dir=${directUserDataDir}`;
const isolatedBridgeHome = path.join(testRoot, 'isolated-bridge-home');
const installDir = path.join(testRoot, 'installed-whitebox');
const installedExecutable = path.join(installDir, 'Whitebox.exe');
const installedAsar = path.join(installDir, 'resources', 'app.asar');
const uninstallRegistryKeyName = String(sourcePackageMetadata.build?.nsis?.guid || '').trim();
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const updateInstallerPaths = new Set();
const trackedUpdateProcesses = new Map();
let activeAppPid = 0;
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
    'The updater-inherited Whitebox profile must begin absent for every cohort attempt.');
  assert.equal(fs.existsSync(directUserDataDir), false, 'The direct Electron profile must begin absent for every cohort attempt.');
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

prepareIsolatedProfileEnvironment();

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
    '$uninstaller = [IO.Path]::GetFullPath($env:WHITEBOX_INTEGRATION_UNINSTALLER)',
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
    '            $uninstallString.IndexOf($uninstaller, [StringComparison]::OrdinalIgnoreCase) -ge 0',
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
  const uninstaller = path.join(installDir, 'Uninstall Whitebox.exe');
  const output = run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: {
      ...process.env,
      WHITEBOX_INTEGRATION_INSTALL_DIR: installDir,
      WHITEBOX_INTEGRATION_UNINSTALLER: uninstaller,
      WHITEBOX_INTEGRATION_UNINSTALL_KEY: uninstallRegistryKeyName,
    },
    timeout: 30_000,
  }).stdout.trim();
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
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

function runInstalledProductUninstaller(uninstaller) {
  assert.equal(installationStarted, true, 'The installed-product uninstaller cannot run before installation starts.');
  assert.equal(uninstallerAttemptCount, 0, 'The installed-product uninstaller must be invoked exactly once per attempt.');
  assert.equal(path.resolve(uninstaller), path.resolve(installDir, 'Uninstall Whitebox.exe'), 'Unexpected installed-product uninstaller path.');
  existingFile(uninstaller, 'installed-product uninstaller');
  uninstallerAttemptCount += 1;
  const result = spawnSync(uninstaller, ['/S', '/currentuser'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      `Integration uninstaller cleanup failed (${result.status ?? 'spawn error'}).`,
      result.error && result.error.stack,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  validUninstallerRunCount += 1;
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
      const pid = Number(match[1]);
      assertInstalledAppProfileIsolation(pid, `updater relaunch ${expectedVersion}`);
      assertProfileDirectoryUsed(inheritedUserDataDir, 'Updater-inherited Whitebox Electron profile');
      return pid;
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
  assertIsolatedProfileEnvironment(`direct app start ${expectedVersion}`);
  const child = spawn(installedExecutable, [directUserDataArgument], {
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
  let observedSignal = null;
  let lastProfileEvidenceError = null;
  while (Date.now() - startedAt < 60_000) {
    if (!observedSignal && fs.existsSync(rendererReadyPath)) {
      try {
        const signal = JSON.parse(fs.readFileSync(rendererReadyPath, 'utf8').replace(/^\uFEFF/, '').trim());
        assert(signal && typeof signal === 'object' && !Array.isArray(signal),
          `Installed app renderer-ready payload was not an object for ${expectedVersion}.`);
        observedSignal = signal;
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw new Error(`Installed app wrote an invalid renderer-ready signal for ${expectedVersion}: ${error.message}`);
        }
      }
      if (observedSignal) {
        assert.equal(observedSignal.token, rendererReadyToken,
          `Installed app renderer-ready token mismatch for ${expectedVersion}.`);
        assert.equal(Number(observedSignal.pid), child.pid,
          `Installed app renderer-ready PID mismatch for ${expectedVersion}.`);
        assert.equal(observedSignal.version, expectedVersion,
          `Installed app renderer-ready version mismatch for ${expectedVersion}.`);
        assert(String(observedSignal.rendererReadyAt || '').trim(),
          `Installed app renderer-ready timestamp was missing for ${expectedVersion}.`);
      }
    }
    if (observedSignal) {
      try {
        assertInstalledAppProfileIsolation(child.pid, `direct app start ${expectedVersion}`, true);
        assertProfileDirectoryUsed(directUserDataDir, 'Explicit direct Electron profile');
        fs.rmSync(rendererReadyPath, { force: true });
        return child.pid;
      } catch (error) {
        lastProfileEvidenceError = error;
      }
    }
    if (child.exitCode !== null) throw new Error(`Installed app exited before renderer readiness (${child.exitCode}).`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error([
    `Installed app did not complete renderer readiness and profile verification for ${expectedVersion}: ${child.pid}`,
    observedSignal && `Renderer-ready signal: ${JSON.stringify(observedSignal)}`,
    lastProfileEvidenceError && `Last profile evidence error: ${lastProfileEvidenceError.stack || lastProfileEvidenceError.message}`,
  ].filter(Boolean).join('\n'));
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
  const completeAssets = fixtureReleaseAssets(targetVersion).map(asset => (
    asset.name === targetInstallerName || asset.name === manualBridgeInstallerName
      ? releaseAsset(asset.name)
      : asset
  ));
  const canonicalAsset = completeAssets.find(asset => asset.name === targetInstallerName);
  const manualBridgeAsset = completeAssets.find(asset => asset.name === manualBridgeInstallerName);
  const release = {
    tag_name: `v${targetVersion}`,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/minjund/Whitebox/releases/tag/v${targetVersion}`,
    published_at: '2026-08-24T00:00:00.000Z',
    body: `Windows ${SOURCE_VERSION} packaged update integration fixture`,
    assets: completeAssets,
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
  assertIsolatedProfileEnvironment('frozen-client attempt initialization');
  assert.equal(fs.existsSync(directUserDataDir), false,
    'The direct Electron profile was touched before the cohort installer/app attempt began.');
  assert.match(targetVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.match(uninstallRegistryKeyName, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'The Whitebox NSIS per-user uninstall registry key must be pinned by GUID.');
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
  installationStarted = true;
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
  const targetReleaseAssets = fixtureReleaseAssets(targetVersion).map(asset => {
    if (asset.name !== targetInstallerName && asset.name !== manualBridgeInstallerName) return asset;
    const installer = asset.name === targetInstallerName ? targetInstaller : manualBridgeInstaller;
    return {
      ...asset,
      size: fs.statSync(installer).size,
      digest: `sha256:${sha256(installer)}`,
    };
  });
  assertReleaseAssetSelections(targetReleaseAssets, targetVersion, targetUpdaterModule.selectReleaseAsset);

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
  assertProfileDirectoryUsed(directUserDataDir, 'Explicit direct Electron profile');
  assertProfileDirectoryUsed(inheritedUserDataDir, 'Updater-inherited Whitebox Electron profile');
  assertInstalledAppProfileIsolation(activeAppPid, 'completed frozen-client attempt');

  console.log(`✓ Official Whitebox ${SOURCE_VERSION} reached ${targetVersion} through its packaged ${sourceCohort.installMode} path; the candidate updater then acknowledged bootstrap and reinstalled/relaunched the same target exactly once.`);
}

main().catch(error => {
  console.error(error.stack || error);
  dumpUpdateLogs(testRoot);
  process.exitCode = 1;
}).finally(async () => {
  const cleanupFailures = [];
  const captureCleanup = async (label, action) => {
    try {
      await action();
    } catch (error) {
      cleanupFailures.push(`${label}: ${error.stack || error}`);
    }
  };

  for (const [pid, commandPath] of trackedUpdateProcesses) {
    await captureCleanup('stop tracked integration updater process', async () => {
      if (processCommandReferences(pid, commandPath)) stopProcessTree(pid);
    });
  }
  for (const [pid, commandPath] of trackedUpdateProcesses) {
    await captureCleanup('verify tracked integration updater process cleanup', async () => {
      assert.equal(processCommandReferences(pid, commandPath), false,
        `A tracked integration updater process remained after cleanup: ${pid} (${commandPath})`);
    });
  }
  for (const installerPath of updateInstallerPaths) {
    await captureCleanup('stop integration installer process', async () => {
      stopProcessesAtExactPath(installerPath, 'Integration installer');
    });
  }
  await captureCleanup('stop installed-path processes', async () => {
    stopProcessesUnderDirectory(installDir, 'Installed-path');
  });

  asar.uncacheAll();
  const uninstaller = path.join(installDir, 'Uninstall Whitebox.exe');
  if (installationStarted) {
    await captureCleanup('verify installed-product uninstall registry entry', async () => {
      const registryEntries = perUserUninstallRegistryEntries();
      assert(registryEntries.length > 0, 'No per-user Whitebox uninstall registry entry existed after installation started.');
      assert(registryEntries.every(entry => entry.toLowerCase().endsWith(`|${uninstallRegistryKeyName.toLowerCase()}`)),
        `Unexpected per-user uninstall registry entries referenced the integration install: ${registryEntries.join(', ')}`);
    });
    await captureCleanup('run installed-product uninstaller exactly once', async () => {
      runInstalledProductUninstaller(uninstaller);
    });
    if (uninstallerAttemptCount !== 1) {
      cleanupFailures.push(`run installed-product uninstaller exactly once: expected 1 invocation, observed ${uninstallerAttemptCount}`);
    }
    if (validUninstallerRunCount !== 1) {
      cleanupFailures.push(`run one valid installed-product uninstaller: expected 1 successful invocation, observed ${validUninstallerRunCount}`);
    }
    await captureCleanup('wait for installed product cleanup', async () => waitForInstallCleanup());
    await captureCleanup('verify installed-path process cleanup', async () => {
      const remainingProcesses = runningProcessesUnderDirectory(installDir);
      assert.deepStrictEqual(remainingProcesses, [],
        `Installed-path processes remained after uninstall: ${remainingProcesses.map(record => `${record.pid} (${record.executablePath})`).join(', ')}`);
    });
    await captureCleanup('verify install directory cleanup', async () => {
      assert.equal(fs.existsSync(installDir), false, `Installed directory remained after uninstall: ${installDir}`);
    });
    await captureCleanup('verify per-user uninstall registry cleanup', async () => {
      assert.deepStrictEqual(perUserUninstallRegistryEntries(), [],
        'Per-user Whitebox uninstall registry entries remained after uninstall.');
    });
  } else {
    assert.equal(uninstallerAttemptCount, 0, 'The uninstaller ran without an installation attempt.');
    assert.equal(validUninstallerRunCount, 0, 'A valid uninstaller run was recorded without an installation attempt.');
  }

  for (const installerPath of updateInstallerPaths) {
    await captureCleanup('verify integration installer process cleanup', async () => {
      assert.deepStrictEqual(runningProcessIds(installerPath), [],
        `Integration installer processes remained after uninstall: ${installerPath}`);
    });
  }
  for (const [pid, commandPath] of trackedUpdateProcesses) {
    await captureCleanup('verify updater process cleanup after uninstall', async () => {
      assert.equal(processCommandReferences(pid, commandPath), false,
        `A tracked integration updater process remained after uninstall: ${pid} (${commandPath})`);
    });
  }

  if (cleanupFailures.length) {
    console.error(`Frozen-client integration cleanup was not fully verified; retaining ${testRoot} for inspection:\n${cleanupFailures.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  await captureCleanup('remove integration temporary root', async () => {
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    assert.equal(fs.existsSync(testRoot), false, `Integration temporary root remained after cleanup: ${testRoot}`);
    assert.equal(fs.existsSync(isolatedProfileRoot), false, `Isolated profile root remained after cleanup: ${isolatedProfileRoot}`);
    assert.equal(fs.existsSync(isolatedAppDataRoot), false, `Isolated APPDATA root remained after cleanup: ${isolatedAppDataRoot}`);
    assert.equal(fs.existsSync(isolatedLocalAppDataRoot), false, `Isolated LOCALAPPDATA root remained after cleanup: ${isolatedLocalAppDataRoot}`);
    assert.equal(fs.existsSync(inheritedUserDataDir), false, `Updater-inherited Electron profile remained after cleanup: ${inheritedUserDataDir}`);
    assert.equal(fs.existsSync(directUserDataDir), false, `Explicit Electron profile remained after cleanup: ${directUserDataDir}`);
    assert.equal(fs.existsSync(isolatedBridgeHome), false, `Isolated bridge home remained after cleanup: ${isolatedBridgeHome}`);
  });
  if (cleanupFailures.length) {
    console.error(`Frozen-client integration temporary directory cleanup failed:\n${cleanupFailures.join('\n')}`);
    process.exitCode = 1;
  }
});
