'use strict';
const assert = require('node:assert/strict');
const { TerminalCompletionTracker, applyCompletionBadge, badgePng } = require('../../src/terminalCompletionBadge');

function registerTerminalCompletionBadgeTests({ test }) {
  test('completion badge counts native working-to-complete turns and exact acknowledgements', () => {
    const counts = [], tracker = new TerminalCompletionTracker(n => counts.push(n));
    const a = { id: 'a', creationId: 'shell-a', pid: 10 }, b = { id: 'b', creationId: 'shell-b', pid: 20 };
    const groups = [{ members: [a, b] }];
    const update = states => tracker.update({ panels: [{ members: [a, b].map((m, i) => ({ ...m, activity: { ...m, providerPid: m.pid + 1, requestId: 'turn1', ...states[i] } })) }] }, groups);
    const working = { state: 'working', completed: false }, done = { state: 'idle', completed: true };
    update([done, done]); assert.equal(tracker.count, 0, 'historical answers are baseline');
    update([{ ...working, requestId: 'turn2' }, { ...working, requestId: 'turn2' }]);
    const result = update([{ ...done, requestId: 'turn2' }, { ...done, requestId: 'turn2' }]);
    assert.equal(tracker.count, 2);
    const token = result.panels[0].members[0].activity.unreadCompletionId;
    update([{ ...done, requestId: 'turn2' }, { ...done, requestId: 'turn2' }]); assert.equal(tracker.count, 2, 'poll deduplicates');
    tracker.read({ ...a, completionId: 'stale' }); assert.equal(tracker.count, 2);
    tracker.read({ ...a, completionId: token }); assert.equal(tracker.count, 1);
    update([{ ...working, requestId: 'turn3' }, done]);
    update([{ ...done, requestId: 'turn3' }, done]);
    tracker.read({ ...a, completionId: token }); assert.equal(tracker.count, 2, 'late read cannot erase the next answer');
    tracker.update({ panels: [] }, groups); assert.equal(tracker.count, 2, 'transient unavailable probe retains badge');
    tracker.update({ panels: [] }, []); assert.equal(tracker.count, 0, 'removed terminals clear unread state');
    assert.deepEqual(counts, [2, 1, 2, 0]);
  });
  test('bare commands, waiting, interruptions and changed process identities never invent completions', () => {
    const tracker = new TerminalCompletionTracker();
    let member = { id: 'a', creationId: 'shell', pid: 10 };
    const update = activity => tracker.update({ panels: [{ members: [{ ...member, activity: { ...member, ...activity } }] }] }, [{ members: [member] }]);
    update({ state: 'working' }); update({ state: 'idle' }); assert.equal(tracker.count, 0);
    update({ state: 'working', requestId: 't', providerPid: 12 });
    update({ state: 'waiting', requestId: 't', providerPid: 12 }); assert.equal(tracker.count, 0);
    update({ state: 'idle', completed: false, requestId: 't', providerPid: 12 }); assert.equal(tracker.count, 0);
    update({ state: 'idle', completed: true, requestId: 't', providerPid: 13 }); assert.equal(tracker.count, 0);
    member = { ...member, creationId: 'new-shell', pid: 30 };
    update({ state: 'idle', completed: true, requestId: 't', providerPid: 12 }); assert.equal(tracker.count, 0);
  });
  test('completion badge uses numeric PNG overlays on Windows and clears native badges', () => {
    const overlays = [], badges = [], app = { setBadgeCount: n => badges.push(n) };
    const nativeImage = { createFromBuffer: buffer => { assert.equal(buffer.subarray(1, 4).toString(), 'PNG'); return buffer; } };
    const window = { isDestroyed: () => false, setOverlayIcon: (...args) => overlays.push(args) };
    for (const count of [1, 2, 100, 0]) applyCompletionBadge({ app, window, nativeImage, platform: 'win32' }, count);
    assert.equal(overlays.length, 4); assert.notDeepEqual(overlays[0][0], overlays[1][0]); assert.equal(overlays[3][0], null);
    for (const count of [2, 0]) applyCompletionBadge({ app, platform: 'darwin' }, count);
    assert.deepEqual(badges, [2, 0]); assert.equal(badgePng(12).readUInt32BE(16), 32);
  });
}
module.exports = { registerTerminalCompletionBadgeTests };
