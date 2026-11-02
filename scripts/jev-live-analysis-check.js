'use strict';

// Explicit opt-in only: this uses the user's encrypted application credential
// and makes two billable requests with synthetic evidence, never PTY contents.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JevAnalysis, ENDPOINT } = require('../src/jevAnalysis');
const root = path.resolve(__dirname, '..');
if (!app) {
  console.error('Run this check using Electron, not Node.'); process.exitCode = 1;
} else if (!process.argv.includes('--live') || !process.env.WHITEBOX_JEV_LIVE_KEY_FILE) {
  console.error('Requires --live and WHITEBOX_JEV_LIVE_KEY_FILE pointing to the encrypted Whitebox key file.');
  app.exit(1);
} else {
  app.setName('Whitebox');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-jev-live-'));
  app.setPath('userData', profile);
  app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
  app.whenReady().then(async () => {
    const deadline = setTimeout(() => { console.error('Live Jev verification timed out.'); app.exit(1); }, 45000);
    const startedAt = Date.now();
    try {
      assert(fs.statSync(process.env.WHITEBOX_JEV_LIVE_KEY_FILE).isFile(), 'Encrypted application key file is required.');
      const client = new JevAnalysis({ file: process.env.WHITEBOX_JEV_LIVE_KEY_FILE, secure: safeStorage });
      const examples = [
        { name: 'simple-observation', expected: false, request: 'Print the first line of README.txt exactly.', source: 'USER: Print the first line of README.txt exactly.\nTOOL RESULT: first line = Welcome\nASSISTANT: Welcome\nNo interpretation or decision was requested.' },
        { name: 'interpretation-required', expected: true, request: 'Decide whether this release is ready, using the test evidence.', source: 'USER: Decide whether this release is ready, using the test evidence.\nASSISTANT: All tests passed; ready to release.\nTOOL RESULT: The privacy regression test was deleted without replacement. Encryption remains unverified; a previous run reported plaintext exposure. A later test run passed 12 unrelated tests.' },
      ];
      const checks = await Promise.all(examples.map(async example => {
        const result = await client.assessNeed({ request: example.request, source: example.source, context: {} });
        assert(Number.isFinite(result.probability) && result.probability >= 0 && result.probability <= 1);
        assert.equal(result.task, undefined, 'screening must not produce a review task');
        return { name: example.name, expected: example.expected, actual: result.needsAnalysis, probability: result.probability,
          model: result.model, usage: result.usage, elapsedMs: result.timings.completedAt - result.timings.startedAt };
      }));
      const report = { endpoint: ENDPOINT, evidence: 'synthetic fixtures only; no terminal output', calls: checks.length, elapsedMs: Date.now()-startedAt, checks };
      const output = path.join(root, 'artifacts/settings/jev-live-analysis.json');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(report,null,2));
      console.log(JSON.stringify(report));
      assert(checks.every(check => check.actual === check.expected), 'Live judgments did not match both controlled examples.');
      clearTimeout(deadline); app.exit(0);
    } catch (error) {
      console.error(error.message); clearTimeout(deadline); app.exit(1);
    }
  });
}
