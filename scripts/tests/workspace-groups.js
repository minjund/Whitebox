'use strict';
// Named groups in the real renderer: dragging another panel's terminal onto the
// screen makes "그룹 N" with its name open for editing; a named group survives
// switching and reload and reopens its split; an unnamed group disappears when
// the split is back to one panel; ungrouping keeps every terminal and panel.
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
  console.log('PASS groups: a mixed split by drag becomes "그룹 N" with its name open, rename, same group on re-split, reopen and reload, unnamed group dropped when unmixed, ungroup keeps PTYs and panels');
  await new Promise(resolve => process.stdout.write('', resolve));
};
