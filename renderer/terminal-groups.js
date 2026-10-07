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
  let linksVisible = false;
  let fontSize = 15;
  let columns = 2;
  let currentGroup = null;
  let liveTerminals = new Map();
  document.querySelector('#mainContent').appendChild(panel);
  let expandedMember = '';
  const mounts = new Map();
  const labels = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok' };
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
    window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'));
    if (revision !== generation) return;
    const group = groups.find(item => item.id === activeId);
    if (!group || group.members.length === 0) {
      clearMounts(); panel.classList.add('hidden'); document.body.classList.remove('terminal-group-active');
      if (window.WhiteboxApp?.state) window.WhiteboxApp.state.terminalGroupOwnerId = '';
      return;
    }
    panel.classList.remove('hidden');
    document.body.classList.add('terminal-group-active');
    if (window.WhiteboxApp?.state) window.WhiteboxApp.state.terminalGroupOwnerId = group.ownerId;
    document.querySelectorAll('[data-sidebar-session-id]').forEach(node => node.setAttribute('aria-selected', String(node.dataset.sidebarSessionId === group.ownerId)));
    const terminals = await api.terminalList();
    if (revision !== generation) return;
    // Detach screens before replacing chrome; reattach the same terminal views
    // so output, input ownership, and scrollback survive group edits.
    clearMounts();
    const joined = new Set(groups.flatMap(item => item.members.map(member => member.creationId)));
    const available = terminals.filter(item => item.type === 'agent' && item.backend === 'managed-tmux' && ['running', 'detached'].includes(item.status) && item.creationId && !joined.has(item.creationId));
    currentGroup = group;
    liveTerminals = new Map(terminals.map(terminal => [terminal.id, terminal]));
    panel.innerHTML = `<header class="terminal-group-head cmux-detail-head"><button type="button" class="cmux-back" data-group-hide aria-label="관제로 돌아가기">←</button><div class="cmux-detail-heading"><div class="cmux-detail-context"><span title="${esc(group.cwd)}">${esc(group.cwd.split(/[\\/]/).filter(Boolean).at(-1))}</span><span>${group.members.length}개 패널</span></div><h1>${esc(group.name)}</h1></div><span class="cmux-connection-badge"><i></i>AI 그룹</span><div class="terminal-group-actions cmux-workbench-actions"><div class="cmux-font-controls" aria-label="터미널 글자 크기"><button type="button" data-group-font="-1" aria-label="글자 작게">A−</button><output data-group-font-size>${fontSize}</output><button type="button" data-group-font="1" aria-label="글자 크게">A＋</button></div><select data-group-columns aria-label="터미널 배치">${[1,2,3].map(n => `<option value="${n}" ${columns === n ? 'selected' : ''}>${n}열 배치</option>`).join('')}</select><button type="button" data-group-manage aria-expanded="false">＋ AI 참여</button><button type="button" data-group-links aria-pressed="${linksVisible}">연결 표시</button></div></header>
      <div class="terminal-group-members" aria-label="같은 그룹에 참여한 AI" ${linksVisible ? '' : 'hidden'}><b>${esc(group.name)}</b>${group.members.map(member => `<span><button type="button" data-group-focus="${esc(member.creationId)}">${esc(labels[member.provider] || member.provider)}</button><button type="button" data-group-remove="${esc(member.creationId)}" aria-label="${esc(labels[member.provider] || member.provider)} 종료 및 그룹에서 제외">×</button></span>`).join('')}<button type="button" data-group-manage>＋ AI 참여</button><small>${group.members.length}개 AI 연결됨</small></div>
      <div class="terminal-group-editor" hidden><form class="terminal-group-rename"><label>그룹 이름 <input name="groupName" maxlength="80" value="${esc(group.name)}" required></label><button type="submit">저장</button><button type="button" data-group-delete>그룹 삭제</button></form>
      <form class="terminal-group-add"><label>새 AI <select name="provider" aria-label="추가할 AI">${Object.entries(labels).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label><button type="submit">＋ AI 추가</button>${available.length ? `<label>실행 중인 AI <select name="existing" aria-label="그룹에 참여시킬 tmux AI">${available.map(item => `<option value="${esc(item.id)}">${esc(item.title || item.provider)}</option>`).join('')}</select></label><button type="button" data-group-join>그룹에 참여</button>` : ''}</form></div>

      <div class="terminal-group-grid">${group.members.map(member => `<section class="terminal-group-pane" data-group-member="${esc(member.creationId)}"><header><strong data-group-title>${esc(labels[member.provider] || member.provider)}</strong><small class="cmux-session-status" data-group-session-status></small><button type="button" data-group-expand="${esc(member.creationId)}" aria-label="터미널 확대 또는 복원">⤢</button><button type="button" data-group-remove="${esc(member.creationId)}" aria-label="AI 종료 및 그룹에서 제외" title="종료 및 그룹에서 제외">×</button></header><div class="terminal-group-viewport" id="group-terminal-${esc(member.creationId.replace(/[^a-zA-Z0-9_-]/g, '-'))}">${member.terminal ? '' : '연결된 터미널이 없습니다. 제외 후 다시 추가할 수 있습니다.'}</div></section>`).join('')}</div><footer class="cmux-workbench-footer"><span class="terminal-group-status" role="status"></span><span>터미널을 클릭해 바로 입력 · 제외하면 해당 세션이 종료됩니다.</span></footer>`;
    if (!group.members.some(member => member.creationId === expandedMember)) expandedMember = '';
    applyExpanded();
    updateStatuses();
    for (const member of group.members) {
      if (!member.terminal) continue;
      const viewport = [...panel.querySelectorAll('[data-group-member]')].find(item => item.dataset.groupMember === member.creationId).querySelector('.terminal-group-viewport');
      try {
        const dispose = await window.WhiteboxTerminal.mountGroupTerminal(member.terminal.id, viewport, { fontSize });
        if (revision !== generation) { dispose(); return; }
        mounts.set(member.creationId, { dispose });
      } catch (error) { status(error.message, true); }
    }
  }
  async function act(action) {
    if (busy) return;
    busy = true;
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
    } finally {
      busy = false;
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
      const badge = pane.querySelector('[data-group-session-status]');
      const state = session ? app.controlRoomStatus(session) : terminal?.status || 'unknown';
      badge.dataset.status = state;
      badge.textContent = session ? app.sessionStatusLabel(session, state)
        : ({running:'연결됨',starting:'시작 중',detached:'연결 대기',exited:'종료됨',failed:'오류',completed:'완료'}[state] || '상태 미확인');
      const title = pane.querySelector('[data-group-title]');
      title.textContent = session?.title || terminal?.title || labels[member.provider] || member.provider;
      title.title = title.textContent;
    }
  }
  api.onSnapshot?.(() => queueMicrotask(updateStatuses));
  api.onTerminalState?.(payload => {
    for (const terminal of payload.sessions || []) liveTerminals.set(terminal.id, terminal);
    queueMicrotask(updateStatuses);
  });
  window.addEventListener('whitebox:terminal-prompts-changed', updateStatuses);
  function applyExpanded() {
    panel.querySelector('.terminal-group-grid')?.style.setProperty('--group-columns', String(Math.min(columns, currentGroup?.members.length || 1)));
    panel.querySelector('.terminal-group-grid')?.classList.toggle('is-expanded', Boolean(expandedMember));
    panel.querySelectorAll('[data-group-member]').forEach(node => { node.hidden = Boolean(expandedMember && node.dataset.groupMember !== expandedMember); });
  }
  function close() {
    activeId = ''; generation += 1; clearMounts(); panel.classList.add('hidden'); document.body.classList.remove('terminal-group-active');
    if (window.WhiteboxApp?.state) window.WhiteboxApp.state.terminalGroupOwnerId = '';
  }
  window.addEventListener('whitebox-sidebar-folder-selected', close);
  document.addEventListener('click', event => {
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
    if (event.target.matches('[data-group-columns]')) { columns = Number(event.target.value); applyExpanded(); return; }
    if (!event.target.matches('[data-group-select]')) return;
    const id = event.target.value;
    act(async () => { activeId = id; });
  });
  panel.addEventListener('click', event => {
    const font = event.target.closest('[data-group-font]');
    if (font) {
      fontSize = Math.max(12, Math.min(22, fontSize + Number(font.dataset.groupFont)));
      panel.querySelector('[data-group-font-size]').textContent = fontSize;
      for (const mount of mounts.values()) mount.dispose.setFontSize?.(fontSize);
    }
    const remove = event.target.closest('[data-group-remove]');
    if (remove) {
      mounts.get(remove.dataset.groupRemove)?.dispose();
      mounts.delete(remove.dataset.groupRemove);
      act(() => api.terminalGroupRemove(activeId, remove.dataset.groupRemove));
    }
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
      if (expandedMember) { expandedMember = focus.dataset.groupFocus; applyExpanded(); }
      const pane = [...panel.querySelectorAll('[data-group-member]')].find(item => item.dataset.groupMember === focus.dataset.groupFocus);
      pane?.querySelector('textarea')?.focus();
      pane?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (event.target.closest('[data-group-delete]')) { clearMounts(); act(() => api.terminalGroupDelete(activeId)); }
    if (event.target.closest('[data-group-join]')) {
      const terminalId = panel.querySelector('[name="existing"]').value;
      act(() => api.terminalGroupAdd(activeId, { terminalId }));
    }
    if (event.target.closest('[data-group-hide]') && !busy) {
      generation += 1; clearMounts(); panel.classList.add('hidden'); document.body.classList.remove('terminal-group-active');
      if (window.WhiteboxApp?.state) window.WhiteboxApp.state.terminalGroupOwnerId = '';
    }
  });
  let pendingTaskGroup = null;
  window.WhiteboxTerminalGroups = {
    refresh: render,
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
  api.terminalGroups().then(groups => { knownGroups = groups; }).catch(error => window.WhiteboxRendererUtils?.reportRecoverableError?.('terminal-groups-load', error));
})();
