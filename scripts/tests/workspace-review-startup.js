'use strict';

const assert = require('node:assert/strict');

module.exports = async function reviewStartupChecks({ evaluate, waitFor, win, manager, readyCalls }) {
  await waitFor('WhiteboxWorkspace.getState().sessions.every(s => s.pid > 0)', 'startup fixture original PTYs');
  const original = await evaluate('localStorage.getItem("whitebox:workspace:v2")');
  const identities = manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId }));
  const beforeReady = readyCalls();
  await evaluate(`(() => {
    const state = WhiteboxWorkspace.getState(), saved = JSON.parse(localStorage.getItem('whitebox:workspace:v2'));
    const session = state.sessions.find(s => s.id === state.activeId);
    const task = { taskId:'recorded-request', request:'RETAINED_RECORD_REQUEST', actual:'RETAINED_RECORD_OUTPUT',
      recordOnly:true, analysisDepth:'record', lifecycle:'completed', observedAt:'2026-11-06T00:00:00Z' };
    saved.autoReview = false;
    saved.reviewHistory = [{ id:session.id, creationId:session.creationId, pid:session.pid,
      provider:'codex', result:{ tasks:[task], observedAt:task.observedAt } }];
    localStorage.setItem('whitebox:workspace:v2', JSON.stringify(saved));
  })()`);
  await win.reload();
  await waitFor('Boolean(window.WhiteboxWorkspace)', 'saved record without analysis ID must reach renderer-ready');
  assert.equal(readyCalls(), beforeReady + 1, 'real renderer-ready IPC is emitted exactly once after restoring recorded tasks');
  assert.equal(await evaluate('document.querySelector("#wbReviewContent").textContent.includes("RETAINED_RECORD_REQUEST")'), true, 'saved task remains readable');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-retained-analysis]"))'), false, 'absent failure never matches absent analysis ID');
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("whitebox:workspace:v2")).reviewHistory[0].result.tasks[0].analysisId === undefined'), true, 'normal recorded tasks keep their original identity');
  assert.deepEqual(manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId })), identities, 'restoring history preserves all PTYs');
  await evaluate(`localStorage.setItem('whitebox:workspace:v2', ${JSON.stringify(original)})`);
  await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'original review fixture restored');
  console.log('PASS saved recorded task without analysisId: startup, exactly one renderer-ready IPC, readable history, no false failure match and unchanged PTYs');
};
