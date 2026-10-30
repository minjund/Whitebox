'use strict';

// Separate GitHub-hosted VMs own the NSIS registry and native roaming profiles.
// Each VM still runs its assigned packaged attempts serially with the original
// installer/ACK/relaunch/cleanup assertions and deadlines.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { cohortList, readCohortManifest } = require('./check-update-compatibility-cohorts');
const { expectedReleaseAssetNames } = require('./release-asset-contract');
const SHARD_COUNT = 6;
const planFile = path.resolve('artifacts/windows-update-plan/plan.json');
const resultDir = path.resolve('artifacts/windows-update-results');
const candidateDir = path.resolve('release');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fileDigest = file => digest(fs.readFileSync(file));

function makePlan({ sourceSha, version, manifest, files, runId, runAttempt }) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  assert.match(String(runId), /^[1-9]\d*$/);
  assert.match(String(runAttempt), /^[1-9]\d*$/);
  const expectedNames = expectedReleaseAssetNames(version).filter(name => name.endsWith('.exe')).sort();
  assert.deepEqual(files.map(file => file.name).sort(), expectedNames);
  for (const file of files) {
    assert.deepEqual(Object.keys(file).sort(), ['name', 'sha256', 'size']);
    assert(Number.isSafeInteger(file.size) && file.size > 0);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }
  const canonical = files.find(file => file.name === `Whitebox-Setup-${version}.exe`);
  const manual = files.find(file => file.name === `Whitebox-Manual-Setup-${version}-x64.exe`);
  assert.equal(canonical.size, manual.size);
  assert.equal(canonical.sha256, manual.sha256);
  const cohorts = cohortList(manifest);
  assert(cohorts.length >= SHARD_COUNT);
  const ordered = [...cohorts.filter(c => c.version === manifest.previousFixed.version),
    ...cohorts.filter(c => c.version !== manifest.previousFixed.version)];
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) => ({
    id: `cohort-${index + 1}`, kind: 'cohort',
    versions: ordered.filter((_cohort, position) => position % SHARD_COUNT === index).map(c => c.version),
  }));
  shards.push({ id: 'legacy', kind: 'legacy', versions: [] });
  return { schema: 1, sourceSha, version, runId: String(runId), runAttempt: String(runAttempt), manifest,
    cohorts, files: [...files].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0), shards };
}

function validatePlan(plan, context, manifest = readCohortManifest()) {
  assert.equal(plan.sourceSha, context.sourceSha, 'Candidate source SHA changed');
  assert.equal(plan.runId, String(context.runId), 'Cannot reuse another workflow run');
  assert.equal(plan.runAttempt, String(context.runAttempt), 'Cannot combine separate workflow attempts');
  assert.equal(plan.version, require('../package.json').version);
  assert.deepEqual(plan.manifest, manifest, 'Candidate manifest differs from selected source');
  assert.deepEqual(plan, makePlan({ ...plan, manifest }), 'Incomplete or altered shard plan');
  return plan;
}

function context() {
  const sourceSha = String(process.env.EXPECTED_SOURCE_SHA || '');
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceSha);
  return { sourceSha, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT };
}

function loadPlan() {
  return validatePlan(JSON.parse(fs.readFileSync(planFile, 'utf8')), context());
}

function verifyFiles(plan, directory = candidateDir) {
  const actual = fs.readdirSync(directory).filter(name => name.endsWith('.exe')).sort();
  assert.deepEqual(actual, plan.files.map(file => file.name).sort(), 'Unexpected candidate installers');
  for (const file of plan.files) {
    const fullPath = path.join(directory, file.name);
    assert.equal(fs.statSync(fullPath).size, file.size, 'Candidate size: ' + file.name);
    assert.equal(fileDigest(fullPath), file.sha256, 'Candidate SHA-256: ' + file.name);
  }
}

