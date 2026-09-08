'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const baseline = process.argv[2] || '';
if (baseline && !/^[a-f0-9]{40}$/.test(baseline)) throw new Error('Baseline must be an exact commit SHA');
function load(relative) {
  if (!baseline) return require(path.join(root, relative));
  const filename = path.join(root, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, encoding: 'utf8' }), filename);
  return loaded.exports;
}
const { AgentMonitor, parseCodex } = load('src/agentMonitor.js');
const { enrichSessions } = load('src/sessionIntelligence.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-perf-monitor-'));
try {
  const monitor = new AgentMonitor({ home: temp });
  const file = path.join(temp, 'stream.jsonl');
  const at = '2026-09-08T01:00:00.000Z';
  const rows = [{ timestamp: at, type: 'session_meta', payload: { id: 'performance-stream', cwd: temp } }];
  for (let i = 0; i < 60; i++) rows.push({ timestamp: at, type: 'event_msg', payload: {
    type: i % 2 ? 'agent_message' : 'user_message',
    message: Array.from({ length: 80 }, (_, j) => `src/module-${i}/file-${j}.js measured output`).join(' '),
  } });
  const content = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  let latest;
  for (let revision = 0; revision < 180; revision++) {
    fs.writeFileSync(file, content + JSON.stringify({ timestamp: at, type: 'event_msg', payload: {
      type: 'agent_message', message: 'revision-' + revision,
    } }) + '\n');
    const stat = fs.statSync(file);
    latest = monitor.parseFile({ file, mtimeMs: revision + 1, size: stat.size }, parseCodex);
    assert.equal(latest.messages.at(-1).text, 'revision-' + revision);
  }
  const streamingMs = performance.now() - started;
  global.gc?.();
  const retainedHeapMB = (process.memoryUsage().heapUsed - before) / 1048576;
  const sessions = Array.from({ length: 80 }, (_, i) => ({ ...latest, id: 'perf-' + i }));
  const enrichmentMs = [];
  for (let round = 0; round < 8; round++) {
    const start = performance.now();
    const result = enrichSessions(sessions, Date.parse(at));
    enrichmentMs.push(performance.now() - start);
    assert(result.every(row => row.outcome.artifacts.length === 24));
  }
  if (!baseline) assert.equal(monitor.parseCache.size, 1, 'Obsolete streaming generations retained');
  const report = { baseline: baseline || 'working-tree', revisions: 180, sessions: 80,
    streamingMs, retainedHeapMB, cacheEntries: monitor.parseCache.size, enrichmentMs };
  const output = path.join(root, 'artifacts/performance');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, baseline ? 'synthetic-baseline.json' : 'synthetic-after.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (path.dirname(temp) !== os.tmpdir() || !path.basename(temp).startsWith('whitebox-perf-monitor-')) throw new Error('Unexpected fixture path');
  fs.rmSync(temp, { recursive: true, force: true });
}
