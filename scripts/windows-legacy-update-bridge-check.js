'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const asar = require('@electron/asar');
const bridgeConfig = require('./legacy-update-bridge.config');

if (process.platform !== 'win32') throw new Error('Legacy bridge artifact verification must run on Windows.');

const version = bridgeConfig.extraMetadata.version;
const releaseDir = path.resolve(process.env.WHITEBOX_LEGACY_BRIDGE_RELEASE_DIR
  || path.join(__dirname, '..', bridgeConfig.directories.output));
const unpackedExecutable = path.join(releaseDir, 'win-unpacked', 'LoadToAgent.exe');
const installer = path.join(releaseDir, `LoadToAgent-Setup-${version}.exe`);
for (const file of [unpackedExecutable, installer]) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.size <= 0) throw new Error(`Legacy bridge artifact is missing or empty: ${file}`);
}

const packagedMetadata = JSON.parse(asar.extractFile(
  path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar'),
  'package.json',
).toString('utf8'));
if (packagedMetadata.version !== version) throw new Error(`Packaged bridge version mismatch: ${packagedMetadata.version}`);
if (packagedMetadata.name !== 'loadtoagent') throw new Error(`Packaged bridge name mismatch: ${packagedMetadata.name}`);
if (packagedMetadata.whitebox?.distributionChannel !== 'internal'
  || packagedMetadata.whitebox?.allowUnsignedWindowsUpdates !== true) {
  throw new Error('Packaged bridge cannot install the unsigned internal Whitebox second hop.');
}

const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const programFiles = process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files';
const powershell7 = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
const powershell = fs.existsSync(powershell7)
  ? powershell7
  : path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const metadataScript = [
  '$exe = Get-Item -LiteralPath $env:LEGACY_BRIDGE_EXECUTABLE',
  '$installer = Get-Item -LiteralPath $env:LEGACY_BRIDGE_INSTALLER',
  "if ($exe.Name -ne 'LoadToAgent.exe') { throw ('Unexpected executable name: ' + $exe.Name) }",
  "if ($exe.VersionInfo.ProductName -ne 'LoadToAgent') { throw ('Unexpected executable ProductName: ' + $exe.VersionInfo.ProductName) }",
  "if ($exe.VersionInfo.FileDescription -ne 'LoadToAgent') { throw ('Unexpected executable description: ' + $exe.VersionInfo.FileDescription) }",
  "if ($exe.VersionInfo.ProductVersion -notlike ($env:LEGACY_BRIDGE_VERSION + '*')) { throw ('Unexpected executable version: ' + $exe.VersionInfo.ProductVersion) }",
  "if ($installer.VersionInfo.ProductName -ne 'LoadToAgent') { throw ('Unexpected installer ProductName: ' + $installer.VersionInfo.ProductName) }",
  'Add-Type -AssemblyName System.Drawing',
  '$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe.FullName)',
  "if ($null -eq $icon -or $icon.Width -lt 16 -or $icon.Height -lt 16) { throw 'Bridge executable has no readable icon' }",
  '$icon.Dispose()',
].join('; ');
execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', metadataScript], {
  env: {
    ...process.env,
    LEGACY_BRIDGE_EXECUTABLE: unpackedExecutable,
    LEGACY_BRIDGE_INSTALLER: installer,
    LEGACY_BRIDGE_VERSION: version,
  },
  encoding: 'utf8',
  windowsHide: true,
});

const signatureScript = [
  '$signature = Get-AuthenticodeSignature -LiteralPath $env:LEGACY_BRIDGE_INSTALLER',
  "$allowed = if ($env:WHITEBOX_ALLOW_UNSIGNED -eq 'true') { @('Valid', 'NotSigned') } else { @('Valid') }",
  "if ($allowed -notcontains [string]$signature.Status) { throw ('Invalid Authenticode signature: ' + $signature.Status) }",
].join('; ');
execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', signatureScript], {
  env: { ...process.env, LEGACY_BRIDGE_INSTALLER: installer },
  encoding: 'utf8',
  windowsHide: true,
});

console.log(`LoadToAgent ${version} legacy update bridge artifacts verified.`);
