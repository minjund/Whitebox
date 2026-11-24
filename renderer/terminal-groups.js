'use strict';
// Named groups: every screen split (two or more terminals on screen) is a group.
// Clicking a terminal in the sidebar shows that terminal alone; clicking a
// group brings its split back. A split made by dragging a terminal onto the
// screen becomes "그룹 N" with its name open for editing; a split made another
// way (a new terminal beside one, or a split saved before groups existed) gets
// a name without opening it. Later changes to that screen change the group.
// Panels, their membership and colours are unchanged.
window.WhiteboxTerminalGroups = function createTerminalGroups(context) {
  const { root, t, esc, layout } = context;
  let groups = [], nextNumber = 1, editing = '', menuFor = '', armed = false, armedFrom = '', lastActive = '', lastPlace = '', lastHtml = '';
  let migrated = true;
  const born = new Map(); // group id -> when the person's split made it, for the "새 그룹" effect
  const BORN_MS = 2400;

  const allPanels = () => context.owners().flatMap(owner => owner.tabs.map(panel => ({ owner, panel })));
  const available = () => new Set(allPanels().flatMap(({ panel }) => layout.ids(panel.layout)));
  const panelsIn = view => [...new Set(layout.ids(view).map(id => context.panelFor(id)?.id).filter(Boolean))];
  const isSplit = view => layout.ids(view).length > 1;
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
    return now && isSplit(now.view) ? groupOf(now.view) || null : null;
  }
  function remove(group) { groups = groups.filter(item => item !== group); if (editing === group.id) editing = ''; }
  function adopt(group, now) { group.layout = now.view; group.ownerId = now.owner.id; group.panelId = now.panel.id; }
  function create(view, ownerId, panelId) {
    const group = { id: crypto.randomUUID(), name: `${t('그룹')} ${nextNumber}`, number: nextNumber, named: false, ownerId, panelId, layout: view };
    nextNumber += 1;
    groups.push(group);
    return group;
  }
  // A group made by splitting the screen says so: its row arrives with a short highlight.
  function announce(group) {
    born.set(group.id, Date.now());
    setTimeout(() => { born.delete(group.id); render(true); }, BORN_MS);
    return group;
  }
  // Splits saved before every split was a group become groups once, in sidebar order.
  function migrate(ids) {
    migrated = true;
    for (const { owner, panel } of allPanels()) {
      const view = layout.fit(panel.viewLayout, ids);
      if (view && isSplit(view) && !groupOf(view) && groups.length < 50) create(view, owner.id, panel.id);
    }
    context.save();
  }

  // Called on every screen render. A split on screen always belongs to a
  // group: a change to the group's own screen changes that group, any other
  // split becomes a new group. Showing one terminal alone leaves groups as
  // they are, so the group still brings its split back.
  function sync() {
    const ids = available();
    groups = groups.filter(group => {
      const fitted = layout.fit(group.layout, ids);
      if (!fitted) return false;
      group.layout = fitted;
      return group.named || isSplit(fitted);
    });
    if (!migrated) migrate(ids);
    const now = current();
    if (now) {
      const split = isSplit(now.view), place = `${now.owner.id}\n${now.panel.id}`;
      let group = groupOf(now.view);
      if (armed) {
        // A drop continues the group whose screen it changed.
        group = groups.find(item => item.id === armedFrom) || group;
        if (split && !group) { group = create(now.view, now.owner.id, now.panel.id); editing = group.id; announce(group); }
        if (group && split) adopt(group, now);
        else if (group && !group.named) remove(group);
      } else if (split && !group) {
        // A terminal added to or hidden from the group's screen: same group.
        const previous = place === lastPlace && groups.find(item => item.id === lastActive);
        group = previous || announce(create(now.view, now.owner.id, now.panel.id));
        adopt(group, now);
      } else if (group && split) group.layout = now.view;
      lastActive = group && split ? group.id : '';
      lastPlace = place;
    }
    armed = false; armedFrom = '';
  }

  function open(groupId) {
    const group = groups.find(item => item.id === groupId), found = group && anchor(group);
    if (!found) return;
    const fitted = layout.fit(group.layout, available());
    if (!fitted) return;
    // Activate first: activating remembers the current screen into the panel,
    // which would overwrite the split when the panel is the one on screen.
    const focus = layout.ids(fitted).includes(found.panel.activePane) ? found.panel.activePane : layout.ids(fitted)[0];
    context.activate(found.owner, found.panel, focus);
    found.panel.viewLayout = found.owner.viewLayout = fitted;
    found.owner.activeSurface = found.panel.activePane = focus;
    menuFor = '';
    context.renderLayout();
  }
  // A panel or terminal dropped on a group joins its split the way "+ 터미널"
  // adds to a panel: beside the selected terminal, side by side, each next one
  // beside the one added before it. Panels and their membership are unchanged.
  function add(groupId, ids) {
    const group = groups.find(item => item.id === groupId), found = group && anchor(group);
    const live = available();
    let view = found && layout.fit(group.layout, live);
    if (!view) return false;
    const shown = layout.ids(view);
    let target = shown.includes(found.panel.activePane) ? found.panel.activePane : shown[0];
    for (const id of ids) {
      if (!live.has(id) || layout.ids(view).includes(id)) continue;
      view = layout.split(view, target, id, 'row');
      target = id;
    }
    group.layout = view;
    found.panel.activePane = target;
    open(groupId);
    context.save();
    return true;
  }
  function rename(groupId, value) {
    const group = groups.find(item => item.id === groupId);
    const name = String(value || '').replace(/\s+/gu, ' ').trim().slice(0, 40);
    if (group && name && name !== group.name) { group.name = name; group.named = true; }
    editing = '';
    render(true); context.refreshNav(); context.save();
  }
  // Ungrouping keeps every terminal and panel. A split is always a group, so
  // the screen that showed it goes back to one terminal.
  function dissolve(groupId) {
    const group = groups.find(item => item.id === groupId), found = group && anchor(group);
    groups = groups.filter(item => item.id !== groupId);
    menuFor = '';
    if (found) {
      const ids = layout.ids(group.layout), own = layout.ids(found.panel.layout);
      const keep = [found.panel.activePane, ...ids].find(id => own.includes(id) && ids.includes(id)) || own[0];
      const showing = context.space() === found.owner && context.tab() === found.panel
        && sameSet(layout.ids(found.owner.viewLayout), ids);
      if (keep && (showing || sameSet(layout.ids(found.panel.viewLayout), ids))) {
        found.panel.viewLayout = { id: keep };
        if (showing) { found.owner.viewLayout = { id: keep }; found.owner.activeSurface = found.panel.activePane = keep; }
      }
    }
    lastActive = '';
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
      const isNew = born.has(group.id);
      return `<div class="wb-group-row ${on === group ? 'active' : ''} ${isNew ? 'is-born' : ''}" data-group-row="${esc(group.id)}">
        <button type="button" class="wb-group-main" data-group-open="${esc(group.id)}" aria-current="${on === group}" ${editing === group.id ? 'tabindex="-1"' : ''}>
          <span class="wb-group-swatches" aria-hidden="true">${swatches}</span>
          <span class="wb-group-copy">${editing === group.id ? '' : label}<small>${esc(t('터미널'))} ${ids.length} · ${esc(t('패널'))} ${members.length}</small></span>${isNew ? `<span class="wb-group-born" role="status">${esc(t('그룹이 생겼어요'))}</span>` : ''}
        </button>${editing === group.id ? `<span class="wb-group-edit">${label}</span>` : ''}
        <button type="button" class="wb-group-more" data-group-menu="${esc(group.id)}" aria-label="${esc(group.name)} ${esc(t('그룹 관리'))}" aria-expanded="${menuFor === group.id}">⋯</button>${menu}
      </div>`;
    }).join('');
    const html = groups.length ? `<div class="wb-side-heading"><span>${esc(t('그룹'))}</span><small>${groups.length}</small></div><div class="wb-group-list">${rows}</div>` : '';
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
    sync, render, active, open, add, rename, dissolve,
    // While a name is being typed, the workspace must not move focus to a terminal.
    editing: () => Boolean(editing),
    // The next split change comes from the person (a drag or an arrange), not a restore.
    arm() { armed = true; armedFrom = active()?.id || ''; },
    serialize() { return { nextNumber, migrated: true, groups: groups.map(({ id, name, number, named, ownerId, panelId, layout: view }) => ({ id, name, number, named, ownerId, panelId, layout: view })) }; },
    restore(saved) {
      // State saved before every split was a group (none, or 2.0.41) is migrated once.
      migrated = saved?.migrated === true;
      if (!saved || typeof saved !== 'object') return;
      nextNumber = Math.max(1, Math.min(10000, Number(saved.nextNumber) || 1));
      groups = (Array.isArray(saved.groups) ? saved.groups.slice(0, 50) : []).filter(group => group && typeof group.id === 'string'
        && typeof group.name === 'string' && typeof group.ownerId === 'string' && typeof group.panelId === 'string' && group.layout)
        .map(group => ({ id: group.id, name: group.name.slice(0, 40), number: Number(group.number) || 0, named: group.named === true, ownerId: group.ownerId, panelId: group.panelId, layout: group.layout }));
    },
  };
};
