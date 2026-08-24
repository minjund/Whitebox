'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const TEMP_PREFIX = 'whitebox-drawer-actual-pty-';
const OWNER_FILE = '.whitebox-drawer-actual-pty-owner.json';

function ownedTemporaryRoot(candidate, nonce) {
  const resolved = path.resolve(String(candidate || ''));
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`PTY integration temporary root is not an owned directory: ${resolved}`);
  }
  const real = fs.realpathSync(resolved);
  if (path.dirname(real) !== temporaryParent
    || !path.basename(real).startsWith(TEMP_PREFIX)
    || real === temporaryParent) {
    throw new Error(`Refusing to clean an unexpected PTY integration path: ${real}`);
  }
  const ownerPath = path.join(real, OWNER_FILE);
  const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  if (owner.nonce !== nonce || owner.runnerPid !== process.pid) {
    throw new Error(`PTY integration temporary ownership did not match: ${real}`);
  }
  return real;
}

function runElectron(electron, script, cwd, environment) {
  return new Promise(resolve => {
    const child = spawn(electron, [script], {
      cwd,
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', error => resolve({ code: null, signal: '', error }));
    child.once('exit', (code, signal) => resolve({ code, signal: signal || '', error: null }));
  });
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const nonce = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(path.join(temporary, OWNER_FILE), JSON.stringify({
    nonce,
    runnerPid: process.pid,
  }));

  let result = { code: null, signal: '', error: null };
  let cleanupError = null;
  try {
    const electron = require('electron');
    result = await runElectron(
      electron,
      path.join(__dirname, 'drawer-actual-pty-integration.js'),
      root,
      {
        ...process.env,
        WHITEBOX_DRAWER_ACTUAL_PTY_TEMP_ROOT: temporary,
        WHITEBOX_DRAWER_ACTUAL_PTY_TEMP_NONCE: nonce,
      },
    );
  } catch (error) {
    result = { code: null, signal: '', error };
  } finally {
    try {
      const exactRoot = ownedTemporaryRoot(temporary, nonce);
      fs.rmSync(exactRoot, { recursive: true, force: false, maxRetries: 40, retryDelay: 100 });
      if (fs.existsSync(exactRoot)) {
        throw new Error(`PTY integration temporary directory remained: ${exactRoot}`);
      }
      if (process.env.WHITEBOX_DRAWER_ACTUAL_PTY_TEST_POST_CLEANUP_FAILURE === '1') {
        throw new Error('Simulated post-Electron cleanup verification failure.');
      }
      process.stdout.write(`✓ Electron 종료 후 임시 PTY 디렉터리 정리 검증: ${path.basename(exactRoot)}\n`);
    } catch (error) {
      cleanupError = error;
      process.stderr.write(`Post-Electron PTY cleanup failed: ${error.stack || error}\n`);
    }
  }

  if (result.error) {
    process.stderr.write(`Could not run Electron PTY integration: ${result.error.stack || result.error}\n`);
  } else if (result.signal) {
    process.stderr.write(`Electron PTY integration exited from signal ${result.signal}.\n`);
  }
  process.exitCode = cleanupError || result.error || result.signal || result.code !== 0 ? 1 : 0;
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