function exportEnv(key, value) {
  assert.match(key, /^[A-Z][A-Z0-9_]*$/);
  assert(!/[\r\n]/.test(String(value)));
  fs.appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`);
}

function getShard(plan, id = process.env.WHITEBOX_UPDATE_SHARD) {
  const shard = plan.shards.find(shard => shard.id === id);
  assert(shard, 'Unknown or missing shard');
  return shard;
}

function assertWindowsRunner() {
  assert.equal(process.platform, 'win32', 'Packaged execution requires Windows');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'NSIS attempts require isolated hosted VMs');
}

async function downloadCohorts(plan, shard) {
  assert.equal(shard.kind, 'cohort');
  const directory = path.resolve('artifacts/windows-update-inputs');
  fs.mkdirSync(directory, { recursive: true });
  for (const version of shard.versions) {
    const cohort = plan.cohorts.find(c => c.version === version);
    const file = path.join(directory, path.posix.basename(new URL(cohort.url).pathname));
    console.log(`Download pinned official ${version}: ${cohort.url}`);
    const response = await fetch(cohort.url, { headers: { 'User-Agent': 'Whitebox-packaged-update-cohort-check' }, signal: AbortSignal.timeout(180000) });
    assert.equal(response.status, 200);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file, { flags: 'wx' }));
    assert.equal(fs.statSync(file).size, cohort.size, 'Official installer size: ' + version);
    assert.equal(fileDigest(file), cohort.sha256, 'Official installer digest: ' + version);
    exportEnv(cohort.env, file);
  }
}

function assertAttempt(result, stdout, expectedMarker) {
  if (result.error) throw result.error;
  assert.equal(result.signal, null, 'An interrupted attempt is not a pass');
  assert.equal(result.status, 0, 'Packaged attempt failed');
  assert.equal(stdout.split(expectedMarker).length - 1, 1, 'Missing or duplicate packaged success/cleanup evidence');
}

function runShard(plan, shard) {
  assertWindowsRunner();
  verifyFiles(plan);
  fs.mkdirSync(resultDir, { recursive: true });
  const receipt = { schema: 1, sourceSha: plan.sourceSha, runId: plan.runId, runAttempt: plan.runAttempt,
    planDigest: digest(JSON.stringify(plan)), shardId: shard.id, status: 'failure', attempts: [] };
  const versions = shard.kind === 'legacy' ? ['legacy'] : shard.versions;
  try {
    for (const version of versions) {
      const cohort = plan.cohorts.find(c => c.version === version);
      const script = shard.kind === 'legacy' ? 'windows-legacy-update-bridge-integration.js' : 'windows-v173-update-integration.js';
      const marker = shard.kind === 'legacy'
        ? `Packaged v1.6.3 reached the immutable 1.6.23 bridge, selected the manual alias for Whitebox ${plan.version}, and the installed candidate then reinstalled itself through one acknowledged automatic handshake.`
        : `Official Whitebox ${version} reached ${plan.version} through its packaged ${cohort.installMode} path; the candidate updater then acknowledged bootstrap and reinstalled/relaunched the same target exactly once.`;
      console.log(`Run ${shard.id}: ${version} -> ${plan.version}; source=${plan.sourceSha}`);
      const startedAt = new Date().toISOString();
      const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
        env: { ...process.env, ...(cohort ? { WHITEBOX_FROZEN_VERSION: version } : {}) },
        encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true,
      });
      const stdout = result.stdout || '', stderr = result.stderr || '';
      fs.writeFileSync(path.join(resultDir, `${shard.id}-${version}.log`), stdout + stderr, { flag: 'wx' });
      process.stdout.write(stdout); process.stderr.write(stderr);
      assertAttempt(result, stdout, marker);
      receipt.attempts.push({ version, kind: shard.kind, installMode: cohort ? cohort.installMode : 'legacy-bridge',
        status: 'success', startedAt, completedAt: new Date().toISOString() });
    }
    verifyFiles(plan);
    receipt.status = 'success';
  } finally {
    // No partial receipt can pass aggregation, including cleanup/timeout errors.
    fs.writeFileSync(path.join(resultDir, `${shard.id}.json`), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  }
}

function validateReceipts(plan, receipts) {
  assert.equal(receipts.length, plan.shards.length, 'A required shard is missing');
  assert.deepEqual(receipts.map(r => r.shardId).sort(), plan.shards.map(s => s.id).sort(), 'Duplicate or unknown shard');
  const attempts = [];
  for (const receipt of receipts) {
    assert.equal(receipt.schema, 1);
    for (const key of ['sourceSha', 'runId', 'runAttempt']) assert.equal(receipt[key], plan[key]);
    assert.equal(receipt.planDigest, digest(JSON.stringify(plan)), 'Different candidate or source plan');
    assert.equal(receipt.status, 'success', 'A failed or partial shard cannot pass');
    const shard = getShard(plan, receipt.shardId);
    const expected = shard.kind === 'legacy' ? ['legacy'] : shard.versions;
    assert.deepEqual(receipt.attempts.map(a => a.version).sort(), [...expected].sort(), 'Missing, duplicate or unassigned source');
    for (const attempt of receipt.attempts) {
      assert.equal(attempt.kind, shard.kind);
      assert.equal(attempt.status, 'success');
      assert.equal(attempt.installMode, shard.kind === 'legacy' ? 'legacy-bridge' : plan.cohorts.find(c => c.version === attempt.version).installMode);
      const start = Date.parse(attempt.startedAt), end = Date.parse(attempt.completedAt);
      assert(Number.isFinite(start) && Number.isFinite(end) && end >= start);
      attempts.push(attempt);
    }
  }
  assert.deepEqual(attempts.filter(a => a.kind === 'cohort').map(a => a.version).sort(), plan.cohorts.map(c => c.version).sort());
  assert.equal(attempts.filter(a => a.kind === 'legacy').length, 1);
  for (const required of ['1.7.3', '1.7.4', '1.7.5']) assert(attempts.some(a => a.version === required));
  return attempts;
}

async function main(command) {
  if (command === 'create') {
    const ctx = context(), manifest = readCohortManifest(), version = require('../package.json').version;
    if (process.env.EXPECTED_COHORT_MANIFEST) assert.equal(JSON.stringify(manifest), process.env.EXPECTED_COHORT_MANIFEST);
    const canonical = path.join(candidateDir, `Whitebox-Setup-${version}.exe`);
    fs.copyFileSync(canonical, path.join(candidateDir, `Whitebox-Manual-Setup-${version}-x64.exe`), fs.constants.COPYFILE_EXCL);
    const files = expectedReleaseAssetNames(version).filter(name => name.endsWith('.exe')).map(name => ({
      name, size: fs.statSync(path.join(candidateDir, name)).size, sha256: fileDigest(path.join(candidateDir, name)),
    }));
    const plan = makePlan({ ...ctx, manifest, version, files });
    verifyFiles(plan);
    fs.mkdirSync(path.dirname(planFile), { recursive: true });
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2), { flag: 'wx' });
    console.log(`Pinned ${plan.cohorts.length} source cohorts across ${SHARD_COUNT} isolated VMs plus the legacy VM; SHA=${plan.sourceSha}`);
    return;
  }
  const plan = loadPlan();
  if (command === 'plan') {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include: plan.shards.map(({ id, kind }) => ({ id, kind })) })}\n`);
  } else if (command === 'verify') {
    assertWindowsRunner(); verifyFiles(plan); getShard(plan);
    const canonical = plan.files.find(f => f.name === `Whitebox-Setup-${plan.version}.exe`);
    for (const [key, value] of Object.entries({
      WHITEBOX_CURRENT_INSTALLER: path.join(candidateDir, canonical.name),
      WHITEBOX_MANUAL_INSTALLER: path.join(candidateDir, `Whitebox-Manual-Setup-${plan.version}-x64.exe`),
      WHITEBOX_CURRENT_INSTALLER_SIZE: canonical.size, WHITEBOX_CURRENT_INSTALLER_SHA256: canonical.sha256,
      WHITEBOX_LEGACY_CANDIDATE_E2E: 'true',
    })) exportEnv(key, value);
  } else if (command === 'download') {
    assertWindowsRunner(); await downloadCohorts(plan, getShard(plan));
  } else if (command === 'run') {
    runShard(plan, getShard(plan));
  } else if (command === 'collect') {
    const receipts = fs.readdirSync(resultDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(resultDir, f))));
    const attempts = validateReceipts(plan, receipts);
    const summary = `## Packaged Windows updater coverage\n\nSource: ${plan.sourceSha}\n\n| Source | Path | Result |\n| --- | --- | --- |\n${attempts.map(a => `| ${a.version} | ${a.installMode} | PASS |`).join('\n')}\n\nEvery attempt includes candidate self-reinstall/relaunch and cleanup.\n`;
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'verified=true\n');
    console.log(`PASS complete fresh-run coverage: ${plan.cohorts.length} official sources, legacy bridge, candidate self-reinstall and cleanup; ${plan.sourceSha}`);
  } else throw new Error('Unknown shard command: ' + command);
}

module.exports = { SHARD_COUNT, makePlan, validatePlan, verifyFiles, assertAttempt, validateReceipts, digest };
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
