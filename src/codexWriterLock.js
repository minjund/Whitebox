'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { stripVTControlCharacters } = require('util');

const CODEX_WRITER_ACTIVE_MESSAGE = '이 Codex 대화가 다른 CLI 또는 앱에서 열려 있습니다. 기존 창에서 대화를 종료한 뒤 PTY 연결을 다시 시도해 주세요.';

function codexResumeWriterConflict(options, output, exitCode) {
  if (options.type !== 'agent' || options.provider !== 'codex' || options.args?.[0] !== 'resume'
    || !Number.isFinite(exitCode) || exitCode === 0) return false;
  const id = options.args[1] === '--' ? options.args[2] : options.args[1];
  // Require the complete final bootstrap diagnostic and the resumed identity.
  // Cursor positioning may place Error directly after an earlier redraw in
  // the byte stream. The caller supplies only this PTY run's output tail.
  // Node's stripper leaves the intermediate space in DECSCUSR (CSI 0 SP q),
  // which Codex emits inside "Error: Failed ..." on Windows.
  const diagnostic = stripVTControlCharacters(String(output || '')
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/gu, '')).trimEnd();
  const match = diagnostic.match(/Error: Failed to resume session from [^\r\n]+: thread\/resume failed during TUI bootstrap: thread\/resume failed: thread ([A-Za-z0-9._:-]+) already has an active writer \(code -32600\)$/u);
  return Boolean(match && match[1] === id);
}

function assertCodexWriterAvailable(options, { platform = process.platform, env = process.env, fileSystem = fs } = {}) {
  // Windows enforces Codex's byte-range writer lock on reads, including an
  // empty lock file. File existence alone does not imply an active writer:
  // Codex retains these files after releasing the lock. Never remove them.
  if (platform !== 'win32' || options.type !== 'agent' || options.provider !== 'codex'
    || options.distro || options.args?.[0] !== 'resume') return;
  const id = options.args[1] === '--' ? options.args[2] : options.args[1];
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(String(id || '')) || /[:]/u.test(id)) return;
  const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const lockPath = path.join(home, 'thread-writer-locks', `${id}.lock`);
  let descriptor;
  try {
    descriptor = fileSystem.openSync(lockPath, 'r');
    fileSystem.readSync(descriptor, Buffer.alloc(1), 0, 1, 0);
  } catch (cause) {
    if (cause.code === 'ENOENT') return;
    const busy = cause.code === 'EBUSY';
    const error = new Error(busy
      ? CODEX_WRITER_ACTIVE_MESSAGE
      : 'Codex 대화의 사용 여부를 확인하지 못해 PTY 연결을 시작하지 않았습니다. 파일 접근 권한을 확인한 뒤 다시 시도해 주세요.');
    error.code = busy ? 'CODEX_SESSION_WRITER_ACTIVE' : 'CODEX_SESSION_WRITER_CHECK_FAILED';
    error.deliveryState = 'rejected';
    error.creationState = 'rejected';
    error.cause = cause;
    throw error;
  } finally {
    if (descriptor !== undefined) fileSystem.closeSync(descriptor);
  }
}

module.exports = { assertCodexWriterAvailable, codexResumeWriterConflict, CODEX_WRITER_ACTIVE_MESSAGE };
