'use strict';

(() => {
  const api = window.whitebox, app = window.WhiteboxApp;
  if (!app || !api?.terminalGroups) return;
  const esc = value => window.WhiteboxRendererUtils.esc(String(value || ''));
  let refreshing = null, current = '', revision = 0, busy = false, inventoryEpoch = 0;
  const views = new Map();
  let expandedPane = '', returnScroll = 0, returnTrigger = null, layoutShape = '', pendingLayout = false;
  const main = document.querySelector('#mainContent');
  let terminalFontSize = 15, dragging = false, resizing = null;
  function clearDrop() { detail.querySelectorAll('[data-drop-direction]').forEach(node => { delete node.dataset.dropDirection; }); }
  document.addEventListener('dragend', () => { dragging = false; clearDrop(); });
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${({ back: '<path d="m14 6-6 6 6 6M8 12h12"/>', terminal: '<path d="m5 7 5 5-5 5m8 0h6"/>', expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>', external: '<path d="M14 3h7v7m0-7L10 14m0-10H4v16h16v-6"/>' })[name]}</svg>`;
  const overview = document.createElement('section');
  overview.className = 'cmux-overview'; overview.setAttribute('aria-label', 'cmux 작업');
  document.querySelector('#terminalGroupPanel')?.before(overview);
  const detail = document.createElement('section');
  detail.className = 'cmux-detail hidden'; detail.setAttribute('aria-label', 'cmux 상세 터미널');
  detail.innerHTML = `<header class="cmux-detail-head"><button type="button" class="cmux-back" data-cmux-back aria-label="관제로 돌아가기" title="관제로 돌아가기">${icon('back')}</button><div class="cmux-detail-heading"><div class="cmux-detail-context"><span data-cmux-project></span><span data-cmux-pane-count></span></div><h1 data-cmux-title></h1></div><span class="cmux-connection-badge" title="cmux 연결됨"><i></i>cmux</span><div class="cmux-workbench-actions"><div class="cmux-font-controls" aria-label="터미널 글자 크기"><button type="button" data-cmux-font="-1" aria-label="글자 작게">A−</button><output data-cmux-font-size>15</output><button type="button" data-cmux-font="1" aria-label="글자 크게">A＋</button></div><button type="button" data-cmux-questionnaire hidden>AI 질문지</button><button type="button" data-cmux-restore hidden>전체 배치 보기</button><select data-cmux-picker aria-label="터미널 바로가기"></select><button type="button" class="cmux-native-button" data-cmux-native aria-label="cmux 원본 창 열기" title="cmux 원본 창 열기">${icon('external')}</button></div></header><div class="cmux-layout"></div><footer class="cmux-workbench-footer"><span class="cmux-detail-status" role="status"></span><span data-cmux-input-status>터미널을 클릭해 바로 입력 · 붙여넣기 가능</span></footer>`;
  main.append(detail);
  const notice = document.createElement('div'); notice.className = 'cmux-connection-notice'; notice.setAttribute('role', 'status'); notice.hidden = true;
  document.querySelector('#projectSidebarList')?.after(notice);
  const enabled = () => (app.state.sourcePluginSettings?.enabledPluginIds || []).includes('builtin.cmux');
  const groups = () => enabled() ? (app.state.sidebarTerminalEntries || []).filter(entry => entry.cmuxWorkspace) : [];
  function containsSession(session) {
    if (!session || session.environment?.kind === 'wsl') return false;
    if (session.cmux) return true;
    return groups().some(group => group.members.some(member => (member.sessionIds || []).includes(session.id)
      || (session.runtimePresence || []).some(runtime => runtime.kind !== 'wsl' && (member.processIds || []).includes(Number(runtime.pid)))));
  }
  const groupsForWorkspace = () => {
    const norm = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase();
    const root = norm(app.state.workspace);
    return groups().filter(group => (root === 'all' || norm(group.cwd) === root || norm(group.cwd).startsWith(`${root}/`))
      && window.WhiteboxSidebarTree?.matchesFilter(app.state, group) !== false);
  };
  window.WhiteboxCmux = { containsSession, groupsForWorkspace, renderOverview,
    questionnaireGroup(session) {
      if (!enabled()) return null;
      return groups().find(group => {
        const leader = group.members.find(member => /오케스트|orchestrat/i.test(member.title)) || group.members[0];
        return leader?.currentSessionId === session.id;
      }) || null;
    },
    updateStatuses,
    isMember: session => Boolean(session?.cmux) || containsSession(session),
    currentGroupId: () => current,
  };
  const status = text => { detail.querySelector('[role=status]').textContent = text; };
  function closeDetail({ restoreFocus = false } = {}) {
    resizing?.cancel(false);
    const wasOpen = Boolean(current);
    const trigger = returnTrigger?.isConnected ? returnTrigger : [...overview.querySelectorAll('[data-cmux-detail]')].find(button => button.dataset.cmuxDetail === current);
    expandedPane = ''; document.body.classList.remove('cmux-detail-open');
    current = ''; layoutShape = ''; pendingLayout = false; revision += 1; detail.classList.add('hidden');
    for (const view of views.values()) { view.observer.disconnect(); view.terminal.dispose(); }
    views.clear();
    detail.querySelectorAll('.cmux-arrange-menu').forEach(menu => menu.remove());
    detail.querySelector('.cmux-layout').replaceChildren();
    if (wasOpen) main.scrollTop = returnScroll;
    if (restoreFocus) trigger?.focus({ preventScroll: true });
  }
  function updateInputFocus() {
    const input = document.activeElement;
    for (const view of views.values()) syncCursor(view);
    const active = [...views.values()].find(view => view.terminal.textarea === input);
    detail.querySelectorAll('.cmux-pane').forEach(node => node.classList.toggle('is-input-active', Boolean(active && node.contains(active.node))));
    const member = groups().find(entry => entry.id === current)?.members.find(item => item.id === active?.node.dataset.cmuxMember);
    detail.querySelector('[data-cmux-input-status]').textContent = member
      ? `${member.title}에 입력 중 · 붙여넣기 가능`
      : '터미널을 클릭해 바로 입력 · 붙여넣기 가능';
  }
  function syncCursor(view) {
    const visible = document.hasFocus() && document.activeElement === view.terminal.textarea && view.frame?.cursor?.visible !== false;
    if (view.cursorVisible === visible) return;
    view.cursorVisible = visible;
    view.terminal.write(visible ? '\x1b[?25h' : '\x1b[?25l');
  }
  window.addEventListener('blur', updateInputFocus);
  window.addEventListener('focus', updateInputFocus);
  detail.addEventListener('focusin', updateInputFocus);
  detail.addEventListener('focusout', () => queueMicrotask(updateInputFocus));
  function applyExpansion() {
    const host = detail.querySelector('.cmux-layout');
    if (expandedPane && ![...host.querySelectorAll('[data-cmux-pane]')].some(node => node.dataset.cmuxPane === expandedPane)) expandedPane = '';
    host.classList.toggle('is-expanded', Boolean(expandedPane));
    host.querySelectorAll('[data-cmux-pane]').forEach(node => {
      const selected = node.dataset.cmuxPane === expandedPane;
      node.classList.toggle('is-expanded-pane', selected);
      node.querySelector('[data-cmux-expand]').setAttribute('aria-pressed', String(selected));
    });
    detail.querySelector('[data-cmux-restore]').hidden = !expandedPane;
    requestAnimationFrame(() => { for (const view of views.values()) if (view.node.getClientRects().length) view.refit(); });
  }
  function renderOverview() {
    updateStatuses();
    const visible = groupsForWorkspace();
    const html = visible.map(group => `<article class="cmux-overview-card"><div><span class="cmux-mark">연결된 작업 공간</span><strong>${esc(group.title)}</strong><small>${group.members.length}개 터미널 <span class="cmux-overview-connection">· cmux 연결됨</span></small></div><button type="button" data-cmux-detail="${esc(group.id)}">cmux 자세히 보기 ${icon('external')}</button></article>`).join('');
    if (overview.innerHTML !== html) overview.innerHTML = html;
  }
  async function applyInventory(cmux, managedEntries) {
    if (!enabled()) cmux = { installed: false, entries: [], groups: [] };
    const entries = [...(managedEntries || (app.state.sidebarTerminalEntries || []).filter(entry => !entry.cmuxWorkspace)), ...(cmux.groups || [])];
    const changed = JSON.stringify(entries) !== JSON.stringify(app.state.sidebarTerminalEntries);
    app.state.sidebarTerminalEntries = entries;
    const active = entries.find(entry => entry.id === current);
    // Reconcile even an unchanged native ratio after a rejected/clamped resize.
    if (active) await renderDetail(active);
    if (current && !active) closeDetail();
    if (changed) {
      app.renderWorkspaces(); app.renderSessions();
    }
    renderOverview();
    app.syncQuestionnaireInbox?.();
    notice.hidden = !cmux.installed || !cmux.error;
    notice.replaceChildren();
    if (cmux.error) {
      const text = document.createElement('p');
      text.textContent = 'cmux 연결 차단됨 · 설정 → 자동화 → 소켓 제어 모드에서 연결을 허용하세요.';
      text.title = cmux.error; notice.append(text);
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '다시 연결'; retry.onclick = () => refresh(); notice.append(retry);
    }
  }
  function refresh() {
    if (refreshing) return refreshing;
    if (busy || resizing) return Promise.resolve();
    const epoch = inventoryEpoch;
    refreshing = (async () => {
      try {
        const [managed, cmux] = await Promise.all([api.terminalGroups(), api.cmuxList?.() || { entries: [] }]);
        if (epoch !== inventoryEpoch || busy || resizing) return;
        await applyInventory(cmux, managed.filter(group => group.members.length > 0).map(group => ({ id: `group:${group.id}`, title: `${group.name} · ${group.members.length} AI`, cwd: group.cwd, terminalGroupId: group.id, status: 'running', provider: 'group' })));
      } catch (error) { notice.hidden = false; notice.textContent = error.message; }
      finally { refreshing = null; if (epoch !== inventoryEpoch && !busy && !resizing) void refresh(); }
    })();
    return refreshing;
  }
  async function read(onlyMemberId) {
    if (!current || document.hidden || dragging || resizing || busy) return;
    const id = current;
    await Promise.allSettled([...views].map(async ([memberId, view]) => {
      if (onlyMemberId && memberId !== onlyMemberId) return;
      if (view.node.hidden || !view.node.isConnected || !view.node.getClientRects().length) return;
      if (view.reading) { if (onlyMemberId) view.readAgain = true; return; }
      view.reading = true;
      try {
        const frame = api.cmuxFrame ? await api.cmuxFrame(memberId) : { text: await api.cmuxRead(memberId) };
        const output = frame.ansi || frame.text || '';
        const signature = JSON.stringify([frame.columns, frame.rows, output]);
        if (current !== id || views.get(memberId) !== view || resizing || busy || view.last === signature) return;
        const firstFrame = !view.last;
        view.last = signature;
        // This is a screen snapshot, not an output stream. Replacing the frame
        // prevents duplicate scrollback while keeping input on the original PTY.
        view.frame = frame; view.refit();
        // Native snapshots may show their own cursor in every surface. Keep
        // that visibility local to the one input target, without blinking.
        const ansi = frame.ansi || ('\x1b[2J\x1b[H' + String(output).replace(/\r?\n/g, '\r\n'));
        view.cursorVisible = document.hasFocus() && document.activeElement === view.terminal.textarea && frame.cursor?.visible !== false;
        view.terminal.write(ansi.replace(/\x1b\[\?25[hl]/g, '') + (view.cursorVisible ? '\x1b[?25h' : '\x1b[?25l'));
        if (firstFrame || view.followInput) { view.followInput = false; view.revealCursor(); }
      } catch (error) { if (current === id && views.get(memberId) === view) status(error.message); }
      finally {
        view.reading = false;
        if (view.readAgain && current === id && views.get(memberId) === view) { view.readAgain = false; void read(memberId); }
      }
    }));
  }
  async function act(memberId, options) {
    if (busy || resizing) return;
    busy = true; inventoryEpoch += 1;
    detail.setAttribute('aria-busy', 'true'); status('배치를 적용하는 중…');
    try {
      const result = await api.cmuxArrange(memberId, options);
      if (enabled() && result.inventory) await applyInventory(result.inventory);
      else { if (refreshing) await refreshing; busy = false; await refresh(); }
      status('배치 저장됨');
    } catch (error) {
      const message = error.message;
      if (refreshing) await refreshing;
      busy = false; await refresh(); status(message);
    } finally { busy = false; detail.removeAttribute('aria-busy'); void refresh(); void read(); }
  }

  function updateStatuses() {
    const entry = groups().find(item => item.id === current);
    if (!entry) return;
    for (const member of entry.members) {
      const badge = [...detail.querySelectorAll('[data-cmux-session-status]')].find(node => node.dataset.cmuxSessionStatus === member.id);
      if (!badge) continue;
      const session = (app.state.snapshot?.sessions || []).find(item => item.id === member.currentSessionId);
      const state = session ? app.controlRoomStatus(session) : 'unknown';
      badge.dataset.status = state || 'unknown';
      badge.textContent = session ? app.sessionStatusLabel(session, state) : '상태 미확인';
      badge.title = session ? `${session.title || member.title} · ${badge.textContent}` : '현재 대화 연결을 확인하지 못했습니다.';
    }
  }
  function terminalTheme() {
    const css = getComputedStyle(document.documentElement);
    return { background: css.getPropertyValue('--terminal-bg').trim(), foreground: css.getPropertyValue('--terminal-fg').trim(), cursor: css.getPropertyValue('--terminal-fg').trim() };
  }
  window.addEventListener('whitebox:theme-changed', () => { for (const view of views.values()) view.terminal.options.theme = terminalTheme(); });
  function memberPane(member, entry) {
    let view = views.get(member.id);
    if (!view) {
      const node = document.createElement('section'); node.className = 'cmux-terminal'; node.dataset.cmuxMember = member.id;
      node.innerHTML = '<div class="cmux-terminal-viewport terminal-screen"></div>';
      const host = node.firstElementChild, engine = window.WhiteboxTerminalEngine;
      const terminal = new engine.Terminal({ fontSize: terminalFontSize, fontFamily: 'Menlo, monospace', scrollback: 0, cursorBlink: false, cursorStyle: 'bar', screenReaderMode: true, theme: terminalTheme() });
      // Scroll the readable native grid instead of the replay emulator's empty history.
      host.addEventListener('wheel', event => event.stopPropagation(), { capture: true, passive: true });
      const fit = new engine.FitAddon(); terminal.loadAddon(fit); terminal.open(host);
      if (window.WhiteboxTerminalIme) terminal.loadAddon(window.WhiteboxTerminalIme.createAddon());
      const refit = () => {
        if (resizing) return;
        try {
          if (view?.frame?.columns && view.frame.rows) {
            if (terminal.options.fontSize !== terminalFontSize) terminal.options.fontSize = terminalFontSize;
            if (terminal.cols !== view.frame.columns || terminal.rows !== view.frame.rows) terminal.resize(view.frame.columns, view.frame.rows);
            const metrics = terminal.renderer.getMetrics();
            terminal.element.style.width = `${Math.ceil(metrics.width * view.frame.columns)}px`;
            terminal.element.style.height = `${Math.ceil(metrics.height * view.frame.rows)}px`;
            node.dataset.fontSize = String(terminalFontSize);
          } else fit.fit();
        } catch (_) {}
      };
      const revealCursor = () => {
        const cursor = view.frame?.cursor;
        if (!cursor) { host.scrollTop = host.scrollHeight; return; }
        const metrics = terminal.renderer.getMetrics();
        const x = cursor.column * metrics.width, y = cursor.row * metrics.height;
        if (x < host.scrollLeft || x + metrics.width > host.scrollLeft + host.clientWidth) host.scrollLeft = Math.max(0, x - host.clientWidth + metrics.width * 3);
        if (y < host.scrollTop || y + metrics.height > host.scrollTop + host.clientHeight) host.scrollTop = Math.max(0, y - host.clientHeight + metrics.height * 2);
      };
      view = { node, terminal, fit, refit, revealCursor, queue: Promise.resolve(), last: '', observer: new ResizeObserver(refit) };
      view.observer.observe(host); views.set(member.id, view);
      syncCursor(view);
      // The native-sized grid may leave blank space inside a panel. Clicking
      // anywhere in that terminal should acquire its input, not just the canvas.
      node.addEventListener('pointerdown', event => { if (event.button === 0) terminal.focus(); });
      node.addEventListener('compositionstart', () => { view.composing = true; }, true);
      node.addEventListener('compositionend', () => {
        view.composing = false;
        // Register after the IME addon's composition-end flush timer.
        queueMicrotask(() => setTimeout(() => {
          const active = groups().find(item => item.id === current);
          if (pendingLayout && active) renderDetail(active).catch(error => status(error.message));
        }, 0));
      }, true);
      terminal.onData(data => {
        if (current !== entry.id || node.hidden || !node.getClientRects().length || document.activeElement !== terminal.textarea) return;
        view.followInput = true;
        view.queue = view.queue.then(() => api.cmuxInput(member.id, data)).then(() => { void read(member.id); }).catch(error => status(error.message));
      });
    }
    view.terminal.textarea.setAttribute('aria-label', `${member.title} 터미널 입력`);
    view.node.hidden = member.selected === false;
    return view.node;
  }
  async function renderDetail(entry) {
    const version = ++revision;
    await window.WhiteboxTerminalEngine.ready();
    if (version !== revision || current !== entry.id || resizing) return;
    if (!enabled()) return;
    document.body.classList.add('cmux-detail-open');
    detail.classList.remove('hidden'); detail.querySelector('[data-cmux-title]').textContent = entry.title;
    detail.querySelector('[data-cmux-project]').textContent = entry.cwd.split('/').filter(Boolean).at(-1) || '프로젝트';
    detail.querySelector('[data-cmux-project]').title = entry.cwd;
    const picker = detail.querySelector('[data-cmux-picker]'), previousPick = picker.value;
    const options = '<option value="">터미널 선택</option>' + entry.members.map(member => `<option value="${esc(member.id)}">${esc(member.title)}</option>`).join('');
    if (picker.innerHTML !== options) picker.innerHTML = options;
    if (entry.members.some(member => member.id === previousPick)) picker.value = previousPick;
    // Ratios change frequently; they must not detach every terminal and its
    // focused input. Only topology or membership changes rebuild the tree.
    const shape = JSON.stringify([entry.layout, entry.members.map(member => [member.id, member.paneId, member.selected])], (key, value) => key === 'split' ? undefined : value);
    const syncRatios = (tree, path = 'root') => {
      if (tree?.children?.length !== 2) return;
      const node = detail.querySelector(`[data-cmux-split-path="${path}"]`);
      if (node) node.style.setProperty('--cmux-ratio', `${Math.max(.05, Math.min(.95, Number(tree.split) || .5)) * 100}%`);
      tree.children.forEach((child, index) => syncRatios(child, `${path}-${index}`));
    };
    // Status/title updates must not detach an active textarea or cancel IME.
    for (const member of entry.members) {
      const tab = [...detail.querySelectorAll('[data-cmux-tab]')].find(node => node.dataset.cmuxTab === member.id);
      if (tab) { tab.querySelector('.cmux-tab-title').textContent = member.title; tab.title = member.title; }
      views.get(member.id)?.terminal.textarea.setAttribute('aria-label', `${member.title} 터미널 입력`);
    }
    if ([...views.values()].some(view => view.composing && view.terminal.textarea === document.activeElement)) { pendingLayout = true; return; }
    syncRatios(entry.layout);
    if (layoutShape === shape) { pendingLayout = false; updateInputFocus(); updateStatuses(); return; }
    pendingLayout = false; layoutShape = shape;
    const focused = [...views].find(([, view]) => view.terminal.textarea === document.activeElement)?.[0];
    const liveIds = new Set(entry.members.map(member => member.id));
    for (const [id, view] of views) if (!liveIds.has(id)) { view.observer.disconnect(); view.terminal.dispose(); views.delete(id); }
    const paneIds = [...new Set(entry.members.map(member => member.paneId || member.id))];
    detail.querySelector('[data-cmux-pane-count]').textContent = `${paneIds.length}개 패널`;
    function pane(id) {
      const members = entry.members.filter(member => (member.paneId || member.id) === id);
      const node = document.createElement('div'); node.className = 'cmux-pane'; node.dataset.cmuxPane = id;
      const tabs = document.createElement('div'); tabs.className = 'cmux-tabs'; tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', '패널의 터미널');
      tabs.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const items = [...tabs.querySelectorAll('[role=tab]')], index = items.indexOf(event.target);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
        items[next].focus(); items[next].click();
      };
      for (const member of members) {
        const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'cmux-tab'; tab.dataset.cmuxTab = member.id; tab.innerHTML = `<span class="cmux-tab-title">${esc(member.title)}</span><span class="cmux-session-status" data-cmux-session-status="${esc(member.id)}"></span>`; tab.title = member.title; tab.draggable = true; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(member.selected !== false));
        tab.onclick = async () => { if (member.selected === false) await act(member.id, { action: 'select' }); const target = views.get(member.id); if (target && !target.node.hidden && target.node.getClientRects().length) target.terminal.focus(); };
        tab.ondragstart = event => { if (busy) { event.preventDefault(); return; } dragging = true; event.dataTransfer.setData('application/x-whitebox-cmux', member.id); event.dataTransfer.effectAllowed = 'move'; };
        tab.setAttribute('aria-haspopup', 'dialog');
        tab.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); openMenu(node, member, entry, event); };
        tab.onkeydown = event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.stopPropagation(); openMenu(node, member, entry); } };
        tabs.append(tab);
      }
      const selected = members.find(member => member.selected !== false) || members[0];
      const controls = document.createElement('div'); controls.className = 'cmux-pane-controls';
      const inputBadge = document.createElement('span'); inputBadge.className = 'cmux-input-badge'; inputBadge.textContent = '입력'; inputBadge.setAttribute('aria-hidden', 'true'); controls.append(inputBadge);
      const expand = document.createElement('button'); expand.type = 'button'; expand.dataset.cmuxExpand = ''; expand.innerHTML = icon('expand'); expand.title = '터미널 크게 보기 / 전체 배치'; expand.setAttribute('aria-label', expand.title); expand.onclick = () => { expandedPane = expandedPane === id ? '' : id; applyExpansion(); }; controls.append(expand);
      const head = document.createElement('div'); head.className = 'cmux-pane-head'; head.append(tabs, controls); node.append(head);
      head.title = '제목을 우클릭해 터미널 배치 및 관리';
      head.oncontextmenu = event => { event.preventDefault(); openMenu(node, selected, entry, event); };
      for (const member of members) node.append(memberPane(member, entry));
      const dropDirection = event => {
        const rect = node.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
        return x < .22 ? 'left' : x > .78 ? 'right' : y < .22 ? 'up' : y > .22 ? 'down' : 'tab';
      };
      node.ondragover = event => {
        if (busy || !event.dataTransfer.types.includes('application/x-whitebox-cmux')) return;
        event.preventDefault(); event.dataTransfer.dropEffect = 'move';
        const direction = dropDirection(event);
        if (node.dataset.dropDirection !== direction) { clearDrop(); node.dataset.dropDirection = direction; }
      };
      node.ondragleave = event => { if (!node.contains(event.relatedTarget)) delete node.dataset.dropDirection; };
      node.ondrop = event => {
        if (!event.dataTransfer.types.includes('application/x-whitebox-cmux')) return;
        event.preventDefault(); dragging = false; clearDrop();
        const source = event.dataTransfer.getData('application/x-whitebox-cmux'); if (!source || source === selected.id || busy) return;
        void act(source, { action: 'move', targetId: selected.id, direction: dropDirection(event) });
      };
      return node;
    }
    const used = new Set();
    function layout(tree, path = 'root') {
      const id = tree?.pane?.id;
      if (id && paneIds.includes(id)) { used.add(id); return pane(id); }
      if (tree?.children?.length === 2) {
        const node = document.createElement('div'), horizontal = tree.direction === 'horizontal'; node.className = `cmux-split ${horizontal ? 'horizontal' : 'vertical'}`;
        node.dataset.cmuxSplitPath = path;
        const ratio = Math.max(.05, Math.min(.95, Number(tree.split) || .5));
        node.style.setProperty('--cmux-ratio', `${ratio * 100}%`);
        const first = layout(tree.children[0], `${path}-0`), last = layout(tree.children[1], `${path}-1`);
        const separator = document.createElement('div'); separator.className = 'cmux-divider'; separator.setAttribute('role', 'separator'); separator.setAttribute('tabindex', '0'); separator.setAttribute('aria-orientation', horizontal ? 'vertical' : 'horizontal'); separator.setAttribute('aria-label', '분할 크기 변경');
        const firstMembers = entry.members.filter(member => first.querySelector(`[data-cmux-member="${member.id}"]`));
        const lastMembers = entry.members.filter(member => last.querySelector(`[data-cmux-member="${member.id}"]`));
        const resize = delta => {
          const member = delta > 0 ? firstMembers.at(-1) : lastMembers[0];
          // cmux's pane.resize amount is a point delta, not terminal cells.
          if (member) act(member.id, { action: 'resize', direction: horizontal ? (delta > 0 ? 'right' : 'left') : (delta > 0 ? 'down' : 'up'), amount: Math.max(1, Math.round(Math.abs(delta))) });
        };
        separator.onpointerdown = event => {
          if (busy || resizing || event.button !== 0) return;
          event.preventDefault();
          const rect = node.getBoundingClientRect(), span = horizontal ? rect.width : rect.height;
          if (!span) return;
          const original = node.style.getPropertyValue('--cmux-ratio');
          const startRatio = parseFloat(original) / 100;
          const start = horizontal ? event.clientX : event.clientY;
          let delta = 0, frame = 0;
          const preview = () => {
            frame = 0;
            node.style.setProperty('--cmux-ratio', `${(startRatio + delta / span) * 100}%`);
          };
          const move = next => {
            if (next.pointerId !== event.pointerId) return;
            const position = horizontal ? next.clientX : next.clientY;
            delta = (Math.max(.1, Math.min(.9, startRatio + (position - start) / span)) - startRatio) * span;
            if (!frame) frame = requestAnimationFrame(preview);
          };
          const finish = (commit, refreshAfter = true) => {
            if (resizing?.separator !== separator) return;
            cancelAnimationFrame(frame); frame = 0;
            separator.onpointermove = separator.onpointerup = separator.onpointercancel = separator.onlostpointercapture = null;
            resizing = null;
            detail.classList.remove('is-resizing-horizontal', 'is-resizing-vertical');
            if (separator.hasPointerCapture(event.pointerId)) separator.releasePointerCapture(event.pointerId);
            if (commit && Math.abs(delta) > 4) { preview(); resize(delta); }
            else { node.style.setProperty('--cmux-ratio', original); if (refreshAfter) { void refresh(); void read(); } }
          };
          resizing = { separator, cancel: refreshAfter => finish(false, refreshAfter) };
          // Invalidate scans/paints begun before pointer capture. During the
          // gesture only one CSS ratio write per frame runs; PTYs stay intact.
          inventoryEpoch += 1; revision += 1;
          detail.classList.add(horizontal ? 'is-resizing-horizontal' : 'is-resizing-vertical');
          separator.setPointerCapture(event.pointerId);
          separator.onpointermove = move;
          separator.onpointerup = end => { if (end.pointerId === event.pointerId) { move(end); finish(true); } };
          separator.onpointercancel = separator.onlostpointercapture = end => { if (end.pointerId === event.pointerId) finish(false); };
        };
        separator.onkeydown = event => { const delta = (horizontal ? { ArrowLeft: -21, ArrowRight: 21 } : { ArrowUp: -21, ArrowDown: 21 })[event.key]; if (delta) { event.preventDefault(); resize(delta); } };
        node.append(first, separator, last); return node;
      }
      const empty = document.createElement('div'); empty.className = 'cmux-empty-pane'; empty.textContent = '터미널이 아닌 패널'; return empty;
    }
    const host = detail.querySelector('.cmux-layout');
    if (entry.layout) host.replaceChildren(layout(entry.layout));
    else { const fallback = document.createElement('div'); fallback.className = 'cmux-fallback-layout'; fallback.append(...paneIds.map(pane)); host.replaceChildren(fallback); }
    applyExpansion();
    const previousInput = views.get(focused);
    if (previousInput && !previousInput.node.hidden && previousInput.node.getClientRects().length) previousInput.terminal.focus();
    updateInputFocus();
    updateStatuses();
    app.syncQuestionnaireInbox?.();
    requestAnimationFrame(() => { for (const view of views.values()) view.refit(); read(); });
  }
  function openMenu(node, member, entry, point) {
    if (busy) return;
    const trigger = [...node.querySelectorAll('[data-cmux-tab]')].find(tab => tab.dataset.cmuxTab === member.id);
    detail.querySelectorAll('.cmux-arrange-menu').forEach(menu => menu.remove());
    const menu = document.createElement('div'); menu.className = 'cmux-arrange-menu'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '터미널 배치 및 관리'); menu.setAttribute('popover', 'manual');
    menu.innerHTML = `<strong>터미널 배치</strong><label>이동할 위치<select aria-label="이동할 터미널">${entry.members.filter(item => item.id !== member.id).map(item => `<option value="${esc(item.id)}">${esc(item.title)}</option>`).join('')}</select></label><div class="cmux-menu-directions">${[['left','← 왼쪽'],['right','오른쪽 →'],['up','↑ 위'],['down','아래 ↓'],['tab','탭으로 합치기']].map(([direction,label])=>`<button type="button" data-cmux-move="${direction}">${label}</button>`).join('')}<button type="button" data-cmux-swap>위치 맞바꾸기</button></div><strong>새 터미널</strong><div><button type="button" data-cmux-split="right">오른쪽 분할 ＋</button><button type="button" data-cmux-split="down">아래 분할 ＋</button></div><button type="button" data-cmux-remove>터미널 종료…</button><button type="button" data-cmux-dismiss>닫기</button><small>탭을 끌어 패널 가장자리에 놓으면 분할, 가운데에 놓으면 탭으로 합칩니다.</small>`;
    menu.querySelectorAll('[data-cmux-move]').forEach(button => { button.onclick = () => { act(member.id, { action: 'move', targetId: menu.querySelector('select').value, direction: button.dataset.cmuxMove }); menu.remove(); }; });
    menu.querySelector('[data-cmux-swap]').onclick = () => { act(member.id, { action: 'swap', targetId: menu.querySelector('select').value }); menu.remove(); };
    menu.querySelectorAll('[data-cmux-split]').forEach(button => { button.onclick = () => { act(member.id, { action: 'split', direction: button.dataset.cmuxSplit }); menu.remove(); }; });
    menu.querySelector('[data-cmux-remove]').onclick = event => { const button = event.currentTarget; if (button.dataset.confirm) { act(member.id, { action: 'close' }); menu.remove(); } else { button.dataset.confirm = 'true'; button.textContent = '실행 중인 작업도 종료됩니다. 종료하기'; } };
    menu.querySelector('[data-cmux-dismiss]').onclick = () => { menu.remove(); trigger?.focus(); }; detail.append(menu);
    if (entry.members.length < 2) menu.querySelectorAll('[data-cmux-move], [data-cmux-swap], select').forEach(control => { control.disabled = true; });
    menu.showPopover();
    const anchor = trigger.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(innerWidth - bounds.width - 12, point ? point.clientX : anchor.left))}px`;
    menu.style.top = `${Math.max(12, Math.min(innerHeight - bounds.height - 12, point ? point.clientY : anchor.bottom + 6))}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  detail.querySelectorAll('[data-cmux-font]').forEach(button => { button.onclick = () => {
    terminalFontSize = Math.min(22, Math.max(12, terminalFontSize + Number(button.dataset.cmuxFont)));
    detail.querySelector('[data-cmux-font-size]').textContent = String(terminalFontSize);
    for (const view of views.values()) { view.refit(); view.revealCursor(); }
  }; });
  detail.querySelector('[data-cmux-questionnaire]').onclick = async () => {
    const button = detail.querySelector('[data-cmux-questionnaire]');
    if (button.dataset.retrySession) { button.disabled = true; try { const result = await api.retryQuestionnaire(button.dataset.retrySession); if (!result?.ok) status('현재 작업이 완료된 후 다시 시도하세요.'); } catch (error) { status(error.message); } finally { app.syncQuestionnaireInbox?.(); } }
    else app.openLatestCmuxQuestionnaire?.(current);
  };
  detail.querySelector('[data-cmux-back]').onclick = () => closeDetail({ restoreFocus: true });
  detail.querySelector('[data-cmux-restore]').onclick = () => { expandedPane = ''; applyExpansion(); };
  detail.querySelector('[data-cmux-picker]').onchange = async event => {
    const entry = groups().find(item => item.id === current), member = entry?.members.find(item => item.id === event.target.value);
    if (!member) return;
    expandedPane = member.paneId || member.id; applyExpansion();
    if (member.selected === false) await act(member.id, { action: 'select' });
    views.get(member.id)?.terminal.focus();
  };
  detail.addEventListener('keydown', event => {
    if (event.key === 'Escape' && resizing) { event.preventDefault(); event.stopPropagation(); resizing.cancel(); return; }
    if (event.key === 'Escape' && detail.querySelector('.cmux-arrange-menu')) { event.preventDefault(); event.stopPropagation(); detail.querySelector('[data-cmux-dismiss]').click(); }
  });
  window.addEventListener('blur', () => resizing?.cancel());
  detail.querySelector('[data-cmux-native]').onclick = async () => { const entry = groups().find(item => item.id === current); try { if (entry?.members[0]) await api.cmuxFocus(entry.members[0].id); } catch (error) { status(error.message); } };
  document.addEventListener('click', event => {
    if (event.button === 0 && !event.target.closest('.cmux-arrange-menu, .cmux-pane-head')) detail.querySelectorAll('.cmux-arrange-menu').forEach(menu => menu.remove());
    const button = event.target.closest('[data-cmux-detail]');
    if (button) { const entry = groups().find(item => item.id === button.dataset.cmuxDetail); if (entry) { returnScroll = main.scrollTop; returnTrigger = button; main.scrollTop = 0; current = entry.id; status(''); renderDetail(entry).catch(error => status(error.message)); } return; }
    const trigger = event.target.closest('[data-cmux-workspace]');
    if (trigger) {
      event.preventDefault(); event.stopImmediatePropagation(); closeDetail();
      const project = trigger.closest('[data-sidebar-project-key]')?.querySelector('[data-workspace]');
      const entry = groups().find(item => item.id === trigger.dataset.cmuxWorkspace);
      if (entry) { app.state.cmuxSidebarSelectedId = entry.id; app.state.workspace = project?.dataset.workspace || entry.cwd; app.state.sidebarFolderFilter = { projectKey: app.state.workspace, entryId: entry.id, name: entry.title, path: entry.cwd }; app.state.workspaceSource = 'all'; app.state.view = 'all'; app.state.graphFocusId = ''; app.renderWorkspaces(); app.renderSessions(); renderOverview(); overview.scrollIntoView({ block: 'start' }); }
    } else if (event.target.closest('[data-workspace], [data-sidebar-session-id], [data-terminal-group-id], [data-view]')) { app.state.cmuxSidebarSelectedId = ''; closeDetail(); }
  }, true);
  new MutationObserver(() => { if (current && document.body.dataset.currentView !== 'all') closeDetail(); }).observe(document.body, { attributes: true, attributeFilter: ['data-current-view'] });
  new MutationObserver(renderOverview).observe(document.querySelector('#projectTaskToolbar'), { childList: true, subtree: true });
  window.addEventListener('whitebox-terminal-inventory-changed', () => {
    inventoryEpoch += 1;
    if (!enabled()) {
      closeDetail(); notice.hidden = true; notice.replaceChildren();
      app.state.sidebarTerminalEntries = (app.state.sidebarTerminalEntries || []).filter(entry => !entry.cmuxWorkspace);
      if (String(app.state.sidebarFolderFilter?.entryId || '').startsWith('cmux-workspace:')) app.state.sidebarFolderFilter = null;
      app.state.cmuxSidebarSelectedId = '';
      app.renderWorkspaces(); app.renderSessions(); renderOverview();
    }
    void refresh();
  });
  window.addEventListener('whitebox-sidebar-folder-selected', () => { closeDetail(); renderOverview(); });
  refresh(); setInterval(refresh, 4000); setInterval(read, 700);
})();
