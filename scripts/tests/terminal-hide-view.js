'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function hideViewChecks({ evaluate, waitFor, win, manager, profile }) {
  const snapshot = () => evaluate(`(() => {
    const s = WhiteboxWorkspace.getState();
    return { owners: [...s.spaces, s.standalone].map(o => ({ id:o.id, cwd:o.cwd, tabs:o.tabs.map(p=>({id:p.id,layout:p.layout})) })), trash:s.trash };
  })()`);
  const visible = () => evaluate('[...document.querySelectorAll("#wbCanvas .wb-pane")].map(n=>n.dataset.terminalId)');
  const identities = () => manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId }));
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const hide = async id => {
    await click(`#wbCanvas [data-terminal-id="${id}"] header button:last-child`);
    await waitFor('!WhiteboxWorkspace.getState().busy', 'X action settled');
  };
  const reopen = id => click(`.wb-instance[data-instance="${id}"]`);
  const first = await evaluate('WhiteboxWorkspace.getState().activeId');
  assert(first, 'fixture starts with a project terminal');
  await evaluate('WhiteboxWorkspace.createTerminal("row")');
  const second = await evaluate('WhiteboxWorkspace.getState().activeId');
  const before = await snapshot(), original = identities();
  assert.deepEqual(new Set(await visible()), new Set([first, second]));
  await hide(first); // Hide a pane that does not own keyboard focus.
  assert.deepEqual(await visible(), [second]);
  assert.equal(await evaluate('WhiteboxWorkspace.getState().activeId'), second);
  assert.deepEqual(await snapshot(), before, 'hiding preserves projects, panels, memberships and trash');
  await hide(second);
  assert.deepEqual(await visible(), []);
  assert.equal(await evaluate('WhiteboxWorkspace.getState().activeId'), '');
  assert.equal(await evaluate('document.querySelectorAll(".wb-instance").length'), 2);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(identities(), original, 'X never terminates or replaces a PTY');
  await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload hidden canvas');
  assert.deepEqual(await visible(), [], 'last-pane hide survives reload');
  assert.deepEqual(await snapshot(), before);
  await reopen(first);
  assert((await visible()).includes(first));
  assert.deepEqual(identities(), original, 'sidebar reopens the same live sessions');
  // Real output produced while hidden is available on reopening.
  await hide(first);
  await manager.write(first, 'echo HIDDEN_SESSION_STILL_RUNNING\r');
  await reopen(first);
  await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(first)}).includes('HIDDEN_SESSION_STILL_RUNNING')`, 'live output after reopening');
  // Hiding the focused pane transfers focus to the remaining visible pane.
  await hide(first);
  assert.deepEqual(await visible(), [second]);
  assert.equal(await evaluate('WhiteboxWorkspace.getState().activeId'), second);
  // Create from an empty canvas without reviving the hidden panes.
  await hide(second);
  await evaluate('WhiteboxWorkspace.createTerminal("")');
  const third = await evaluate('WhiteboxWorkspace.getState().activeId');
  assert(third && ![first, second].includes(third));
  assert.deepEqual(await visible(), [third]);
  await evaluate('WhiteboxWorkspace.createTerminal("", WhiteboxWorkspace.getState().standalone)');
  const independent = await evaluate('WhiteboxWorkspace.getState().activeId');
  const independentState = await snapshot(), independentIds = identities();
  await hide(independent);
  assert.deepEqual(await visible(), []);
  assert.deepEqual(await snapshot(), independentState, 'independent panel also survives X');
  await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload hidden independent panel');
  await reopen(independent);
  assert.deepEqual(await visible(), [independent]);
  assert.deepEqual(identities(), independentIds);
  // The explicitly labelled sidebar termination remains distinct from hiding.
  await click(`.wb-instance-row [data-close-terminal="${independent}"]`);
  await waitFor(`!WhiteboxWorkspace.getState().busy && !WhiteboxWorkspace.getState().sessions.some(s=>s.id===${JSON.stringify(independent)})`, 'explicit terminal termination');
  assert.equal(manager.get(independent), null);
  assert(manager.get(first) && manager.get(second) && manager.get(third));
  assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces.length'), before.owners.length - 1);
  // Capture the actual empty view for manual inspection.
  await reopen(third); await hide(third);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.deepEqual(await visible(), []);
  fs.writeFileSync(path.join(profile, 'hidden-canvas.png'), (await win.webContents.capturePage()).toPNG());
  console.log('PASS right-side X hides only the view: project/standalone membership, live PTY identity and output, focus, reload, reopen, new panels, and explicit termination');
  console.log(`Screenshot: ${path.join(profile, 'hidden-canvas.png')}`);
};
