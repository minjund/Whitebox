'use strict';
// Named groups in the real renderer: every screen split is a group. Dragging a
// terminal onto the screen makes "그룹 N" with its name open for editing; a
// named group survives switching and reload and reopens its split; an unnamed
// group disappears when its split is hidden down to one terminal; ungrouping
// keeps every terminal and panel; a sidebar terminal opens alone and the group
// brings the split back; splits saved before groups are named once on load.
const assert = require('node:assert/strict');

function lit(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('JavaScript 리터럴로 직렬화할 수 없는 값입니다.');
  return serialized.replace(/[<>/\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

module.exports = async function groupChecks({ evaluate, waitFor, win, manager }) {
  const activeId = () => evaluate('WhiteboxWorkspace.getState().activeId');
  const visible = () => evaluate('[...document.querySelectorAll("#wbCanvas .wb-pane")].map(node => node.dataset.terminalId)');
  const rows = () => evaluate('[...document.querySelectorAll("#wbGroups .wb-group-row")].map(row => ({ name: row.querySelector("strong")?.textContent || row.querySelector("input")?.value || "", active: row.classList.contains("active"), editing: Boolean(row.querySelector("input")) }))');
  const identities = () => manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId })).sort((a, b) => a.id.localeCompare(b.id));
  const drag = (id, selector, x, y) => evaluate(`(() => {
    const source = document.querySelector('[data-instance=' + ${lit(JSON.stringify(id))} + ']');
    const target = document.querySelector(${lit(selector)});
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const rect = target.getBoundingClientRect();
    const event = type => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + rect.width * ${x}, clientY: rect.top + rect.height * ${y} });
    const accepted = !target.dispatchEvent(event('dragover'));
    target.dispatchEvent(event('drop'));
    source.dispatchEvent(event('dragend'));
    return accepted;
  })()`);
  const pane = id => `#wbCanvas [data-terminal-id=${JSON.stringify(id)}]`;
  const typeName = (value, key) => evaluate(`(() => { const input = document.querySelector('#wbGroups input[data-group-name]'); input.value = ${lit(value)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ${lit(key)}, bubbles: true, cancelable: true })); })()`);

  const locale = await evaluate('document.documentElement.dataset.locale || "ko"');
  const numbered = n => `${locale === 'en' ? 'Group' : locale === 'zh-CN' ? '分组' : '그룹'} ${n}`;
  const first = await activeId();
  assert(first, 'fixture starts with a project terminal');
  await evaluate('document.querySelector("[data-new-panel]").click()');
  await waitFor(`WhiteboxWorkspace.getState().activeId && WhiteboxWorkspace.getState().activeId !== ${lit(first)} && !WhiteboxWorkspace.getState().busy`, 'second panel');
  const second = await activeId();
  await evaluate(`document.querySelector('[data-instance=' + ${lit(JSON.stringify(first))} + ']').click()`);
  await waitFor(`JSON.stringify([...document.querySelectorAll('#wbCanvas .wb-pane')].map(node => node.dataset.terminalId)) === ${lit(JSON.stringify([first]))}`, 'first panel alone');
  assert.equal(await evaluate('document.querySelector("#wbGroups").hidden'), true, 'one panel on screen is not a group');

  const before = identities();
  // 1. Dragging the other panel's terminal beside it makes "그룹 1", name open.
  assert.equal(await drag(second, pane(first), .85, .5), true);
  await waitFor(`document.querySelectorAll('#wbCanvas .wb-pane').length === 2`, 'mixed split');
  await waitFor(`!document.querySelector('#wbGroups').hidden && document.activeElement === document.querySelector('#wbGroups input[data-group-name]')`, 'a group appears with its name open for editing');
  // The born effect animates, or with reduced motion (CI runners) stays a still highlight.
  const born = await evaluate(`(() => { const row = document.querySelector('#wbGroups .wb-group-row'), style = getComputedStyle(row);
    return { born: row.classList.contains('is-born'), reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, animation: style.animationName, background: style.backgroundColor }; })()`);
  assert(born.born && (born.reduced ? born.animation === 'none' && born.background !== 'rgba(0, 0, 0, 0)' : born.animation === 'wb-group-born'), `a group made by a split arrives with the born effect: ${JSON.stringify(born)}`);
  assert.deepEqual(await rows(), [{ name: numbered(1), active: true, editing: true }]);
  await typeName('결제 작업', 'Enter');
  await waitFor(`document.querySelector('#wbGroups strong')?.textContent === '결제 작업'`, 'the typed name is kept');
  assert.equal(await evaluate('document.querySelector("#wbBreadcrumbProject").textContent'), '결제 작업', 'the top path names the group');
  // A further drop only changes the split; no second group.
  assert.equal(await drag(second, pane(first), .5, .9), true);
  await waitFor(`WhiteboxWorkspace.getState().spaces[0].viewLayout?.axis === 'column'`, 'restacked split');
  assert.equal((await rows()).length, 1, 'changing the split keeps the same group');

  // 2. Another screen (a new panel) is not the group; reopening restores its split; it survives reload.
  await evaluate('document.querySelector("[data-new-panel]").click()');
  await waitFor(`![${lit(first)}, ${lit(second)}].includes(WhiteboxWorkspace.getState().activeId) && !WhiteboxWorkspace.getState().busy`, 'third panel');
  const third = await activeId();
  await waitFor(`!document.querySelector('#wbGroups .wb-group-row').classList.contains('active')`, 'another screen is not the group');
  await evaluate('document.querySelector("#wbGroups [data-group-open]").click()');
  await waitFor(`document.querySelectorAll('#wbCanvas .wb-pane').length === 2 && document.querySelector('#wbGroups .wb-group-row').classList.contains('active')`, 'the group reopens its split');
  await win.reload();
  await waitFor('Boolean(window.WhiteboxWorkspace) && Boolean(document.querySelector("#wbGroups strong"))', 'groups after reload', 15000);
  assert.equal(await evaluate('document.querySelector("#wbGroups strong").textContent'), '결제 작업');

  // 3. An unnamed group goes away when its split is back to one panel.
  await evaluate(`document.querySelector('[data-instance=' + ${lit(JSON.stringify(third))} + ']').click()`);
  await waitFor(`JSON.stringify([...document.querySelectorAll('#wbCanvas .wb-pane')].map(node => node.dataset.terminalId)) === ${lit(JSON.stringify([third]))}`, 'third panel alone');
  assert.equal(await drag(first, pane(third), .85, .5), true);
  await waitFor(`document.querySelectorAll('#wbGroups .wb-group-row').length === 2 && Boolean(document.querySelector('#wbGroups input[data-group-name]'))`, 'second group with its name open');
  assert.equal((await rows())[1].name, numbered(2), 'groups are numbered');
  await typeName(numbered(2), 'Escape');
  await waitFor(`!document.querySelector('#wbGroups input[data-group-name]')`, 'Escape keeps the numbered name');
  await evaluate(`document.querySelector(${lit(`${pane(first)} [data-hide-terminal]`)}).click()`);
  await waitFor(`document.querySelectorAll('#wbGroups .wb-group-row').length === 1`, 'the unnamed group disappears with its mixed split');

  // 4. Ungrouping keeps every terminal and panel.
  await evaluate('document.querySelector("#wbGroups [data-group-menu]").click()');
  await evaluate('document.querySelector("#wbGroups [data-group-dissolve]").click()');
  await waitFor(`document.querySelector('#wbGroups').hidden`, 'ungroup removes the named group');
  assert.deepEqual(identities().filter(item => item.id !== third), before, 'groups never start, stop or replace a terminal');
  assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces[0].tabs.length'), 3, 'every panel remains');
  assert.deepEqual(new Set(await visible()).size >= 1, true);
  // 5. A sidebar terminal shows alone; a split made in one panel is a group too,
  //    named without opening the name, and the group brings the split back.
  await evaluate(`document.querySelector('[data-instance=' + ${lit(JSON.stringify(first))} + ']').click()`);
  await waitFor(`JSON.stringify([...document.querySelectorAll('#wbCanvas .wb-pane')].map(node => node.dataset.terminalId)) === ${lit(JSON.stringify([first]))}`, 'a sidebar terminal opens alone');
  await evaluate('WhiteboxWorkspace.createTerminal("row")');
  await waitFor(`document.querySelectorAll('#wbCanvas .wb-pane').length === 2 && !WhiteboxWorkspace.getState().busy`, 'a new terminal beside it');
  const added = await activeId();
  await waitFor(`document.querySelectorAll('#wbGroups .wb-group-row').length === 1`, 'a split inside one panel becomes a group');
  assert.deepEqual(await rows(), [{ name: numbered(3), active: true, editing: false }], 'named in order, name not opened for a split that was not dragged');
  assert.equal(await evaluate('document.querySelector("#wbGroups .wb-group-born")?.getAttribute("role")'), 'status', 'a split says that it made a group');
  await waitFor('!document.querySelector("#wbGroups .is-born")', 'the born effect ends by itself', 5000);
  await evaluate(`document.querySelector('[data-instance=' + ${lit(JSON.stringify(added))} + ']').click()`);
  await waitFor(`JSON.stringify([...document.querySelectorAll('#wbCanvas .wb-pane')].map(node => node.dataset.terminalId)) === ${lit(JSON.stringify([added]))}`, 'a terminal of the group opens alone');
  assert.deepEqual(await rows(), [{ name: numbered(3), active: false, editing: false }], 'showing one terminal keeps the group');
  await evaluate('document.querySelector("#wbGroups [data-group-open]").click()');
  await waitFor(`document.querySelectorAll('#wbCanvas .wb-pane').length === 2 && document.querySelector('#wbGroups .wb-group-row').classList.contains('active')`, 'the group brings its split back');
  assert.deepEqual(new Set(await visible()), new Set([first, added]));

  // 6. A split saved before every split was a group is named once on load.
  await evaluate(`(() => { const state = JSON.parse(localStorage.getItem('whitebox:workspace:v2')); delete state.groups; localStorage.setItem('whitebox:workspace:v2', JSON.stringify(state)); })()`);
  await win.reload();
  await waitFor('Boolean(window.WhiteboxWorkspace) && document.querySelectorAll("#wbGroups .wb-group-row").length === 1', 'an existing split becomes a group after update', 15000);
  assert.deepEqual(await rows(), [{ name: numbered(1), active: true, editing: false }], 'the existing split gets a numbered name');
  await win.reload();
  await waitFor('Boolean(window.WhiteboxWorkspace) && Boolean(document.querySelector("#wbGroups strong"))', 'groups after second reload', 15000);
  assert.equal((await rows()).length, 1, 'migration runs once, not on every start');
  // 7. Dragging a whole panel onto a group adds its terminals beside the
  //    group's selected terminal, like "+ 터미널" adds to a panel.
  const thirdPanel = await evaluate(`WhiteboxWorkspace.getState().spaces[0].tabs.find(panel => JSON.stringify(panel.layout).includes(${lit(third)})).id`);
  const panelCountBefore = await evaluate('WhiteboxWorkspace.getState().spaces[0].tabs.length');
  const groupBefore = await evaluate('WhiteboxWorkspace.getState().spaces[0].viewLayout');
  const selectedBefore = await activeId();
  const centre = selector => evaluate(`(() => { const r = document.querySelector(${lit(selector)}).getBoundingClientRect(); return { x: r.left + 6, y: r.top + 4 }; })()`);
  const from = await centre(`[data-drag-panel=${JSON.stringify(thirdPanel)}]`);
  const to = await evaluate(`(() => { const r = document.querySelector('#wbGroups [data-group-row]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  win.webContents.debugger.attach('1.3');
  try {
    const mouse = params => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', params);
    await mouse({ type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 8; step++) await mouse({ type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8, button: 'left', buttons: 1 });
    assert.equal(await evaluate(`document.querySelector('#wbGroups [data-group-row]').dataset.dropDirection`), 'group', 'the group shows it takes the drop');
    await mouse({ type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 });
  } finally { win.webContents.debugger.detach(); }
  await waitFor(`document.querySelectorAll('#wbCanvas .wb-pane').length === 3`, 'the dropped panel joins the group');
  assert.deepEqual(new Set(await visible()), new Set([first, added, third]));
  assert.deepEqual((await rows()).map(row => row.active), [true], 'still one group, now holding the panel');
  assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces[0].tabs.length'), panelCountBefore, 'the panel itself stays');
  // Same placement as a new terminal: split beside the selected terminal, then the usual grid.
  const layoutModule = require('../../renderer/terminal-workspace-layout');
  assert.deepEqual(await evaluate('WhiteboxWorkspace.getState().spaces[0].viewLayout'), layoutModule.split(groupBefore, selectedBefore, third, 'row'), 'placed like a terminal added to a panel');
  console.log('PASS groups: dragging a panel onto a group adds it beside the selected terminal');
  console.log('PASS groups: a mixed split by drag becomes "그룹 N" with its name open, rename, same group on re-split, reopen and reload, unnamed group dropped when unmixed, ungroup keeps PTYs and panels, sidebar terminal alone and group restores the split, one-panel split is a group, existing splits migrate once');
  await new Promise(resolve => process.stdout.write('', resolve));
};
