'use strict';

const assert = require('assert');
const path = require('path');
const { createMonitorScanScheduler } = require('../../src/monitorScanScheduler');
const { parseClaude, parseCodex } = require('../../src/agentMonitor');

function registerMonitorStateLatencyTests({ test, temp, jsonl }) {
  test('continuous file changes do not postpone scans, urgent refresh preempts, stop cancels', () => {
    let now = 0;
    let id = 0;
    let scans = 0;
    const pending = new Map();
    const scheduler = createMonitorScanScheduler(() => { scans += 1; }, {
      now: () => now,
      setTimeout: (run, delay) => { pending.set(++id, { run, at: now + delay }); return id; },
      clearTimeout: timer => pending.delete(timer),
    });
    function advance(at) {
      now = at;
      for (const [timer, task] of pending) {
        if (task.at <= now) { pending.delete(timer); task.run(); }
      }
    }
    scheduler.request();
    for (let at = 10; at < 80; at += 10) { advance(at); scheduler.request(); }
    advance(80);
    assert.equal(scans, 1);
    scheduler.request();
    advance(90);
    scheduler.request(0);
    scheduler.request();
    advance(90);
    assert.equal(scans, 2);
    scheduler.request();
    scheduler.stop();
    advance(200);
    assert.equal(scans, 2);
    assert.equal(pending.size, 0);
  });

  for (const provider of ['claude', 'codex']) {
    test(`${provider}: tool completion switches to thinking while parallel and yielded work stays working`, () => {
      const at = new Date().toISOString();
      const rows = provider === 'codex'
        ? [{ timestamp: at, type: 'session_meta', payload: { id: 'latency-codex', cwd: temp } },
          { timestamp: at, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn' } }]
        : [{ timestamp: at, type: 'user', uuid: 'user', sessionId: 'latency-claude', cwd: temp,
          message: { role: 'user', content: 'Run two commands' } }];
      function call(id) {
        return provider === 'codex'
          ? { timestamp: at, type: 'response_item', payload: { type: 'function_call', call_id: id, name: 'exec_command', arguments: '{"cmd":"npm test"}' } }
          : { timestamp: at, type: 'assistant', uuid: id, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'npm test' } }] } };
      }
      function output(id, text) {
        return provider === 'codex'
          ? { timestamp: at, type: 'response_item', payload: { type: 'function_call_output', call_id: id, output: text } }
          : { timestamp: at, type: 'user', uuid: `out-${id}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } };
      }
      function parse(extra) {
        const info = jsonl(path.join(temp, 'latency', `${provider}.jsonl`), [...rows, ...extra]);
        return (provider === 'codex' ? parseCodex : parseClaude)(info);
      }
      assert.equal(parse([call('a'), call('b'), output('a', 'Exit code: 0')]).activityState, 'working');
      const done = parse([call('a'), call('b'), output('a', 'Exit code: 0'), output('b', 'Exit code: 0')]);
      assert.equal(done.status, 'running');
      assert.equal(done.activityState, 'thinking');
      assert.equal(parse([call('a'), output('a', 'Script running with cell ID 123')]).activityState, 'working');
    });
  }
}

module.exports = { registerMonitorStateLatencyTests };
