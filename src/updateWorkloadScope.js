'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

// Inspect only the authenticated terminal host. Never enumerate or terminate
// unrelated shells/providers just because their names resemble an AI task.
async function readWindowsHostProcess(pid, run = promisify(execFile)) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid terminal host PID');
  const verifierRoot = path.basename(path.dirname(__dirname)) === 'app.asar'
    ? path.dirname(path.dirname(__dirname)) : path.resolve(__dirname, '../build/generated');
  const verifier = path.join(verifierRoot, 'whitebox-signature-check.exe');
  try {
    const result = await run(verifier, ['--process-info', String(pid)], {
      windowsHide: true, timeout: 15_000, maxBuffer: 256 * 1024,
    });
    const value = JSON.parse(String(result.stdout || '').trim());
    if (value.ProcessId !== pid || !path.win32.isAbsolute(value.ExecutablePath || '')
      || !value.CommandLine || !/^\d{14}\.\d{6}[+-]\d{3}$/.test(value.Started)) throw new Error('Incomplete host identity');
    return value;
  } catch (_error) {
    // execFile errors embed the command and stdout; do not expose those in UI.
    throw new Error('업데이트 대상 명령창 연결 프로그램을 확인하지 못했습니다. 프로그램을 종료하지 않았습니다.');
  }
}

function canonicalWindowsLaunchPath(value) {
  let existing = path.win32.resolve(value);
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.win32.dirname(existing);
    if (parent === existing) throw new Error('명령창 실행 경로를 확인하지 못했습니다.');
    suffix.unshift(path.win32.basename(existing));
    existing = parent;
  }
  return path.win32.join(fs.realpathSync.native(existing), ...suffix);
}

function isExternalWindowsHost(identity, appPath, canonicalize = value => path.win32.resolve(value)) {
  if (!path.win32.isAbsolute(appPath || '')) throw new Error('Invalid installed application path');
  const root = canonicalize(path.win32.dirname(appPath)).toLowerCase();
  const executable = canonicalize(identity.ExecutablePath).toLowerCase();
  const prefix = root.endsWith('\\') ? root : root + '\\';
  const command = String(identity.CommandLine).replaceAll('/', '\\').toLowerCase();
  const scripts = [...command.matchAll(/"([^"\r\n]*\\terminalhostdaemon\.js)"|(\S*\\terminalhostdaemon\.js)(?=\s|$)/g)]
    .map(match => match[1] || match[2]);
  if (scripts.length !== 1 || !path.win32.isAbsolute(scripts[0])) return false;
  const script = canonicalize(scripts[0]).toLowerCase();
  // The executable AND the launch command must be outside the installation.
  // A source Electron loading this installation's app.asar still belongs to it.
  return executable !== root && !executable.startsWith(prefix)
    && !script.startsWith(prefix) && !command.includes(prefix);
}

async function externalTerminalHost(client, appPath, options = {}) {
  if ((options.platform || process.platform) !== 'win32') return false;
  const discovery = client.discovery;
  if (!client.connected || !discovery) throw new Error('명령창 연결 상태를 확인하지 못했습니다.');
  const inspect = options.inspect || readWindowsHostProcess;
  const before = await inspect(Number(discovery.pid));
  await client.verifyHost(discovery);
  const after = await inspect(Number(discovery.pid));
  if (client.discovery !== discovery || !client.connected
    || before.Started !== after.Started || before.ExecutablePath !== after.ExecutablePath
    || before.CommandLine !== after.CommandLine) throw new Error('업데이트 준비 중 명령창 연결 프로그램이 바뀌었습니다.');
  return isExternalWindowsHost(after, appPath, options.canonicalize || canonicalWindowsLaunchPath);
}

module.exports = { readWindowsHostProcess, isExternalWindowsHost, externalTerminalHost };
