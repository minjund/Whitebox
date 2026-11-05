'use strict';
const assert = require('node:assert/strict');
module.exports = async function startupReconnect({ evaluate, waitFor, win, manager, unavailable, counters }) {
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
  console.log('PASS cold workspace startup resumes on a real late connection: bounded failures, no false readiness, no reload/replacement PTY, duplicate-event coalescing');
};
