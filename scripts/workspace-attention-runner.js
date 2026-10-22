'use strict';

// Chromium can retain Windows profile handles until Electron actually exits.
// The parent owns and verifies removal of the fixture after that exit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const prefix = 'whitebox-workspace-attention-';
const ownerFile = '.attention-test-owner.json';

function ownedRoot(root, token, parentPid) {
  const stat = fs.lstatSync(root);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Attention test root must be a real directory');
  const real = fs.realpathSync(root);
  assert.equal(path.dirname(real), fs.realpathSync(os.tmpdir()));
  assert(path.basename(real).startsWith(prefix));
  const owner = JSON.parse(fs.readFileSync(path.join(real, ownerFile), 'utf8'));
  assert.equal(owner.token, token);
  assert.equal(owner.parentPid, parentPid);
  return real;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const token = randomUUID();
  fs.writeFileSync(path.join(root, ownerFile), JSON.stringify({ token, parentPid: process.pid }));
  let exitCode = 1;
  try {
    const result = await new Promise((resolve, reject) => {
      const env = { ...process.env, WHITEBOX_ATTENTION_TEST_ROOT: root, WHITEBOX_ATTENTION_TEST_TOKEN: token };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [path.join(__dirname, 'workspace-attention-check.js')], {
        env, cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true, timeout: 90000,
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(result.signal, null, 'Attention Electron must exit normally');
    assert.equal(result.code, 0, 'Attention Electron assertions and PTY cleanup must succeed');
    exitCode = 0;
  } finally {
    const exactRoot = ownedRoot(root, token, process.pid);
    await fs.promises.rm(exactRoot, { recursive: true, force: false, maxRetries: 40, retryDelay: 100 });
    assert.equal(fs.existsSync(exactRoot), false, 'Attention fixture profile must be removed after Electron exits');
    console.log('PASS workspace attention post-Electron owned profile cleanup');
  }
  process.exitCode = exitCode;
}

module.exports = { ownedRoot };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
