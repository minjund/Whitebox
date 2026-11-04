'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TerminalCollaboration } = require('../src/terminalCollaboration');
const { main: control } = require('../bin/panel-control');
const tick = () => new Promise(resolve => setImmediate(resolve));

module.exports = async function closeChecks() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-panel-close-'));
  const source = { id: 'terminal:source', creationId: 'source', pid: 101, status: 'running', outputSequence: 1 };
  const running = { id: 'terminal:running', creationId: 'running', pid: 102, status: 'running', outputSequence: 1 };
  const stopped = { id: 'terminal:stopped', creationId: 'stopped', pid: null, status: 'stopped' };
  const ghost = { id: 'terminal:ghost', creationId: 'ghost', pid: 999, status: 'running' };
  const outside = { id: 'terminal:outside', creationId: 'outside', pid: 104, status: 'running' };
  const roster = [source, running, stopped, ghost].map(item => ({ ...item }));
  const live = new Map([source, running, stopped, outside].map(item => [item.id, { ...item }]));
  const closed = [], calls = [];
  let now = Date.now(), rejectClose = false, retain = false, hold = false, release;
  const c = new TerminalCollaboration({ directory, now: () => now, monitor: { scan: () => ({ available: true, processes: [] }) },
    manager: () => ({ list: () => [...live.values()], get: id => live.get(id), close: async id => {
      calls.push(id);
      if (rejectClose) throw Error('fixture close failed');
      if (hold) await new Promise(resolve => { release = resolve; });
      if (!retain) live.delete(id);
      return { ok: true };
    } }),
    onTerminalClosed: terminal => { assert(!live.has(terminal.id)); closed.push(terminal); },
  });
  const payload = () => ({ groups: [{ id: 'panel', cwd: directory, members: roster }, { id: 'other', cwd: directory, members: [outside] }], frames: [] });
  const command = (target, extra = []) => control(['close-terminal', '--source', source.id, '--surface', target, '--json', ...extra], { directory });
  try {
    await c.sync(payload());
    const list = await control(['list-panels', '--source', source.id, '--json'], { directory });
    assert.deepEqual(list.surfaces.map(item => item.id), roster.map(item => item.id));
    assert.equal(list.surfaces.find(item => item.id === stopped.id).status, 'stopped');
    assert.equal(list.surfaces.find(item => item.id === ghost.id).status, 'removed');
    await assert.rejects(command(source.id), /invoking terminal/);
    await assert.rejects(command(outside.id), /exact surface/);
    await assert.rejects(command('codex'), /exact surface/);
    await assert.rejects(command(running.id, ['extra']), /Usage/);
    await assert.rejects(control(['close-terminal', '--source', source.id], { directory }), /Usage/);
    assert.equal(calls.length, 0);

    live.get(running.id).pid++;
    await assert.rejects(command(running.id), /session changed/);
    live.get(running.id).pid--;
    live.get(running.id).creationId = 'replacement';
    await assert.rejects(command(running.id), /session changed/);
    live.get(running.id).creationId = running.creationId;
    now += 11000; await assert.rejects(command(running.id), /stale/); await c.sync(payload());
    rejectClose = true; await assert.rejects(command(running.id), /fixture close failed/); rejectClose = false;
    retain = true; await assert.rejects(command(running.id), /removal was not confirmed/); retain = false;
    assert.equal(closed.length, 0, 'failed/unconfirmed termination must not remove the pane');
    assert(c.groups.get('panel').surfaces.some(item => item.id === running.id));

    hold = true;
    const pending = command(running.id);
    for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(release); assert.equal(closed.length, 0, 'wait for termination acknowledgement before hiding the pane');
    release(); hold = false;
    assert.equal((await pending).closed, true);
    assert.equal(closed[0].id, running.id);
    assert(!c.groups.get('panel').surfaces.some(item => item.id === running.id));
    assert(!fs.existsSync(c.file(running.id, 'access')));
    const count = calls.length; await assert.rejects(command(running.id), /exact surface/); assert.equal(calls.length, count);
    c.groups.get('panel').surfaces.find(item => item.id === stopped.id).pid = 200;
    assert.equal((await command(stopped.id)).closed, true, 'a confirmed stopped session is closable even before the old PID refreshes');
    const beforeGhost = calls.length;
    assert.equal((await command(ghost.id)).closed, true, 'an already removed host record must still remove its orphaned pane');
    assert.equal(calls.length, beforeGhost, 'missing host records do not trigger a second process termination');
    assert.deepEqual(closed.map(item => item.id), [running.id, stopped.id, ghost.id]);
    assert(live.has(source.id)); assert(live.has(outside.id));
    assert.deepEqual((await control(['list-panels', '--source', source.id], { directory })).surfaces.map(item => item.id), [source.id]);
    await tick();
    console.log('PASS terminal close socket/CLI: live, stopped and orphan panes; exact panel/identity; acknowledged removal; failure retention; no self/foreign close or duplicate termination');
  } finally { await c.control.close(); fs.rmSync(directory, { recursive: true, force: true }); }
};
if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
