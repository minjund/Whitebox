'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function newest(directory) {
  const versions = fs.readdirSync(directory).filter(name => /^\d+(\.\d+)+$/.test(name));
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (!versions.length) throw new Error(`No compiler/SDK version in ${directory}`);
  return path.join(directory, versions[0]);
}

function buildWindowsSignatureCheck() {
  if (process.platform !== 'win32') throw new Error('Build the Windows verifier on Windows');
  const programFiles = process.env['ProgramFiles(x86)'];
  const vswhere = path.join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const installation = execFileSync(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
  { encoding: 'utf8', windowsHide: true }).trim();
  if (!installation) throw new Error('MSVC x64 Build Tools are required for the native verifier');
  const msvc = newest(path.join(installation, 'VC', 'Tools', 'MSVC'));
  const sdk = path.join(programFiles, 'Windows Kits', '10');
  const include = newest(path.join(sdk, 'Include'));
  const lib = path.join(sdk, 'Lib', path.basename(include));
  const output = path.resolve(__dirname, '../build/generated');
  fs.mkdirSync(output, { recursive: true });
  const executable = path.join(output, 'whitebox-signature-check.exe');
  execFileSync(path.join(msvc, 'bin/Hostx64/x64/cl.exe'), [
    '/nologo', '/O2', '/MT', '/W4', '/WX', '/EHsc', '/guard:cf', '/DUNICODE', '/D_UNICODE',
    `/I${path.join(msvc, 'include')}`, ...['ucrt', 'shared', 'um'].map(part => `/I${path.join(include, part)}`),
    path.resolve(__dirname, '../build/windows-signature-check.cpp'),
    `/Fo${path.join(output, 'windows-signature-check.obj')}`, `/Fe${executable}`, '/link',
    `/LIBPATH:${path.join(msvc, 'lib/x64')}`, `/LIBPATH:${path.join(lib, 'ucrt/x64')}`,
    `/LIBPATH:${path.join(lib, 'um/x64')}`, '/DYNAMICBASE', '/NXCOMPAT', '/HIGHENTROPYVA',
    'wintrust.lib', 'crypt32.lib',
  ], { stdio: 'inherit', windowsHide: true });
  if (!fs.statSync(executable).size) throw new Error('Native signature verifier build is empty');
  return executable;
}

module.exports = buildWindowsSignatureCheck;
if (require.main === module) buildWindowsSignatureCheck();
