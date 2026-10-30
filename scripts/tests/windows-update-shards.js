'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SHARD_COUNT, makePlan, validatePlan, validateReceipts, verifyFiles, assertAttempt, digest } = require('../windows-update-shards');
const { readCohortManifest } = require('../check-update-compatibility-cohorts');
const { classifyNameStatus } = require('../updater-review-scope');
const { expectedReleaseAssetNames } = require('../release-asset-contract');
const version = require('../../package.json').version;
const context = { sourceSha: 'a'.repeat(40), runId: '123', runAttempt: '1' };
const clone = value => JSON.parse(JSON.stringify(value));
function fixturePlan() {
  return makePlan({ ...context, version, manifest: readCohortManifest(),
    files: expectedReleaseAssetNames(version).filter(n => n.endsWith('.exe')).map(name => ({ name, size: 10, sha256: 'b'.repeat(64) })) });
}
function fixtureReceipts(plan) {
  return plan.shards.map(shard => ({ schema: 1, ...context, planDigest: digest(JSON.stringify(plan)),
    shardId: shard.id, status: 'success', attempts: (shard.kind === 'legacy' ? ['legacy'] : shard.versions).map(version => ({
      version, kind: shard.kind, status: 'success', installMode: shard.kind === 'legacy' ? 'legacy-bridge' : plan.cohorts.find(c => c.version === version).installMode,
      startedAt: '2026-10-30T00:00:00.000Z', completedAt: '2026-10-30T00:01:00.000Z',
    })) }));
}

function registerWindowsUpdateShardTests({ test, temp }) {
  test('업데이트 병렬 분배는 모든 공식 버전을 정확히 한 번 포함하고 레거시는 별도 VM으로 격리한다', () => {
    const plan = fixturePlan();
    validatePlan(plan, context);
    const cohorts = plan.shards.filter(s => s.kind === 'cohort');
    assert.equal(cohorts.length, SHARD_COUNT);
    assert.equal(plan.shards.filter(s => s.kind === 'legacy').length, 1);
    assert.deepEqual(cohorts.flatMap(s => s.versions).sort(), plan.cohorts.map(c => c.version).sort());
    assert(Math.max(...cohorts.map(s => s.versions.length)) - Math.min(...cohorts.map(s => s.versions.length)) <= 1);
    assert.equal(cohorts[0].versions[0], plan.manifest.previousFixed.version);
    for (const version of ['1.7.3', '1.7.4', '1.7.5', '2.0.7', '2.0.8', '2.0.9']) assert(cohorts.some(s => s.versions.includes(version)));
  });
  test('업데이트 계획은 다른 SHA·실행·재실행·설치본 핀 및 누락·중복 분배를 거부한다', () => {
    const plan = fixturePlan();
    for (const mutate of [
      p => { p.sourceSha = 'c'.repeat(40); }, p => { p.runId = '124'; }, p => { p.runAttempt = '2'; },
      p => { p.shards[0].versions.pop(); }, p => { p.shards[0].versions.push(p.shards[0].versions[0]); },
      p => { p.shards.pop(); }, p => { p.cohorts[0].sha256 = 'd'.repeat(64); },
      p => { p.manifest.previousFixed.sha256 = 'e'.repeat(64); },
    ]) { const changed = clone(plan); mutate(changed); assert.throws(() => validatePlan(changed, context)); }
    for (const file of ['scripts/windows-update-shards.js', 'scripts/tests/windows-update-shards.js', '.github/workflows/windows-update-shards.yml', 'docs/UPDATE-SHARDING.md']) {
      assert.equal(classifyNameStatus('M\t' + file).sensitive, true, file);
    }
  });
  test('Windows 분할 검사는 실제 후보 파일의 손상·추가 파일·자동/수동 별칭 차이를 거부한다', () => {
    const directory = path.join(temp, 'shard-candidate-bytes'); fs.mkdirSync(directory);
    const files = expectedReleaseAssetNames(version).filter(n => n.endsWith('.exe')).map(name => {
      fs.writeFileSync(path.join(directory, name), 'candidate fixture');
      return { name, size: 17, sha256: digest('candidate fixture') };
    });
    const plan = makePlan({ ...context, version, manifest: readCohortManifest(), files });
    verifyFiles(plan, directory);
    fs.writeFileSync(path.join(directory, files[0].name), 'tampered fixture!');
    assert.throws(() => verifyFiles(plan, directory));
    fs.writeFileSync(path.join(directory, files[0].name), 'candidate fixture');
    fs.writeFileSync(path.join(directory, 'extra.exe'), 'unexpected');
    assert.throws(() => verifyFiles(plan, directory));
    const changed = clone(files); changed.find(f => f.name.includes('Manual')).sha256 = 'f'.repeat(64);
    assert.throws(() => makePlan({ ...context, version, manifest: readCohortManifest(), files: changed }));
  });
  test('업데이트 완료 집계는 빠진 VM·부분 성공·과거 실행·서로 다른 후보 및 누락된 필수 경로를 차단한다', () => {
    const plan = fixturePlan(), receipts = fixtureReceipts(plan);
    assert.equal(validateReceipts(plan, receipts).length, plan.cohorts.length + 1);
    for (const mutate of [
      r => { r.pop(); }, r => { r[0] = r[1]; }, r => { r[0].status = 'failure'; },
      r => { r[0].runId = '999'; }, r => { r[0].runAttempt = '2'; },
      r => { r[0].sourceSha = 'c'.repeat(40); }, r => { r[0].planDigest = 'c'.repeat(64); },
      r => { r[0].attempts.pop(); }, r => { r[0].attempts.push(clone(r[0].attempts[0])); },
      r => { r.at(-1).attempts = []; }, r => { r[0].attempts[0].status = 'skipped'; },
      r => { r[0].attempts[0].completedAt = '2025-01-01T00:00:00Z'; },
    ]) { const changed = clone(receipts); mutate(changed); assert.throws(() => validateReceipts(plan, changed)); }
  });
  test('업데이트 자식 프로세스는 정상 종료와 해당 새 실행의 유일한 완료 근거가 모두 있어야 통과한다', () => {
    const marker = 'packaged fixture and cleanup complete';
    assertAttempt({ status: 0, signal: null }, marker + '\n', marker);
    for (const result of [{ status: 1, signal: null }, { status: 0, signal: 'SIGTERM' }, { status: null, signal: null, error: new Error('timeout') }]) {
      assert.throws(() => assertAttempt(result, marker, marker));
    }
    for (const stdout of ['', 'Windows integration skipped: win32 only.', marker + marker]) {
      assert.throws(() => assertAttempt({ status: 0, signal: null }, stdout, marker));
    }
  });
}
module.exports = { registerWindowsUpdateShardTests };
