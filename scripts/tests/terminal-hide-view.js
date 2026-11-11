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
  const waitForLivePtys = async ids => {
    // A new pane mounts asynchronously and initially has no process identity.
    // Compare identities only after real PTYs have started, before any X click.
    const deadline = Date.now() + 5000;
    const ready = () => ids.every(id => {
      const session = manager.get(id);
      return session && Number.isInteger(session.pid) && session.pid > 0;
    });
    while (!ready() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert(ready(), 'identity baseline requires every original PTY to be running');
  };
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
  await waitForLivePtys([first, second]);
  const before = await snapshot(), original = identities();
  assert.deepEqual(new Set(await visible()), new Set([first, second]));
  // Hiding another pane re-renders the layout, which re-parents every pane.
  // Chromium blurs a moved textarea without compositionend: keep the Korean
  // syllable being composed and keyboard focus in the pane being typed in.
  const typed = [], write = manager.write;
  // A shell with focus reporting on (PowerShell on Windows) also receives the
  // re-parent's focus-out/in reports; only the typed text is compared.
  const typedText = () => typed.join('').replace(/\x1b\[[IO]/gu, '');
  manager.write = function (id, value, ...rest) { if (id === second) typed.push(String(value)); return write.call(this, id, value, ...rest); };
  const input = `document.querySelector('#wbCanvas [data-terminal-id="${second}"] .ghostty-input')`;
  await evaluate(`${input}.focus()`);
  win.webContents.debugger.attach('1.3');
  let typingFocus;
  try {
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
    await hide(first); // Hide a pane that does not own keyboard focus.
    typingFocus = await evaluate(`document.activeElement === ${input}`);
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '글', selectionStart: 1, selectionEnd: 1 });
    await win.webContents.debugger.sendCommand('Input.insertText', { text: '글' });
    const deadline = Date.now() + 3000;
    while (typedText() !== '한글' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  } finally { win.webContents.debugger.detach(); manager.write = write; }
  assert.equal(typingFocus, true, 'hiding another pane keeps keyboard focus in the pane being typed in');
  assert.equal(typedText(), '한글', 'the composing syllable survives the layout re-render exactly once');
  await evaluate(`${input}.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', code: 'KeyU', keyCode: 85, ctrlKey: true, bubbles: true, cancelable: true }))`);
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
  // Reload hydrates panes lazily; wait for the original terminal's replay first.
  await waitFor(`!document.querySelector('[data-terminal-id="${first}"] .wb-pane-loading')`, 'original pane mounted after reload');
  // Split the marker in the command so an echoed command is not execution proof.
  await hide(first);
  const command = process.platform === 'win32' ? "Write-Output ('WB_X_' + 'LIVE')" : "printf 'WB_X_%s\\n' 'LIVE'";
  await manager.command(first, command);
  const deadline = Date.now() + 5000;
  while (!manager.get(first, true).replay.includes('WB_X_LIVE') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert(manager.get(first, true).replay.includes('WB_X_LIVE'), 'the original hidden PTY must execute the command');
  await reopen(first);
  await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(first)}).replace(/\\s+/g, '').includes('WB_X_LIVE')`, 'live output after reopening');
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
  await waitForLivePtys([first, second, third, independent]);
  const independentState = await snapshot(), independentIds = identities();
  await hide(independent);
  assert.deepEqual(await visible(), []);
  assert.deepEqual(await snapshot(), independentState, 'independent panel also survives X');
  await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload hidden independent panel');
  assert.deepEqual(await visible(), [], 'independent hidden canvas survives reload');
  await reopen(independent);
  assert.deepEqual(await visible(), [independent]);
  assert.deepEqual(identities(), independentIds);
  // The sidebar trash icon archives the terminal; it remains distinct from hiding.
  await click(`.wb-instance-row [data-trash-terminal="${independent}"]`);
  await waitFor(`!WhiteboxWorkspace.getState().busy && WhiteboxWorkspace.getState().trash.some(i=>i.id===${JSON.stringify(independent)}) && !document.querySelector('[data-terminal-id="${independent}"]')`, 'sidebar trash icon moves the terminal to the trash');
  assert.equal(manager.get(independent)?.status, 'stopped', 'the archived session is stopped, not removed');
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
