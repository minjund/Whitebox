'use strict';
const assert = require('node:assert/strict');
module.exports = async function startupReconnect({ evaluate, waitFor, win, manager, pidRace, unavailable, counters }) {
  if (pidRace?.enabled) {
    assert.equal(pidRace.delivered, true);
    assert.equal(await evaluate(`WhiteboxWorkspace.getState().sessions.find(s=>s.id===${JSON.stringify(pidRace.id)}).pid`), pidRace.live.pid,
      'PID events during initial creation survive a late pending metadata response');
    win.webContents.send('terminals:state', { change:'pid-fixture-stale', session:pidRace.stale, sessions:[pidRace.stale] });
    await waitFor('window.__startupPidFixtureStale === true', 'stale state event receipt');
    assert.equal(await evaluate(`WhiteboxWorkspace.getState().sessions.find(s=>s.id===${JSON.stringify(pidRace.id)}).pid`), pidRace.live.pid,
      'an old running snapshot cannot erase the live PID');
    pidRace.hold = false;
    console.log('PASS real startup PID race: early event delivery, late stale read and stale event cannot erase the original live PTY');
  }
  const original = manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId }));
  const ready = counters().ready;
  unavailable(true);
  await win.loadURL('about:blank');
  await win.loadFile(require('node:path').resolve(__dirname, '../../renderer/index.html'));
  await waitFor('!document.querySelector("#wbError").hidden', 'bounded cold-host startup error');
  const reads = counters().reads;
  await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal(counters().reads, reads, 'no unbounded inventory polling while the host is unavailable');
  assert.equal(counters().ready, ready, 'a failed inventory is never a ready renderer');
  unavailable(false);
  // An authenticated host can connect after the renderer exhausted its first reads.
  win.webContents.send('terminals:connection', { state: 'connected' });
  win.webContents.send('terminals:connection', { state: 'connected' });
  await waitFor('Boolean(window.WhiteboxWorkspace)', 'same renderer resumes after late authenticated host connection');
  assert.equal(counters().ready, ready + 1, 'duplicate connection events initialize exactly once');
  assert.deepEqual(manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId })), original, 'recovery never creates replacement shells');
  assert.equal(await evaluate('document.querySelector("#wbError").hidden'), true);
  if (pidRace?.enabled) {
    await manager.stop(pidRace.id);
    await waitFor(`(() => { const s=WhiteboxWorkspace.getState().sessions.find(s=>s.id===${JSON.stringify(pidRace.id)}); return s && !s.pid && s.status!=='running'; })()`, 'real terminal stop clears the PID');
    assert.equal(manager.get(pidRace.id, false).pid, null, 'preserving an old live snapshot never masks a real stopped process');
  }
  console.log('PASS cold workspace startup resumes on a real late connection: bounded failures, no false readiness, no reload/replacement PTY, duplicate-event coalescing');
};
