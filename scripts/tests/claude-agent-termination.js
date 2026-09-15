'use strict';

const assert = require('assert');
const path = require('path');
const { parseClaude, attachHierarchy } = require('../../src/agentMonitor');

function registerClaudeAgentTerminationTests({ test, temp, jsonl }) {
  const at = seconds => new Date(Date.now() - 60_000 + seconds * 1000).toISOString();
  const row = (role, seconds, content, stopReason) => ({
    type: role, timestamp: at(seconds),
    message: { role, content, ...(stopReason ? { stop_reason: stopReason } : {}) },
  });
  const launches = ids => [
    row('user', 0, '상태를 점검해줘'),
    row('assistant', 1, ids.map(id => ({
      type: 'tool_use', id: `spawn-${id}`, name: 'Agent', input: { description: id, prompt: '점검해줘' },
    }))),
    row('user', 2, ids.map(id => ({
      type: 'tool_result', tool_use_id: `spawn-${id}`,
      content: `Async agent launched successfully.\nagentId: ${id}`,
    }))),
  ];
  const parseParent = (id, rows) => parseClaude(jsonl(path.join(temp, 'claude-stop', `${id}.jsonl`), rows));
  const parseChild = (parent, id, seconds = 4) => parseClaude(jsonl(
    path.join(temp, 'claude-stop', parent, 'subagents', `agent-${id}.jsonl`), [
      row('user', 2, '점검해줘'),
      row('assistant', seconds, [{ type: 'tool_use', id: `read-${id}`, name: 'Read', input: { file_path: 'status.js' } }], 'tool_use'),
    ],
  ));

  test('Claude 묶음 stopped 알림은 실제·누락된 자식 모두 중단으로 정리한다', () => {
    for (const envelope of ['queue', 'user', 'text']) {
      const id = `stopped-${envelope}`;
      const ids = ['stop-a', 'stop-b', 'stop-c'];
      const text = `<task-notification>${ids.map(child => `<task-id>${child}</task-id>`).join('')}<status>stopped</status></task-notification>`;
      const notification = envelope === 'queue'
        ? { type: 'queue-operation', operation: 'enqueue', timestamp: at(10), content: text }
        : row('user', 10, envelope === 'text' ? [{ type: 'text', text }] : text);
      const parent = parseParent(id, [...launches(ids), notification, row('assistant', 12, [{ type: 'text', text: '종료 상태를 확인했습니다.' }], 'end_turn')]);
      const child = parseChild(id, ids[0]);
      const other = parseParent(`unrelated-${envelope}`, [row('user', 5, '다른 작업을 계속해줘')]);
      const sessions = [parent, child, other];
      attachHierarchy(sessions);
      attachHierarchy(sessions);
      assert.equal(parent.status, 'completed');
      assert.equal(parent.collaboration.metrics.currentlyRunning, 0);
      assert.deepEqual(parent.collaboration.spawns.map(record => record.status), ['cancelled', 'cancelled', 'cancelled']);
      for (const record of parent.collaboration.spawns) {
        const stopped = sessions.find(session => session.id === record.childId);
        assert.equal(stopped.status, 'cancelled');
        assert.equal(stopped.activityState, 'idle');
        assert.equal(stopped.completionObserved, false);
        assert.ok(stopped.completedAt);
      }
      assert.equal(other.status, 'running', '다른 세션의 실행 상태는 유지해야 합니다.');
    }
  });

  test('Claude TaskStop 결과는 성공과 해당 작업 없음만 종료로 처리한다', () => {
    const cases = [
      { name: 'stopped', output: 'Successfully stopped task: worker (Agent)', ended: true },
      { name: 'missing', output: '<tool_use_error>No task found with ID: worker</tool_use_error>', error: true, ended: true },
      { name: 'denied', output: '<tool_use_error>Permission denied</tool_use_error>', error: true, ended: false },
      { name: 'wrong-id', output: '<tool_use_error>No task found with ID: another-worker</tool_use_error>', error: true, ended: false },
    ];
    for (const scenario of cases) {
      const id = `task-stop-${scenario.name}`;
      const parent = parseParent(id, [
        ...launches(['worker']),
        row('assistant', 8, [{ type: 'tool_use', id: 'stop-worker', name: 'TaskStop', input: { task_id: 'worker' } }]),
        row('user', 10, [{ type: 'tool_result', tool_use_id: 'stop-worker', content: scenario.output, is_error: scenario.error === true }]),
        row('assistant', 12, [{ type: 'text', text: '상태를 확인했습니다.' }], 'end_turn'),
      ]);
      const child = parseChild(id, 'worker');
      attachHierarchy([parent, child]);
      assert.equal(child.status, scenario.ended ? 'cancelled' : 'running', scenario.name);
      assert.equal(parent.status, scenario.ended ? 'completed' : 'running', scenario.name);
      assert.equal(parent.collaboration.metrics.currentlyRunning, scenario.ended ? 0 : 1, scenario.name);
    }
  });

  test('Claude 중단 이후 재개와 더 최신 자식 활동은 실행 상태를 유지한다', () => {
    const notification = { type: 'queue-operation', operation: 'enqueue', timestamp: at(10), content: '<task-notification><task-id>worker</task-id><status>stopped</status></task-notification>' };
    const rows = [...launches(['worker']), notification, row('assistant', 12, [{ type: 'text', text: '중단했습니다.' }], 'end_turn')];
    const resumed = parseParent('resumed-stop', [
      ...rows,
      row('assistant', 14, [{ type: 'tool_use', id: 'resume-worker', name: 'SendMessage', input: { to: 'worker', message: '이어서 진행해줘' } }]),
      row('user', 15, [{ type: 'tool_result', tool_use_id: 'resume-worker', content: '{"success":true,"resumedAgentId":"worker"}' }]),
      notification,
      row('assistant', 16, [{ type: 'text', text: '재개했습니다.' }], 'end_turn'),
    ]);
    attachHierarchy([resumed, parseChild('resumed-stop', 'worker')]);
    assert.equal(resumed.status, 'running');
    assert.equal(resumed.collaboration.spawns[0].status, 'running');
    assert.equal(resumed.collaboration.spawns[0].completedAt, null);
    const parent = parseParent('new-child-activity', rows);
    const newer = parseChild('new-child-activity', 'worker', 18);
    attachHierarchy([parent, newer]);
    assert.equal(newer.status, 'running');
    assert.equal(parent.status, 'running');
    assert.equal(parent.collaboration.metrics.currentlyRunning, 1);
  });
}

module.exports = { registerClaudeAgentTerminationTests };
