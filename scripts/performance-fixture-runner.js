'use strict';

// Chromium and loaded ASAR files may stay locked until Electron exits on Windows.
// A plain Node parent owns each fixture and verifies cleanup after that exit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const prefix = 'whitebox-performance-fixture-';
const ownerFile = '.performance-test-owner.json';
const fixtures = ['terminal-input-performance-check.js', 'process-monitor-worker-check.js'];

function ownedRoot(root, token, parentPid, fixture) {
  assert(fixtures.includes(fixture), 'Unknown performance fixture');
  const stat = fs.lstatSync(root);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Fixture root must be a real directory');
  const real = fs.realpathSync(root);
  assert.equal(path.dirname(real), fs.realpathSync(os.tmpdir()));
  assert(path.basename(real).startsWith(prefix));
  const owner = JSON.parse(fs.readFileSync(path.join(real, ownerFile), 'utf8'));
  assert.equal(owner.token, token);
  assert.equal(owner.parentPid, Number(parentPid));
  assert.equal(owner.fixture, fixture);
  return real;
}

function fixtureRoot(fixture) {
  return ownedRoot(process.env.WHITEBOX_PERFORMANCE_ROOT, process.env.WHITEBOX_PERFORMANCE_TOKEN,
    process.env.WHITEBOX_PERFORMANCE_PARENT, fixture);
}

async function main() {
  for (const fixture of fixtures) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const token = randomUUID();
    fs.writeFileSync(path.join(root, ownerFile), JSON.stringify({ token, parentPid: process.pid, fixture }));
    try {
      const result = await new Promise((resolve, reject) => {
        const env = { ...process.env, WHITEBOX_PERFORMANCE_ROOT: root, WHITEBOX_PERFORMANCE_TOKEN: token,
          WHITEBOX_PERFORMANCE_PARENT: String(process.pid) };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [path.join(__dirname, fixture)], {
          env, cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true, timeout: 100000,
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });
      assert.equal(result.signal, null, fixture + ' must exit normally');
      assert.equal(result.code, 0, fixture + ' assertions must succeed');
    } finally {
      const exactRoot = ownedRoot(root, token, process.pid, fixture);
      await fs.promises.rm(exactRoot, { recursive: true, force: false, maxRetries: 40, retryDelay: 100 });
      assert.equal(fs.existsSync(exactRoot), false, 'Performance fixture must be removed after Electron exits');
      console.log('PASS post-Electron owned profile/ASAR cleanup: ' + fixture);
    }
  }
}

module.exports = { fixtureRoot, ownedRoot };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
