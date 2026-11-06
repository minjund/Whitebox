'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

module.exports = async function projectReorderChecks({ evaluate, waitFor, win, manager }) {
  win.webContents.debugger.attach('1.3');
  const originalSaved = await evaluate('localStorage.getItem("whitebox:workspace:v2")');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const order = () => evaluate('WhiteboxWorkspace.getState().spaces.map(item => item.id)');
  const selection = () => evaluate('WhiteboxWorkspace.getState().selectedSpace');
  const point = id => evaluate(`(() => {
    const node = [...document.querySelectorAll('#wbSpaces [data-space]')].find(n => n.dataset.space === ${JSON.stringify(id)});
    const r = node.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  let held = false;
  const mouse = async (type, p) => {
    if (type === 'mouseDown') held = true;
    if (type === 'mouseUp') held = false;
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: { mouseMove:'mouseMoved', mouseDown:'mousePressed', mouseUp:'mouseReleased' }[type],
      ...p, button: held || type === 'mouseUp' ? 'left' : 'none', buttons: held ? 1 : 0,
      ...(type === 'mouseMove' ? {} : { clickCount:1 }),
    });
  };
  const clean = async () => assert.equal(await evaluate('Boolean(document.querySelector(".is-dragging-project, .is-project-drag-source, [data-project-drop-edge]"))'), false, 'every drag marker is cleaned');
  const [first, second] = await order();
  assert(first && second);
  assert.equal(await evaluate('document.querySelector(".wb-local-workspace")'), null, 'redundant local workspace block removed');
  assert.equal(await evaluate('document.querySelector(".wb-brand").nextElementSibling.classList.contains("wb-project-search")'), true, 'search directly follows logo');
  await waitFor('!WhiteboxWorkspace.getState().busy && WhiteboxWorkspace.getState().sessions.every(s => s.pid > 0)', 'original terminal ready');
  const identities = manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId }));
  const originalSelection = await selection();
  let p = await point(second);
  await mouse('mouseMove', p); await mouse('mouseDown', p); await mouse('mouseUp', p);
  await waitFor(`WhiteboxWorkspace.getState().selectedSpace === ${JSON.stringify(second)}`, 'short press selects project');
  assert.deepEqual(await order(), [first, second]);
  p = await point(first);
  await mouse('mouseMove', p); await mouse('mouseDown', p); await mouse('mouseUp', p);
  await waitFor(`WhiteboxWorkspace.getState().selectedSpace === ${JSON.stringify(originalSelection)}`, 'original project selected');

  // Holding without movement arms reordering while polling continues.
  p = await point(second);
  await mouse('mouseMove', p); await mouse('mouseDown', p);
  await waitFor('document.querySelector("#terminalWorkspace").classList.contains("is-dragging-project")', 'long press arms drag');
  const target = await point(first);
  await mouse('mouseMove', { x: target.x, y: target.y - 8 });
  await waitFor('Boolean(document.querySelector("[data-project-drop-edge=before]"))', 'insertion guide');
  fs.writeFileSync(path.join(os.tmpdir(), 'whitebox-project-reorder.png'), (await win.webContents.capturePage()).toPNG());
  await mouse('mouseUp', { x: target.x, y: target.y - 8 });
  await waitFor(`WhiteboxWorkspace.getState().spaces[0].id === ${JSON.stringify(second)}`, 'long press reorders');
  assert.equal(await selection(), originalSelection, 'drag must not select the dragged project');
  await clean();
  assert.deepEqual(await evaluate('JSON.parse(localStorage.getItem("whitebox:workspace:v2")).spaces.map(s => s.id)'), [second, first]);
  await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'saved project order reload');
  assert.deepEqual(await order(), [second, first]);

  // Escape, blur and drops outside the sidebar all preserve the saved order.
  for (const cancel of ['escape', 'blur', 'outside', 'capture']) {
    await evaluate('window.addEventListener("pointerdown", event => { window.__reorderPointerId = event.pointerId; }, {once:true,capture:true})');
    p = await point(first);
    await mouse('mouseMove', p); await mouse('mouseDown', p);
    await waitFor('document.querySelector("#terminalWorkspace").classList.contains("is-dragging-project")', cancel + ' drag starts');
    const to = await point(second);
    await mouse('mouseMove', { x: to.x, y: to.y - 8 });
    await waitFor('Boolean(document.querySelector("[data-project-drop-edge=before]"))', cancel + ' pointer move processed');
    if (cancel === 'escape') {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    } else if (cancel === 'blur') await evaluate('window.dispatchEvent(new Event("blur"))');
    else if (cancel === 'capture') {
      assert.equal(await evaluate('document.querySelector("#terminalWorkspace").hasPointerCapture(window.__reorderPointerId)'), true);
      await evaluate('document.querySelector("#terminalWorkspace").releasePointerCapture(window.__reorderPointerId)');
      await mouse('mouseMove', to);
      await waitFor('!document.querySelector("#terminalWorkspace").classList.contains("is-dragging-project")', 'capture loss cancels drag');
    }
    else await mouse('mouseMove', { x: 600, y: 200 });
    await mouse('mouseUp', cancel === 'outside' ? { x: 600, y: 200 } : to);
    await pause(50); await clean();
    assert.deepEqual(await order(), [second, first], cancel + ' does not reorder');
  }

  // A conventional mouse drag also works without waiting for the hold timer.
  p = await point(first);
  await mouse('mouseMove', p); await mouse('mouseDown', p);
  const to = await point(second);
  await mouse('mouseMove', { x: to.x, y: to.y - 8 });
  await mouse('mouseUp', { x: to.x, y: to.y - 8 });
  await waitFor(`WhiteboxWorkspace.getState().spaces[0].id === ${JSON.stringify(first)}`, 'normal mouse drag');
  await clean();

  // Seed a larger saved list to test filtered movement and continuous scrolling.
  await evaluate(`(() => {
    const saved = JSON.parse(localStorage.getItem('whitebox:workspace:v2'));
    for (let i = 0; i < 18; i++) saved.spaces.push({ id:'reorder-'+i, name:(i === 2 || i === 4 ? 'Match ' : 'Fixture ')+i, cwd:'/fixture/project-'+i, tabs:[], activeTab:'', nextNumber:1 });
    localStorage.setItem('whitebox:workspace:v2', JSON.stringify(saved));
  })()`);
  await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'many project fixture');
  const search = text => evaluate(`(() => { const n=document.querySelector('#wbProjectSearch'); n.value=${JSON.stringify(text)}; n.dispatchEvent(new Event('input')); })()`);
  await search('Match');
  assert.equal(await evaluate('document.querySelectorAll("#wbSpaces [data-space]").length'), 2);
  p = await point('reorder-4');
  await mouse('mouseMove', p); await mouse('mouseDown', p);
  const filteredTarget = await point('reorder-2');
  await mouse('mouseMove', { x: filteredTarget.x, y: filteredTarget.y - 8 });
  await mouse('mouseUp', { x: filteredTarget.x, y: filteredTarget.y - 8 });
  const filteredOrder = await order();
  assert(filteredOrder.indexOf('reorder-4') < filteredOrder.indexOf('reorder-2'));
  assert(filteredOrder.indexOf('reorder-1') < filteredOrder.indexOf('reorder-3'), 'hidden projects retain relative order');
  await search('');
  await evaluate('document.querySelector(".wb-sidebar-scroll").scrollTop=0');
  p = await point(first);
  await mouse('mouseMove', p); await mouse('mouseDown', p);
  await waitFor('document.querySelector("#terminalWorkspace").classList.contains("is-dragging-project")', 'scroll drag starts');
  const bottom = await evaluate('(() => { const r=document.querySelector(".wb-sidebar-scroll").getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.floor(r.bottom-4)}; })()');
  await mouse('mouseMove', bottom);
  await waitFor('document.querySelector(".wb-sidebar-scroll").scrollTop > 100', 'auto scroll continues with stationary pointer');
  await mouse('mouseUp', bottom);
  await clean();
  assert((await order()).indexOf(first) > 1, 'drop follows scrolled target');

  await search('Match');
  await evaluate('document.querySelector("#wbSpaces [data-space=reorder-4]").focus()');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down', modifiers: ['alt'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down', modifiers: ['alt'] });
  await waitFor('document.querySelector("#wbSpaces [data-space]").dataset.space === "reorder-2"', 'keyboard reorder');
  assert.equal(await evaluate('document.activeElement.dataset.space'), 'reorder-4', 'keyboard focus follows moved project');
  assert.deepEqual(manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId })), identities, 'project reorder preserves original PTYs');
  win.webContents.debugger.detach();
  await evaluate(`localStorage.setItem('whitebox:workspace:v2', ${JSON.stringify(originalSaved)})`);
  await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'original project fixture restored');
  console.log('PASS project short click, long press, pointer drag, guide, Escape/blur/capture/outside cancellation, filtered order, continuous auto-scroll, keyboard, reload persistence, original PTYs and local workspace block removal');
};
