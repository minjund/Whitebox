'use strict';

(() => {
  const api = window.whitebox;
  const panel = document.querySelector('#terminalGroupPanel');
  if (!panel || !api?.terminalGroups) return;
  const esc = value => window.WhiteboxRendererUtils.esc(String(value || ''));
  let activeId = '';
  let generation = 0;
  let busy = false;
  let knownGroups = [];
  let linksVisible = true;
  const layoutApi = window.WhiteboxGroupLayout;
  let layout = null, layoutGroupId = '', draggedMember = '', pendingSplit = null;
  const abbreviations = { claude: 'Cl', codex: 'Cx', gemini: 'Ge', grok: 'Gk' };
  let fontSize = 15;
  let columns = 2;
  let currentGroup = null;
  let pendingDeleteId = '';
  let overviewError = '';
  let liveTerminals = new Map();
  document.querySelector('#mainContent').appendChild(panel);
  let expandedMember = '';
  const mounts = new Map();
  const labels = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok' };
  const overview = document.createElement('section'); overview.className = 'cmux-overview group-overview';
  overview.setAttribute('aria-label', 'AI 그룹 작업'); panel.before(overview);
  function memberSession(member) {
    const terminal = liveTerminals.get(member.terminal?.id) || member.terminal;
    const id = terminal?.agentLinkedSessionId || terminal?.bridgeId;
    return (window.WhiteboxApp?.state.snapshot?.sessions || []).find(session =>
      (id && (session.id === id || session.id === `${member.provider}:${id}`))
      || (terminal?.id && session.runtimePresence?.some(runtime => runtime.terminalId === terminal.id)));
  }
  function matchesProvider(group) {
    const selected = window.WhiteboxApp?.state.providerFilters;
    return !selected?.size || group.members.some(member => selected.has(member.provider));
  }
  function matchesQuery(group, query) {
    const words = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const text = [group.name || group.title, group.cwd, 'group', 'AI 그룹', ...group.members.flatMap(member => {
      const session = memberSession(member);
      return [member.provider, labels[member.provider], abbreviations[member.provider], member.terminal?.title, session?.title, session?.model, ...(session?.messages || []).slice(-12).map(message => message.text)];
    })].join(' ').toLowerCase();
    return words.every(word => text.includes(word));
  }
  function groupsForWorkspace() {
    const app = window.WhiteboxApp, state = app?.state;
    if (!state || state.view !== 'all') return [];
    const norm = path => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const root = norm(state.workspace);
    return knownGroups.filter(group => (root === 'all' || norm(group.cwd) === root || norm(group.cwd).startsWith(`${root}/`))
      && window.WhiteboxSidebarTree?.matchesFilter(state, { id: `group:${group.id}`, cwd: group.cwd }) !== false
      && matchesProvider(group) && matchesQuery(group, state.search));
  }
  function renderOverview() {
    const html = groupsForWorkspace().map(group => {
      const members = group.members.filter(member => !window.WhiteboxApp.state.providerFilters.size || window.WhiteboxApp.state.providerFilters.has(member.provider));
      return `<article class="group-overview-card"><div><span class="cmux-mark">group · ${group.members.length} 세션</span><strong>${esc(group.name)}</strong><small>${members.map(member => `${esc(abbreviations[member.provider])} ${esc(window.WhiteboxApp.sessionStatusLabel?.(memberSession(member), memberSession(member) ? window.WhiteboxApp.controlRoomStatus(memberSession(member)) : member.terminal?.status || 'exited') || member.terminal?.status || '종료됨')}`).join(' · ')}</small></div><div><button type="button" data-terminal-group-id="${esc(group.id)}">그룹 열기 →</button><button type="button" data-overview-group-delete="${esc(group.id)}" ${busy ? 'disabled' : ''}>${pendingDeleteId === group.id ? (group.members.length ? '모든 참여 AI 종료 및 그룹 삭제' : '빈 그룹 삭제하기') : '그룹 삭제'}</button></div></article>`;
    }).join('') + (overviewError ? `<p class="terminal-group-status is-error" role="alert">${esc(overviewError)}</p>` : '');
    if (overview.innerHTML !== html) overview.innerHTML = html;
  }

  function status(message, error = false) {
    const node = panel.querySelector('.terminal-group-status');
    if (node) { node.textContent = message; node.classList.toggle('is-error', error); }
  }
  function clearMounts() {
    for (const value of mounts.values()) value.dispose?.();
    mounts.clear();
  }
  async function render() {
    const revision = ++generation;
    const groups = await api.terminalGroups();
    knownGroups = groups;
    renderOverview();
    window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'));
    if (revision !== generation) return;
    const group = groups.find(item => item.id === activeId);
    if (!group) {
      clearMounts(); panel.classList.add('hidden'); document.body.classList.remove('terminal-group-active');
      if (window.WhiteboxApp?.state) window.WhiteboxApp.state.terminalGroupOwnerId = '';
      return;
    }
    panel.classList.remove('hidden');
    document.body.classList.add('terminal-group-active');
    if (window.WhiteboxApp?.state) {
      const app = window.WhiteboxApp;
      const row = [...document.querySelectorAll('[data-terminal-group-id]')].find(node => node.dataset.terminalGroupId === group.id);
      const project = row?.closest('[data-sidebar-project-key]');
      const projectPath = project?.querySelector('[data-workspace]')?.dataset.workspace || (app.state.workspace === 'all' ? group.cwd : app.state.workspace);
      const projectKey = project?.dataset.sidebarProjectKey || String(projectPath).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      app.state.terminalGroupOwnerId = group.ownerId;
      app.state.sidebarExpandedProjects?.add(projectKey);
      app.state.sidebarFolderFilter = { projectKey, entryId: `group:${group.id}`, name: group.name, path: group.cwd };
      app.renderWorkspaces();
    }
    document.querySelectorAll('[data-sidebar-session-id]').forEach(node => node.setAttribute('aria-selected', String(node.dataset.sidebarSessionId === group.ownerId)));
    const terminals = await api.terminalList();
    if (revision !== generation) return;
    // Detach screens before replacing chrome; reattach the same terminal views
    // so output, input ownership, and scrollback survive group edits.
    clearMounts();
    const joined = new Set(groups.flatMap(item => item.members.map(member => member.creationId)));
    const available = terminals.filter(item => item.type === 'agent' && item.backend === 'managed-tmux' && ['running', 'detached'].includes(item.status) && item.creationId && !joined.has(item.creationId));
    currentGroup = group;
    if (layoutGroupId !== group.id) {
      layoutGroupId = group.id;
      try { layout = JSON.parse(localStorage.getItem(`whitebox-group-layout:${group.id}`)); } catch (_) { layout = null; }
    }
    const previousIds = layoutApi.leaves(layout).flatMap(pane => pane.tabs);
    layout = layoutApi.reconcile(layout, group.members.map(member => member.creationId));
    if (pendingSplit) {
      const added = group.members.find(member => !previousIds.includes(member.creationId));
      if (added) layout = layoutApi.move(layout, added.creationId, pendingSplit.target, pendingSplit.direction);
      pendingSplit = null;
    }
    liveTerminals = new Map(terminals.map(terminal => [terminal.id, terminal]));
    panel.innerHTML = `<header class="terminal-group-head cmux-detail-head"><button type="button" class="cmux-back" data-group-hide aria-label="관제로 돌아가기">←</button><div class="cmux-detail-heading"><div class="cmux-detail-context"><span title="${esc(group.cwd)}">${esc(group.cwd.split(/[\\/]/).filter(Boolean).at(-1))}</span><span>${group.members.length}개 패널</span></div><h1>${esc(group.name)}</h1></div><span class="cmux-connection-badge"><i></i>AI 그룹</span><div class="terminal-group-actions cmux-workbench-actions"><div class="cmux-font-controls" aria-label="터미널 글자 크기"><button type="button" data-group-font="-1" aria-label="글자 작게">A−</button><output data-group-font-size>${fontSize}</output><button type="button" data-group-font="1" aria-label="글자 크게">A＋</button></div><select data-group-columns aria-label="터미널 배치">${[1,2,3].map(n => `<option value="${n}" ${columns === n ? 'selected' : ''}>${n}열 배치</option>`).join('')}</select><button type="button" data-group-restore hidden>전체 배치 보기</button><select data-group-picker aria-label="터미널 바로가기"><option value="">세션 선택</option>${group.members.map((member,i) => `<option value="${esc(member.creationId)}">${esc(abbreviations[member.provider])} · ${i+1}</option>`).join('')}</select><button type="button" data-group-manage aria-expanded="false">＋ AI 참여</button><button type="button" data-group-links aria-pressed="${linksVisible}">AI 연결 · ${group.members.length}</button></div></header>
      <div class="terminal-group-members" aria-label="같은 그룹에 참여한 AI" ${linksVisible ? '' : 'hidden'}><b>${esc(group.name)}</b>${group.members.map(member => `<span><button type="button" data-group-focus="${esc(member.creationId)}">${esc(labels[member.provider] || member.provider)}</button><button type="button" data-group-remove="${esc(member.creationId)}" aria-label="${esc(labels[member.provider] || member.provider)} 종료 및 그룹에서 제외">×</button></span>`).join('')}<button type="button" data-group-manage>＋ AI 참여</button><small>같은 그룹의 AI끼리 메시지함으로 소통합니다. 작업 전·단계 완료 시 확인합니다.</small></div>
      <div class="terminal-group-editor" hidden><form class="terminal-group-rename"><label>그룹 이름 <input name="groupName" maxlength="80" value="${esc(group.name)}" required></label><button type="submit">저장</button><button type="button" data-group-delete>그룹 삭제</button></form>
      <form class="terminal-group-add"><label>새 AI <select name="provider" aria-label="추가할 AI">${Object.entries(labels).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label><button type="submit">＋ AI 추가</button>${available.length ? `<label>실행 중인 AI <select name="existing" aria-label="그룹에 참여시킬 tmux AI">${available.map(item => `<option value="${esc(item.id)}">${esc(item.title || item.provider)}</option>`).join('')}</select></label><button type="button" data-group-join>그룹에 참여</button>` : ''}</form><details class="group-host-inventory"><summary>전체 터미널 연결 ${terminals.filter(item => ['running','starting','detached'].includes(item.status)).length}개 · 그룹 외 연결 ${terminals.filter(item => ['running','starting','detached'].includes(item.status) && !joined.has(item.creationId)).length}개</summary><ul>${terminals.filter(item => !joined.has(item.creationId)).map(item => `<li>${esc(abbreviations[item.provider] || item.type)} · ${esc(item.title)} · ${esc(item.status)}<small>${esc(item.cwd)}</small></li>`).join('')}</ul></details></div>

      <div class="terminal-group-grid">${group.members.map(member => `<section class="terminal-group-pane" data-group-member="${esc(member.creationId)}"><header draggable="true" data-group-drag="${esc(member.creationId)}"><span class="group-provider-mark">${esc(abbreviations[member.provider] || member.provider)}</span><strong data-group-title>${esc(labels[member.provider] || member.provider)}</strong><small class="cmux-session-status" data-group-session-status="${esc(member.creationId)}"></small><button type="button" data-group-arrange="${esc(member.creationId)}" aria-label="패널 배치">⋯</button><button type="button" data-group-expand="${esc(member.creationId)}" aria-label="터미널 확대 또는 복원">⤢</button><button type="button" data-group-remove="${esc(member.creationId)}" aria-label="AI 종료 및 그룹에서 제외" title="종료 및 그룹에서 제외">×</button></header><div class="terminal-group-viewport" id="group-terminal-${esc(member.creationId.replace(/[^a-zA-Z0-9_-]/g, '-'))}">${member.terminal ? '' : '연결된 터미널이 없습니다. 제외 후 다시 추가할 수 있습니다.'}</div></section>`).join('')}</div><footer class="cmux-workbench-footer"><span class="terminal-group-status" role="status"></span><span data-group-input-status>터미널을 클릭해 바로 입력 · 붙여넣기 가능</span><span>탭을 끌어 가장자리에 놓으면 분할 · 가운데는 탭 합치기 · 경계를 끌어 크기 조절</span></footer>`;
    if (!group.members.some(member => member.creationId === expandedMember)) expandedMember = '';
    applyExpanded();
    updateStatuses();
    for (const member of group.members) {
      if (!member.terminal) continue;
      const viewport = [...panel.querySelectorAll('[data-group-member]')].find(item => item.dataset.groupMember === member.creationId).querySelector('.terminal-group-viewport');
      try {
        const dispose = await window.WhiteboxTerminal.mountGroupTerminal(member.terminal.id, viewport, { fontSize, inputLabel: `${group.name} · ${abbreviations[member.provider]} · ${member.creationId} 터미널 입력`, onInputFocus: focused => {
          const label = panel.querySelector('[data-group-input-status]');
          if (label && focused) label.textContent = `${abbreviations[member.provider]} · ${group.members.indexOf(member) + 1}에 입력 중 · 붙여넣기 가능`;
          else if (label && !panel.contains(document.activeElement)) label.textContent = '터미널을 클릭해 바로 입력 · 붙여넣기 가능';
        } });
        if (revision !== generation) { dispose(); return; }
        mounts.set(member.creationId, { dispose });
      } catch (error) { status(error.message, true); }
    }
  }
  async function act(action) {
    if (busy) return;
    busy = true;
    overviewError = '';
    renderOverview();
    panel.setAttribute('aria-busy', 'true');
    panel.querySelectorAll('button,select').forEach(node => { node.disabled = true; });
    try { await action(); await render(); }
    catch (error) {
      try { await render(); } catch (_) { /* Keep the last confirmed screen. */ }
      if (!panel.querySelector('.terminal-group-status')) {
        panel.classList.remove('hidden');
        const message = document.createElement('p'); message.className = 'terminal-group-status'; message.setAttribute('role', 'alert'); panel.append(message);
      }
      status(error.message || String(error), true);
      overviewError = error.message || String(error);
    } finally {
      busy = false;
      renderOverview();
      panel.removeAttribute('aria-busy');
      panel.querySelectorAll('button,select').forEach(node => { node.disabled = false; });
    }
  }
  function updateStatuses() {
    const app = window.WhiteboxApp;
    if (!currentGroup || panel.classList.contains('hidden')) return;
    for (const member of currentGroup.members) {
      const pane = [...panel.querySelectorAll('[data-group-member]')].find(node => node.dataset.groupMember === member.creationId);
      if (!pane) continue;
      const terminal = liveTerminals.get(member.terminal?.id) || member.terminal;
      const id = terminal?.agentLinkedSessionId || terminal?.bridgeId;
      const sessions = app.state.snapshot?.sessions || [];
      const session = sessions.find(item => item.id === id || (id && item.id === `${member.provider}:${id}`))
        || (terminal?.id && sessions.find(item => item.runtimePresence?.some(runtime => runtime.terminalId === terminal.id)));
      const badge = [...panel.querySelectorAll('[data-group-session-status]')].find(node => node.dataset.groupSessionStatus === member.creationId);
      const state = session ? app.controlRoomStatus(session) : terminal?.status || 'unknown';
      badge.dataset.status = state;
      badge.textContent = session ? app.sessionStatusLabel(session, state)
        : ({running:'연결됨',starting:'시작 중',detached:'연결 대기',exited:'종료됨',failed:'오류',completed:'완료'}[state] || '상태 미확인');
      const title = pane.querySelector('[data-group-title]');
      title.textContent = session?.title || terminal?.title || labels[member.provider] || member.provider;
      title.title = title.textContent;
    }
  }
  api.onSnapshot?.(() => queueMicrotask(() => { updateStatuses(); renderOverview(); }));
  api.onTerminalState?.(payload => {
    for (const terminal of payload.sessions || []) liveTerminals.set(terminal.id, terminal);
    queueMicrotask(updateStatuses);
  });
  window.addEventListener('whitebox:terminal-prompts-changed', updateStatuses);
  function saveLayout() {
    try { localStorage.setItem(`whitebox-group-layout:${activeId}`, JSON.stringify(layout)); }
    catch (error) { status(`배치를 저장하지 못했습니다: ${error.message}`, true); }
  }
  function applyExpanded() {
    const grid = panel.querySelector('.terminal-group-grid');
    if (!grid) return;
    const focus = document.activeElement;
    const panes = new Map([...grid.querySelectorAll('[data-group-member]')].map(node => [node.dataset.groupMember, node]));
    const badges = new Map([...grid.querySelectorAll('[data-group-session-status]')].map(node => [node.dataset.groupSessionStatus, node]));
    grid.style.setProperty('--group-columns', String(columns));
    grid.classList.add('is-workspace');
    grid.classList.toggle('is-expanded', Boolean(expandedMember));
    panel.querySelector('[data-group-restore]').hidden = !expandedMember;
    function draw(node) {
      if (node.tabs) {
        const container = document.createElement('div'); container.className = 'group-layout-pane';
        container.dataset.groupTarget = node.active;
        const tabs = document.createElement('div'); tabs.className = 'group-layout-tabs'; tabs.setAttribute('role', 'tablist');
        for (const id of node.tabs) {
          const member = currentGroup.members.find(item => item.creationId === id);
          const tab = document.createElement('button'); tab.type = 'button'; tab.draggable = true;
          tab.dataset.groupTab = id; tab.dataset.groupDrag = id; tab.setAttribute('role', 'tab');
          tab.setAttribute('aria-selected', String(id === node.active));
          tab.title = `${currentGroup.name} · ${member.creationId}`;
          tab.textContent = `${abbreviations[member.provider] || member.provider} · ${currentGroup.members.indexOf(member) + 1}`;
          if (badges.has(id)) tab.append(badges.get(id));
          tabs.append(tab);
          const pane = panes.get(id);
          if (pane) { pane.hidden = expandedMember ? id !== expandedMember : id !== node.active; container.append(pane); }
        }
        container.prepend(tabs);
        container.hidden = Boolean(expandedMember && !node.tabs.includes(expandedMember));
        return container;
      }
      const split = document.createElement('div'); split.className = `group-layout-split ${node.axis}`;
      split.style.setProperty('--split-ratio', `${node.ratio * 100}%`);
      const divider = document.createElement('div'); divider.className = 'group-layout-divider'; divider.tabIndex = 0;
      divider.setAttribute('role', 'separator'); divider.setAttribute('aria-label', '패널 크기 조절');
      divider.setAttribute('aria-valuemin', '15'); divider.setAttribute('aria-valuemax', '85');
      divider.setAttribute('aria-orientation', node.axis === 'horizontal' ? 'vertical' : 'horizontal');
      const setRatio = value => { node.ratio = Math.max(.15, Math.min(.85, value)); split.style.setProperty('--split-ratio', `${node.ratio * 100}%`); divider.setAttribute('aria-valuenow', String(Math.round(node.ratio * 100))); };
      setRatio(node.ratio);
      divider.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); setRatio(node.ratio + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -.05 : .05)); saveLayout();
      });
      divider.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); divider.setPointerCapture(event.pointerId);
        const before = node.ratio;
        const move = e => { const box = split.getBoundingClientRect(); setRatio(node.axis === 'horizontal' ? (e.clientX - box.left) / box.width : (e.clientY - box.top) / box.height); };
        const cancel = e => { if (e.key === 'Escape') { e.preventDefault(); finish({ type: 'pointercancel' }); } };
        const finish = e => { if (e.type === 'pointercancel') setRatio(before); divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', finish); divider.removeEventListener('pointercancel', finish); divider.removeEventListener('lostpointercapture', finish); document.removeEventListener('keydown', cancel); saveLayout(); };
        document.addEventListener('keydown', cancel); divider.addEventListener('lostpointercapture', finish);
        divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', finish); divider.addEventListener('pointercancel', finish);
      });
      split.append(draw(node.first), divider, draw(node.second));
      return split;
    }
    grid.replaceChildren(...(layout ? [draw(layout)] : []));
    if (!layout) grid.innerHTML = '<div class="group-empty">이 그룹에 AI 세션을 추가하세요.<button type="button" data-group-manage>＋ AI 참여</button><button type="button" data-group-delete>빈 그룹 삭제</button></div>';
    if (focus?.isConnected && focus.matches('textarea')) focus.focus({ preventScroll: true });
    saveLayout();
  }
  function rearrange(id, target, direction) {
    layout = layoutApi.move(layout, id, target, direction); expandedMember = ''; applyExpanded();
  }
  panel.addEventListener('dragstart', event => {
    const tab = event.target.closest('[data-group-drag]');
    if (!tab) return;
    draggedMember = tab.dataset.groupDrag; event.dataTransfer.setData('text/plain', draggedMember); event.dataTransfer.effectAllowed = 'move';
  });
  function dropDirection(event, pane) {
    const box = pane.getBoundingClientRect(), x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
    return x < .23 ? 'left' : x > .77 ? 'right' : y < .23 ? 'up' : y > .77 ? 'down' : 'tab';
  }
  function clearDrop() { panel.querySelectorAll('[data-group-drop]').forEach(node => delete node.dataset.groupDrop); }
  panel.addEventListener('dragover', event => {
    const pane = event.target.closest('[data-group-target]');
    if (!draggedMember || !pane) return;
    event.preventDefault(); clearDrop(); pane.dataset.groupDrop = dropDirection(event, pane);
  });
  panel.addEventListener('drop', event => {
    const pane = event.target.closest('[data-group-target]');
    if (draggedMember && pane) { event.preventDefault(); rearrange(draggedMember, pane.dataset.groupTarget, dropDirection(event, pane)); }
    draggedMember = ''; clearDrop();
  });
  document.addEventListener('dragend', () => { draggedMember = ''; clearDrop(); });

  function close() {
    activeId = ''; generation += 1; clearMounts(); panel.classList.add('hidden'); document.body.classList.remove('terminal-group-active');
    if (window.WhiteboxApp?.state) window.WhiteboxApp.state.terminalGroupOwnerId = '';
  }
  function deleteGroup(id) {
    return act(async () => {
      await api.terminalGroupDelete(id);
      localStorage.removeItem(`whitebox-group-layout:${id}`);
      const app = window.WhiteboxApp;
      if (app?.state.sidebarFolderFilter?.entryId === `group:${id}`) app.state.sidebarFolderFilter = null;
      if (activeId === id) {
        close(); currentGroup = null; layout = null; layoutGroupId = '';
      }
      pendingDeleteId = '';
      app?.renderWorkspaces(); app?.renderSessions();
    });
  }
  window.addEventListener('whitebox-sidebar-folder-selected', close);
  document.addEventListener('click', event => {
    const remove = event.target.closest('[data-overview-group-delete]');
    if (remove) {
      event.preventDefault(); event.stopPropagation();
      if (busy) return;
      const id = remove.dataset.overviewGroupDelete;
      if (pendingDeleteId === id) deleteGroup(id);
      else { pendingDeleteId = id; renderOverview(); }
      return;
    }
    const direct = event.target.closest('[data-terminal-group-id]');
    if (direct) {
      event.preventDefault(); event.stopPropagation(); activeId = direct.dataset.terminalGroupId;
      const projectPath = direct.closest('[data-sidebar-project-key]')?.querySelector('[data-workspace]')?.dataset.workspace;
      act(async () => {
        const group = (await api.terminalGroups()).find(item => item.id === activeId);
        if (!group) return;
        const instance = window.WhiteboxApp;
        instance.state.workspace = projectPath || group.cwd; instance.state.workspaceSource = 'all'; instance.state.view = 'all';
        instance.state.sidebarFolderFilter = { projectKey: instance.state.workspace, entryId: `group:${group.id}`, name: group.name, path: group.cwd };
        instance.state.cmuxSidebarSelectedId = ''; instance.state.graphFocusId = '';
        instance.renderWorkspaces(); instance.renderSessions();
      }); return;
    }
    if (event.target.closest('[data-sidebar-session-id], [data-workspace], [data-cmux-workspace], [data-path-tree-toggle], [data-tree-toggle], [data-view]')) close();
  }, true);
  panel.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.matches('.terminal-group-rename')) {
      const name = event.target.elements.groupName.value;
      act(() => api.terminalGroupRename(activeId, name));
    } else {
      const provider = event.target.elements.provider.value;
      act(() => api.terminalGroupAdd(activeId, { provider }));
    }
  });
  panel.addEventListener('change', event => {
    if (event.target.matches('[data-group-columns]')) {
      columns = Number(event.target.value);
      const ids = currentGroup.members.map(member => member.creationId);
      const rows = [];
      for (let i = 0; i < ids.length; i += columns) {
        let row = layoutApi.leaf([ids[i]]);
        for (let j = i + 1; j < Math.min(i + columns, ids.length); j++) row = { axis: 'horizontal', ratio: (j-i)/(j-i+1), first: row, second: layoutApi.leaf([ids[j]]) };
        rows.push(row);
      }
      layout = rows.reduce((tree, row, i) => tree ? { axis: 'vertical', ratio: i/(i+1), first: tree, second: row } : row, null);
      expandedMember = ''; applyExpanded(); return;
    }
    if (event.target.matches('[data-group-picker]')) { focusMember(event.target.value); return; }
    if (!event.target.matches('[data-group-select]')) return;
    const id = event.target.value;
    act(async () => { activeId = id; });
  });
  panel.addEventListener('click', event => {
    const tab = event.target.closest('[data-group-tab]');
    if (tab) { const pane = layoutApi.leaves(layout).find(item => item.tabs.includes(tab.dataset.groupTab)); pane.active = tab.dataset.groupTab; applyExpanded(); }
    const arrange = event.target.closest('[data-group-arrange]');
    if (arrange) {
      panel.querySelector('.group-arrange-menu')?.remove();
      const menu = document.createElement('div'); menu.className = 'group-arrange-menu';
      const id = arrange.dataset.groupArrange;
      menu.innerHTML = `<b>패널 배치</b><select aria-label="대상 세션">${currentGroup.members.filter(m => m.creationId !== id).map((m, i) => `<option value="${esc(m.creationId)}">${esc(labels[m.provider])} · ${i+1}</option>`).join('')}</select><div>${[['left','← 왼쪽'],['right','오른쪽 →'],['up','↑ 위'],['down','아래 ↓'],['tab','탭으로 합치기']].map(([dir,label]) => `<button type="button" data-arrange-direction="${dir}">${label}</button>`).join('')}<button type="button" data-arrange-swap>위치 맞바꾸기</button></div><b>새 AI로 분할</b><select data-split-provider aria-label="분할할 AI">${Object.entries(labels).map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select><button type="button" data-add-split="tab">새 탭 ＋</button><button type="button" data-add-split="right">오른쪽 ＋</button><button type="button" data-add-split="down">아래 ＋</button><button type="button" data-group-instruct>그룹 소통 안내 보내기</button><button type="button" data-arrange-remove>터미널 종료…</button><button type="button" data-arrange-close>닫기</button>`;
      if (currentGroup.members.length < 2) menu.querySelectorAll('[data-arrange-direction], [data-arrange-swap]').forEach(button => button.disabled = true);
      menu.addEventListener('click', e => {
        if (e.target.hasAttribute('data-arrange-swap')) { layout = layoutApi.swap(layout, id, menu.querySelector('select').value); applyExpanded(); menu.remove(); }
        if (e.target.hasAttribute('data-arrange-remove')) {
          if (e.target.dataset.confirm) { removeMember(id); menu.remove(); }
          else { e.target.dataset.confirm = 'true'; e.target.textContent = '실행 중인 작업도 종료됩니다. 종료하기'; }
        }
        if (e.target.hasAttribute('data-group-instruct')) { menu.remove(); act(() => api.terminalGroupInstruct(activeId, id)); }
        const direction = e.target.dataset.arrangeDirection;
        if (direction) { rearrange(id, menu.querySelector('select').value, direction); menu.remove(); }
        if (e.target.dataset.addSplit) { pendingSplit = { target: id, direction: e.target.dataset.addSplit }; const provider = menu.querySelector('[data-split-provider]').value; menu.remove(); act(() => api.terminalGroupAdd(activeId, { provider })).finally(() => { pendingSplit = null; }); }
        if (e.target.hasAttribute('data-arrange-close')) menu.remove();
      });
      menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '터미널 배치 및 관리');
      menu.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); menu.remove(); arrange.focus(); } });
      panel.append(menu); menu.querySelector('button:not(:disabled)')?.focus();
    }
    const font = event.target.closest('[data-group-font]');
    if (font) {
      fontSize = Math.max(12, Math.min(22, fontSize + Number(font.dataset.groupFont)));
      panel.querySelector('[data-group-font-size]').textContent = fontSize;
      for (const mount of mounts.values()) mount.dispose.setFontSize?.(fontSize);
    }
    const remove = event.target.closest('[data-group-remove]');
    if (remove) {
      if (remove.dataset.confirm) removeMember(remove.dataset.groupRemove);
      else { remove.dataset.confirm = 'true'; remove.textContent = '종료하기'; remove.title = '실행 중인 AI 작업을 종료하고 그룹에서 제외합니다.'; }
    }
    if (event.target.closest('[data-group-restore]')) { expandedMember = ''; applyExpanded(); }
    if (event.target.closest('[data-group-manage]')) {
      const editor = panel.querySelector('.terminal-group-editor');
      editor.hidden = !editor.hidden;
      panel.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', String(!editor.hidden));
    }
    if (event.target.closest('[data-group-links]')) {
      linksVisible = !linksVisible;
      panel.querySelector('.terminal-group-members').hidden = !linksVisible;
      panel.querySelector('[data-group-links]').setAttribute('aria-pressed', String(linksVisible));
    }
    const expand = event.target.closest('[data-group-expand]');
    if (expand) { expandedMember = expandedMember === expand.dataset.groupExpand ? '' : expand.dataset.groupExpand; applyExpanded(); }
    const focus = event.target.closest('[data-group-focus]');
    if (focus) {
      const leaf = layoutApi.leaves(layout).find(item => item.tabs.includes(focus.dataset.groupFocus));
      if (leaf) { leaf.active = focus.dataset.groupFocus; applyExpanded(); }
      if (expandedMember) { expandedMember = focus.dataset.groupFocus; applyExpanded(); }
      const pane = [...panel.querySelectorAll('[data-group-member]')].find(item => item.dataset.groupMember === focus.dataset.groupFocus);
      pane?.querySelector('textarea')?.focus();
      pane?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    const deleteButton = event.target.closest('[data-group-delete]');
    if (deleteButton) {
      if (deleteButton.dataset.confirm) {
        deleteGroup(activeId);
      } else {
        deleteButton.dataset.confirm = 'true';
        deleteButton.textContent = currentGroup?.members.length ? '모든 참여 AI 종료 및 그룹 삭제' : '빈 그룹 삭제하기';
      }
    }
    if (event.target.closest('[data-group-join]')) {
      const terminalId = panel.querySelector('[name="existing"]').value;
      act(() => api.terminalGroupAdd(activeId, { terminalId }));
    }
    if (event.target.closest('[data-group-hide]') && !busy) {
      generation += 1; clearMounts(); panel.classList.add('hidden'); document.body.classList.remove('terminal-group-active');
      if (window.WhiteboxApp?.state) window.WhiteboxApp.state.terminalGroupOwnerId = '';
    }
  });
  function removeMember(id) {
    if (busy) return;
    mounts.get(id)?.dispose(); mounts.delete(id);
    act(() => api.terminalGroupRemove(activeId, id));
  }
  function focusMember(id) {
    const pane = layoutApi.leaves(layout).find(item => item.tabs.includes(id));
    if (!pane) return;
    pane.active = id; if (expandedMember) expandedMember = id; applyExpanded();
    [...panel.querySelectorAll('[data-group-member]')].find(node => node.dataset.groupMember === id)?.querySelector('textarea')?.focus();
  }
  panel.addEventListener('contextmenu', event => {
    const tab = event.target.closest('[data-group-tab]'), header = event.target.closest('[data-group-drag]');
    const id = tab?.dataset.groupTab || header?.dataset.groupDrag;
    if (!id) return;
    event.preventDefault();
    [...panel.querySelectorAll('[data-group-arrange]')].find(button => button.dataset.groupArrange === id)?.click();
  });
  document.addEventListener('keydown', event => {
    if (panel.classList.contains('hidden') || busy || !layout) return;
    const id = document.activeElement?.closest('[data-group-member]')?.dataset.groupMember;
    if (!id) return;
    if (event.metaKey && event.key.toLowerCase() === 'd') {
      event.preventDefault(); event.stopPropagation(); pendingSplit = { target: id, direction: event.shiftKey ? 'down' : 'right' };
      const provider = currentGroup.members.find(member => member.creationId === id).provider;
      act(() => api.terminalGroupAdd(activeId, { provider })).finally(() => { pendingSplit = null; });
    } else if ((event.ctrlKey && event.key === 'Tab') || (event.metaKey && event.altKey && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))) {
      event.preventDefault(); event.stopPropagation(); const ids = currentGroup.members.map(member => member.creationId);
      const previous = event.shiftKey || ['ArrowLeft','ArrowUp'].includes(event.key);
      focusMember(ids[(ids.indexOf(id) + (previous ? -1 : 1) + ids.length) % ids.length]);
    }
  }, true);
  let pendingTaskGroup = null;
  window.WhiteboxTerminalGroups = {
    refresh: render,
    matchesProvider, matchesQuery, groupsForWorkspace, renderOverview,
    updateInventory(groups) { knownGroups = groups; renderOverview(); },
    containsSession(session) {
      if (!session) return false;
      return knownGroups.some(group => group.members.some(member => {
        const terminal = member.terminal;
        const linked = terminal?.agentLinkedSessionId || terminal?.bridgeId;
        return session.id === group.ownerId || (linked && (session.id === linked || session.id === `${member.provider}:${linked}`))
          || session.creationId === member.creationId
          || (terminal?.id && session.runtimePresence?.some(runtime => runtime.terminalId === terminal.id));
      }));
    },
    async startTask(options, selection) {
      let groupId = selection.id;
      if (!groupId) {
        if (pendingTaskGroup?.creationId !== options.creationId) {
          const group = await api.terminalGroupCreate({ name: selection.name || 'AI 그룹', cwd: options.cwd, creationId: options.creationId });
          pendingTaskGroup = { creationId: options.creationId, id: group.id };
        }
        groupId = pendingTaskGroup.id;
      }
      const member = await api.terminalGroupAdd(groupId, options);
      activeId = groupId;
      await render();
      return { ok: true, terminalId: member.terminal?.id, creationId: member.creationId, groupId };
    },
  };
  api.terminalGroups().then(groups => { knownGroups = groups; renderOverview(); }).catch(error => window.WhiteboxRendererUtils?.reportRecoverableError?.('terminal-groups-load', error));
})();
