'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractArtifacts, enrichSession } = require('../../src/sessionIntelligence');
const { AgentMonitor } = require('../../src/agentMonitor');
const { TmuxMonitor } = require('../../src/tmuxMonitor');

const busy = ms => { const end = Date.now() + ms; while (Date.now() < end) { /* a parse that costs time */ } };

const tests = [
  {
    name: 'Session enrichment reuses results for unchanged transcript arrays and recomputes when one is replaced',
    run() {
      const messages = [{ role: 'assistant', text: 'edited src/app.js and ran tests/app.test.js', timestamp: '2026-11-12T01:00:00Z' }];
      const session = { id: 's', status: 'running', messages, lifecycle: [], executions: [], updatedAt: '2026-11-12T01:00:00Z' };
      const first = extractArtifacts(session);
      assert.deepEqual(first.map(item => item.value), ['src/app.js', 'tests/app.test.js']);
      first[0].value = 'mutated by a caller';
      assert.equal(extractArtifacts({ ...session })[0].value, 'src/app.js', 'callers get copies; the cached list is never changed');
      const grown = [...messages, { role: 'assistant', text: 'also wrote docs/guide.md', timestamp: '2026-11-12T01:01:00Z' }];
      assert.deepEqual(extractArtifacts({ ...session, messages: grown }).map(item => item.value), ['src/app.js', 'tests/app.test.js', 'docs/guide.md']);
      assert.ok(extractArtifacts({ ...session, result: 'see lib/x.ts' }).some(item => item.value === 'lib/x.ts'), 'a changed result is not served from the cache');
      const later = { ...session, messages: grown, lifecycle: [{ label: 'step', completedAt: '2026-11-12T02:00:00Z' }] };
      assert.equal(enrichSession(later).progress.lastActivityAt, '2026-11-12T02:00:00.000Z', 'a replaced lifecycle updates the latest activity');
    },
  },
  {
    name: 'A growing transcript whose parse is expensive is re-parsed at most every few seconds; cheap or shrunk files are re-parsed at once',
    run() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-monitor-cost-'));
      try {
        const file = path.join(dir, 'a.jsonl');
        fs.writeFileSync(file, 'one\n');
        const monitor = new AgentMonitor({ home: dir, changedReparseMinMs: 300 });
        let parses = 0, cost = 30;
        const parser = info => { parses++; busy(cost); return { id: 'a', status: 'completed', size: info.size }; };
        const info = () => { const stat = fs.statSync(file); return { file, mtimeMs: stat.mtimeMs, size: stat.size }; };
        assert.equal(monitor.parseFile(info(), parser).size, 4);
        fs.appendFileSync(file, 'two\n');
        assert.equal(monitor.parseFile(info(), parser).size, 4, 'an expensive file that just grew keeps its last parse for now');
        assert.equal(parses, 1);
        busy(320);
        assert.equal(monitor.parseFile(info(), parser).size, 8, 'after the interval the new content is parsed');
        fs.writeFileSync(file, 'x\n');
        cost = 0;
        assert.equal(monitor.parseFile(info(), parser).size, 2, 'a shrunk or replaced file is never served from the old parse');
        fs.appendFileSync(file, 'y\n');
        assert.equal(monitor.parseFile(info(), parser).size, 4, 'a cheap parse is never held back');
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    },
  },
  {
    name: 'The tmux probe runs every 5s while a tmux session exists and every 30s while none does',
    run() {
      const quiet = ['M', '/Users/dev', 'tmux_3.4'].join('|~|');
      const active = [quiet, ['P', '$1', 'work', '1784000000', '1', '1', '@1', '0', 'main', '1', '%1', '0', '500', 'zsh', '/Users/dev/repo', '1', '0', 'dev'].join('|~|')].join('\n');
      let output = quiet, probes = 0;
      const monitor = new TmuxMonitor({ platform: 'darwin', execFileSync: () => { probes++; return output; } });
      monitor.scan();
      monitor.lastScanAt = Date.now() - 6_000; monitor.scan();
      assert.equal(probes, 1, 'no tmux session: the 5s mark does not probe again');
      monitor.lastScanAt = Date.now() - 31_000; output = active; monitor.scan();
      assert.equal(probes, 2, 'it still looks again after 30s');
      monitor.lastScanAt = Date.now() - 6_000; monitor.scan();
      assert.equal(probes, 3, 'with a session the 5s pace is kept');
      const testMonitor = new TmuxMonitor({ platform: 'darwin', execFileSync: () => { probes++; return quiet; }, scanTtlMs: 1 });
      testMonitor.scan(); testMonitor.lastScanAt = Date.now() - 10; testMonitor.scan();
      assert.equal(probes, 5, 'an explicit short interval is honored');
    },
  },
];

module.exports = { registerMonitorScanCostTests: context => {
  for (const item of tests) context.test(item.name, item.run);
} };
