'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWorkbench } = require('./terminal-interactions');
const { createFrameTracker } = require('../../renderer/terminal-frame-delta');
const { pruneMissingPromptTargets } = require('../../renderer/terminal-prompt');
const { TerminalCollaboration } = require('../../src/terminalCollaboration');

function registerTerminalMemoryReleaseTests({ test, root, temp }) {
  test('trash releases the emulator, input queue and host; a later mount rebuilds it from replay', async () => {
    const session = { id: 'terminal:trash', type: 'shell', status: 'running' };
    let replay = 'live-history\r\n';
    const fixture = createWorkbench(root, { session, bindEvents: true,
      terminalGet: async () => ({ ...session, replay, outputSequence: 3 }) });
    const entry = await fixture.workbench.ensureSessionTerminal(session);
    let disposed = 0;
    const dispose = entry.terminal.dispose.bind(entry.terminal);
    entry.terminal.dispose = () => { disposed += 1; dispose(); };
    entry.inputQueue.push('queued'); entry.inputQueueChars = 6;
    assert.equal(entry.host.isConnected, true);

    assert.equal(fixture.workbench.releaseTerminal(session.id), true);
    assert.equal(fixture.state.terminals.has(session.id), false, 'no view entry survives trash');
    assert.equal(disposed, 1, 'the emulator and its canvas are disposed');
    assert.equal(entry.host.isConnected, false, 'the host leaves the runtime mount');
    assert.equal(entry.inputClosed, true);
    assert.equal(entry.inputQueue.length, 0);
    assert.equal(fixture.workbench.releaseTerminal(session.id), false, 'a second release is a no-op');
    fixture.receiveOutput({ id: session.id, data: 'late', outputSequence: 4 });
    assert.equal(entry.terminal.writes.includes('late'), false, 'late output never reaches a released view');

    // Trash stops the PTY; restore mounts the stopped record from the host.
    Object.assign(session, { status: 'stopped', pid: null });
    replay = 'live-history\r\nTRASH_KEPT\r\n';
    const restored = await fixture.workbench.ensureSessionTerminal(session);
    assert.notStrictEqual(restored, entry);
    assert.equal(fixture.state.terminals.get(session.id), restored);
    assert.equal(restored.inputDisabled, true);
    assert.equal(restored.terminal.writes.join(''), replay, 'restore shows the full stopped replay');
  });

  test('workspace trash and permanent delete release the terminal view, not just its pane', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'terminal-workspace.js'), 'utf8');
    const body = name => {
      const start = source.indexOf(`function ${name}(`);
      assert(start >= 0, name);
      return source.slice(start, source.indexOf('\n  }\n', start));
    };
    assert.match(body('trashInstance'), /terminal\.releaseTerminal\?\.\(id\)/u);
    assert.match(body('removeTerminalLocally'), /terminal\.releaseTerminal\?\.\(id\)/u);
    assert.match(body('removeTerminalLocally'), /reviewRevisions\.delete\(id\)/u);
    const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
    assert(scripts.indexOf('terminal-frame-delta.js') >= 0
      && scripts.indexOf('terminal-frame-delta.js') < scripts.indexOf('terminal-workspace.js'));
  });

  test('collaboration frames resend screen text only on change or the freshness beat', () => {
    let now = 1_000;
    const tracker = createFrameTracker({ heartbeatMs: 2_000, now: () => now });
    const text = 'x'.repeat(24_000);
    const frame = (overrides = {}) => ({ id: 'a', creationId: 'c1', text, readinessText: '>', inputDraft: '', bracketedPaste: false, outputSequence: 7, ...overrides });
    const identities = new Map([['a', '100'], ['b', '200']]);
    const bytes = frames => JSON.stringify(frames).length;

    let batch = tracker.prepare([frame(), frame({ id: 'b' })], identities);
    assert.equal(batch.frames.every(item => item.text === text), true, 'first observation is a full frame');
    batch.commit();

    now += 1_000;
    batch = tracker.prepare([frame(), frame({ id: 'b' })], identities);
    assert.deepEqual(batch.frames, [
      { id: 'a', creationId: 'c1', outputSequence: 7, unchanged: true },
      { id: 'b', creationId: 'c1', outputSequence: 7, unchanged: true },
    ]);
    assert(bytes(batch.frames) < 200, 'an idle tick sends no screen text');
    batch.commit();

    // A changed field, a replaced process or a new draft is sent at once.
    for (const changed of [{ outputSequence: 8 }, { inputDraft: 'typing' }, { readinessText: '' }, { creationId: 'c2' }]) {
      batch = tracker.prepare([frame(changed)], identities);
      assert.equal(batch.frames[0].text, text, JSON.stringify(changed));
    }
    batch = tracker.prepare([frame()], new Map([['a', '101']]));
    assert.equal(batch.frames[0].text, text, 'a new PID resends the frame');

    // A failed send is not recorded, so the next tick resends the full frame.
    now += 100;
    batch = tracker.prepare([frame({ outputSequence: 9 })], identities);
    assert.equal(batch.frames[0].text, text);
    batch = tracker.prepare([frame({ outputSequence: 9 })], identities);
    assert.equal(batch.frames[0].text, text, 'uncommitted frames are resent');
    batch.commit();
    assert.equal(tracker.size(), 1, 'panes missing from a delivered batch are forgotten');

    now += 1_999;
    assert.equal(tracker.prepare([frame({ outputSequence: 9 })], identities).frames[0].unchanged, true);
    now += 1;
    batch = tracker.prepare([frame({ outputSequence: 9 })], identities);
    assert.equal(batch.frames[0].text, text, 'the beat refreshes main before its 5 s activity window');
    batch.commit();
    tracker.forget('a');
    assert.equal(tracker.size(), 0);
  });

  test('current main keeps the previous full frame when it receives an unchanged marker', async () => {
    let now = Date.now();
    const member = { id: 'terminal:marker', creationId: 'epoch:1', pid: 4242, status: 'running', outputSequence: 7 };
    const service = new TerminalCollaboration({ directory: path.join(temp, 'frame-marker'), manager: () => ({ list: () => [member] }),
      monitor: { scan: () => ({ available: true, processes: [] }) }, activity: { observe: async () => new Map() }, enableControl: false, now: () => now });
    const groups = [{ id: 'group', cwd: temp, members: [member] }];
    await service.sync({ groups, frames: [{ id: member.id, creationId: member.creationId, text: 'SCREEN', readinessText: '>', outputSequence: 7 }] });
    const stored = service.frames.get(member.id);
    now += 1_000;
    await service.sync({ groups, frames: [{ id: member.id, creationId: member.creationId, outputSequence: 7, unchanged: true }] });
    assert.equal(service.frames.get(member.id), stored, 'the marker neither erases nor replaces the frame');
    assert.equal(service.frames.get(member.id).text, 'SCREEN');
  });

  test('prompt dismissals for closed terminals are pruned', () => {
    const dismissals = new Map([['terminal:live', 'fp'], ['terminal:closed', 'fp']]);
    assert.equal(pruneMissingPromptTargets(dismissals, new Set(['terminal:live'])), 1);
    assert.deepEqual([...dismissals.keys()], ['terminal:live']);
    assert.equal(pruneMissingPromptTargets(dismissals, null), 0);
  });
}

module.exports = { registerTerminalMemoryReleaseTests };
