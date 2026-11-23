'use strict';
// Named groups: a screen split that mixes terminals from more than one panel.
// The split is created by dragging another panel's terminal onto the screen;
// at that moment the arrangement becomes "그룹 N" and its name opens for
// editing. Later drops only change the split. When the split goes back to one
// panel, an unnamed group disappears; a group the person named stays and
// restores its last split. Panels, their membership and colours are unchanged.
window.WhiteboxTerminalGroups = function createTerminalGroups(context) {
  const { root, t, esc, layout } = context;
  let groups = [], nextNumber = 1, editing = '', menuFor = '', armed = false, armedFrom = '', lastActive = '', lastHtml = '';

  const allPanels = () => context.owners().flatMap(owner => owner.tabs.map(panel => ({ owner, panel })));
  const available = () => new Set(allPanels().flatMap(({ panel }) => layout.ids(panel.layout)));
  const panelsIn = view => [...new Set(layout.ids(view).map(id => context.panelFor(id)?.id).filter(Boolean))];
  const sameSet = (a, b) => a.length === b.length && a.every(id => b.includes(id));
  // The panel that shows a group's split: where it was made, or else the panel of its first terminal.
  function anchor(group) {
    const panels = allPanels();
    return panels.find(({ owner, panel }) => owner.id === group.ownerId && panel.id === group.panelId)
      || panels.find(({ panel }) => panel.id === context.panelFor(layout.ids(group.layout)[0])?.id);
  }
  function current() {
    const owner = context.space(), panel = context.tab(), view = context.canvasLayout();
    return owner && panel && view ? { owner, panel, view } : null;
  }
  // A group is identified by the terminals on screen, whichever panel shows them.
  const groupOf = view => groups.find(group => sameSet(layout.ids(group.layout), layout.ids(view)));
  function active() {
    const now = current();
    return now && panelsIn(now.view).length > 1 ? groupOf(now.view) || null : null;
  }
  function remove(group) { groups = groups.filter(item => item !== group); if (editing === group.id) editing = ''; }
  function adopt(group, now) { group.layout = now.view; group.ownerId = now.owner.id; group.panelId = now.panel.id; }

  // Called on every screen render. Only a split the person changes (armed by a
  // drag or arrange) can make a group; navigating never creates one.
  function sync() {
    const ids = available();
    groups = groups.filter(group => {
      const fitted = layout.fit(group.layout, ids);
      if (!fitted) return false;
      group.layout = fitted;
      return group.named || panelsIn(fitted).length > 1;
    });
    const now = current();
    if (now) {
      const mixed = panelsIn(now.view).length > 1, shown = layout.ids(now.view);
      let group = groupOf(now.view);
      if (armed) {
        // A drop continues the group whose screen it changed.
        group = groups.find(item => item.id === armedFrom) || group;
        if (mixed && !group) {
          group = { id: crypto.randomUUID(), name: `${t('그룹')} ${nextNumber}`, number: nextNumber, named: false, ownerId: now.owner.id, panelId: now.panel.id, layout: now.view };
          nextNumber += 1;
          groups.push(group);
          editing = group.id;
        }
        if (group && mixed) adopt(group, now);
        else if (group && !group.named) remove(group);
      } else if (!group && lastActive) {
        // A terminal hidden from the group's screen: same group, fewer terminals.
        const previous = groups.find(item => item.id === lastActive), before = previous ? layout.ids(previous.layout) : [];
        if (previous && shown.length < before.length && shown.every(id => before.includes(id))) {
          if (mixed) { adopt(previous, now); group = previous; } else if (!previous.named) remove(previous);
        }
      } else if (group && mixed) group.layout = now.view;
      lastActive = group && mixed ? group.id : '';
    }
    armed = false; armedFrom = '';
  }

  function open(groupId) {
    const group = groups.find(item => item.id === groupId), found = group && anchor(group);
    if (!found) return;
    const fitted = layout.fit(group.layout, available());
    if (!fitted) return;
    found.panel.viewLayout = fitted;
    context.activate(found.owner, found.panel, layout.ids(fitted)[0]);
    menuFor = '';
    context.renderLayout();
  }
  function rename(groupId, value) {
    const group = groups.find(item => item.id === groupId);
    const name = String(value || '').replace(/\s+/gu, ' ').trim().slice(0, 40);
    if (group && name && name !== group.name) { group.name = name; group.named = true; }
    editing = '';
    render(true); context.refreshNav(); context.save();
  }
  // Ungrouping keeps every terminal and panel; the panel shows only its own terminals again.
  function dissolve(groupId) {
    const group = groups.find(item => item.id === groupId), found = group && anchor(group);
    groups = groups.filter(item => item.id !== groupId);
    menuFor = '';
    if (found) {
      found.panel.viewLayout = found.panel.layout;
      if (context.space() === found.owner && context.tab() === found.panel) found.owner.viewLayout = found.panel.layout;
    }
    context.renderLayout();
  }

  function render(force = false) {
    const section = root.querySelector('#wbGroups');
    if (!section) return;
    const input = section.querySelector('input[data-group-name]');
    if (!force && input && document.activeElement === input) return;
    const on = active();
    const rows = groups.map(group => {
      const ids = layout.ids(group.layout), members = panelsIn(group.layout).map(id => allPanels().find(item => item.panel.id === id)?.panel).filter(Boolean);
      const swatches = members.slice(0, 4).map(panel => `<i style="--wb-panel-color:${esc(context.panelColor(panel))}"></i>`).join('');
      const label = editing === group.id
        ? `<input data-group-name="${esc(group.id)}" value="${esc(group.name)}" maxlength="40" aria-label="${esc(t('그룹 이름'))}" spellcheck="false">`
        : `<strong>${esc(group.name)}</strong>`;
      const menu = menuFor === group.id ? `<div class="wb-group-menu" role="menu"><button role="menuitem" data-group-rename="${esc(group.id)}">${esc(t('이름 바꾸기'))}</button><button role="menuitem" class="danger" data-group-dissolve="${esc(group.id)}">${esc(t('분할 풀기'))} <small>${esc(t('터미널은 그대로'))}</small></button></div>` : '';
      return `<div class="wb-group-row ${on === group ? 'active' : ''}" data-group-row="${esc(group.id)}">
        <button type="button" class="wb-group-main" data-group-open="${esc(group.id)}" aria-current="${on === group}" ${editing === group.id ? 'tabindex="-1"' : ''}>
          <span class="wb-group-swatches" aria-hidden="true">${swatches}</span>
          <span class="wb-group-copy">${editing === group.id ? '' : label}<small>${esc(t('터미널'))} ${ids.length} · ${esc(t('패널'))} ${members.length}</small></span>
        </button>${editing === group.id ? `<span class="wb-group-edit">${label}</span>` : ''}
        <button type="button" class="wb-group-more" data-group-menu="${esc(group.id)}" aria-label="${esc(group.name)} ${esc(t('그룹 관리'))}" aria-expanded="${menuFor === group.id}">⋯</button>${menu}
      </div>`;
    }).join('');
    const html = groups.length ? `<div class="wb-side-heading"><span>${esc(t('그룹'))}</span></div><div class="wb-group-list">${rows}</div>` : '';
    section.hidden = !groups.length;
    if (html !== lastHtml) { section.innerHTML = html; lastHtml = html; }
    const field = section.querySelector('input[data-group-name]');
    if (field && document.activeElement !== field) { field.focus({ preventScroll: true }); field.select(); }
  }

  root.addEventListener('click', event => {
    const section = root.querySelector('#wbGroups');
    if (!section?.contains(event.target)) { if (menuFor && !event.target.closest('.wb-group-menu')) { menuFor = ''; render(true); } return; }
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.groupMenu) { menuFor = menuFor === button.dataset.groupMenu ? '' : button.dataset.groupMenu; render(true); return; }
    if (button.dataset.groupRename) { editing = button.dataset.groupRename; menuFor = ''; render(true); return; }
    if (button.dataset.groupDissolve) { dissolve(button.dataset.groupDissolve); return; }
    if (button.dataset.groupOpen && editing !== button.dataset.groupOpen) open(button.dataset.groupOpen);
  });
  root.addEventListener('keydown', event => {
    const input = event.target.closest?.('input[data-group-name]');
    if (!input || event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); rename(input.dataset.groupName, input.value); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editing = ''; render(true); }
  });
  root.addEventListener('focusout', event => {
    const input = event.target.closest?.('input[data-group-name]');
    if (input && editing === input.dataset.groupName) rename(input.dataset.groupName, input.value);
  });

  return {
    sync, render, active, open, rename, dissolve,
    // While a name is being typed, the workspace must not move focus to a terminal.
    editing: () => Boolean(editing),
    // The next split change comes from the person (a drag or an arrange), not a restore.
    arm() { armed = true; armedFrom = active()?.id || ''; },
    serialize() { return { nextNumber, groups: groups.map(({ id, name, number, named, ownerId, panelId, layout: view }) => ({ id, name, number, named, ownerId, panelId, layout: view })) }; },
    restore(saved) {
      if (!saved || typeof saved !== 'object') return;
      nextNumber = Math.max(1, Math.min(10000, Number(saved.nextNumber) || 1));
      groups = (Array.isArray(saved.groups) ? saved.groups.slice(0, 50) : []).filter(group => group && typeof group.id === 'string'
        && typeof group.name === 'string' && typeof group.ownerId === 'string' && typeof group.panelId === 'string' && group.layout)
        .map(group => ({ id: group.id, name: group.name.slice(0, 40), number: Number(group.number) || 0, named: group.named === true, ownerId: group.ownerId, panelId: group.panelId, layout: group.layout }));
    },
  };
};
