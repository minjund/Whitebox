'use strict';

const assert = require('assert');
const {
  createExecutionTracker,
  reconcileExecutionActivities,
} = require('../src/agentMonitor/executionActivity');

function activityFor(command, options = {}) {
  const tracker = createExecutionTracker({
    compactText: value => String(value || ''),
    timestamp: value => value || null,
  });
  tracker.recordCall({
    name: options.name || 'shell_command',
    callId: options.callId || 'call-1',
    args: {
      command,
      sandbox_permissions: options.sandboxPermissions,
    },
    at: options.at || '2026-07-27T00:00:00.000Z',
  });
  return { tracker, activity: tracker.activities[0] };
}

{
  const { activity } = activityFor(
    "$exe = Resolve-Path '.\\Whitebox.exe'; Start-Process -FilePath $exe -PassThru",
  );
  assert.equal(activity.runtime, 'Windows 명령창');
}

{
  const { activity } = activityFor(
    "Get-Process Whitebox -ErrorAction SilentlyContinue | Select-Object Id,Path",
  );
  assert.equal(activity.runtime, 'Windows 명령창');
}

{
  const { activity } = activityFor("node -e 'console.log(\"ok\")'");
  assert.equal(activity.runtime, '명령창');
}

{
  const { tracker, activity } = activityFor(
    "$launch = Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -PassThru",
    { sandboxPermissions: 'require_escalated' },
  );
  assert.equal(activity.approvalRequired, true);
  const [expired] = reconcileExecutionActivities(tracker.finalize(), {
    now: Date.parse('2026-07-27T00:10:00.000Z'),
    staleAfterMs: 5 * 60_000,
  });
  assert.equal(expired.status, 'cancelled');
  assert.equal(expired.statusDetail, '권한 승인 요청 만료');
  assert.equal(expired.completedAt, activity.updatedAt);
}

{
  const { tracker } = activityFor('npm test');
  const [unobserved] = reconcileExecutionActivities(tracker.finalize(), {
    now: Date.parse('2026-07-27T00:10:00.000Z'),
    staleAfterMs: 5 * 60_000,
  });
  assert.equal(unobserved.status, 'unverified');
  assert.equal(unobserved.statusDetail, '최근 실행 활동이 확인되지 않음');
}

{
  const { tracker, activity } = activityFor(
    'Start-Process notepad.exe',
    { sandboxPermissions: 'require_escalated' },
  );
  tracker.recordOutput({
    name: 'shell_command',
    callId: activity.callId,
    output: 'Process launched\nexit code: 0',
    at: '2026-07-27T00:00:01.000Z',
  });
  assert.equal(activity.status, 'completed');
  assert.equal(activity.exitCode, 0);
}

{
  const { tracker, activity } = activityFor('npm run watch', { callId: 'long-running' });
  for (let index = 0; index < 125; index += 1) {
    const callId = `completed-${index}`;
    tracker.recordCall({
      name: 'shell_command', callId, args: { command: `echo ${index}` },
      at: `2026-07-27T00:01:${String(index % 60).padStart(2, '0')}.000Z`,
    });
    tracker.recordOutput({
      name: 'shell_command', callId, output: 'exit code: 0',
      at: `2026-07-27T00:02:${String(index % 60).padStart(2, '0')}.000Z`,
    });
  }
  const projected = tracker.finalize(120);
  assert.equal(projected.some(item => item.id === activity.id && item.status === 'running'), true);
}

{
  // Claude Code's Monitor tool: an off-screen watch with its own task id. Events
  // keep it alive, a confirmed TaskStop cancels it, the expiry notice ends it.
  const tracker = createExecutionTracker({ compactText: value => String(value || ''), timestamp: value => value || null });
  tracker.recordCall({ name: 'Monitor', callId: 'monitor-1', args: { description: 'PR CI checks', timeout_ms: 1800000, command: 'while true; do gh pr checks 163; sleep 60; done' }, at: '2026-11-09T00:38:40.000Z' });
  const monitor = tracker.activities[0];
  assert.equal(monitor.kind, 'monitor'); assert.equal(monitor.mode, 'background'); assert.equal(monitor.label, 'PR CI checks');
  tracker.recordOutput({ name: 'Monitor', callId: 'monitor-1', output: 'Monitor started (task bsrtzcywd, expires in 30m unless the source ends first; you get one notice at expiry). You will be notified on each event.', at: '2026-11-09T00:38:48.000Z' });
  assert.equal(monitor.status, 'running'); assert.equal(monitor.backgroundId, 'bsrtzcywd');
  tracker.recordHeartbeat({ args: { task_id: 'bsrtzcywd' }, at: '2026-11-09T00:39:10.000Z' });
  assert.equal(monitor.updatedAt, '2026-11-09T00:39:10.000Z', 'an event is liveness proof');
  tracker.recordOutput({ name: 'TaskStop', callId: 'stop-1', args: { task_id: 'other' }, output: 'failed', at: '2026-11-09T00:40:00.000Z', isError: true });
  assert.equal(monitor.status, 'running', 'a failed or foreign stop changes nothing');
  tracker.recordOutput({ name: 'TaskStop', callId: 'stop-2', args: { task_id: 'bsrtzcywd' }, output: '{"message":"Successfully stopped task: bsrtzcywd (cd /project; gh pr checks)"}', at: '2026-11-09T00:43:10.000Z' });
  assert.equal(monitor.status, 'cancelled'); assert.equal(monitor.completedAt, '2026-11-09T00:43:10.000Z');
  tracker.recordCall({ name: 'Monitor', callId: 'monitor-2', args: { description: 'second', command: 'x' }, at: '2026-11-09T00:43:12.000Z' });
  tracker.recordOutput({ name: 'Monitor', callId: 'monitor-2', output: 'Monitor started (task bagqj261y, expires in 30m)', at: '2026-11-09T00:43:13.000Z' });
  tracker.recordOutput({ name: 'monitor', callId: '', args: { task_id: 'bagqj261y' }, output: '<task-notification>\n<task-id>bagqj261y</task-id>\n<summary>Monitor event: "second"</summary>\n<event>[Monitor expired after 30m with 13 events delivered.]</event>\n</task-notification>', at: '2026-11-09T01:13:13.000Z' });
  assert.equal(tracker.activities[1].status, 'completed', 'the expiry notice ends the watch');
}

process.stdout.write('실행 작업 감지 테스트 8개 통과\n');
