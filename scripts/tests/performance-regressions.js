'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { AgentMonitor, parseCodex } = require('../../src/agentMonitor');
const { extractArtifacts, enrichSession } = require('../../src/sessionIntelligence');
const { createSnapshotPublicationCoordinator } = require('../../src/monitorPublicationCoordinator');

function registerPerformanceRegressionTests({ test, temp, jsonl, root }) {
  test('a provider file event refreshes its discovery without invalidating unrelated histories', () => {
    const monitor = new AgentMonitor({ home: temp });
    const roots = ['provider-a', 'provider-b'].map(name => path.join(temp, name));
    for (const dir of roots) jsonl(path.join(dir, 'first.jsonl'), [{ id: 'first' }]);
    const files = dir => monitor.files(dir, dir, (_file, name) => name.endsWith('.jsonl'), 80, 6);
    for (const dir of roots) assert.equal(files(dir).length, 1);
    for (const dir of roots) jsonl(path.join(dir, 'new.jsonl'), [{ id: 'new' }]);
    monitor.invalidateFiles(roots[0]);
    assert.equal(files(roots[0]).length, 2);
    assert.equal(files(roots[1]).length, 1, 'unrelated provider keeps its cached discovery');
    monitor.invalidateFiles(roots[1]);
    assert.equal(files(roots[1]).length, 2);
  });

  test('streaming transcript cache retains only current card and full-history generations', () => {
    const monitor = new AgentMonitor({ home: temp });
    const file = path.join(temp, 'performance', 'stream.jsonl');
    const at = '2026-09-08T01:00:00.000Z';
    for (let i = 0; i < 180; i++) {
      const info = jsonl(file, [
        { timestamp: at, type: 'session_meta', payload: { id: 'perf-stream', cwd: temp } },
        { timestamp: at, type: 'event_msg', payload: { type: 'user_message', message: 'request ' + 'x'.repeat(i) } },
        { timestamp: at, type: 'event_msg', payload: { type: 'agent_message', message: 'answer ' + 'y'.repeat(i) } },
      ]);
      const value = monitor.parseFile(info, parseCodex);
      assert.equal(value.messages.at(-1).text, ('answer ' + 'y'.repeat(i)).trim());
      assert.strictEqual(monitor.parseFile(info, () => { throw new Error('unchanged log reparsed'); }), value);
      monitor.parseFile(info, item => parseCodex(item, { fullHistory: true }), 'full-history');
    }
    assert.equal(monitor.parseCache.size, 2);
    const missing = { file, mtimeMs: 0, size: 0 };
    assert.equal(monitor.parseFile(missing, () => null), null, 'invalid replacement must not return old content');
  });

  test('detail cache eviction leaves hot cards readable and reloads evicted full history', () => {
    const monitor = new AgentMonitor({ home: temp });
    const card = { file: 'hot', mtimeMs: 1, size: 1 };
    const parse = info => ({ id: info.file, status: 'completed' });
    monitor.parseFile(card, parse);
    for (let i = 0; i < 30; i++) monitor.parseFile({ ...card, file: 'detail-' + i }, parse, 'full-history');
    assert.equal(monitor.parseCache.size, 9);
    assert.equal(monitor.parseFile(card, () => { throw new Error('card evicted by details'); }).id, 'hot');
    let reloaded = false;
    monitor.parseFile({ ...card, file: 'detail-0' }, info => { reloaded = true; return parse(info); }, 'full-history');
    assert.equal(reloaded, true);
  });

  test('bounded artifact extraction preserves priority, duplicates, checks, and commit fallback', () => {
    const paths = Array.from({ length: 40 }, (_, i) => `src/file-${i}.js`);
    const session = { artifacts: [{ path: 'src/explicit.js', verified: true }],
      result: `${paths.join(' ')} commit abcdef123456`, messages: [{ text: paths.join(' ') }] };
    const artifacts = extractArtifacts(session);
    assert.equal(artifacts.length, 24);
    assert.deepEqual(artifacts[0], { kind: 'file', value: 'src/explicit.js', verified: true });
    assert.deepEqual(artifacts.slice(1).map(row => row.value), paths.slice(0, 23));
    const fallback = extractArtifacts({ result: 'tests/run.spec.js tests/run.spec.js commit abcdef123456' });
    assert.deepEqual(fallback.map(row => row.kind), ['test', 'commit']);
    const at = '2026-09-08T01:00:00.000Z';
    const live = { id: 'live', status: 'running', startedAt: at, updatedAt: at,
      messages: [{ role: 'assistant', text: 'old response' }, { role: 'user', text: 'new request' }],
      responseIntent: { category: 'optional', requestText: 'old question' } };
    assert.equal(enrichSession(live, [live], Date.parse(at)).responseIntent.category, 'none');
    assert.equal(enrichSession(live, [live], Date.parse(at) + 11 * 60000).health.level, 'critical');
    assert.equal(enrichSession({ ...live, status: 'completed' }).outcome.summary, '');
  });

  test('unchanged plugin refresh skips duplicate work while core and plugin changes publish', async () => {
    const calls = [];
    let source = { sessions: [], statuses: [] };
    const coordinator = createSnapshotPublicationCoordinator({
      scanSource: () => structuredClone(source), publish: (core, plugins) => { calls.push({ core, plugins }); },
    });
    try {
      await coordinator.observeCore({ sessions: [{ id: 'core', status: 'running' }] });
      await coordinator.whenIdle();
      assert.equal(calls.length, 1);
      source = { sessions: [{ id: 'plugin', status: 'waiting' }], statuses: [{ id: 'source', available: true }] };
      await coordinator.refreshSource();
      assert.equal(calls.length, 2);
      await coordinator.refreshSource();
      assert.equal(calls.length, 2);
      await coordinator.observeCore({ sessions: [{ id: 'core', status: 'completed' }] });
      await coordinator.whenIdle();
      assert.equal(calls.length, 3);
      source.statuses[0].available = false;
      await coordinator.refreshSource();
      assert.equal(calls.length, 4);
      assert.equal(calls.at(-1).core.sessions[0].status, 'completed');
    } finally { coordinator.stop(); }
  });

  test('browsing many transcripts bounds renderer memory without losing selected parent or reload', async () => {
    let reads = 0;
    const sandbox = { window: { WhiteboxAppFactories: {}, WhiteboxI18n: { t: key => key, errorText: String },
      whitebox: { sessionDetail: async id => { reads++; return { id, messages: [{ text: id }] }; } } } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'renderer/app-drawer-data.js'), 'utf8'), sandbox);
    const state = { details: new Map([['parent', { id: 'parent' }], ['child', { id: 'child', parentId: 'parent' }]]),
      selectedId: 'child', snapshot: { sessions: [] }, detailErrors: new Map(), detailLoadingIds: new Set() };
    const data = sandbox.window.WhiteboxAppFactories.createDrawerData({ state, renderDrawer() {}, reportRecoverableError(error) { throw error; } });
    for (let i = 0; i < 60; i++) await data.loadSessionDetail('history-' + i);
    assert.equal(state.details.size, 12);
    assert(state.details.has('parent') && state.details.has('child'));
    const before = reads;
    assert.equal((await data.loadSessionDetail('history-0')).messages[0].text, 'history-0');
    assert.equal(reads, before + 1);
  });
}

module.exports = { registerPerformanceRegressionTests };
