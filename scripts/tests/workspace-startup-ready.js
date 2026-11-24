'use strict';
// Startup readiness. An updater waits for this signal and rolls the update back
// when it does not arrive in time (30 s in installed 2.0.41 clients), so it must
// be sent once the workspace is drawn, without waiting for terminals to attach.
// A profile that still carries Understand · Review history starts normally,
// shows no review panel, and its recorded request still names the terminal.
const assert = require('node:assert/strict');

module.exports = async function startupReadyChecks({ evaluate, waitFor, win, manager, readyCalls, holdReplay, releaseReplay }) {
  await waitFor('WhiteboxWorkspace.getState().sessions.every(s => s.pid > 0)', 'startup fixture original PTYs');
  const original = await evaluate('localStorage.getItem("whitebox:workspace:v2")');
  const identities = manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId }));
  const active = await evaluate('WhiteboxWorkspace.getState().activeId');
  await evaluate(`(() => {
    const state = WhiteboxWorkspace.getState(), saved = JSON.parse(localStorage.getItem('whitebox:workspace:v2'));
    const session = state.sessions.find(s => s.id === state.activeId);
    const task = { taskId:'recorded-request', request:'RETAINED_RECORD_REQUEST', actual:'RETAINED_RECORD_OUTPUT',
      recordOnly:true, analysisDepth:'record', lifecycle:'completed', observedAt:'2026-11-06T00:00:00Z' };
    saved.autoReview = true; saved.reviewWidth = 400;
    saved.analysisSettings = { provider:'codex', jevEnabled:true, models:{ claude:'', codex:'old' }, effort:'high' };
    saved.reviewHistory = [{ id:session.id, creationId:session.creationId, pid:session.pid,
      provider:'codex', result:{ tasks:[task], observedAt:task.observedAt } }];
    localStorage.setItem('whitebox:workspace:v2', JSON.stringify(saved));
  })()`);
  // 1. The visible terminal's replay is held: readiness must not wait for it.
  const beforeReady = readyCalls();
  holdReplay(active);
  await win.reload();
  const deadline = Date.now() + 10000;
  while (readyCalls() === beforeReady && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(readyCalls(), beforeReady + 1, 'renderer-ready is sent while a visible terminal is still attaching');
  assert.equal(await evaluate(`Boolean(document.querySelector('#wbCanvas [data-terminal-id="${active}"] .wb-pane-loading'))`), true, 'the held terminal is still attaching');
  releaseReplay();
  await waitFor('Boolean(window.WhiteboxWorkspace)', 'startup finishes after the held replay');
  assert.equal(readyCalls(), beforeReady + 1, 'renderer-ready is emitted exactly once');
  // 2. Old review state: no panel, no analysis settings, the recorded request names the terminal.
  assert.equal(await evaluate('document.querySelector("#wbReview, #wbReviewToggle, [data-settings-section=analysis], #wbJevSettings")'), null, 'Understand · Review is gone');
  await waitFor(`(document.querySelector('[data-instance="${active}"] strong')?.textContent || '').includes('RETAINED_RECORD_REQUEST')`, 'a recorded request still names the terminal');
  await evaluate('WhiteboxWorkspace.createTerminal("row")');
  await waitFor('!WhiteboxWorkspace.getState().busy', 'save after startup');
  const saved = await evaluate('JSON.parse(localStorage.getItem("whitebox:workspace:v2"))');
  assert.equal(['autoReview', 'reviewWidth', 'analysisSettings'].some(key => key in saved), false, 'review settings are no longer saved');
  assert.deepEqual(manager.list().filter(item => identities.some(old => old.id === item.id)).map(({ id, pid, creationId }) => ({ id, pid, creationId })), identities, 'startup preserves all PTYs');
  await evaluate(`localStorage.setItem('whitebox:workspace:v2', ${JSON.stringify(original)})`);
  console.log('PASS startup readiness: renderer-ready once while a visible terminal still attaches; old review state starts without the panel and still names the terminal');
};
