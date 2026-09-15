'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

function validatePids(pids) {
  assert(Array.isArray(pids) && pids.every(pid => Number.isSafeInteger(pid) && pid > 0),
    'Process exit checks require positive integer PIDs');
  assert.equal(new Set(pids).size, pids.length, 'Process exit checks reject duplicate PIDs');
}

function probeWindowsProcessIds(pids, { powershell = 'powershell.exe', spawn = spawnSync } = {}) {
  validatePids(pids);
  if (!pids.length) return [];
  const filter = pids.map(pid => `ProcessId = ${pid}`).join(' OR ');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$records = @(Get-CimInstance Win32_Process -Filter '${filter}' -ErrorAction Stop)`,
    '$ids = @($records | ForEach-Object { [long]$_.ProcessId })',
    '[Console]::Write((ConvertTo-Json -InputObject $ids -Compress))',
  ].join('\n');
  const result = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Process exit query failed (${result.status}): ${result.stderr || ''}`);
  }
  const alive = JSON.parse(String(result.stdout).trim());
  validatePids(alive);
  assert(alive.every(pid => pids.includes(pid)), 'Process exit query returned an unrequested PID');
  return alive;
}

async function waitForOwnedProcessIdsExit(pids, {
  probe = probeWindowsProcessIds, timeoutMs = 30_000, pollMs = 100,
} = {}) {
  validatePids(pids);
  if (!pids.length) return;
  const deadline = Date.now() + timeoutMs;
  let consecutiveAbsences = 0;
  while (Date.now() < deadline) {
    const alive = await probe(pids);
    if (Date.now() >= deadline) break;
    validatePids(alive);
    assert(alive.every(pid => pids.includes(pid)), 'Process exit query returned an unrequested PID');
    consecutiveAbsences = alive.length ? 0 : consecutiveAbsences + 1;
    if (consecutiveAbsences === 2) return;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out verifying owned process exit: ${pids.join(', ')}`);
}

module.exports = { probeWindowsProcessIds, waitForOwnedProcessIdsExit };
