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
      const request = 'Add a hidden API key field to settings, show the saved key only on request, and verify that hiding clears the displayed saved key.';
      const examples = [
        { name: 'fulfilled', expected: 'supported', source: 'USER REQUEST: '+request+'\nASSISTANT REPORT: Implemented the hidden API key field. The Show button reads the encrypted saved key on request. Hide removes the displayed saved key and shows a fixed mask.\nTEST RESULT: All three requirements were tested and passed. No tests were removed. No outstanding requirements or failures remain.' },
        { name: 'unfulfilled', expected: 'unsupported', source: 'USER REQUEST: '+request+'\nASSISTANT REPORT: No implementation was completed. The API key remains exposed in plain text on opening settings. Show and Hide buttons are missing.\nTEST RESULT: All requested behaviors fail. The user requirements remain unimplemented.' },
      ];
      const checks = await Promise.all(examples.map(async example => {
        const result = await client.analyze({ request, source: example.source, context: {}, locale: 'en' });
        const task = result.task;
        assert.equal(task.analysisProvider, 'jev');
        assert.equal(Object.keys(task.typedAnalysis.judgments).length, 5);
        for (const probability of Object.values(task.typedAnalysis.probabilities)) assert(Number.isFinite(probability) && probability >= 0 && probability <= 1);
        return { name: example.name, expected: example.expected, actual: task.typedAnalysis.judgments.fulfilled, probability: task.typedAnalysis.probabilities.fulfilled,
          model: task.analysisModel, usage: task.analysisUsage, elapsedMs: result.timings.completedAt - result.timings.modelStartedAt };
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
