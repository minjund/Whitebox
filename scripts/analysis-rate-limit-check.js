'use strict';
// Opt-in, ~180 seconds. Real OS processes replay one observed transport diagnostic;
// no model calls. This measures failure handling, not successful model latency.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { AgentRunner } = require('../src/agentRunner');
const { baseline } = require('./analysis-live-comparison');
async function run() {
  if (!process.argv.includes('--run')) throw new Error('Use --run for the 180-second real-process diagnostic replay (no model calls).');
  if (process.platform === 'win32') throw new Error('This local diagnostic replay uses a POSIX executable; cross-platform behavior is covered by runner tests.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-rate-limit-'));
  const originalPath = process.env.PATH;
  const diagnostic = 'WARN codex_core::responses_retry: stream disconnected - retrying sampling request (1/5 in 479.999868675s)... sampling_error=exceeded retry limit, last status: 429 Too Many Requests';
  const report = { kind: 'real OS process replay of observed CLI stderr; no live model or successful analysis latency claim', diagnostic, modelCalls: 0, results: [] };
  try {
    const bin = path.join(dir, 'bin'); await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, 'codex'), `#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on('end',()=>{process.stderr.write(${JSON.stringify(diagnostic + '\n')});setInterval(()=>{},1000);});\n`, { mode: 0o700 });
    process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
    const OldRunner = baseline('agentRunner').AgentRunner;
    for (const [variant, Runner] of [['candidate', AgentRunner], ['baseline', OldRunner]]) {
      const runner = new Runner({ runsDir: path.join(dir, variant, 'runs') });
      const start = performance.now(); let failure;
      console.log(`START ${variant}`);
      try { await runner.generateTerminalReview({ provider: 'codex', prompt: 'Synthetic diagnostic replay; no tools.' }); }
      catch (error) { failure = { code: error.code || null, message: error.message, retryAfterMs: error.retryAfterMs || null }; }
      const elapsedMs = performance.now() - start;
      const closeDeadline = Date.now() + 10000;
      while (runner.active.size && Date.now() < closeDeadline) await new Promise(resolve => setTimeout(resolve, 20));
      const cleaned = runner.active.size === 0;
      await runner.dispose();
      assert(cleaned, 'owned child close must be observed'); assert(failure, 'transport rejection cannot become success');
      report.results.push({ variant, elapsedMs, failure, ownedProcessCleanupVerified: cleaned });
      console.log(`DONE ${variant} ${elapsedMs.toFixed(1)}ms ${failure.code || failure.message}`);
      if (variant === 'candidate') { assert.equal(failure.code, 'REVIEW_RATE_LIMITED'); assert.equal(failure.retryAfterMs, 480000); }
      else { assert.match(failure.message, /시간이 초과/); assert(elapsedMs >= 179000); }
    }
    assert(report.results[0].elapsedMs < report.results[1].elapsedMs / 10, 'capacity recognition must take less than one tenth of the old timeout');
  } finally {
    process.env.PATH = originalPath;
    const out = path.join(__dirname, '../artifacts/analysis-rate-limit-2.0.5.json');
    await fs.mkdir(path.dirname(out), { recursive: true }); await fs.writeFile(out, JSON.stringify(report, null, 2));
    await fs.rm(dir, { recursive: true, force: true });
  }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
