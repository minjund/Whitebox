'use strict';

(() => {
  if (document.documentElement.dataset.workspace !== 'terminal') return;
  const api = window.whitebox;
  const terminal = window.WhiteboxTerminal;
  const layout = window.WhiteboxWorkspaceLayout;
  const esc = window.WhiteboxRendererUtils.esc;
  const { t, msg } = window.WhiteboxWorkspaceI18n;
  const ui = window.WhiteboxWorkspaceUI;
  const KEY = 'whitebox:workspace:v2';
  const icons = {
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    terminal: '<path d="m5 6 6 6-6 6m9 0h5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    down: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>',
    solo: '<rect x="3" y="4" width="18" height="16" rx="2"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2"/>',
    plug: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0Zm6 9v4"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
    keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M7 15h10"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    review: '<path d="M4 6h16M4 12h10M4 18h7m4-1 2 2 4-5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4Z"/><path d="M8 9h8M8 12h5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    inbox: '<path d="M4 13h4l1.5 3h5l1.5-3h4M5 5h14l1 8v6H4v-6Z"/>',
    moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  };
  const icon = name => `<svg class="wb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const uuid = () => crypto.randomUUID();
  const base = path => String(path).split(/[\\/]/u).filter(Boolean).at(-1) || path;
  let bootstrap, spaces = [], trash = [], selectedSpace = '', busy = false, reviewBusy = false, restoringId = '';
  let fontFamily = 'Cascadia Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  let fontSize = 14, expanded = false, uiFont = 'pretendard';
  const applyUiFont = () => { if (uiFont === 'pretendard') delete document.documentElement.dataset.uiFont; else document.documentElement.dataset.uiFont = uiFont; };
  let reviewTask = null;
  let contentHistory = [];
  const explainedTasks = (id, creationId, tasks = []) => tasks.map(task =>
    window.WhiteboxReviewDecision.applyHistoryContent(task, contentHistory, id, creationId));
  let pinnedPanels = [];
  let projectQuery = '';
  let standalone = { id: 'standalone', standalone: true, name: t('독립 패널'), cwd: '.', tabs: [], activeTab: '', nextNumber: 1 };
  const owners = () => [...spaces, standalone];
  let collaborationJobs = [];
  let updateState = null, updateEventSeen = false, updateRevision = 0, updateOperation = '', updateActionError = '', announcedUpdateVersion = '';

  const handledCollaborations = new Set();
  const collaborationStates = new Map(), collaborationNotices = new Map();
  // Screen text goes to main only when a pane's frame changed (see sync).
  const collaborationFrames = window.WhiteboxTerminalFrameDelta?.createFrameTracker() || null;
  let collaborationLoaded = false;
  const reviewRevisions = new Map();
  function acceptReview(id, value) {
    const session = sessions.get(id);
    if (!session || value.creationId && value.creationId !== session.creationId || value.terminalPid && value.terminalPid !== session.pid) return false;
    if (!Number.isSafeInteger(value.revision)) return true;
    const key = `${session.creationId}:${session.pid}`;
    const previous = reviewRevisions.get(id);
    if (previous?.key === key && previous.revision > value.revision) return false;
    reviewRevisions.set(id, { key, revision: value.revision }); return true;
  }
  const sessions = new Map(), panes = new Map(), reviews = new Map(), submissions = new Map(), interruptions = new Map(), reviewHistory = new Map();
  function rememberSession(session) {
    const previous = sessions.get(session.id);
    // Pending running snapshots cannot erase a newer live process. Actual
    // stopped/exited events remain authoritative and can always clear its PID.
    if (previous?.creationId === session.creationId && session.status === 'running') {
      const before = Date.parse(previous.updatedAt), after = Date.parse(session.updatedAt);
      if (before > after || previous.pid > 0 && !session.pid
        && !(after > before)) return previous;
    }
    sessions.set(session.id, session);
    return session;
  }
  const workStates = new Map();
  const aiMembers = new Map();
  const terminalUsageHistory = new Map();
  // When each terminal was last used: typed into, opened, or worked by its AI.
  const lastUsed = new Map();
  let lastUsedSave = 0;
  let backgroundPopover = null;
  const acknowledgedCompletions = new Map();
  const root = document.createElement('div');
  root.id = 'terminalWorkspace';
  root.innerHTML = msg`
    <aside class="wb-sidebar">
      <div class="wb-brand"><img src="../build/icon.png" alt=""/><strong>whitebox</strong><span>2.0</span></div>
      <label class="wb-project-search">${icon('search')}<input id="wbProjectSearch" type="search" placeholder="프로젝트·터미널 찾기" aria-label="프로젝트·터미널 찾기" autocomplete="off"/><kbd>⌘ K</kbd></label>
      <button type="button" id="wbReviewInbox" class="wb-inbox-row" data-action="next-review">${icon('inbox')}<span>확인할 답</span><b id="wbInboxCount">0</b></button>
      <button type="button" id="wbStaleCleanup" class="wb-inbox-row wb-stale-row is-empty" data-action="clean-stale">${icon('trash')}<span>일주일간 안 쓴 세션 정리</span><b id="wbStaleCount">0</b></button>
      <section id="wbGroups" class="wb-groups" aria-label="그룹" hidden></section>
      <div class="wb-sidebar-scroll">
      <div class="wb-side-heading"><span>프로젝트</span><small id="wbProjectCount"></small><button data-action="workspace" title="프로젝트 추가" aria-label="프로젝트 추가">${icon('plus')}</button></div>
      <p class="wb-side-description">작업 폴더별로 묶은 패널</p>
      <nav id="wbSpaces" aria-label="작업 폴더"></nav>
      <button class="wb-add-project" data-action="workspace">${icon('plus')} 프로젝트 추가</button>
      <div class="wb-side-heading"><span>독립 패널</span><button data-action="new-independent" title="새 패널" aria-label="독립 패널 만들기">${icon('plus')}</button></div>
      <p class="wb-side-description">프로젝트에 속하지 않는 패널</p>
      <nav id="wbInstances" aria-label="독립 패널"></nav>
      </div>
      <p class="wb-panel-help">터미널을 끌어 패널에 넣거나 새 패널로 꺼내세요. 숨겨진 터미널도 계속 실행됩니다.</p>
      <div class="wb-sidebar-bottom"><button data-action="trash">${icon('trash')} <span>휴지통</span><small id="wbTrashCount">0</small></button><hr class="wb-sidebar-separator"/><button data-action="settings">${icon('settings')} <span>설정 · 단축키</span></button><div class="wb-version-row"><small id="wbVersion"></small><button id="wbUpdateBadge" data-action="update-settings" hidden></button></div></div>
    </aside>
    <main class="wb-main">
      <header class="wb-topbar"><div class="wb-breadcrumbs"><button data-action="toggle-sidebar" aria-label="사이드바 접기">${icon('panel')}</button><span class="wb-breadcrumb-rule"></span><span id="wbBreadcrumbPanel" class="wb-crumb-panel" aria-hidden="true" hidden></span>${icon('folder')}<span id="wbBreadcrumbProject"></span><span class="wb-slash">/</span><strong id="wbBreadcrumbLeaf">작업 공간</strong></div><div class="wb-top-actions"><div class="wb-mode-switch" role="group" aria-label="작업 모드"><button data-workspace-mode="terminal" aria-pressed="true">터미널</button><button data-workspace-mode="chat" aria-pressed="false" disabled>채팅</button></div><button data-theme-toggle class="wb-theme-button"><span class="wb-theme-moon">${icon('moon')}</span><span class="wb-theme-sun">${icon('sun')}</span></button></div></header>
      <div id="wbTabs" role="tablist" aria-label="이 패널의 터미널" hidden></div>
      <div id="wbError" class="wb-error" role="alert" hidden></div>
      <div id="wbCollaborationStatus" class="wb-collaboration-status" aria-live="polite" hidden></div>
      <section id="wbCanvas" aria-label="터미널 작업 공간"></section>
      <footer class="wb-status"><span id="wbConnection"><i></i>터미널 연결 중</span><span id="wbTerminalStatus"></span><span>⌘/Ctrl T 터미널 추가 <b>·</b> ⌘/Ctrl D 분할</span></footer>
    </main>
    <div id="wbParking" hidden></div>
    <dialog id="wbArrange"><form method="dialog"><header><h2>패널 분리 · 화면 배치</h2><button aria-label="닫기">${icon('close')}</button></header><p>패널을 분리해도 같은 화면에서 함께 봅니다. 다른 패널은 테두리 색으로 구분합니다.</p><label>함께 볼 패널<select id="wbMoveTarget"></select></label><label>배치<select id="wbMoveDirection"><option value="right">오른쪽에 배치</option><option value="down">아래에 배치</option><option value="left">왼쪽에 배치</option><option value="up">위에 배치</option></select></label><div class="wb-dialog-actions"><button type="button" data-action="detach-panel">패널 분리</button><button type="button" data-action="join-panel">같은 패널로 묶기</button><button value="cancel">취소</button><button type="button" data-action="move-terminal">분할 배치</button></div></form></dialog>
    <dialog id="wbSettings" aria-labelledby="wbSettingsTitle"><form method="dialog" class="wb-settings-form">
      <header class="wb-settings-header"><div class="wb-settings-heading"><span class="wb-settings-appmark">w.</span><div><h2 id="wbSettingsTitle">설정</h2><small>Whitebox</small></div></div><span id="wbSettingsClose"><button aria-label="설정 닫기">${icon('close')}</button></span></header>
      <div class="wb-settings-layout"><nav class="wb-settings-nav" aria-label="설정 항목">
        <button type="button" data-settings-section="general" aria-current="page">${icon('settings')}<span>일반</span></button>
        <button type="button" data-settings-section="terminal">${icon('terminal')}<span>터미널</span></button>
        <button type="button" data-settings-section="connections">${icon('plug')}<span>연결</span></button>
        <button type="button" data-settings-section="remote">${icon('phone')}<span>원격</span></button>
        <button type="button" data-settings-section="shortcuts">${icon('keyboard')}<span>단축키</span></button>
        <small>whitebox.</small>
      </nav><div class="wb-settings-content" id="wbSettingsContent">
      <section data-settings-page="general" aria-labelledby="wbSettingsGeneralTitle"><div class="wb-settings-section-title"><h3 id="wbSettingsGeneralTitle">일반</h3><p>화면과 언어, 알림을 설정합니다.</p></div>
        <div class="wb-setting-row"><div><strong>모양</strong><p>앱 전체에 적용할 테마</p></div><div id="wbSettingsTheme"></div></div>
        <div class="wb-setting-row"><label for="wbUiFont"><strong>화면 글꼴</strong><span>메뉴 등 화면 글자 · 터미널 글꼴은 따로 설정</span></label><select id="wbUiFont"><option value="pretendard">Pretendard (한글·영문 가독성)</option><option value="system">시스템 기본</option><option value="geist">Geist (이전 글꼴)</option></select></div>
        <div class="wb-setting-row"><label for="wbLanguage"><strong>언어</strong><span>메뉴와 설정 화면의 표시 언어</span></label><select id="wbLanguage"><option value="ko">한국어</option><option value="en">English</option><option value="zh-CN">简体中文</option></select></div>
        <div id="wbAttentionCard" class="wb-setting-row wb-attention-setting"><div><label for="wbAttentionEnabled"><strong>입력 요청 알림</strong></label><p id="wbAttentionDescription">AI가 권한이나 답변을 요청하면 다른 창 위에서도 바로 확인하고 응답할 수 있는 작은 창을 표시합니다.</p></div><label class="wb-setting-switch"><input id="wbAttentionEnabled" type="checkbox" role="switch" aria-label="입력 요청 알림" aria-describedby="wbAttentionDescription wbAttentionStatus" checked/><span></span></label><p id="wbAttentionStatus" role="status" aria-live="polite"></p></div>
        <fieldset id="wbUpdateSettings" class="wb-analysis-settings"><legend>앱 업데이트</legend>
          <p id="wbUpdateVersions"></p><p id="wbUpdateInstalledVersion" hidden></p>
          <strong id="wbUpdateStatus" role="status" aria-live="polite"></strong>
          <p>앱 시작 시와 15분마다 새 버전을 자동으로 확인합니다.</p>
          <p id="wbUpdateCheckedAt"></p><p id="wbUpdateError" role="status" hidden></p>
          <progress id="wbUpdateProgress" max="100" aria-label="업데이트 다운로드" hidden></progress>
          <div class="wb-update-actions"><button type="button" data-action="update-check">업데이트 확인</button><button type="button" data-action="update-install" hidden>업데이트 설치</button><button type="button" data-action="update-release" hidden>버전 안내 보기</button></div>
          <details id="wbUpdateNotes" hidden><summary>이번 버전의 변경 사항</summary><pre></pre></details>
        </fieldset>
      </section>
      <section data-settings-page="terminal" aria-labelledby="wbSettingsTerminalTitle" hidden><div class="wb-settings-section-title"><h3 id="wbSettingsTerminalTitle">터미널</h3><p>편하게 읽고 입력할 수 있도록 조정합니다.</p></div>
        <div class="wb-setting-row"><label for="wbFontFamily"><strong>글꼴</strong><span>터미널에서 사용할 고정폭 글꼴</span></label><select id="wbFontFamily"><option value="Cascadia Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace">Cascadia Mono</option><option value="D2Coding, SFMono-Regular, Menlo, Monaco, Consolas, monospace">D2Coding</option><option value="monospace">monospace</option></select></div>
        <div class="wb-setting-row"><label for="wbFont"><strong>글자 크기</strong><span>모든 터미널에 적용</span></label><div class="wb-font-stepper"><span id="wbFontDecrease"></span><input id="wbFont" type="number" min="11" max="24" step="1" value="14" aria-label="터미널 글자 크기"/><span>px</span><span id="wbFontIncrease"></span></div></div>
        <p class="wb-font-preview-label">미리보기</p><div id="wbFontPreview" class="wb-font-preview"><small>~/projects/whitebox</small><p>$ 안녕하세요. Hello, Whitebox.</p><p>$ <span aria-hidden="true">▏</span></p></div>
      </section>
      <section data-settings-page="connections" aria-labelledby="wbSettingsConnectionsTitle" hidden><div class="wb-settings-section-title"><h3 id="wbSettingsConnectionsTitle">연결</h3><p>AI 연결과 API 키를 관리합니다.</p></div>
        <div class="wb-settings-provider"><span>C</span><div><strong>Codex · Claude</strong><p>이 컴퓨터에 설치된 CLI 사용</p></div></div>
      </section>
      <section data-settings-page="remote" aria-labelledby="wbSettingsRemoteTitle" hidden><div class="wb-settings-section-title"><h3 id="wbSettingsRemoteTitle">원격</h3><p>휴대폰에서 이 컴퓨터의 터미널을 엽니다.</p></div><div id="wbRemote"></div></section>
      <section data-settings-page="shortcuts" aria-labelledby="wbSettingsShortcutsTitle" hidden><div class="wb-settings-section-title"><h3 id="wbSettingsShortcutsTitle">단축키</h3><p>자주 사용하는 동작을 빠르게 실행합니다.</p></div><dl class="wb-settings-shortcuts"><dt>⌘/Ctrl T</dt><dd>새 터미널</dd><dt>⌘/Ctrl D</dt><dd>오른쪽 분할</dd><dt>⌘/Ctrl Shift D</dt><dd>아래 분할</dd><dt>⌘/Ctrl 1–9</dt><dd>터미널 탭 이동</dd><dt>⌘/Ctrl Shift [ / ]</dt><dd>분할 터미널 이동</dd></dl></section>
      </div></div><footer class="wb-settings-footer"><span id="wbSettingsSaved" role="status" aria-live="polite"></span><span id="wbSettingsDone"><button value="close">완료</button></span></footer>
    </form></dialog>
    <dialog id="wbRemoveProject"><form method="dialog"><h2>프로젝트를 목록에서 삭제할까요?</h2><p id="wbRemoveDescription"></p><p>실제 프로젝트 폴더와 파일은 그대로 남습니다.</p><div class="wb-dialog-actions"><button value="cancel">취소</button><button value="remove" class="wb-danger">프로젝트 삭제</button></div></form></dialog>
    <dialog id="wbTrash"><header><h2>인스턴스 휴지통</h2><button data-action="trash-close" aria-label="휴지통 닫기">${icon('close')}</button></header><p>휴지통으로 옮기면 실행 중인 세션과 프로그램이 종료됩니다. 출력과 검토 기록은 남으며, 복원해도 프로그램을 다시 실행하지 않습니다.</p><div id="wbTrashList"></div><p id="wbTrashNotice" role="status"></p><div class="wb-dialog-actions"><button data-action="trash-empty" class="wb-danger" disabled>휴지통 전체 삭제</button></div></dialog>
    <dialog id="wbStaleSessions" aria-labelledby="wbStaleTitle"><form method="dialog"><h2 id="wbStaleTitle"></h2><p>휴지통으로 옮기면 실행 중인 프로그램이 종료돼요. 출력 기록은 휴지통에 남아요.</p><ul id="wbStaleList" class="wb-stale-list"></ul><div class="wb-dialog-actions"><button value="cancel">취소</button><button value="clean" class="wb-danger">휴지통으로 옮기기</button></div></form></dialog>
    <dialog id="wbEmptyTrash"><form method="dialog"><h2>휴지통을 비울까요?</h2><p id="wbEmptyTrashDescription"></p><div class="wb-dialog-actions"><button value="cancel">취소</button><button value="empty" class="wb-danger">전체 영구 삭제</button></div></form></dialog>
    <dialog id="wbClose"><form method="dialog"><h2>인스턴스를 영구 삭제할까요?</h2><p>실행 중인 프로그램도 종료됩니다. 삭제 후에는 이 인스턴스를 복구할 수 없습니다.</p><div><button value="cancel">취소</button><button value="close" class="wb-danger">영구 삭제</button></div></form></dialog>`;
  document.body.append(root);
  const $ = selector => root.querySelector(selector);
  // A Claude/Codex terminal can be read as a chat inside its own pane.
  const chat = window.WhiteboxTerminalChat({
    root, api, t, esc, activeId: () => activeId(), session: id => sessions.get(id),
    member: id => aiMembers.get(id), groupId: id => panelFor(id)?.id,
    panes: () => panes, readTerminal: id => terminal.readTerminal(id),
    visibleIds: () => { try { return layout.ids(canvasLayout()); } catch { return []; } },
    save: () => save(), report: (message, id) => report(new Error(message), 'chat', id),
    focusTerminal: id => requestAnimationFrame(() => terminal.focusTerminal(id)),
    // A message sent from the chat is a submitted turn for the review, like Enter in the terminal.
    submitted: job => {
      submissions.set(job.targetId, { id: job.id, request: job.request, at: job.sentAt, stamps: { [job.provider]: job.stamp } });
      setTimeout(() => captureReviews(), 0);
    },
  });
  // Every screen split is a named group (renderer/terminal-groups.js).
  const groups = window.WhiteboxTerminalGroups({
    root, t, esc, layout, owners: () => owners(), panelFor: id => panelFor(id), space: () => space(), tab: () => tab(),
    canvasLayout: () => canvasLayout(), activate: (owner, panel, id) => activatePanel(owner, panel, id),
    renderLayout: () => renderLayout(), save: () => save(), panelColor: panel => panelColor(panel), refreshNav: () => renderNav(),
  });
  const backgroundPopup = document.createElement('section');
  backgroundPopup.id = 'wbBackgroundPopover'; backgroundPopup.className = 'wb-background-popover'; backgroundPopup.hidden = true;
  backgroundPopup.setAttribute('role', 'region'); backgroundPopup.setAttribute('aria-labelledby', 'wbBackgroundHeading');
  backgroundPopup.innerHTML = msg`<header><strong id="wbBackgroundHeading">백그라운드 작업 <span id="wbBackgroundCount"></span></strong><button type="button" data-close-background aria-label="작업 내역 닫기">${icon('close')}</button></header><p id="wbBackgroundOwner"></p><ul id="wbBackgroundJobs"></ul><p id="wbBackgroundMore" hidden></p>`;
  root.append(backgroundPopup);
  function settingsSection(name = 'general') {
    if (!$(`[data-settings-page="${name}"]`)) return;
    for (const page of root.querySelectorAll('[data-settings-page]')) page.hidden = page.dataset.settingsPage !== name;
    for (const button of root.querySelectorAll('[data-settings-section]')) {
      if (button.dataset.settingsSection === name) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    if (name === 'remote') window.WhiteboxRemoteSettings?.open($('#wbRemote'));
    else window.WhiteboxRemoteSettings?.close();
    $('#wbSettingsContent').scrollTop = 0;
  }
  function renderSettingsTheme() {
    ui?.choices?.($('#wbSettingsTheme'), { value: window.WhiteboxTheme?.getPreference?.() || window.WhiteboxTheme?.getTheme() || 'dark',
      label: t('모양'), options: [{ value: 'light', label: t('라이트') }, { value: 'dark', label: t('다크') }, { value: 'system', label: t('시스템') }],
      onChange: value => window.WhiteboxTheme.setTheme(value) });
  }
  function renderFontPreview() {
    $('#wbFontPreview').style.setProperty('--wb-settings-font', fontFamily);
    $('#wbFontPreview').style.setProperty('font-family', fontFamily, 'important');
    for (const child of $('#wbFontPreview').querySelectorAll('*')) child.style.setProperty('font-family', 'inherit', 'important');
    $('#wbFontPreview').style.fontSize = `${fontSize}px`;
    $('#wbFontDecrease button').disabled = fontSize <= 11;
    $('#wbFontIncrease button').disabled = fontSize >= 24;
  }
  function openSettings() {
    renderSettingsTheme(); renderFontPreview(); settingsSection();
    $('#wbSettingsSaved').textContent = '';
    if (!$('#wbSettings').open) $('#wbSettings').showModal();
    $('#wbSettings').scrollTop = 0;
  }
  ui?.actionButton?.($('#wbSettingsClose'), { type: 'submit', variant: 'ghost', ariaLabel: t('설정 닫기'), icon: icon('close'), value: 'close' });
  ui?.actionButton?.($('#wbSettingsDone'), { type: 'submit', variant: 'primary', label: t('완료'), value: 'close' });
  ui?.actionButton?.($('#wbFontDecrease'), { action: 'settings-font-smaller', ariaLabel: t('글자 작게'), label: '−' });
  ui?.actionButton?.($('#wbFontIncrease'), { action: 'settings-font-larger', ariaLabel: t('글자 크게'), label: '+' });
  $('#wbSettings').addEventListener('click', event => {
    const section = event.target.closest('[data-settings-section]');
    if (section) settingsSection(section.dataset.settingsSection);
  });
  $('#wbSettings').addEventListener('change', () => { $('#wbSettingsSaved').textContent = t('설정이 적용되었습니다.'); });
  $('#wbSettings').addEventListener('close', () => window.WhiteboxRemoteSettings?.close());
  window.addEventListener('whitebox:theme-changed', renderSettingsTheme);

  function renderUpdates() {
    const update = updateState || {};
    const available = ['available', 'downloading', 'downloaded', 'installing'].includes(update.status);
    if (available && update.latestVersion) announcedUpdateVersion = update.latestVersion;
    else if (update.status === 'current') announcedUpdateVersion = '';
    const badge = $('#wbUpdateBadge');
    badge.hidden = !announcedUpdateVersion;
    badge.textContent = t('업데이트 있음');
    badge.title = msg`새 버전 ${announcedUpdateVersion}`;
    badge.setAttribute('aria-label', msg`새 버전 ${announcedUpdateVersion}`);
    $('#wbVersion').textContent = `v${bootstrap?.versions?.app || update.runningVersion || update.currentVersion || '—'}`;
    $('#wbUpdateVersions').textContent = msg`실행 중 ${bootstrap?.versions?.app || '—'} · 최신 ${update.latestVersion || t('확인 전')}`;
    const installed = $('#wbUpdateInstalledVersion');
    installed.hidden = update.currentVersionKnown !== false && (!update.currentVersion || update.currentVersion === bootstrap?.versions?.app);
    installed.textContent = msg`업데이트 대상 설치 버전: ${update.currentVersionKnown === false ? t('확인 불가') : update.currentVersion || '—'}`;
    const labels = { idle: t('업데이트 확인 전'), checking: t('업데이트 확인 중…'), current: t('최신 버전입니다.'),
      available: msg`새 버전 ${update.latestVersion || '—'}`, downloading: t('업데이트 다운로드 중…'),
      downloaded: t('업데이트 설치 준비 완료'), installing: t('업데이트 설치 중…'),
      error: t('업데이트를 확인하지 못했습니다.'), unsupported: t('수동 업데이트가 필요합니다.') };
    const status = updateOperation === 'check' ? 'checking' : update.status || 'idle';
    const error = updateActionError || update.error || update.checkError || '';
    $('#wbUpdateStatus').textContent = status === 'current' && error ? labels.error : labels[status] || labels.idle;
    $('#wbUpdateCheckedAt').textContent = update.checkedAt ? msg`마지막 확인: ${new Date(update.checkedAt).toLocaleString(window.WhiteboxI18n.getLocaleTag())}` : '';
    $('#wbUpdateError').hidden = !error;
    $('#wbUpdateError').textContent = error;
    const working = Boolean(updateOperation) || ['checking', 'downloading', 'installing'].includes(update.status);
    $('[data-action="update-check"]').disabled = working || update.blocked === true;
    const install = $('[data-action="update-install"]');
    install.hidden = !available || !(update.asset || update.status === 'downloaded') || update.blocked === true;
    install.disabled = working;
    install.textContent = update.installMode === 'automatic' ? t('업데이트 설치') : t(update.status === 'downloaded' ? '설치 파일 열기' : '설치 파일 받기');
    $('[data-action="update-release"]').hidden = !update.latestVersion;
    const progress = $('#wbUpdateProgress');
    progress.hidden = update.status !== 'downloading';
    progress.value = Math.max(0, Math.min(100, Number(update.progress) || 0));
    const notes = $('#wbUpdateNotes');
    notes.hidden = !update.notes;
    notes.querySelector('pre').textContent = update.notes || '';
  }
  function receiveUpdate(update) {
    if (!update || typeof update !== 'object') return;
    updateState = update; updateActionError = ''; updateRevision++; renderUpdates();
  }
  // Subscribe before bootstrap so a completed startup check cannot be replaced
  // by the older snapshot returned by the bootstrap request.
  const unsubscribeUpdates = api?.onUpdateState?.(update => { updateEventSeen = true; receiveUpdate(update); });
  window.addEventListener('beforeunload', () => unsubscribeUpdates?.(), { once: true });
  // A save still waiting for its turn is written before the window goes away.
  for (const event of ['beforeunload', 'pagehide']) window.addEventListener(event, () => { if (saveTimer) flushSave(); });
  async function runUpdateAction(action) {
    if (updateOperation || ['checking', 'downloading', 'installing'].includes(updateState?.status)) return;
    if (action === 'install' && (updateState?.blocked || !['available', 'downloaded'].includes(updateState?.status)
      || !(updateState.asset || updateState.status === 'downloaded'))) return;
    updateOperation = action; updateActionError = ''; renderUpdates();
    const revision = updateRevision;
    try {
      const result = await (action === 'check' ? api.checkForUpdate() : api.installDownloadedUpdate());
      if (revision === updateRevision || result?.installCanceled) receiveUpdate(result);
    } catch (error) {
      updateActionError = String(error?.message || error).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u, '');
    } finally { updateOperation = ''; renderUpdates(); }
  }
  const attentionSettings = window.WhiteboxAppFactories.createAttentionPopupSettings({
    state: {},
    $: selector => $({ '#attentionPopupSettingsCard': '#wbAttentionCard',
      '#attentionPopupEnabled': '#wbAttentionEnabled', '#attentionPopupStatus': '#wbAttentionStatus' }[selector] || selector),
    reportRecoverableError: (_scope, error) => report(error),
  });
  const space = () => owners().find(item => item.id === selectedSpace);
  const tab = () => space()?.tabs.find(item => item.id === space().activeTab);
  const activeId = () => space()?.canvasHidden ? '' : space()?.activeSurface || tab()?.activePane || '';
  const panelFor = id => owners().flatMap(owner => owner.tabs).find(panel => layout.ids(panel.layout).includes(id));
  // Each panel remembers its own screen arrangement. Explicit drag/arrange
  // operations may include other panels without changing logical membership.
  function canvasLayout(owner = space()) {
    // An intentionally empty canvas must not fall back to the panel roster.
    if (!owner || owner.canvasHidden) return null;
    const current = owner.tabs.find(panel => panel.id === owner.activeTab);
    if (!current || current.pending) return null;
    const available = new Set(owners().flatMap(item => item.tabs.flatMap(panel => layout.ids(panel.layout))));
    const view = owner.viewLayout || current.viewLayout, present = layout.ids(view);
    owner.viewLayout = present.length && present.length === new Set(present).size && present.every(id => available.has(id))
      ? view : layout.fit(view, available) || layout.fit(current.layout, available);
    current.viewLayout = owner.viewLayout;
    return owner.viewLayout;
  }
  function rememberCanvas(owner = space()) {
    const current = owner?.tabs.find(panel => panel.id === owner.activeTab);
    if (current && !current.pending) current.viewLayout = owner.viewLayout;
  }
  function activatePanel(owner, panel, id = panel.activePane) {
    rememberCanvas();
    if (owner !== space()) rememberCanvas(owner);
    selectedSpace = owner.id; owner.canvasHidden = false; owner.activeTab = panel.id; panel.collapsed = false;
    owner.viewLayout = panel.viewLayout || panel.layout;
    if (id && !layout.ids(owner.viewLayout).includes(id)) owner.viewLayout = panel.layout;
    owner.activeSurface = layout.ids(owner.viewLayout).includes(id) ? id : layout.ids(panel.layout)[0] || '';
    panel.activePane = owner.activeSurface;
    expanded = false; root.classList.remove('terminal-expanded');
    markUsed(owner.activeSurface);
  }
  const panelColors = ['#77ad91', '#7d9fc8', '#c6a474', '#ab8ebd', '#bd8791', '#77b7b3', '#b9b66e', '#ce997d'];
  function panelColor(panel) {
    if (!panel) return panelColors[0];
    if (/^#[a-f0-9]{6}$/iu.test(panel.color || '') || /^hsl\(\d{1,3}\.\d{3} 38% 66%\)$/u.test(panel.color || '')) return panel.color;
    const used = new Set(owners().flatMap(owner => owner.tabs).map(item => item.color));
    panel.color = panelColors.find(color => !used.has(color));
    let index = owners().flatMap(owner => owner.tabs).length;
    while (!panel.color || used.has(panel.color)) panel.color = `hsl(${((index++ * 137.508) % 360).toFixed(3)} 38% 66%)`;
    return panel.color;
  }
  // The person can pick any panel's colour: one of the palette or a custom one.
  // A chosen colour is a plain #rrggbb, which panelColor() keeps as is.
  let colorPicker = null, colorPickerPanel = '';
  const findPanel = id => owners().flatMap(owner => owner.tabs).find(item => item.id === id);
  function closeColorPicker(restoreFocus = false) {
    if (!colorPicker || colorPicker.hidden) return;
    colorPicker.hidden = true;
    if (restoreFocus) root.querySelector(`[data-panel-color="${CSS.escape(colorPickerPanel)}"]`)?.focus();
    colorPickerPanel = '';
  }
  function setPanelColor(id, color) {
    const panel = findPanel(id);
    if (!panel || !/^#[a-f0-9]{6}$/iu.test(color)) return;
    panel.color = color.toLowerCase();
    save(); renderLayout(false);
  }
  function openColorPicker(id, anchor) {
    const panel = findPanel(id);
    if (!panel) return;
    if (!colorPicker) {
      colorPicker = document.createElement('div');
      colorPicker.className = 'wb-color-picker';
      colorPicker.setAttribute('role', 'dialog');
      colorPicker.addEventListener('click', event => {
        const swatch = event.target.closest('[data-pick-color]');
        if (swatch) { setPanelColor(colorPickerPanel, swatch.dataset.pickColor); closeColorPicker(true); }
      });
      colorPicker.addEventListener('change', event => {
        if (event.target.matches('[data-pick-custom]')) { setPanelColor(colorPickerPanel, event.target.value); closeColorPicker(true); }
      });
      colorPicker.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeColorPicker(true); } });
      document.addEventListener('pointerdown', event => {
        if (colorPicker.hidden || colorPicker.contains(event.target) || event.target.closest('[data-panel-color]')) return;
        closeColorPicker();
      }, true);
      root.append(colorPicker);
    }
    colorPickerPanel = id;
    const current = panelColor(panel).toLowerCase();
    const custom = /^#[a-f0-9]{6}$/u.test(current) ? current : '#888888';
    colorPicker.setAttribute('aria-label', t('패널 색'));
    colorPicker.innerHTML = `<div class="wb-color-swatches">${panelColors.map(color => `<button type="button" data-pick-color="${color}" style="--swatch:${color}" aria-label="${color}" aria-pressed="${color === current}"></button>`).join('')}</div><label class="wb-color-custom"><input type="color" data-pick-custom value="${custom}"><span>${esc(t('직접 고르기'))}</span></label>`;
    colorPicker.hidden = false;
    const box = anchor.getBoundingClientRect(), width = colorPicker.offsetWidth, height = colorPicker.offsetHeight;
    colorPicker.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
    colorPicker.style.top = `${box.bottom + 6 + height > innerHeight - 8 ? Math.max(8, box.top - height - 6) : box.bottom + 6}px`;
    (colorPicker.querySelector('[aria-pressed="true"]') || colorPicker.querySelector('button'))?.focus();
  }
  const DRAG_TYPE = 'application/x-whitebox-workspace-terminal';
  let draggingId = '', draggingPanelId = '', pointerDrag = null, suppressDragClick = false, consumedDragEscape = false;
  let projectDrag = null;
  let arrangingId = '';
  let pendingCreation = null;

  function report(error, scope = 'general', terminalId = '') {
    $('#wbError').hidden = false;
    $('#wbError').dataset.scope = scope;
    // A terminal-scoped notice (a chat pane's delivery) belongs to that terminal only.
    $('#wbError').dataset.terminalId = terminalId || '';
    const message = String(error?.message || error).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u, '');
    $('#wbError').dataset.connection = String(/명령창.*연결|터미널.*연결/u.test(message));
    $('#wbError').innerHTML = `<span>${esc(message)}</span><button data-action="dismiss-error" aria-label="${t('닫기')}">${icon('close')}</button>`;
    console.error('terminal-workspace:', error);
  }
  // One action (a new terminal, a trash) renders and saves several times. The
  // saved state holds every archived terminal and its kept answers and can be
  // megabytes, so writing it each time made each click take a second. The
  // screen state is remembered at once; the write happens once, after the
  // action has finished (not while it waits for the terminal host), and at
  // once when the window closes.
  let saveTimer = 0, saveSince = 0;
  function save() {
    owners().forEach(rememberCanvas);
    if (!saveTimer) { saveSince = Date.now(); saveTimer = setTimeout(() => flushSave(false), 0); }
  }
  function flushSave(force = true) {
    clearTimeout(saveTimer); saveTimer = 0;
    if (!force && busy && Date.now() - saveSince < 5000) { saveTimer = setTimeout(() => flushSave(false), 30); return; }
    owners().forEach(rememberCanvas);
    // A visible creation placeholder is not a terminal and must not survive reload.
    const storedOwner = owner => {
      const tabs = owner.tabs.filter(panel => !panel.pending);
      return { ...owner, tabs, activeTab: tabs.some(panel => panel.id === owner.activeTab) ? owner.activeTab : tabs[0]?.id || '' };
    };
    try { localStorage.setItem(KEY, JSON.stringify({ version: 2, chatModes: chat.serialize(), groups: groups.serialize(), spaces: spaces.map(storedOwner), standalone: storedOwner(standalone), trash, selectedSpace, pinnedPanels, fontSize, fontFamily, uiFont, handledCollaborations: [...handledCollaborations].slice(-200), reviewHistory: [...reviewHistory.values()], terminalUsageHistory: [...terminalUsageHistory.values()], lastUsed: [...lastUsed.values()] })); }
    catch (error) { report(error); }
  }
  function savedReview(session) {
    const record = reviewHistory.get(session?.id);
    return record?.creationId === session?.creationId && record?.pid === session?.pid ? record : null;
  }
  function retainReview(session, value) {
    if (!value?.result || !Array.isArray(value.result.tasks)) return savedReview(session);
    const previous = savedReview(session);
    const incoming = value.result.tasks.filter(task => !window.WhiteboxTerminalReviewTurns.isNonTaskRequest(task.request));
    const digest = JSON.stringify({ ...value.result, tasks: incoming });
    if (previous?.digest === digest && previous.providerPid === value.providerPid) return previous;
    const sameRun = previous && previous.provider === value.provider && previous.providerPid === value.providerPid;
    const tasks = sameRun ? previous.result.tasks.filter(task => !window.WhiteboxTerminalReviewTurns.isNonTaskRequest(task.request)) : [];
    for (const task of incoming) {
      const index = task.taskId ? tasks.findIndex(item => item.taskId === task.taskId)
        : task.requestQuote ? tasks.findIndex(item => !item.taskId && item.requestQuote === task.requestQuote && item.analysisId === task.analysisId) : -1;
      if (index < 0) tasks.push(task);
      else {
        const runs = new Map();
        for (const candidate of [tasks[index], task]) {
          for (const run of candidate.analysisRuns || [candidate]) {
            if (run.analysisId) runs.set(run.analysisId, { analysisId: run.analysisId, observedAt: run.observedAt,
              analysisUsage: run.analysisUsage, analysisProvider: run.analysisProvider, analysisModel: run.analysisModel,
              ...(run.analysisGate ? { analysisGate: run.analysisGate, recordOnly: run.recordOnly } : {}) });
          }
        }
        tasks[index] = runs.size > 1 ? { ...task, analysisRuns: [...runs.values()] } : task;
      }
    }
    tasks.sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
    const record = { id: session.id, creationId: session.creationId, pid: session.pid,
      provider: value.provider, providerPid: value.providerPid, digest,
      result: { ...value.result, tasks: tasks.slice(-12) } };
    reviewHistory.set(session.id, record);
    save();
    return record;
  }
  function activeFocus() { if (groups.editing()) return; if (chat.isChat(activeId())) chat.focus(activeId()); else terminal.focusTerminal(activeId()); }
  function title(id) {
    const session = sessions.get(id);
    const review = reviews.get(id);
    const tasks = review?.result?.tasks || savedReview(session)?.result?.tasks || [];
    return window.WhiteboxTerminalReviewTurns.terminalName(tasks, review?.preview) || review?.provider || session?.title || t('터미널');
  }
  function terminalState(id) {
    const session = sessions.get(id), pane = panes.get(id);
    if (!session) return { state: 'unknown', label: t('연결 확인 필요') };
    if (['failed', 'exited', 'stopped'].includes(session.status)) return { state: session.status, label: t(session.status === 'failed' ? '실행 실패' : '종료됨') };
    if (session.status === 'stopping') return { state: 'stopping', label: t('종료 중…') };
    if (pane?.error) return { state: 'unknown', label: t('연결 확인 필요') };
    if (session.status === 'starting' || pane?.loading) return { state: 'starting', label: t('시작 중…') };
    if (session.status === 'running') {
      const activity = workStates.get(id);
      if (activity?.creationId === session.creationId && activity.pid === session.pid && Date.now() - activity.observedAt < 5000) {
        if (activity.state === 'idle' && activity.completed) return activity.unreadCompletionId
          && acknowledgedCompletions.get(id) !== activity.unreadCompletionId
          ? { state: 'needs-review', label: t('확인 필요') }
          : { state: 'completed', label: t('확인 완료') };
        const labels = { working: '작업 중', idle: '입력 대기', waiting: '사용자 응답 대기', unknown: '작업 상태 확인 중' };
        return { state: activity.state, label: t(labels[activity.state] || labels.unknown) };
      }
      return { state: 'unknown', label: t('작업 상태 확인 중') };
    }
    return { state: 'unknown', label: t('연결 확인 필요') };
  }
  function stateBadge(value, className = 'wb-terminal-state') {
    return `<span class="${className}" data-state="${value.state}" role="img" aria-label="${esc(value.label)}" title="${esc(value.label)}"><i aria-hidden="true"></i></span>`;
  }
  function terminalBackground(id) {
    const session = sessions.get(id), activity = workStates.get(id), value = activity?.background;
    if (session?.status !== 'running' || activity?.creationId !== session.creationId || activity.pid !== session.pid
      || Date.now() - activity.observedAt >= 5000 || !Number.isSafeInteger(value?.count) || value.count <= 0 || !Array.isArray(value.items)) return null;
    const items = value.items.filter(item => item && typeof item.id === 'string' && typeof item.label === 'string'
      && ['running', 'waiting'].includes(item.state)).slice(0, 32);
    return items.length ? { ...value, items, activity } : null;
  }
  // Monitors (off-screen watchers) get their own eye badge beside the
  // background badge so a watch is visible without opening the list.
  function backgroundCounts(value) {
    if (!value) return { background: 0, monitors: 0 };
    const monitors = value.items.filter(item => item.kind === 'monitor').length;
    return { background: Math.max(0, value.count - monitors), monitors };
  }
  function backgroundBadge(id) {
    const value = terminalBackground(id);
    if (!value) return '';
    const counts = backgroundCounts(value);
    const badge = (kind, count, iconName, text) => {
      if (!count) return '';
      const label = `${t(text)} ${count.toLocaleString(window.WhiteboxI18n.getLocaleTag())} · ${t('작업 내역 보기')}`;
      return `<button type="button" class="wb-background-badge wb-${kind}-badge ${count > 9 ? 'is-many' : ''}" data-background-terminal="${esc(id)}" data-background-kind="${kind}" title="${esc(label)}" aria-label="${esc(title(id))} · ${esc(label)}" aria-expanded="${backgroundPopover?.id === id}" aria-controls="wbBackgroundPopover">${icon(iconName)}<span>${count > 99 ? '99+' : count}</span></button>`;
    };
    return badge('monitor', counts.monitors, 'eye', '모니터') + badge('work', counts.background, 'layers', '백그라운드 작업');
  }
  function closeBackgroundPopover(restoreFocus = false) {
    const id = backgroundPopover?.id;
    backgroundPopover = null; backgroundPopup.hidden = true;
    root.querySelectorAll('[data-background-terminal]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (restoreFocus && id) (root.querySelector(`[data-background-terminal="${CSS.escape(id)}"]`) || root.querySelector(`[data-instance="${CSS.escape(id)}"]`))?.focus();
  }
  function positionBackgroundPopover() {
    if (!backgroundPopover || backgroundPopup.hidden) return;
    const button = root.querySelector(`[data-background-terminal="${CSS.escape(backgroundPopover.id)}"]`);
    if (!button) { closeBackgroundPopover(backgroundPopup.contains(document.activeElement)); return; }
    const anchor = button.getBoundingClientRect(), row = button.closest('.wb-instance-row').getBoundingClientRect(), rect = backgroundPopup.getBoundingClientRect();
    const left = row.right + 10 + rect.width <= innerWidth - 12 ? row.right + 10 : row.left - rect.width - 10;
    backgroundPopup.style.left = `${Math.max(12, Math.min(left, innerWidth - rect.width - 12))}px`;
    backgroundPopup.style.top = `${Math.max(12, Math.min(anchor.top - 8, innerHeight - rect.height - 12))}px`;
  }
  function renderBackgroundPopover() {
    if (!backgroundPopover) return;
    const value = terminalBackground(backgroundPopover.id), activity = value?.activity;
    if (!value || activity.creationId !== backgroundPopover.creationId || activity.pid !== backgroundPopover.pid
      || activity.providerPid !== backgroundPopover.providerPid || activity.conversationId !== backgroundPopover.conversationId) {
      closeBackgroundPopover(backgroundPopup.contains(document.activeElement)); return;
    }
    const elapsed = at => {
      const start = Date.parse(at);
      if (!Number.isFinite(start)) return '';
      const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
      return seconds >= 60 ? `${Math.floor(seconds / 60)}${t('분')} ${seconds % 60}${t('초')}` : `${seconds}${t('초')}`;
    };
    $('#wbBackgroundCount').textContent = value.count.toLocaleString(window.WhiteboxI18n.getLocaleTag());
    $('#wbBackgroundOwner').textContent = title(backgroundPopover.id);
    const markup = value.items.map(item => `<li><div>${icon(item.kind === 'agent' ? 'layers' : item.kind === 'monitor' ? 'eye' : 'terminal')}<span>${esc(item.label)}</span></div><small>${t(item.kind === 'monitor' ? '감시 중' : item.state === 'waiting' ? '입력 대기' : '실행 중')}<span>${esc(elapsed(item.startedAt))}</span></small></li>`).join('');
    if ($('#wbBackgroundJobs').innerHTML !== markup) $('#wbBackgroundJobs').innerHTML = markup;
    const more = Math.max(0, value.count - value.items.length);
    $('#wbBackgroundMore').hidden = !more;
    $('#wbBackgroundMore').textContent = more ? `${t('추가 작업')} ${more}` : '';
    backgroundPopup.hidden = false; positionBackgroundPopover();
  }
  function openBackgroundPopover(id) {
    if (backgroundPopover?.id === id) { closeBackgroundPopover(true); return; }
    const value = terminalBackground(id);
    if (!value) return;
    const { creationId, pid, providerPid, conversationId } = value.activity;
    backgroundPopover = { id, creationId, pid, providerPid, conversationId };
    root.querySelectorAll('[data-background-terminal]').forEach(button => button.setAttribute('aria-expanded', String(button.dataset.backgroundTerminal === id)));
    renderBackgroundPopover();
    backgroundPopup.querySelector('[data-close-background]').focus();
  }
  document.addEventListener('pointerdown', event => {
    if (backgroundPopover && !backgroundPopup.contains(event.target) && !event.target.closest('[data-background-terminal]')) closeBackgroundPopover();
  }, true);
  document.addEventListener('focusin', event => {
    if (backgroundPopover && !backgroundPopup.contains(event.target) && !event.target.closest('[data-background-terminal]')) closeBackgroundPopover();
  });
  backgroundPopup.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeBackgroundPopover(true); }
  });
  window.addEventListener('resize', positionBackgroundPopover);
  new ResizeObserver(positionBackgroundPopover).observe($('.wb-sidebar'));
  $('.wb-sidebar-scroll').addEventListener('scroll', () => closeBackgroundPopover(), { passive: true });
  function renderPaneTabs() {
    const markup = layout.ids(canvasLayout()).map(id => `<button role="tab" aria-selected="${id === activeId()}" tabindex="${id === activeId() ? 0 : -1}" class="wb-tab ${id === activeId() ? 'active' : ''}" data-pane-tab="${esc(id)}" aria-controls="${esc(panes.get(id)?.node.id || '')}"><span class="wb-tab-icon">${icon('terminal')}</span><span class="wb-tab-title" title="${esc(title(id))}">${esc(title(id))}</span></button>`).join('');
    if ($('#wbTabs').innerHTML !== markup) $('#wbTabs').innerHTML = markup;
  }
  function validTerminalUsage(usage) {
    return usage && ['input', 'output', 'cachedInput', 'cacheWrite', 'total'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0);
  }
  function rememberTerminalUsage(id, activity) {
    const session = sessions.get(id);
    if (!session || activity?.creationId !== session.creationId || activity.pid !== session.pid) return false;
    // A stopped shell loses its PID without starting a new conversation. Keep
    // its final counters, and ignore any late/live activity for the archive.
    if (stoppedArchiveSession(session)) return false;
    const previous = terminalUsageHistory.get(id);
    const replaced = previous && (previous.creationId !== session.creationId || previous.pid !== session.pid
      || activity.providerPid && previous.providerPid !== activity.providerPid
      || activity.conversationId && previous.conversationId !== activity.conversationId);
    if (replaced) terminalUsageHistory.delete(id);
    if (activity.usageStatus !== 'observed' || !validTerminalUsage(activity.usage)) return Boolean(replaced);
    const record = { id, creationId: session.creationId, pid: session.pid, provider: activity.provider,
      providerPid: activity.providerPid, conversationId: activity.conversationId, usage: activity.usage };
    if (JSON.stringify(previous) === JSON.stringify(record)) return Boolean(replaced);
    terminalUsageHistory.set(id, record); return true;
  }
  function terminalTokens(id) {
    const session = sessions.get(id), record = terminalUsageHistory.get(id), activity = workStates.get(id);
    const unavailable = activity?.creationId === session?.creationId && activity.pid === session?.pid && activity.usageStatus === 'unavailable';
    if (!session || unavailable || !record || record.creationId !== session.creationId
      || record.pid !== session.pid && !stoppedArchiveSession(session) || !validTerminalUsage(record.usage)) {
      return { text: msg`— 토큰`, detail: t('이 터미널의 AI 토큰 사용량을 아직 확인하지 못했습니다.') };
    }
    const usage = record.usage, locale = window.WhiteboxI18n.getLocaleTag();
    const full = value => value.toLocaleString(locale);
    const amount = usage.total < 10000 ? full(usage.total) : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(usage.total);
    const text = `${usage.partial ? '≥' : ''}${amount} ${t('토큰')}`;
    const detail = [t('이 터미널에 연결된 AI 대화의 누적 사용량입니다.'),
      `${t('전체')} ${full(usage.total)} · ${t('입력')} ${full(usage.input)} · ${t('출력')} ${full(usage.output)}`,
      `${t('캐시 읽기')} ${full(usage.cachedInput)} · ${t('캐시 쓰기')} ${full(usage.cacheWrite)}`,
      t('캐시 입력은 입력 합계에 포함되며 중복 합산하지 않습니다.'),
      usage.partial ? t('기록 일부만 확인되어 관측된 사용량의 하한을 표시합니다.') : '',
      Number.isFinite(Date.parse(usage.observedAt)) ? `${t('마지막 확인')}: ${new Date(usage.observedAt).toLocaleString(locale)}` : '',
    ].filter(Boolean).join('\n');
    return { text, detail };
  }
  function refreshPaneChrome() {
    const shown = layout.ids(canvasLayout());
    const visiblePanels = new Set(shown.map(panelFor).filter(Boolean));
    // The panel (header colour) comes first; the project is a small side note, shown only
    // when terminals from more than one project share the screen.
    const mixedProjects = new Set(shown.map(item => terminalPosition(item)?.owner).filter(Boolean)).size > 1;
    for (const [id, pane] of panes) {
      const panel = panelFor(id), separated = visiblePanels.size > 1 && visiblePanels.has(panel);
      const label = title(id), value = terminalState(id), color = panelColor(panel);
      const tokens = terminalTokens(id);
      const expandTitle = expanded && id === activeId() ? t('기존 배치로 돌아가기') : t('선택한 터미널 넓게 보기');
      const splitView = shown.length > 1;
      const owner = splitView && mixedProjects ? terminalPosition(id)?.owner : null;
      const project = !owner ? '' : owner.standalone ? t('프로젝트 없음') : owner.name;
      const key = JSON.stringify([splitView, panel?.id, separated, color, label, value.state, value.label, tokens, expanded && id === activeId(), expandTitle, project, Boolean(owner?.standalone)]);
      if (pane.chromeKey === key) continue;
      pane.chromeKey = key;
      pane.node.classList.toggle('is-separate-panel', separated);
      pane.node.style.setProperty('--wb-panel-color', color);
      pane.node.dataset.panelId = panel?.id || '';
      const panelBadge = pane.node.querySelector('.wb-pane-panel');
      panelBadge.hidden = true;
      panelBadge.textContent = '';
      panelBadge.removeAttribute('title');
      pane.node.querySelector('.wb-pane-title').textContent = label;
      pane.node.querySelector('.wb-pane-title').title = label;
      const projectBadge = pane.node.querySelector('.wb-pane-project');
      projectBadge.hidden = !project; projectBadge.textContent = project;
      projectBadge.classList.toggle('is-none', Boolean(owner?.standalone));
      projectBadge.title = owner?.standalone ? t('프로젝트에 속하지 않는 패널') : project;
      const tokenBadge = pane.node.querySelector('.wb-pane-tokens');
      tokenBadge.textContent = tokens.text; tokenBadge.title = tokens.detail;
      tokenBadge.setAttribute('aria-label', `${tokens.text}. ${tokens.detail}`);
      pane.node.setAttribute('aria-label', `${label} ${t('터미널')}`);
      pane.node.querySelector('[data-solo-terminal]').hidden = !splitView;
      const expandButton = pane.node.querySelector('[data-expand-terminal]');
      expandButton.setAttribute('aria-pressed', String(expanded && id === activeId()));
      expandButton.title = expandTitle;
      expandButton.setAttribute('aria-label', expandButton.title);
      const badge = pane.node.querySelector('.wb-pane-state');
      badge.innerHTML = '<i aria-hidden="true"></i>';
      badge.dataset.state = value.state;
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', value.label);
      badge.title = value.label;
    }
    const crumbPanel = $('#wbBreadcrumbPanel'), active = activeId(), activePanel = active && panelFor(active);
    // Top path: [panel colour] project / selected terminal.
    crumbPanel.hidden = !activePanel;
    if (activePanel) crumbPanel.style.setProperty('--wb-panel-color', panelColor(activePanel));
    const leaf = active ? title(active) : t('작업 공간');
    if ($('#wbBreadcrumbLeaf').textContent !== leaf) $('#wbBreadcrumbLeaf').textContent = leaf;
    if (activeId()) {
      const markup = `${esc(title(activeId()))} ${stateBadge(terminalState(activeId()))}`;
      if ($('#wbTerminalStatus').innerHTML !== markup) $('#wbTerminalStatus').innerHTML = markup;
    }
  }
  function terminalPosition(id) {
    for (const owner of owners()) for (const panel of owner.tabs) {
      const index = layout.ids(panel.layout).indexOf(id);
      if (index >= 0) return { owner, panel, index };
    }
    return null;
  }
  function selectPane(id, focus = false) {
    if (!layout.ids(canvasLayout()).includes(id)) return;
    const changed = activeId() !== id;
    const panel = panelFor(id), owner = panel && panelOwner(panel.id);
    if (!panel || !owner) return;
    // Focus follows the terminal's project while retaining the shared canvas.
    const projectChanged = owner !== space();
    if (projectChanged) {
      const sharedView = canvasLayout();
      rememberCanvas(); rememberCanvas(owner);
      selectedSpace = owner.id; owner.canvasHidden = false; owner.viewLayout = sharedView;
    }
    owner.activeTab = panel.id; owner.activeSurface = id;
    panel.activePane = id;
    if (expanded && changed) { renderLayout(focus); return; }
    root.querySelectorAll('.wb-pane').forEach(node => node.classList.toggle('is-selected', node.dataset.terminalId === id));
    refreshPaneChrome();
    renderPaneTabs();
    renderChatState();
    if (projectChanged) renderNav(); else renderInstances();
    save();
    if (focus) activeFocus();
  }
  function openAttentionTerminal(payload = {}) {
    const id = payload.terminalId || payload.targetId || payload.sessionId;
    for (const owner of owners()) {
      const panel = owner.tabs.find(item => layout.ids(item.layout).includes(id));
      if (!panel) continue;
      activatePanel(owner, panel, id);
      renderLayout(true);
      return true;
    }
    return false;
  }

  function renderNav() {
    // Chat panes and groups decorate the workspace; a failure in either must
    // never stop the sidebar, the panes or startup.
    try { chat.render(); } catch (error) { report(error, 'chat'); }
    try { groups.sync(); groups.render(); } catch (error) { report(error, 'groups'); }
    $('#wbBreadcrumbProject').textContent = groups.active()?.name || space()?.name || t('내 작업 공간');
    renderInstances();
    renderTrash();
    refreshPaneChrome();
    renderPaneTabs();
  }

  // Sidebar in affectUI's Tree View look: a project is a rounded square with its
  // initial (affectUI Avatar), a terminal shows which AI runs in it as a letter
  // chip, and its state sits at the end of the row.
  const PROVIDER_CHIPS = { claude: 'C', codex: 'X', gemini: 'G', grok: 'K', opencode: 'O' };
  function providerOf(id) { return aiMembers.get(id)?.provider || reviews.get(id)?.provider || ''; }
  function providerChip(id) {
    const provider = providerOf(id), letter = PROVIDER_CHIPS[provider];
    return letter ? `<span class="wb-terminal-icon wb-provider-chip" data-provider="${esc(provider)}" title="${esc(provider)}">${letter}</span>`
      : `<span class="wb-terminal-icon wb-provider-chip" data-provider="shell">${icon('terminal')}</span>`;
  }
  function projectHue(item) {
    let hash = 0;
    for (const character of String(item.id || item.name || '')) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash % 7;
  }
  function projectAvatar(item) {
    const initial = [...String(item.name || '?').trim()][0] || '?';
    return `<span class="wb-space-icon wb-ws-avatar" data-hue="${projectHue(item)}" aria-hidden="true">${esc(initial.toLocaleUpperCase())}</span>`;
  }
  // The end of a project row: working, answers to check, or how many terminals.
  function projectMeta(item) {
    try { return projectMetaHtml(item); } catch { return ''; }
  }
  function projectMetaHtml(item) {
    const ids = item.tabs.flatMap(panel => layout.ids(panel.layout)).filter(id => !trashed(id));
    const states = ids.map(id => terminalState(id).state);
    const working = states.filter(state => state === 'working').length, review = states.filter(state => state === 'needs-review').length;
    return `<span class="wb-space-meta">${working ? `<i class="wb-meta-spin" title="${esc(t('작업 중'))}"></i>` : ''}${review ? `<i class="wb-meta-dot" title="${esc(t('확인 필요'))}"></i>${review}` : working ? '' : ids.length}</span>`;
  }
  function reviewQueue() {
    return owners().flatMap(owner => owner.tabs.flatMap(panel => layout.ids(panel.layout))).filter(id => !trashed(id) && terminalState(id).state === 'needs-review');
  }
  function renderInbox() {
    try { renderInboxNow(); renderStaleNow(); } catch (error) { report(error, 'inbox'); }
  }
  // "일주일간 안 쓴 세션": not typed into, opened or worked by its AI for 7 days.
  const STALE_MS = 7 * 24 * 60 * 60 * 1000;
  function stamp(value) { return typeof value === 'number' ? value : Date.parse(value || '') || 0; }
  function markUsed(id, at = Date.now()) {
    const session = sessions.get(id);
    if (!id || !session?.creationId) return;
    const previous = lastUsed.get(id);
    if (previous?.creationId === session.creationId && at - previous.at < 60000) return;
    lastUsed.set(id, { id, creationId: session.creationId, at });
    // Saved a moment later, and never before the saved workspace has loaded.
    clearTimeout(lastUsedSave);
    lastUsedSave = setTimeout(() => { if (initialized) save(); }, 3000);
  }
  function lastUseOf(id) {
    const session = sessions.get(id), record = lastUsed.get(id);
    const tasks = [reviews.get(id), reviewHistory.get(id)].flatMap(value => value?.result?.tasks || []);
    return Math.max(record?.creationId === session?.creationId ? record.at : 0, stamp(session?.createdAt),
      stamp(submissions.get(id)?.at), ...tasks.map(task => Math.max(stamp(task.submittedAt), stamp(task.observedAt))));
  }
  function staleTerminals(now = Date.now()) {
    return owners().flatMap(owner => owner.tabs.flatMap(panel => layout.ids(panel.layout).map(id => ({ id, owner }))))
      .filter(({ id }) => {
        const at = lastUseOf(id);
        return sessions.has(id) && !trashed(id) && id !== activeId() && at > 0 && now - at > STALE_MS
          && !['working', 'waiting', 'starting', 'stopping'].includes(terminalState(id).state);
      });
  }
  function renderStaleNow() {
    const button = $('#wbStaleCleanup');
    if (!button) return;
    const count = staleTerminals().length;
    $('#wbStaleCount').textContent = String(count);
    button.classList.toggle('is-empty', !count);
    button.disabled = busy || !count;
    button.title = count ? t('일주일 넘게 안 쓴 터미널을 휴지통으로 옮겨요') : t('일주일 넘게 안 쓴 터미널이 없어요');
  }
  async function cleanStaleTerminals() {
    const targets = staleTerminals();
    if (busy || !targets.length) return;
    const dialog = $('#wbStaleSessions'), locale = window.WhiteboxI18n.getLocaleTag();
    $('#wbStaleTitle').textContent = msg`일주일 넘게 안 쓴 터미널 ${targets.length}개를 휴지통으로 옮길까요?`;
    $('#wbStaleList').innerHTML = targets.map(({ id, owner }) => `<li><strong>${esc(title(id))}</strong><small>${esc(owner.name || t('독립 패널'))} · ${esc(t('마지막 사용'))} ${esc(new Date(lastUseOf(id)).toLocaleDateString(locale))}</small></li>`).join('');
    dialog.returnValue = ''; dialog.showModal();
    const answer = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
    if (answer !== 'clean') return;
    for (const { id } of targets) if (sessions.has(id) && !trashed(id)) await trashInstance(id);
    renderInbox();
  }
  function renderInboxNow() {
    const queue = reviewQueue(), button = $('#wbReviewInbox');
    if (!button) return;
    $('#wbInboxCount').textContent = String(queue.length);
    button.classList.toggle('is-empty', !queue.length);
    button.title = queue.length ? t('확인할 답이 있는 터미널로 차례로 이동') : t('확인할 답이 없어요');
  }
  // Each press opens the next terminal with an answer to check, alone on the screen.
  function openNextReview() {
    const queue = reviewQueue();
    if (!queue.length) return;
    const next = queue[(queue.indexOf(activeId()) + 1) % queue.length];
    acknowledgeCompletion(next); showTerminalAlone(next);
  }
  // A panel's own name line: "패널 2" unless the person named it.
  const DEFAULT_PANEL_NAMES = new Set(['패널', 'Panel', '面板']);
  function panelName(item, index) {
    return item.name && !DEFAULT_PANEL_NAMES.has(item.name) ? item.name : `${t('패널')} ${index + 1}`;
  }
  // Project › panel › terminal: each panel has a name line with its colour,
  // count and "+ 터미널"; its terminals sit inside its colour line.
  function instanceRows(owner) {
    return owner.tabs.map((item, index) => {
      const ids = layout.ids(item.layout), visible = selectedSpace === owner.id && owner.activeTab === item.id;
      const name = panelName(item, index);
      return msg`<section class="wb-panel-group ${visible ? 'active' : ''}" style="--wb-panel-color:${panelColor(item)}" data-drop-panel="${esc(item.id)}" data-drag-panel="${esc(item.id)}" role="group" aria-label="${esc(name)}" ${item.pending ? 'aria-busy="true"' : ''}><div class="wb-panel-head" data-panel-head="${esc(item.id)}" title="${esc(name)} · ${t('끌어서 옮기기')}"><button type="button" class="wb-panel-color-button" data-panel-color="${esc(item.id)}" title="${t('패널 색 바꾸기')}" aria-label="${esc(name)} ${t('패널 색 바꾸기')}" aria-haspopup="dialog"><i aria-hidden="true"></i></button><span class="wb-panel-name">${esc(name)}</span><span class="wb-panel-count">${ids.length}</span><button class="wb-panel-add" data-add-panel-terminal="${esc(item.id)}" aria-label="${esc(name)}에 터미널 추가" title="이 패널에 터미널 추가" ${busy ? 'disabled' : ''}>${icon('plus')}<span>${pendingCreation?.panelId === item.id ? t('생성 중…') : t('터미널')}</span></button></div><div class="wb-panel-members" id="wbMembers-${esc(item.id)}">${item.pending ? '<div class="wb-panel-pending" role="status">터미널 연결 중…</div>' : ''}${ids.map(id => {
        const value = terminalState(id);
        const background = backgroundBadge(id), counts = backgroundCounts(terminalBackground(id));
        return msg`<div class="wb-instance-row ${background ? 'has-background' : ''} ${counts.background > 9 || counts.monitors > 9 ? 'has-many-background' : ''} ${counts.monitors && counts.background ? 'has-two-badges' : ''}"><button class="wb-instance ${id === activeId() ? 'active' : ''}" data-instance="${esc(id)}" data-drag-terminal="${esc(id)}" draggable="false" aria-current="${id === activeId()}" title="${esc(title(id))} · ${esc(value.label)}">${providerChip(id)}<span class="wb-instance-copy"><strong>${esc(title(id))}</strong>${stateBadge(value)}</span></button>${background}<button data-trash-terminal="${esc(id)}" class="wb-trash-instance" title="${t('휴지통으로 이동')}" aria-label="${esc(title(id))} ${t('휴지통으로 이동')}">${icon('trash')}</button></div>`;
      }).join('')}</div></section>`;
    }).join('') + msg`<button class="wb-new-panel-drop" data-drop-owner="${esc(owner.id)}" data-new-panel="${esc(owner.id)}" ${busy ? 'disabled' : ''}>${icon('plus')}<span>새 패널</span><small>여기로 끌어 분리</small></button>`;
  }
  let lastProjectsMarkup = '', lastInstancesMarkup = '';
  function renderInstances() {
    if (draggingId || pointerDrag || projectDrag) return; // Keep pressed sources attached before the drag threshold too.
    const matchingProjects = spaces.filter(item => !projectQuery || [item.name, item.cwd, ...item.tabs.flatMap(panel => layout.ids(panel.layout).map(title))].some(value => String(value).toLocaleLowerCase().includes(projectQuery)));
    const projectsMarkup = matchingProjects.map(item => msg`<section class="wb-project" data-project-id="${esc(item.id)}"><div class="wb-space-row"><button class="wb-project-toggle" data-toggle-project="${esc(item.id)}" aria-expanded="${!item.collapsed}" aria-label="${esc(item.name)} ${t('프로젝트 펼치기·접기')}">${icon('chevron')}</button><button class="wb-space ${item.id === selectedSpace ? 'active' : ''}" data-space="${esc(item.id)}" draggable="false" title="${esc(item.cwd)} · ${t('길게 눌러 끌어서 순서 변경 · Alt+↑/↓')}">${projectAvatar(item)}<span><strong>${esc(item.name)}</strong></span>${projectMeta(item)}</button><button class="wb-remove-project" data-remove-project="${esc(item.id)}" title="프로젝트 목록에서 삭제" aria-label="${esc(item.name)} 프로젝트 삭제">${icon('trash')}</button></div><div class="wb-project-terminals" data-project-terminals="${esc(item.id)}" ${item.collapsed ? 'hidden' : ''}>${instanceRows(item)}</div></section>`).join('');
    const independentMarkup = instanceRows(standalone) || t('<p class="wb-no-instances">프로젝트 없는 세션이 여기에 표시됩니다.</p>');
    if (projectsMarkup !== lastProjectsMarkup) { $('#wbSpaces').innerHTML = projectsMarkup; lastProjectsMarkup = projectsMarkup; }
    if (independentMarkup !== lastInstancesMarkup) { $('#wbInstances').innerHTML = independentMarkup; lastInstancesMarkup = independentMarkup; }
    $('#wbProjectCount').textContent = spaces.length ? String(spaces.length) : '';
    renderInbox();
    renderBackgroundPopover();
  }

  $('#wbProjectSearch').addEventListener('input', event => { projectQuery = event.target.value.trim().toLocaleLowerCase(); renderInstances(); });

  function reorderProject(id, targetId, after = false) {
    const source = spaces.find(item => item.id === id);
    if (!source || id === targetId || !spaces.some(item => item.id === targetId)) return;
    spaces.splice(spaces.indexOf(source), 1);
    spaces.splice(spaces.findIndex(item => item.id === targetId) + Number(after), 0, source);
    save(); renderInstances();
    [...$('#wbSpaces').querySelectorAll('[data-space]')].find(node => node.dataset.space === id)?.focus({ preventScroll: true });
  }
  function clearProjectDrop() {
    $('#wbSpaces').querySelectorAll('[data-project-drop-edge]').forEach(node => { delete node.dataset.projectDropEdge; });
  }
  function projectDropTarget(drag) {
    const scroll = $('.wb-sidebar-scroll').getBoundingClientRect();
    if (drag.x < scroll.left || drag.x > scroll.right || drag.y < scroll.top || drag.y > scroll.bottom) return null;
    const projects = [...$('#wbSpaces').querySelectorAll('[data-project-id]')];
    const target = projects.find(node => drag.y < node.getBoundingClientRect().bottom) || projects.at(-1);
    if (!target || target.dataset.projectId === drag.id) return null;
    const bounds = target.getBoundingClientRect();
    return { node: target, id: target.dataset.projectId, after: drag.y >= bounds.top + bounds.height / 2 };
  }
  function projectDragFrame() {
    if (!projectDrag?.started) return;
    const scroll = $('.wb-sidebar-scroll'), bounds = scroll.getBoundingClientRect();
    const { x, y } = projectDrag;
    if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
      const edge = Math.min(36, bounds.height / 4);
      const speed = y < bounds.top + edge ? -Math.ceil((bounds.top + edge - y) / 3)
        : y > bounds.bottom - edge ? Math.ceil((y - bounds.bottom + edge) / 3) : 0;
      if (speed) scroll.scrollTop += speed;
    }
    clearProjectDrop();
    const target = projectDropTarget(projectDrag);
    if (target) target.node.dataset.projectDropEdge = target.after ? 'after' : 'before';
    projectDrag.frame = requestAnimationFrame(projectDragFrame);
  }
  function startProjectDrag() {
    if (!projectDrag || projectDrag.started) return;
    clearTimeout(projectDrag.timer);
    projectDrag.started = true;
    root.setPointerCapture(projectDrag.pointerId);
    root.classList.add('is-dragging-project');
    projectDrag.source.closest('.wb-project').classList.add('is-project-drag-source');
    projectDragFrame();
  }
  function finishProjectDrag(event, cancelled = false) {
    if (!projectDrag || event.pointerId !== projectDrag.pointerId) return;
    const drag = projectDrag, target = !cancelled && drag.started ? projectDropTarget({ ...drag, x: event.clientX, y: event.clientY }) : null;
    projectDrag = null;
    clearTimeout(drag.timer); cancelAnimationFrame(drag.frame);
    root.classList.remove('is-dragging-project');
    drag.source.closest('.wb-project')?.classList.remove('is-project-drag-source');
    clearProjectDrop();
    if (root.hasPointerCapture(drag.pointerId)) root.releasePointerCapture(drag.pointerId);
    if (!drag.started) { setTimeout(renderInstances, 0); return; }
    suppressDragClick = true;
    event.preventDefault(); event.stopPropagation();
    if (target) reorderProject(drag.id, target.id, target.after);
    else renderInstances();
  }
  root.addEventListener('pointerdown', event => {
    const source = event.target.closest('#wbSpaces [data-space]');
    if (!source || event.button !== 0 || !event.isPrimary || busy || projectDrag || pointerDrag) return;
    suppressDragClick = false;
    projectDrag = { id: source.dataset.space, source, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      originX: event.clientX, originY: event.clientY, started: false, frame: 0 };
    projectDrag.timer = setTimeout(startProjectDrag, 250);
  }, true);
  window.addEventListener('pointermove', event => {
    if (!projectDrag || event.pointerId !== projectDrag.pointerId) return;
    projectDrag.x = event.clientX; projectDrag.y = event.clientY;
    if (!projectDrag.started && Math.hypot(event.clientX - projectDrag.originX, event.clientY - projectDrag.originY) >= 6) {
      if (event.pointerType === 'mouse') startProjectDrag();
      else { finishProjectDrag(event, true); return; }
    }
    if (projectDrag.started) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  window.addEventListener('pointerup', event => finishProjectDrag(event), true);
  window.addEventListener('pointercancel', event => finishProjectDrag(event, true), true);
  root.addEventListener('lostpointercapture', event => finishProjectDrag(event, true));
  root.addEventListener('keydown', event => {
    const source = event.target.closest('#wbSpaces [data-space]');
    if (!source || !event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || busy || projectDrag) return;
    const visible = [...$('#wbSpaces').querySelectorAll('[data-space]')];
    const target = visible[visible.indexOf(source) + (event.key === 'ArrowDown' ? 1 : -1)];
    event.preventDefault(); event.stopPropagation();
    if (target) reorderProject(source.dataset.space, target.dataset.space, event.key === 'ArrowDown');
  });

  function selectInstance(id) {
    const owner = owners().find(item => item.tabs.some(tab => layout.ids(tab.layout).includes(id)));
    const target = owner?.tabs.find(item => layout.ids(item.layout).includes(id));
    if (!target) return;
    activatePanel(owner, target, id);
    renderLayout();
  }

  // Change only the saved view; all PTYs and logical panel memberships survive.
  function showTerminalAlone(id) {
    if (!sessions.has(id) || trashed(id)) return;
    const panel = panelFor(id), owner = panelOwner(panel?.id);
    if (!owner) return;
    activatePanel(owner, panel, id);
    owner.viewLayout = panel.viewLayout = { id };
    owner.activeSurface = panel.activePane = id;
    expanded = false; root.classList.remove('terminal-expanded');
    pinnedPanels = [];
    renderLayout();
  }
  function acknowledgeCompletion(id) {
    const activity = workStates.get(id);
    if (!activity?.unreadCompletionId || !api.terminalCompletionRead) return;
    const completionId = activity.unreadCompletionId;
    api.terminalCompletionRead({ id, creationId: activity.creationId, pid: activity.pid, completionId })
      .then(() => {
        const current = workStates.get(id);
        if (current?.creationId !== activity.creationId || current?.pid !== activity.pid
          || current.unreadCompletionId !== completionId) return;
        // An observation already in flight may still contain this unread token.
        // Keep its acknowledgement until the next answer supplies a new token.
        acknowledgedCompletions.set(id, completionId);
        delete current.unreadCompletionId;
        refreshPaneChrome(); renderInstances();
      })
      .catch(error => report(error, 'completion'));
  }

  function panelOwner(panelId) { return owners().find(owner => owner.tabs.some(item => item.id === panelId)); }
  function selectPanel(panelId) {
    const owner = panelOwner(panelId);
    if (!owner) return;
    activatePanel(owner, owner.tabs.find(item => item.id === panelId));
    renderLayout();
  }
  // `chosen`: the user picked the side of `targetId`, so the terminal lands there.
  function moveTerminal(id, { panelId, targetId, ownerId, direction = 'right', join = false, chosen = false }) {
    groups.arm();
    if (busy || !sessions.has(id) || trashed(id)) return;
    const sourceOwner = owners().find(owner => owner.tabs.some(item => layout.ids(item.layout).includes(id)));
    const source = sourceOwner?.tabs.find(item => layout.ids(item.layout).includes(id));
    const owner = ownerId ? owners().find(item => item.id === ownerId) : panelOwner(panelId);
    const destination = owner?.tabs.find(item => item.id === panelId);
    if (!source || !owner || (!ownerId && !destination)) return;
    rememberCanvas();
    if (destination && (owner !== space() || !layout.ids(canvasLayout(owner)).includes(targetId || destination.activePane))) {
      rememberCanvas(owner); owner.activeTab = destination.id; owner.viewLayout = destination.viewLayout || destination.layout;
    }
    if (destination) {
      const candidates = layout.ids(canvasLayout(owner)).filter(item => item !== id);
      targetId ||= candidates.includes(destination.activePane) ? destination.activePane : candidates[0];
      if (!candidates.includes(targetId)) return;
    } else if (sourceOwner === owner && layout.ids(source.layout).length === 1) {
      selectInstance(id); return;
    }
    const sourceView = canvasLayout(sourceOwner), destinationView = canvasLayout(owner);
    // Screen placement and AI panel membership are independent. A normal
    // directional drop only arranges the screen; joining is explicit.
    if (!destination || join) detachFromLayout(id, true);
    if (destination && join) {
      destination.layout = (chosen ? layout.drop : layout.split)(destination.layout, targetId, id,
        ['up', 'down'].includes(direction) ? 'column' : 'row', ['left', 'up'].includes(direction));
      destination.activePane = id; destination.collapsed = false; owner.activeTab = destination.id;
    } else if (!destination) {
      const next = { id: uuid(), name: t('패널'), layout: { id }, activePane: id };
      owner.tabs.push(next); owner.activeTab = next.id;
    }
    sourceOwner.viewLayout = sourceView;
    if (destination) {
      owner.viewLayout = (chosen ? layout.drop : layout.split)(layout.remove(destinationView, id), targetId, id,
        ['up', 'down'].includes(direction) ? 'column' : 'row', ['left', 'up'].includes(direction));
    } else owner.viewLayout = sourceOwner === owner ? sourceView
      : layout.reconcile(destinationView, [{ id }], new Set([...layout.ids(destinationView), id]));
    rememberCanvas(owner);
    owner.activeSurface = id;
    selectedSpace = owner.id; owner.canvasHidden = false; owner.collapsed = false;
    expanded = false; root.classList.remove('terminal-expanded');
    renderLayout();
  }
  function openArrange(id) {
    if (!sessions.has(id) || trashed(id)) return;
    arrangingId = id;
    $('#wbMoveTarget').innerHTML = owners().map(owner => `<optgroup label="${esc(owner.name)}">${owner.tabs.filter(item => layout.ids(item.layout).some(member => member !== id)).map(item => `<option value="${esc(item.id)}">${esc(layout.ids(item.layout).map(title).join(" · "))}</option>`).join('')}<option value="owner:${esc(owner.id)}">${t('새 패널')}</option></optgroup>`).join('');
    $('#wbArrange').showModal();
  }
  function clearDrop() {
    root.querySelectorAll('[data-drop-direction]').forEach(node => { delete node.dataset.dropDirection; delete node.dataset.dropLabel; });
  }
  function finishDrag() {
    draggingId = ''; draggingPanelId = ''; clearDrop(); root.classList.remove('is-dragging-terminal'); renderInstances();
  }
  function dropTarget(event) {
    // A group in the sidebar takes the dragged terminal or the whole dragged panel.
    const groupRow = event.target.closest('#wbGroups [data-group-row]');
    if (groupRow) return { node: groupRow, groupId: groupRow.dataset.groupRow, direction: 'group' };
    const target = event.target.closest('[data-drop-owner], [data-drop-panel], #wbCanvas .wb-pane, #wbCanvas');
    if (!target) return null;
    if (draggingPanelId && (target.dataset.dropOwner || target.dataset.dropPanel)) return null;
    if (target.dataset.dropOwner) return { node: target, ownerId: target.dataset.dropOwner, direction: 'new' };
    if (target.dataset.dropPanel) {
      const panelId = target.dataset.dropPanel;
      const members = layout.ids(panelOwner(panelId)?.tabs.find(panel => panel.id === panelId)?.layout);
      const targetId = layout.ids(canvasLayout()).find(id => id !== draggingId && members.includes(id));
      return { node: target, panelId: targetId ? tab()?.id : panelId, targetId, direction: 'right' };
    }
    if (target.id === 'wbCanvas') {
      const sourceIds = draggingPanelId
        ? layout.ids(panelOwner(draggingPanelId)?.tabs.find(panel => panel.id === draggingPanelId)?.layout)
        : [draggingId];
      const targetId = layout.ids(canvasLayout()).find(id => !sourceIds.includes(id));
      return targetId ? { node: target, panelId: tab()?.id, targetId, direction: 'right' } : null;
    }
    if (target.dataset.terminalId === draggingId || draggingPanelId && layout.ids(panelOwner(draggingPanelId)?.tabs.find(panel => panel.id === draggingPanelId)?.layout).includes(target.dataset.terminalId)) return null;
    const bounds = target.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width, y = (event.clientY - bounds.top) / bounds.height;
    const direction = y < .25 ? 'up' : y > .75 ? 'down' : x < .5 ? 'left' : 'right';
    // Place within the shared canvas. The target's logical project may still
    // remember an older, smaller view; activating it would discard other panes.
    return { node: target, panelId: tab()?.id, targetId: target.dataset.terminalId, direction, chosen: true };
  }
  function placePanel(panelId, target) {
    groups.arm();
    const panel = panelOwner(panelId)?.tabs.find(item => item.id === panelId);
    if (!panel || busy || !layout.ids(panel.layout).length) return;
    const current = canvasLayout();
    const targetId = target.targetId || layout.ids(current).find(id => !layout.ids(panel.layout).includes(id));
    if (!targetId) return;
    const direction = target.direction || 'right';
    space().viewLayout = layout.place(current, panel.layout, targetId,
      ['up', 'down'].includes(direction) ? 'column' : 'row', ['left', 'up'].includes(direction), target.chosen);
    pinnedPanels = [...new Set([...layout.ids(space().viewLayout).map(id => panelFor(id)?.id)].filter(Boolean))];
    rememberCanvas();
    expanded = false; root.classList.remove('terminal-expanded'); renderLayout(false);
  }
  const pointerDropTarget = event => {
    const node = document.elementFromPoint(event.clientX, event.clientY);
    return node ? dropTarget({ target: node, clientX: event.clientX, clientY: event.clientY }) : null;
  };
  root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || busy) return;
    suppressDragClick = false;
    const source = event.target.closest('[data-drag-terminal], [data-drag-panel]');
    if (!source || event.target.closest('button:not([data-drag-terminal]), input, select, textarea, a')) return;
    const panel = source.dataset.dragPanel && panelOwner(source.dataset.dragPanel)?.tabs.find(item => item.id === source.dataset.dragPanel);
    const id = source.dataset.dragTerminal || panel?.activePane || layout.ids(panel?.layout)[0];
    if (!id || !sessions.has(id)) return;
    pointerDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, id, panelId: panel?.id || '', started: false };
  }, true);
  root.addEventListener('pointermove', event => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    if (!pointerDrag.started && Math.hypot(event.clientX - pointerDrag.x, event.clientY - pointerDrag.y) < 6) return;
    if (!pointerDrag.started) root.setPointerCapture(event.pointerId);
    pointerDrag.started = true; draggingId = pointerDrag.id; draggingPanelId = pointerDrag.panelId;
    root.classList.add('is-dragging-terminal'); clearDrop();
    const target = pointerDropTarget(event);
    if (target) {
      target.node.dataset.dropDirection = target.direction;
      target.node.dataset.dropLabel = t({ new: '새 패널로 분리', left: '왼쪽에 배치', right: '오른쪽에 배치', up: '위에 배치', down: '아래에 배치', group: '그룹에 추가' }[target.direction]);
    }
    event.preventDefault();
  });
  const finishPointerDrag = (event, cancelled = false) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const drag = pointerDrag, target = !cancelled && drag.started ? pointerDropTarget(event) : null;
    pointerDrag = null;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    if (!drag.started) {
      // Preserve the original button until Chromium has dispatched its click.
      setTimeout(renderInstances, 0);
      return;
    }
    if (drag.started) {
      suppressDragClick = true;
      event.preventDefault(); event.stopPropagation();
    }
    finishDrag();
    if (target?.groupId) groups.add(target.groupId, drag.panelId ? layout.ids(panelOwner(drag.panelId)?.tabs.find(item => item.id === drag.panelId)?.layout) : [drag.id]);
    else if (target) {
      if (drag.panelId && !target.ownerId) placePanel(drag.panelId, target);
      else moveTerminal(drag.id, target);
    }
  };
  root.addEventListener('pointerup', event => finishPointerDrag(event), true);
  root.addEventListener('pointercancel', event => finishPointerDrag(event, true), true);
  root.addEventListener('lostpointercapture', event => finishPointerDrag(event, true));
  window.addEventListener('blur', () => {
    if (projectDrag) finishProjectDrag({ pointerId: projectDrag.pointerId, preventDefault() {}, stopPropagation() {} }, true);
    if (pointerDrag) finishPointerDrag({ pointerId: pointerDrag.pointerId, preventDefault() {}, stopPropagation() {} }, true);
  });
  root.addEventListener('click', event => {
    if (suppressDragClick && event.isTrusted && event.detail > 0) {
      suppressDragClick = false;
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!event.repeat && !pointerDrag && !projectDrag) consumedDragEscape = false;
    if (!pointerDrag && !projectDrag && !consumedDragEscape) return;
    consumedDragEscape = true;
    if (projectDrag) finishProjectDrag({ pointerId: projectDrag.pointerId, preventDefault() {}, stopPropagation() {} }, true);
    if (pointerDrag) finishPointerDrag({ pointerId: pointerDrag.pointerId, preventDefault() {}, stopPropagation() {} }, true);
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  root.addEventListener('keyup', event => {
    if (event.key !== 'Escape' || !consumedDragEscape) return;
    consumedDragEscape = false;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  root.addEventListener('dragstart', event => {
    if (event.target.closest('#wbSpaces [data-space]')) { event.preventDefault(); return; }
    const source = event.target.closest('[data-drag-terminal]');
    if (!source || busy || event.target.closest('header button')) { if (source) event.preventDefault(); return; }
    draggingId = source.dataset.dragTerminal;
    event.dataTransfer.setData(DRAG_TYPE, draggingId); event.dataTransfer.effectAllowed = 'move';
    root.classList.add('is-dragging-terminal');
  });
  root.addEventListener('dragover', event => {
    if (!draggingId || busy || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    const target = dropTarget(event); clearDrop();
    if (!target) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    event.stopPropagation();
    target.node.dataset.dropDirection = target.direction;
    target.node.dataset.dropLabel = t({ new: '새 패널로 분리', left: '왼쪽에 배치', right: '오른쪽에 배치', up: '위에 배치', down: '아래에 배치', group: '그룹에 추가' }[target.direction]);
  }, true);
  root.addEventListener('dragleave', event => { if (!event.target.contains(event.relatedTarget)) clearDrop(); });
  root.addEventListener('drop', event => {
    if (!draggingId || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    const target = dropTarget(event), id = event.dataTransfer.getData(DRAG_TYPE);
    event.preventDefault(); event.stopPropagation();
    const valid = id === draggingId; finishDrag();
    if (valid && target?.groupId) groups.add(target.groupId, [id]);
    else if (valid && target) moveTerminal(id, target);
  }, true);
  root.addEventListener('dragend', finishDrag);
  // Native desktop drags may blur the window. Keep the source identity until
  // drop/dragend; terminal engines can consume bubbling drop events themselves,
  // so workspace movement above runs in capture phase.

  async function ensurePane(session, restoring = false) {
    let pane = panes.get(session.id);
    if (pane) return pane.promise || pane;
    const node = document.createElement('section');
    node.className = 'wb-pane';
    node.id = `wbPane-${session.id}`;
    node.dataset.terminalId = session.id;
    node.setAttribute('aria-label', msg`${session.title} 터미널`);
    node.innerHTML = msg`<header data-drag-terminal="${esc(session.id)}" draggable="false"><div class="wb-pane-heading"><span class="wb-pane-title"></span><span class="wb-pane-project" hidden></span><span class="wb-pane-tokens" tabindex="0"></span></div><span class="wb-pane-panel" hidden></span><span class="wb-pane-state"></span><button data-chat-terminal="${esc(session.id)}" title="채팅으로 보기" aria-label="채팅으로 보기" aria-pressed="false" hidden>${icon('chat')}</button><button data-solo-terminal="${esc(session.id)}" title="이 터미널만 보기" aria-label="이 터미널만 보기">${icon('solo')}</button><button data-expand-terminal="${esc(session.id)}" title="선택한 터미널 넓게 보기" aria-label="선택한 터미널 넓게 보기">${icon('expand')}</button><button data-arrange-instance="${esc(session.id)}" title="패널 분리 · 화면 배치" aria-label="패널 분리 · 화면 배치">${icon('panel')}</button><button data-hide-terminal="${esc(session.id)}" title="화면에서 숨기기" aria-label="화면에서 숨기기">${icon('close')}</button></header><div class="wb-terminal-mount"></div>`;
    node.querySelector('.wb-pane-title').textContent = title(session.id);
    $('#wbParking').append(node);
    pane = { node, dispose: null, promise: null, loading: true, error: false };
    panes.set(session.id, pane);
    node.addEventListener('pointerdown', () => { selectPane(session.id); acknowledgeCompletion(session.id); });
    node.addEventListener('keydown', () => acknowledgeCompletion(session.id), true);
    node.addEventListener('wheel', () => acknowledgeCompletion(session.id), { capture: true, passive: true });
    pane.promise = terminal.mountTerminal(session.id, node.querySelector('.wb-terminal-mount'), {
      requireSessionIdentity: restoring ? { creationId: session.creationId, pid: session.pid } : null,
      allowStoppedRecord: restoring && !session.pid && ['stopped', 'exited', 'failed'].includes(session.status),
      inputLabel: !session.pid && session.status === 'stopped' ? t('종료된 터미널 기록 · 읽기 전용') : undefined,
      onUserInput: data => {
        markUsed(session.id);
        if (!trashed(session.id) && ['awaiting-answer', 'collecting', 'reviewing'].includes(reviews.get(session.id)?.state)
          && (data === '\x03' || data === '\x1b' && /esc to (?:interrupt|cancel)/iu.test(terminal.readTerminal(session.id)))) {
          interruptions.set(session.id, { id: uuid(), at: Date.now() });
          captureReviews();
          return;
        }
        if (!['\r', '\n'].includes(data) || trashed(session.id)
          // A stale 'paused' projection right after re-enabling must not drop the request.
          || ['shell', 'unbound'].includes(reviews.get(session.id)?.state)) return;
        const screen = terminal.readTerminal(session.id);
        const { submittedPrompt, completionStamp } = window.WhiteboxTerminalReviewTurns;
        // Gemini and Grok draw their own input prompt; the bound review knows which CLI runs here.
        const request = submittedPrompt(screen, reviews.get(session.id)?.provider);
        if (!request) return;
        submissions.set(session.id, { id: uuid(), at: Date.now(), request, stamps: Object.fromEntries(['claude', 'codex', 'gemini', 'grok'].map(provider => [provider, completionStamp(screen, provider)])) });
        captureReviews();
      },
      fontSize, fontFamily, inputLabel: msg`${session.title} ${session.id.slice(-5)} 터미널 입력`,
      onInputFocus: focused => { if (focused && activeId() !== session.id) selectPane(session.id); },
    }).then(dispose => {
      pane.dispose = dispose; pane.loading = false;
      node.querySelector('.wb-pane-loading')?.remove();
      refreshPaneChrome(); renderInstances();
      return pane;
    }).catch(error => {
      if (restoring) { panes.delete(session.id); node.remove(); throw error; }
      pane.loading = false; pane.error = true;
      node.querySelector('.wb-terminal-mount').innerHTML = msg`<div class="wb-pane-loading" role="alert"><p>터미널 연결에 실패했습니다.</p><button data-retry-terminal="${esc(session.id)}">다시 연결</button></div>`;
      refreshPaneChrome(); renderInstances();
      throw error;
    });
    node.querySelector('.wb-terminal-mount').insertAdjacentHTML('beforeend', msg`<div class="wb-pane-loading" role="status">시작 중…</div>`);
    return pane.promise;
  }
  const splitNodes = new WeakMap();
  function paintSplit(tree, axis) {
    const dom = splitNodes.get(tree);
    if (!dom || tree.id || tree.axis !== axis) return;
    dom.first.style.flex = `${tree.ratio} 1 0%`; dom.second.style.flex = `${1 - tree.ratio} 1 0%`;
    dom.handle.setAttribute('aria-valuenow', String(Math.round(tree.ratio * 100)));
    paintSplit(tree.first, axis); paintSplit(tree.second, axis);
  }
  function renderTree(tree, top = null) {
    if (tree.id) {
      if (!panes.has(tree.id) && sessions.has(tree.id)) ensurePane(sessions.get(tree.id)).catch(report);
      return panes.get(tree.id)?.node || document.createElement('div');
    }
    const node = document.createElement('div');
    node.className = `wb-split wb-split-${tree.axis}`;
    // The outermost split of this run of same-direction dividers.
    const run = top && top.axis === tree.axis ? top : tree;
    const first = renderTree(tree.first, run), second = renderTree(tree.second, run);
    const handle = document.createElement('div');
    handle.className = 'wb-divider'; handle.tabIndex = 0;
    handle.setAttribute('role', 'separator'); handle.setAttribute('aria-label', t('터미널 분할 크기'));
    handle.setAttribute('aria-orientation', tree.axis === 'row' ? 'vertical' : 'horizontal');
    splitNodes.set(tree, { first, second, handle });
    // Only the two terminals beside the divider change size; the others keep theirs.
    const resize = position => { layout.resize(tree, position); paintSplit(tree, tree.axis); };
    paintSplit(tree, tree.axis);
    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      // A divider across a grid (2×2) moves for the line under the pointer
      // only: the grid turns so that line's cells stack on their own.
      if (!expanded && layout.transposable(run)) {
        const index = layout.boundary(run, tree), lines = layout.parts(run, run.axis);
        const box = node.getBoundingClientRect(), along = run.axis === 'column' ? (event.clientX - box.left) / box.width : (event.clientY - box.top) / box.height;
        let edge = 0;
        const line = layout.parts(lines[index - 1].node, run.axis === 'column' ? 'row' : 'column').findIndex(cell => (edge += cell.share) >= along);
        layout.transpose(run, index - 1);
        renderLayout(false);
        const target = layout.divider(layout.parts(run, run.axis)[Math.max(0, line)].node, index);
        const moved = target && splitNodes.get(target)?.handle;
        if (moved?.isConnected) { moved.setPointerCapture(event.pointerId); save(); return; }
      }
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const bounds = node.getBoundingClientRect();
      resize(tree.axis === 'row' ? (event.clientX - bounds.left) / bounds.width : (event.clientY - bounds.top) / bounds.height);
    });
    handle.addEventListener('pointerup', event => { handle.releasePointerCapture(event.pointerId); save(); });
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); resize(tree.ratio + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -.05 : .05)); save();
    });
    node.append(first, handle, second);
    return node;
  }
  function visiblePanels() {
    const all = owners().flatMap(owner => owner.tabs);
    pinnedPanels = pinnedPanels.filter(id => all.some(panel => panel.id === id));
    return [...new Set([...pinnedPanels.map(id => all.find(panel => panel.id === id)), tab()].filter(Boolean))];
  }
  function hideForeignTerminalError() {
    const banner = $('#wbError');
    if (!banner.hidden && banner.dataset.terminalId && banner.dataset.terminalId !== activeId()) banner.hidden = true;
  }
  function renderLayout(focus = true) {
    hideForeignTerminalError();
    // Parking re-parents every pane, and Chromium drops focus from a moved
    // element (cutting any IME composition). Keep typing in the active pane.
    const typing = document.activeElement;
    for (const pane of panes.values()) $('#wbParking').append(pane.node);
    $('#wbCanvas').replaceChildren();
    const current = tab();
    const view = canvasLayout();
    if (current?.pending) {
      $('#wbCanvas').innerHTML = msg`<div class="wb-empty wb-creating" role="status" aria-live="polite" aria-busy="true"><span>${icon('terminal')}</span><h2>패널 생성 중…</h2><p>터미널을 연결하고 있어요.</p></div>`;
      $('#wbTerminalStatus').innerHTML = stateBadge({ state: 'starting', label: t('시작 중…') });
      renderChatState();
    } else if (view) {
      if (!layout.ids(view).includes(activeId())) space().activeSurface = layout.ids(view)[0];
      const tree = renderTree(expanded ? { id: activeId() } : view); tree.style.flex = '1';
      $('#wbCanvas').append(tree);
      if (typing !== document.activeElement && typing?.isConnected && panes.get(activeId())?.node.contains(typing)
        && $('#wbCanvas').contains(typing)) typing.focus({ preventScroll: true });
      selectPane(activeId());
      if (focus) requestAnimationFrame(activeFocus);
    } else {
      $('#wbCanvas').innerHTML = space()?.canvasHidden
        ? msg`<div class="wb-empty"><span>${icon('terminal')}</span><h2>화면에 표시된 터미널이 없습니다.</h2><p>왼쪽 터미널을 선택하면 다시 표시됩니다.</p></div>`
        : msg`<div class="wb-empty"><span>${icon('terminal')}</span><h2>터미널에서 바로 시작하세요.</h2><p>셸을 열고 평소처럼 명령어를 입력하세요.<br/>claude, codex도 이 터미널에서 실행합니다.</p><button data-action="${space() ? 'new' : 'workspace'}">${icon('plus')} ${space() ? t('터미널 열기') : t('프로젝트 추가')}</button></div>`;
      $('#wbTerminalStatus').textContent = t('선택한 터미널 없음');
      renderChatState();
    }
    renderNav(); save();
    // Publish moves immediately, even while review analysis is in flight.
    syncCollaboration().catch(error => report(error, 'collaboration'));
  }
  async function createTerminal(axis = 'row', destination = space(), panelId = destination?.activeTab) {
    if (busy) return;
    if (!destination) destination = standalone;
    if (panelId && !destination.tabs.some(item => item.id === panelId)) return;
    busy = true; $('#wbError').hidden = true;
    const owner = destination, previousTab = owner.tabs.find(item => item.id === panelId);
    // A group that already holds this panel's terminal takes the new terminal
    // in: the group changes, no second group is made. That is the group on
    // screen, or the group of the panel's selected terminal shown alone.
    const shownGroup = groups.active(), shownIds = shownGroup ? layout.ids(shownGroup.layout) : [];
    const panelIds = axis && previousTab?.layout ? layout.ids(previousTab.layout) : [];
    const onScreen = panelIds.filter(id => shownIds.includes(id));
    const joining = onScreen.length ? shownGroup : panelIds.includes(previousTab?.activePane) ? groups.holding(previousTab.activePane) : null;
    const inGroup = joining ? panelIds.filter(id => layout.ids(joining.layout).includes(id)) : [];
    const selected = joining ? [previousTab.activePane, activeId(), inGroup[0]].find(id => inGroup.includes(id)) : previousTab?.activePane || '';
    rememberCanvas(); rememberCanvas(owner);
    const previousActive = owner.activeTab, previousSpace = selectedSpace, previousView = owner.viewLayout, previousSurface = owner.activeSurface, previousPins = pinnedPanels, previousHidden = owner.canvasHidden;
    const splitting = axis && previousTab?.layout && layout.ids(previousTab.layout).includes(selected);
    const next = splitting ? previousTab : { id: uuid(), name: t('패널'), layout: null, activePane: '', pending: true };
    pendingCreation = { panelId: next.id };
    if (joining) renderNav();
    else {
      if (!splitting) { owner.tabs.push(next); pinnedPanels = []; }
      owner.canvasHidden = false;
      owner.viewLayout = splitting ? previousTab.viewLayout || previousTab.layout : null;
      if (splitting && !layout.ids(owner.viewLayout).includes(selected)) owner.viewLayout = previousTab.layout;
      expanded = false; root.classList.remove('terminal-expanded');
      owner.activeTab = next.id; owner.collapsed = false; next.collapsed = false; selectedSpace = owner.id;
      renderLayout(false);
    }
    let created = false;
    try {
      const session = await api.terminalCreate({ type: bootstrap.platform.localShell, cwd: owner.cwd, cols: 100, rows: 30, creationId: `workspace:${uuid()}` });
      rememberSession(session);
      created = true;
      next.layout = splitting ? layout.split(next.layout, selected, session.id, axis) : { id: session.id };
      next.activePane = session.id; delete next.pending;
      // Mount in the visible layout so engine/replay initialization does not
      // hold the whole panel offscreen or fit it against the hidden parking lot.
      let mounted;
      if (joining) {
        mounted = ensurePane(session);
        if (!groups.add(joining.id, [session.id], { beside: selected, axis })) renderLayout(false);
      } else {
        const view = layout.remove(canvasLayout(owner), session.id);
        owner.viewLayout = splitting ? layout.split(view, layout.ids(view).includes(selected) ? selected : layout.ids(view)[0], session.id, axis) : { id: session.id };
        next.viewLayout = owner.viewLayout;
        owner.activeSurface = session.id;
        mounted = ensurePane(session);
        renderLayout(false);
      }
      await mounted;
      // Reconcile ConPTY metadata without overwriting a newer state event.
      const current = await api.terminalGet(session.id, false);
      if (current?.creationId === session.creationId && sessions.get(session.id)?.creationId === session.creationId) rememberSession(current);
      refreshPaneChrome(); renderInstances();
      if (tab() === next || joining) activeFocus();
    } catch (error) {
      if (!created && !splitting) {
        owner.tabs = owner.tabs.filter(item => item !== next);
        if (owner.activeTab === next.id) {
          owner.canvasHidden = previousHidden; owner.activeTab = previousActive; owner.viewLayout = previousView; owner.activeSurface = previousSurface; pinnedPanels = previousPins;
          if (selectedSpace === owner.id) selectedSpace = previousSpace;
        }
        renderLayout(false);
      }
      report(error);
    }
    finally { pendingCreation = null; busy = false; renderNav(); }
  }
  function detachFromLayout(id, preserveDisplay = false) {
    for (const owner of owners()) {
      if (!preserveDisplay) owner.viewLayout = layout.remove(owner.viewLayout, id);
      if (owner.activeSurface === id && !preserveDisplay) owner.activeSurface = '';
      for (const item of owner.tabs) {
        item.layout = layout.remove(item.layout, id);
        if (!preserveDisplay) item.viewLayout = layout.remove(item.viewLayout, id);
        if (!layout.ids(item.layout).includes(item.activePane)) item.activePane = layout.ids(item.layout)[0] || '';
      }
      owner.tabs = owner.tabs.filter(item => item.layout);
      if (!owner.tabs.some(item => item.id === owner.activeTab)) owner.activeTab = owner.tabs[0]?.id || '';
    }
  }

  function removeTerminalLocally(id) {
    const pane = panes.get(id); pane?.dispose?.(); pane?.node.remove();
    chat.forget(id); aiMembers.delete(id);
    panes.delete(id); sessions.delete(id); reviews.delete(id); reviewHistory.delete(id); submissions.delete(id); interruptions.delete(id);
    terminalUsageHistory.delete(id); lastUsed.delete(id); reviewRevisions.delete(id); acknowledgedCompletions.delete(id); collaborationFrames?.forget(id);
    terminal.releaseTerminal?.(id);
    trash = trash.filter(item => item.id !== id);
    detachFromLayout(id);
  }

  function hideInstance(id) {
    if (busy || !layout.ids(canvasLayout()).includes(id)) return;
    groups.arm(); // Hiding changes the group's own split.
    groups.hide(id); // ...and the hidden terminal is no longer in that group.
    const owner = space();
    owner.viewLayout = layout.remove(owner.viewLayout, id);
    owner.canvasHidden = !owner.viewLayout;
    owner.activeSurface = layout.ids(owner.viewLayout).includes(activeId()) ? activeId() : layout.ids(owner.viewLayout)[0] || '';
    rememberCanvas(owner);
    expanded = false; root.classList.remove('terminal-expanded');
    renderLayout(false);
  }

  function trashed(id) { return trash.some(item => item.id === id && trashSession(item)); }
  function stoppedArchiveSession(session) {
    return Boolean(session && !session.pid && !session.terminationPending && !session.terminationUncertain
      && ['stopped', 'exited', 'failed'].includes(session.status));
  }
  function archiveIdentityMatches(session, item) {
    return Boolean(session && session.creationId === item.creationId && (stoppedArchiveSession(session)
      || !item.sessionStopped && session.status === 'running' && (!item.pid || session.pid === item.pid)));
  }
  function trashSession(item) {
    const session = sessions.get(item.id);
    return archiveIdentityMatches(session, item) ? session : null;
  }
  function renderTrash(force = false) {
    $('#wbTrashCount').textContent = String(trash.length);
    $('[data-action="trash-empty"]').disabled = busy || trash.length === 0;
    // The list (every archived terminal with its kept answers) is built only
    // while the trash is open; opening it builds it (force).
    if (!force && !$('#wbTrash').open) return;
    const opened = new Set([...$('#wbTrashList').querySelectorAll('details[data-trash-content][open]')].map(node => node.dataset.trashContent));
    $('#wbTrashList').innerHTML = [...trash].sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt)).map(item => {
      const session = trashSession(item);
      const provider = item.provider === 'claude' ? 'Claude' : item.provider === 'codex' ? 'Codex' : t('일반 셸');
      const restorable = Boolean(session && (session.status === 'running' || stoppedArchiveSession(session)));
      const restoring = restoringId === item.id;
      const history = explainedTasks(item.id, item.creationId, item.review?.result?.tasks).filter(task => !window.WhiteboxTerminalReviewTurns.isNonTaskRequest(task.request));
      const contents = history.length ? `<details class="wb-trash-content" data-trash-content="${esc(item.id)}" ${opened.has(item.id) ? 'open' : ''}><summary>${esc(t('보관된 글과 분석 보기'))} (${history.length})</summary>${history.map(task => `<article class="wb-task"><h2>${esc(window.WhiteboxReviewDecision.displayTitle(task))}</h2>${window.WhiteboxReviewDecision.render(task, { t, esc, taskKey: task.taskId || task.analysisId }) || `<p>${esc(t('AI 분석 없이 기록'))}</p><p>${esc(task.actual)}</p>`}</article>`).join('')}</details>` : '';
      return msg`<article class="wb-trash-row"><div><strong>${esc(provider)} · ${esc(item.name)} · ${esc(item.id.slice(-5))}</strong><small>${esc(item.projectName)} · ${esc(new Date(item.deletedAt).toLocaleString(window.WhiteboxI18n.getLocaleTag()))}</small><small>${session ? stoppedArchiveSession(session) ? t('세션 종료됨 · 출력과 검토 기록 보관') : session.status === 'running' ? t('실행 중 · 자동 검토 중지') : t('원래 실행 세션에 연결할 수 없습니다. 새 셸로 대체하지 않습니다.') : t('원래 실행 세션에 연결할 수 없습니다. 새 셸로 대체하지 않습니다.')}</small></div><div class="wb-trash-actions"><button data-restore-instance="${esc(item.id)}" ${!busy && restorable ? '' : 'disabled'} aria-busy="${restoring}" aria-label="${esc(provider)} ${esc(item.name)} ${esc(item.id.slice(-5))} 복구">${restoring ? t('복원 중…') : restorable ? stoppedArchiveSession(session) ? t('종료된 기록 복원') : msg`${esc(provider)} 세션 복구` : t('세션 연결 불가')}</button><button data-purge-instance="${esc(item.id)}" class="wb-danger" ${busy ? 'disabled' : ''} aria-label="${esc(item.name)} 영구 삭제">영구 삭제</button></div>${contents}</article>`;
    }).join('') || t('<div class="wb-trash-empty">휴지통이 비어 있습니다.</div>');
  }

  async function trashInstance(id) {
    if (busy || trashed(id)) return;
    const owner = owners().find(item => item.tabs.some(tab => layout.ids(tab.layout).includes(id)));
    const target = owner?.tabs.find(item => layout.ids(item.layout).includes(id));
    const session = sessions.get(id);
    if (!target || !session) return;
    const item = { id, creationId: session.creationId, pid: session.pid, sourcePid: session.pid || savedReview(session)?.sourcePid || null,
      name: title(id), provider: reviews.get(id)?.provider || '', projectId: owner.id,
      review: retainReview(session, reviews.get(id)), projectName: owner.name,
      standalone: owner.standalone === true, cwd: owner.cwd, deletedAt: new Date().toISOString() };
    busy = true; renderNav();
    try {
      const live = await api.terminalGet(id, false);
      if (live) {
        if (live.creationId !== item.creationId || live.pid !== item.pid) throw new Error(t('터미널 세션이 바뀌어 종료하지 않았습니다.'));
        const stopped = await api.terminalStop(id);
        if (stopped?.creationId !== item.creationId || stopped.pid || stopped.status !== 'stopped'
          || stopped.terminationPending || stopped.terminationUncertain) throw new Error(t('세션 종료를 확인하지 못해 휴지통으로 옮기지 않았습니다.'));
        const current = await api.terminalGet(id, false);
        item.sessionStopped = true; item.pid = null;
        if (current && !archiveIdentityMatches(current, item)) throw new Error(t('터미널 세션이 바뀌어 종료하지 않았습니다.'));
        if (current) rememberSession(current); else sessions.delete(id);
        if (item.review) {
          item.review = { ...item.review, pid: null, sourcePid: item.sourcePid, archived: true };
          reviewHistory.set(id, item.review);
        }
      } else {
        if (session.pid || session.terminationPending || session.terminationUncertain || !['stopped', 'exited', 'failed'].includes(session.status)) {
          throw new Error(t('세션 종료를 확인하지 못해 휴지통으로 옮기지 않았습니다.'));
        }
        item.sessionStopped = true; item.pid = null; sessions.delete(id);
      }
      trash.push(item);
      const pane = panes.get(id); pane?.dispose?.(); pane?.node.remove(); panes.delete(id);
      // The stopped record stays in the host until permanent delete. Free the
      // emulator now; restore rebuilds it from the host replay.
      terminal.releaseTerminal?.(id); collaborationFrames?.forget(id);
      detachFromLayout(id); renderLayout();
      // No model work is requested for a stopped archive.
      Promise.resolve().then(() => api.terminalReview?.({ id, creationId: item.creationId, enabled: false })).catch(report);
    } catch (error) { report(error, 'trash'); }
    finally { busy = false; renderNav(); renderTrash(); }
  }

  async function restoreInstance(id) {
    if (busy) return;
    const item = trash.find(item => item.id === id);
    if (!item) return;
    busy = true; restoringId = id;
    $('#wbTrashNotice').textContent = ''; renderTrash();
    try {
      // Verify the host's current identity, not a possibly stale renderer list.
      // Restoring stopped records is read-only; never spawn a shell or reconnect a dead PTY.
      // Fetch only identity/status here; the mount validates identity again and
      // reads the potentially multi-MiB replay exactly once.
      const session = await api.terminalGet(item.id, false);
      if (!archiveIdentityMatches(session, item)) {
        throw new Error(t('원래 실행 세션에 연결할 수 없습니다. 새 셸로 대체하지 않습니다.'));
      }
      rememberSession(session);
      await ensurePane(session, true);
      const record = item.review || reviewHistory.get(session.id);
      if (record?.id === session.id && record.creationId === session.creationId && Array.isArray(record.result?.tasks)
        && (record.pid === session.pid || stoppedArchiveSession(session))) {
        reviewHistory.set(session.id, stoppedArchiveSession(session)
          ? { ...record, pid: null, sourcePid: record.sourcePid || item.sourcePid || record.pid, archived: true } : record);
      }
      const history = savedReview(session);
      if (history) reviews.set(session.id, { state: stoppedArchiveSession(session) ? 'archived' : 'watching', provider: history.provider, providerPid: history.providerPid, result: history.result, restored: true });
      let owner = item.standalone ? standalone : spaces.find(owner => owner.id === item.projectId) || spaces.find(owner => owner.cwd === item.cwd);
      if (!owner) {
        owner = { id: uuid(), cwd: item.cwd, name: item.projectName, tabs: [], activeTab: '', nextNumber: 1 };
        spaces.push(owner);
      }
      const restored = { id: uuid(), name: item.name || t('패널'), layout: { id: session.id }, activePane: session.id };
      rememberCanvas(); rememberCanvas(owner);
      owner.tabs.push(restored); owner.activeTab = restored.id; selectedSpace = owner.id; owner.canvasHidden = false; owner.viewLayout = restored.layout; owner.activeSurface = session.id;
      trash = trash.filter(record => record !== item);
      $('#wbTrash').close();
      renderLayout();
      // Layout publishes membership asynchronously. Read-only restoration does
      // not wait for unrelated collaboration/review work or request a model call.
    } catch (error) { $('#wbTrashNotice').textContent = msg`복구하지 못했습니다: ${error.message}`; }
    finally { busy = false; restoringId = ''; renderNav(); }
  }

  async function deleteTrashItem(item) {
    if (!trash.includes(item)) return;
    const live = await api.terminalGet(item.id, false);
    if (live) {
      if (!archiveIdentityMatches(live, item)) {
        throw new Error(t('터미널 세션이 바뀌어 삭제하지 않았습니다.'));
      }
      await api.terminalClose(item.id);
      removeTerminalLocally(item.id);
    } else {
      trash = trash.filter(record => record !== item);
      reviewHistory.delete(item.id);
      terminalUsageHistory.delete(item.id);
    }
    save();
  }

  async function emptyTrash() {
    if (busy || !trash.length) return;
    const targets = [...trash];
    busy = true; renderTrash();
    try {
      const dialog = $('#wbEmptyTrash');
      $('#wbEmptyTrashDescription').textContent = msg`휴지통의 인스턴스 ${targets.length}개를 모두 영구 삭제합니다. 실행 중인 프로그램도 종료되며 복구할 수 없습니다.`;
      dialog.returnValue = ''; dialog.showModal();
      const answer = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
      if (answer !== 'empty') return;
      const failures = []; let deleted = 0;
      for (const item of targets) {
        try { await deleteTrashItem(item); deleted++; }
        catch (error) { failures.push(`${item.id.slice(-5)}: ${error.message}`); }
        $('#wbTrashNotice').textContent = msg`삭제 중 ${deleted + failures.length}/${targets.length}`;
      }
      renderLayout(false);
      $('#wbTrashNotice').textContent = failures.length
        ? msg`${deleted}개 삭제했습니다. ${failures.length}개는 삭제하지 못해 휴지통에 남겨두었습니다.` + '\n' + failures.join('\n')
        : msg`${deleted}개를 영구 삭제했습니다.`;
    } catch (error) { $('#wbTrashNotice').textContent = msg`삭제하지 못했습니다: ${error.message}`; }
    finally { busy = false; renderTrash(); }
  }

  async function purgeInstance(id) {
    if (busy) return;
    const item = trash.find(item => item.id === id);
    if (!item) return;
    busy = true;
    try {
      const dialog = $('#wbClose'); dialog.returnValue = ''; dialog.showModal();
      const answer = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
      if (answer !== 'close') return;
      await deleteTrashItem(item);
      renderLayout(false);
    } catch (error) { $('#wbTrashNotice').textContent = msg`삭제하지 못했습니다: ${error.message}`; }
    finally { busy = false; renderTrash(); }
  }

  async function removeProject(id) {
    if (busy) return;
    const owner = spaces.find(item => item.id === id);
    if (!owner) return;
    busy = true;
    try {
      const ids = owner.tabs.flatMap(item => layout.ids(item.layout));
      const dialog = $('#wbRemoveProject');
      $('#wbRemoveDescription').textContent = msg`${owner.name} 프로젝트를 앱 목록에서 삭제합니다.${ids.length ? msg` 연결된 터미널 ${ids.length}개와 실행 중인 프로그램도 종료됩니다.` : ''}`;
      dialog.returnValue = ''; dialog.showModal();
      const answer = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
      if (answer !== 'remove') return;
      for (const terminalId of ids) {
        await api.terminalClose(terminalId);
        removeTerminalLocally(terminalId);
      }
      await api.removeWorkspace(owner.cwd);
      spaces = spaces.filter(item => item.id !== id);
      if (selectedSpace === id) selectedSpace = spaces[0]?.id || standalone.id;
    } catch (error) { report(error); }
    finally { busy = false; renderLayout(); }
  }

  // The chat panes and the collaboration status follow the selected terminal.
  function renderChatState() {
    chat.render();
    renderCollaborationStatus();
  }
  let collaborationSync = null;
  // The screen text each pane had at the latest sync. A review that runs right
  // after that sync uses it instead of extracting up to 400 rows again.
  const syncedScreens = new Map();
  const SYNCED_SCREEN_MS = 400;
  function reviewScreen(id, session) {
    const synced = syncedScreens.get(id);
    return synced && synced.creationId === session.creationId && performance.now() - synced.at < SYNCED_SCREEN_MS
      ? synced.text : terminal.readTerminal(id);
  }
  function syncCollaboration() {
    if (collaborationSync) return collaborationSync;
    collaborationSync = syncCollaborationNow().finally(() => { collaborationSync = null; });
    return collaborationSync;
  }
  async function syncCollaborationNow() {
    if (!api.terminalCollaboration) return;
    const capturedFrames = [];
    let sliceStarted = performance.now();
    for (const id of [...panes.keys()]) {
      const session = sessions.get(id);
      if (!session || trashed(id) || !panes.has(id)) continue;
      capturedFrames.push({ id, creationId: session.creationId, ...terminal.readTerminalSnapshot(id) });
      // A cold screen scan can cost a frame. Let input and paints run between
      // terminals; each individual snapshot remains an atomic observation.
      if (performance.now() - sliceStarted >= 8) {
        await new Promise(resolve => setTimeout(resolve, 0));
        sliceStarted = performance.now();
      }
    }
    // The user may move, close or reconnect a pane while we yield. Send the
    // current roster, and never attach an old screen to a replacement process.
    const groups = owners().flatMap(owner => owner.tabs.filter(panel => !panel.pending).map(panel => ({ id: panel.id, name: `${owner.name} · ${panel.name}`, cwd: owner.cwd,
      members: layout.ids(panel.layout).map(id => ({ ...sessions.get(id), title: title(id) })).filter(item => item.id && !trashed(item.id)) })));
    const frames = capturedFrames.filter(frame => panes.has(frame.id) && !trashed(frame.id)
      && sessions.has(frame.id) && sessions.get(frame.id).creationId === frame.creationId);
    for (const frame of frames) syncedScreens.set(frame.id, { creationId: frame.creationId, text: frame.text, at: performance.now() });
    for (const id of syncedScreens.keys()) if (!panes.has(id)) syncedScreens.delete(id);
    // Up to 24 KB of screen text per pane: resend it only when it changed (or
    // on the tracker's freshness beat); an unchanged pane sends a marker.
    const delta = collaborationFrames?.prepare(frames, new Map(frames.map(frame => [frame.id, `${sessions.get(frame.id)?.pid ?? ''}`])));
    const result = await api.terminalCollaboration({ operation: 'sync', groups, frames: delta ? delta.frames : frames, chatJobs: chat.pendingJobs() });
    delta?.commit();
    workStates.clear(); aiMembers.clear();
    let usageChanged = false;
    for (const id of acknowledgedCompletions.keys()) if (!sessions.has(id) || trashed(id)) acknowledgedCompletions.delete(id);
    for (const panel of result.panels || []) for (const member of panel.members || []) {
      aiMembers.set(member.id, { ...member, observedAt: Date.now() });
      if (member.activity) {
        workStates.set(member.id, { ...member.activity, observedAt: Date.now() });
        if (member.activity.state === 'working') markUsed(member.id);
        usageChanged = rememberTerminalUsage(member.id, member.activity) || usageChanged;
      }
    }
    if (usageChanged) save();
    refreshPaneChrome(); renderInstances();
    collaborationJobs = result.jobs || [];
    chat.observe(collaborationJobs);
    for (const job of collaborationJobs) {
      if (collaborationLoaded && job.state === 'completed' && collaborationStates.get(job.id) !== 'completed') {
        collaborationNotices.set(job.id, Date.now() + 7000);
        setTimeout(renderCollaborationStatus, 7100);
      }
      collaborationStates.set(job.id, job.state);
    }
    pruneCollaborationRecords();
    collaborationLoaded = true;
    for (const job of collaborationJobs) {
      if (job.terminal && !handledCollaborations.has(`new:${job.id}`)) {
        const owner = panelOwner(job.groupId);
        const panel = owner?.tabs.find(item => item.id === job.groupId);
        const live = await api.terminalGet(job.terminal.id, false);
        if (panel && live && live.creationId === job.terminal.creationId) {
          if (!owner.tabs.some(item => layout.ids(item.layout).includes(live.id))) {
            detachFromLayout(live.id);
            rememberSession(live); await ensurePane(live);
            const target = panel.activePane || layout.ids(panel.layout)[0], view = panel.viewLayout || panel.layout;
            panel.layout = layout.split(panel.layout, target, live.id);
            panel.viewLayout = layout.split(view, layout.ids(view).includes(target) ? target : layout.ids(view)[0], live.id);
            if (owner.activeTab === panel.id) owner.viewLayout = panel.viewLayout;
            if (tab()?.id === panel.id) renderLayout(false); else { renderNav(); renderInstances(); }
          }
          handledCollaborations.add(`new:${job.id}`); save();
        }
      }
      if (job.request && job.sentAt && ['running', 'completed'].includes(job.state) && !handledCollaborations.has(job.id) && sessions.has(job.targetId)) {
        submissions.set(job.targetId, { id: job.id, request: job.request, at: job.sentAt, stamps: { [job.provider]: job.stamp } });
        handledCollaborations.add(job.id); save();
      }
    }
    renderCollaborationStatus();
    if ($('#wbError').dataset.scope === 'collaboration') $('#wbError').hidden = true;
  }
  // Job bookkeeping otherwise grows for the app's lifetime. Expired notices
  // are inert; states and handled ids of jobs main no longer reports are kept
  // up to a bound (save() already persists only the newest 200 handled ids).
  const COLLABORATION_RECORD_LIMIT = 200;
  function pruneCollaborationRecords(now = Date.now()) {
    const current = new Set(collaborationJobs.map(job => job.id));
    for (const [id, until] of collaborationNotices) if (until <= now) collaborationNotices.delete(id);
    for (const id of collaborationStates.keys()) {
      if (collaborationStates.size <= COLLABORATION_RECORD_LIMIT) break;
      if (!current.has(id)) collaborationStates.delete(id);
    }
    for (const key of handledCollaborations) {
      if (handledCollaborations.size <= COLLABORATION_RECORD_LIMIT) break;
      if (!current.has(key.startsWith('new:') ? key.slice(4) : key)) handledCollaborations.delete(key);
    }
  }
  function renderCollaborationStatus() {
    const related = collaborationJobs.filter(job => job.operation !== 'chat' && (job.sourceId === activeId() || job.targetId === activeId()));
    // Only deliveries in progress show at the top. A failed or interrupted one
    // is reported to the AI that asked, so it does not stay above the screen.
    const jobs = related.filter(job => !['failed', 'interrupted'].includes(job.state)
      && (job.state !== 'completed' || (collaborationNotices.get(job.id) || 0) > Date.now())).slice(-3);
    const status = $('#wbCollaborationStatus'); status.hidden = !jobs.length;
    const labels = { queued: t('전달 대기'), starting: t('시작 중…'), sending: t('전달 중'), running: t('상대 답변 대기'), completed: t('응답 도착'), failed: t('전달 실패'), interrupted: t('확인 필요') };
    const markup = job => `<div><strong>${esc(job.terminal && job.state === 'completed' ? t('새 터미널 열림') : labels[job.state] || job.state)}</strong><span>${esc((job.targetId || '').slice(-5))} · ${esc(job.request || t('새 터미널'))}</span>${job.error ? `<small>${esc(job.error)}</small>` : ''}</div>`;
    status.innerHTML = jobs.map(markup).join('');
  }
  function captureReviews(force = false, manualTarget = null) {
    if (!api.terminalReview) return Promise.resolve();
    // A manual refresh must observe its selected terminal after an in-flight
    // background observation, rather than silently dropping the request.
    if (reviewBusy) return force ? reviewTask.then(() => captureReviews(true, manualTarget)) : reviewTask;
    reviewTask = captureReviewsNow(force, manualTarget);
    return reviewTask;
  }
  async function captureReviewsNow(force, manualTarget) {
    reviewBusy = true;
    try {
      try { await syncCollaboration(); } catch (error) {
        $('#wbCollaborationStatus').hidden = false;
        $('#wbCollaborationStatus').textContent = `${t('협업 연결 확인 필요')}: ${String(error.message || error)}`;
      }
      const ids = manualTarget ? [manualTarget.id] : force ? [activeId()] : [...panes.keys()];
      for (const id of ids) {
        const session = sessions.get(id);
        if (!session || trashed(id) || session.status !== 'running') continue;
        if (manualTarget && session.creationId !== manualTarget.creationId) continue;
        if (!session.creationId) {
          reviews.set(id, { state: 'unbound', message: t('이전 터미널에는 검토 연결 식별자가 없습니다. 새 터미널을 열면 이해·검토가 연결됩니다.') });
          continue;
        }
        let result;
        // Record-only: the request and the observed facts name the terminal; no model is called.
        try { result = await api.terminalReview({ id, creationId: session.creationId, text: reviewScreen(id, session), enabled: true, force: false, reanalyze: false, foreground: id === activeId(), submission: submissions.get(id), interruption: interruptions.get(id), analysis: { recordOnly: true, locale: window.WhiteboxI18n?.getLocale() || 'ko' } });
        } catch (error) {
          if (sessions.get(id)?.creationId === session.creationId) reviews.set(id, { ...reviews.get(id), state: 'error', message: String(error.message || error) });
          continue;
        }
        if (sessions.get(id)?.creationId !== session.creationId || trashed(id) || !acceptReview(id, result)) continue;
        const history = retainReview(session, result);
        reviews.set(id, history ? { ...result, result: history.result, restored: !result.result } : result);
        const pane = panes.get(id);
        if (pane) pane.node.querySelector('.wb-pane-title').textContent = title(id);
      }
      refreshPaneChrome();
      renderPaneTabs();
      renderChatState();
      renderInstances();
    } catch (error) {
      if (activeId()) reviews.set(activeId(), { ...reviews.get(activeId()), state: 'error', message: String(error.message || error) });
      renderChatState();
    } finally { reviewBusy = false; }
  }
  async function act(action) {
    if (action === 'settings-font-smaller' || action === 'settings-font-larger') {
      $('#wbFont').value = fontSize + (action === 'settings-font-smaller' ? -1 : 1);
      $('#wbFont').dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (action === 'dismiss-error') $('#wbError').hidden = true;
    if (action === 'toggle-sidebar') root.classList.toggle('sidebar-hidden');

    if (action === 'new') return createTerminal();
    if (action === 'new-independent') return createTerminal('', standalone);
    if (action === 'new-panel') return createTerminal('');
    if (action === 'detach-panel') {
      const panel = panelFor(arrangingId);
      if (panel) moveTerminal(arrangingId, { ownerId: panelOwner(panel.id).id });
      $('#wbArrange').close();
    }
    if (action === 'join-panel') {
      const panelId = $('#wbMoveTarget').value;
      if (!panelId.startsWith('owner:')) moveTerminal(arrangingId, { panelId, direction: $('#wbMoveDirection').value, join: true, chosen: true });
      $('#wbArrange').close();
    }
    if (action === 'archive-arranged') { $('#wbArrange').close(); return trashInstance(arrangingId); }
    if (action === 'move-terminal') {
      const value = $('#wbMoveTarget').value;
      if (value.startsWith('owner:')) moveTerminal(arrangingId, { ownerId: value.slice(6) });
      else moveTerminal(arrangingId, { panelId: value, direction: $('#wbMoveDirection').value, chosen: true });
      $('#wbArrange').close();
    }
    if (action === 'split' || action === 'split-down') return createTerminal(action === 'split' ? 'row' : 'column');
    if (action === 'workspace') {
      const result = await api.addWorkspaces();
      if (result.canceled || !result.selected) return;
      let found = spaces.find(item => item.cwd === result.selected.path);
      if (!found) { found = { id: uuid(), name: result.selected.name, cwd: result.selected.path, tabs: [], activeTab: '', nextNumber: 1 }; spaces.push(found); }
      selectedSpace = found.id; renderLayout();
      if (!found.tabs.length) await createTerminal();
    }
    if (action === 'expand') {
      expanded = !expanded; root.classList.toggle('terminal-expanded', expanded);
      renderLayout();
    }
    if (action === 'trash') {
      renderTrash(true); $('#wbTrashNotice').textContent = ''; $('#wbTrash').showModal();
      for (const item of trash) {
        if (!trashSession(item)) continue;
        const review = await api.terminalReview?.({ id: item.id, creationId: item.creationId, enabled: false });
        if (review?.provider) { item.provider = review.provider; item.providerPid = review.providerPid; }
      }
      save(); renderTrash();
    }
    if (action === 'next-review') return openNextReview();
    if (action === 'clean-stale') return cleanStaleTerminals();
    if (action === 'trash-empty') return emptyTrash();
    if (action === 'trash-close') $('#wbTrash').close();
    if (action === 'settings') openSettings();
    if (action === 'update-settings') openSettings();
    if (action === 'update-check') return runUpdateAction('check');
    if (action === 'update-install') return runUpdateAction('install');
    if (action === 'update-release') {
      try { await api.openUpdateRelease(); } catch (error) { updateActionError = String(error.message || error); renderUpdates(); }
    }
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    // A panel's name line opens its selected terminal and shows its "+ 터미널".
    const head = !button && event.target.closest('[data-panel-head]');
    if (head) {
      const owner = panelOwner(head.dataset.panelHead), panel = owner?.tabs.find(item => item.id === head.dataset.panelHead);
      const id = panel && (layout.ids(panel.layout).includes(panel.activePane) ? panel.activePane : layout.ids(panel.layout)[0]);
      if (id) showTerminalAlone(id);
      return;
    }
    if (!button) return;
    if (button.dataset.backgroundTerminal) openBackgroundPopover(button.dataset.backgroundTerminal);
    if (button.dataset.panelColor) { if (colorPickerPanel === button.dataset.panelColor) closeColorPicker(); else openColorPicker(button.dataset.panelColor, button); return; }
    if (button.hasAttribute('data-close-background')) closeBackgroundPopover(true);
    if (button.dataset.action) act(button.dataset.action).catch(report);
    if (button.dataset.space) { selectedSpace = button.dataset.space; space().collapsed = false; renderLayout(); acknowledgeCompletion(activeId()); }
    if (button.dataset.paneTab) { acknowledgeCompletion(button.dataset.paneTab); selectPane(button.dataset.paneTab, true); }
    if (button.dataset.soloTerminal) { acknowledgeCompletion(button.dataset.soloTerminal); showTerminalAlone(button.dataset.soloTerminal); }
    if (button.dataset.toggleProject) {
      const project = spaces.find(item => item.id === button.dataset.toggleProject);
      if (project) { project.collapsed = !project.collapsed; renderInstances(); save(); }
    }
    if (button.dataset.expandTerminal) { acknowledgeCompletion(button.dataset.expandTerminal); selectPane(button.dataset.expandTerminal); act('expand').catch(report); }
    // A terminal in the sidebar shows that terminal alone; its group brings the split back.
    if (button.dataset.instance) { acknowledgeCompletion(button.dataset.instance); showTerminalAlone(button.dataset.instance); }
    if (button.dataset.togglePanel) {
      const owner = panelOwner(button.dataset.togglePanel);
      const panel = owner?.tabs.find(item => item.id === button.dataset.togglePanel);
      if (panel) {
        panel.collapsed = !panel.collapsed;
        renderInstances(); save();
      }
    }
    if (button.dataset.selectPanel) { selectPanel(button.dataset.selectPanel); acknowledgeCompletion(activeId()); }
    if (button.dataset.retryTerminal) {
      const id = button.dataset.retryTerminal, pane = panes.get(id);
      if (pane?.error && sessions.has(id)) {
        panes.delete(id); pane.node.remove();
        const mounted = ensurePane(sessions.get(id));
        renderLayout(false); mounted.then(() => { if ($('#wbError').dataset.connection === 'true') $('#wbError').hidden = true; }).catch(report);
      }
    }
    if (button.dataset.newPanel) createTerminal('', owners().find(item => item.id === button.dataset.newPanel)).catch(report);
    if (button.dataset.addPanelTerminal) {
      const owner = panelOwner(button.dataset.addPanelTerminal);
      if (owner) createTerminal('row', owner, button.dataset.addPanelTerminal).catch(report);
    }
    if (button.dataset.arrangeInstance) openArrange(button.dataset.arrangeInstance);
    if (button.dataset.newProject) createTerminal('', spaces.find(item => item.id === button.dataset.newProject)).catch(report);
    if (button.dataset.removeProject) removeProject(button.dataset.removeProject).catch(report);
    if (button.dataset.hideTerminal) hideInstance(button.dataset.hideTerminal);
    // The sidebar trash icon archives: the session stops and its output and
    // review records stay restorable from the trash.
    if (button.dataset.trashTerminal) trashInstance(button.dataset.trashTerminal).catch(report);
    if (button.dataset.restoreInstance) restoreInstance(button.dataset.restoreInstance).catch(report);
    if (button.dataset.purgeInstance) purgeInstance(button.dataset.purgeInstance).catch(report);
  });
  // Understand · Review is gone; the workspace has no review column.
  root.classList.add('review-hidden');
  $('#wbTabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const ids = layout.ids(canvasLayout()), current = ids.indexOf(activeId());
    if (!ids.length) return;
    selectPane(ids[(current + (event.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]);
    $('#wbTabs [aria-selected="true"]')?.focus();
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey || root.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    if (key === 'k') { event.preventDefault(); event.stopImmediatePropagation(); root.classList.remove('sidebar-hidden'); $('#wbProjectSearch').focus(); return; }
    let action = '';
    if (key === 't') action = 'new';
    if (key === 'd') action = event.shiftKey ? 'split-down' : 'split';
    if (action) { event.preventDefault(); event.stopImmediatePropagation(); act(action).catch(report); return; }
    if (/^[1-9]$/u.test(key) && layout.ids(canvasLayout())[Number(key) - 1]) {
      event.preventDefault(); event.stopImmediatePropagation(); selectPane(layout.ids(canvasLayout())[Number(key) - 1], true);
    }
    if (event.shiftKey && ['BracketLeft', 'BracketRight'].includes(event.code)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const ids = layout.ids(canvasLayout()), current = ids.indexOf(activeId());
      if (ids.length) selectPane(ids[(current + (event.code === 'BracketRight' ? 1 : ids.length - 1)) % ids.length], true);
    }
  }, true);
  $('#wbLanguage').value = window.WhiteboxI18n?.getLocale() || 'ko';
  $('#wbLanguage').addEventListener('change', async event => {
    const locale = event.target.value;
    window.WhiteboxI18n.setLocale(locale);
    await api.setLocale?.(locale);
    save(); flushSave(); window.location.reload();
  });
  $('#wbFont').addEventListener('change', event => {
    fontSize = Math.max(11, Math.min(24, Number(event.target.value) || 14)); event.target.value = fontSize;
    panes.forEach(pane => pane.dispose?.setFontSize?.(fontSize)); renderFontPreview(); save();
  });
  $('#wbFontFamily').addEventListener('change', event => {
    fontFamily = event.target.value;
    panes.forEach(pane => pane.dispose?.setFontFamily?.(fontFamily)); renderFontPreview(); save();
  });
  $('#wbUiFont').addEventListener('change', event => {
    uiFont = ['pretendard', 'system', 'geist'].includes(event.target.value) ? event.target.value : 'pretendard';
    applyUiFont(); save();
  });

  let initialization = null, initialized = false, waitingForStartupHost = false, connectionRevision = 0;
  function handleTerminalState(payload) {
    let usageChanged = false;
    const removed = payload.change === 'removed' && payload.session;
    // Archived records remain available when their host session disappears;
    // explicit trash deletion removes those separately after acknowledgement.
    if (removed && sessions.get(removed.id)?.creationId === removed.creationId
      && !trash.some(item => item.id === removed.id && item.creationId === removed.creationId)
      && !(payload.sessions || []).some(item => item.id === removed.id)) {
      removeTerminalLocally(removed.id);
      renderLayout(false); renderTrash();
    }
    for (const session of payload.sessions || []) {
      if (!sessions.has(session.id)) continue;
      if (rememberSession(session) !== session) continue;
      const usage = terminalUsageHistory.get(session.id);
      if (usage && (usage.creationId !== session.creationId || session.pid && usage.pid !== session.pid)) {
        terminalUsageHistory.delete(session.id); usageChanged = true;
      }
    }
    if (usageChanged) save();
    refreshPaneChrome();
    renderInstances();
  }
  api?.onTerminalState?.(handleTerminalState);
  // Register before the first inventory request. A late real connection must
  // resume a cold renderer that already exhausted its bounded initial reads.
  api?.onTerminalConnection?.(value => {
    $('#wbConnection').textContent = value.state === 'connected' ? t('셸 연결됨') : t('셸 다시 연결 중…');
    if (value.state !== 'connected') return;
    connectionRevision++;
    if (!initialized) {
      if (waitingForStartupHost && !initialization) initializeWorkspace();
      return;
    }
    const mountedIds = [...panes.keys()];
    for (const [id, pane] of panes) { pane.dispose?.(); pane.node.remove(); panes.delete(id); }
    Promise.all(mountedIds.map(id => sessions.get(id)).filter(session => session && !trashed(session.id)).map(session => ensurePane(session)))
      .then(() => renderLayout()).catch(report);
  });
  function initializeWorkspace() {
    if (initialization || initialized) return initialization;
    const observedConnection = connectionRevision;
    waitingForStartupHost = false;
    initialization = init().catch(error => report(error, 'startup')).finally(() => {
      initialization = null;
      if (!initialized && waitingForStartupHost && connectionRevision > observedConnection) initializeWorkspace();
    });
    return initialization;
  }
  // Re-reads running shells whose PID is still unknown. ConPTY publishes the
  // PID only with the first output, as a single state event.
  async function reconcileMissingPids() {
    await Promise.all([...sessions.values()].filter(session => session.status === 'running' && !session.pid).map(async session => {
      const current = await api.terminalGet(session.id, false);
      if (current?.creationId === session.creationId && sessions.get(session.id)?.creationId === session.creationId) rememberSession(current);
    }));
  }
  async function init() {
    if (!api) throw new Error(t('Whitebox 앱에서 실행해 주세요.'));
    bootstrap = await window.WhiteboxRendererUtils.bootstrap();
    if (!updateEventSeen) receiveUpdate(window.WhiteboxRendererUtils.latestUpdateState?.() || bootstrap.update);
    renderUpdates();
    attentionSettings.loadAttentionPopupSettings(bootstrap.attentionPopups);
    attentionSettings.renderAttentionPopupSettings();
    attentionSettings.bindAttentionPopupSettings();
    // A freshly staged packaged daemon may still be starting when the first
    // bounded connection attempt ends. Resume initialization after a real
    // connection; never turn a failed inventory read into an empty workspace.
    let inventory;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        inventory = await api.terminalList();
        break;
      } catch (error) {
        if (attempt === 2) { waitingForStartupHost = true; throw error; }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    inventory.filter(item => !item.transient && ['shell', 'powershell', 'cmd'].includes(item.type)).forEach(item => rememberSession(item));
    // A state event can precede the initial inventory response. Reconcile only
    // unresolved shells after adopting that inventory.
    try { await reconcileMissingPids(); }
    catch (error) { waitingForStartupHost = true; throw error; }
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { /* Recover with the live PTY inventory. */ }
    for (const id of saved.handledCollaborations || []) if (typeof id === 'string') handledCollaborations.add(id);
    fontSize = Math.max(11, Math.min(24, Number(saved.fontSize) || 14));
    if ([...$('#wbFontFamily').options].some(option => option.value === saved.fontFamily)) fontFamily = saved.fontFamily;
    $('#wbFontFamily').value = fontFamily;
    renderSettingsTheme(); renderFontPreview();
    uiFont = ['pretendard', 'system', 'geist'].includes(saved.uiFont) ? saved.uiFont : 'pretendard';
    $('#wbUiFont').value = uiFont; applyUiFont();
    const trashIds = new Set();
    trash = (Array.isArray(saved.trash) ? saved.trash : []).filter(item => {
      if (!item || typeof item.id !== 'string' || typeof item.cwd !== 'string' || !item.cwd || trashIds.has(item.id)) return false;
      trashIds.add(item.id); return true;
    });
    for (const record of [...(Array.isArray(saved.reviewHistory) ? saved.reviewHistory : []), ...trash.map(item => item.review)]) {
      if (!record || typeof record.id !== 'string' || !Array.isArray(record.result?.tasks)
        || !record.result.tasks.every(task => task && typeof task === 'object')
        || !(sessions.has(record.id) || trash.some(item => item.id === record.id && item.creationId === record.creationId))) continue;
      const tasks = record.result.tasks.filter(task => !window.WhiteboxTerminalReviewTurns.isNonTaskRequest(task.request));
      const removedNonTasks = tasks.length !== record.result.tasks.length;
      record.result = { ...record.result, tasks: tasks.slice(-12).map(task => Object.hasOwn(task, 'analysisUsage') ? task : {
        ...task, analysisUsage: task.observedAt && task.observedAt === record.result.observedAt ? record.result.usage ?? null : null
      }) };
      if (removedNonTasks) record.digest = JSON.stringify(record.result);
      reviewHistory.set(record.id, record);
      const session = sessions.get(record.id);
      if (savedReview(session)) reviews.set(record.id, { state: session.status === 'stopped' ? 'archived' : 'watching', provider: record.provider, providerPid: record.providerPid, result: record.result, restored: true });
    }
    for (const record of (Array.isArray(saved.terminalUsageHistory) ? saved.terminalUsageHistory : []).slice(-6400)) {
      const session = sessions.get(record?.id);
      if (session && record.creationId === session.creationId && validTerminalUsage(record.usage)
        && (record.pid === session.pid || stoppedArchiveSession(session))) terminalUsageHistory.set(record.id, record);
    }
    for (const record of (Array.isArray(saved.lastUsed) ? saved.lastUsed : []).slice(-6400)) {
      if (record && typeof record.id === 'string' && Number.isFinite(record.at) && record.creationId
        && sessions.get(record.id)?.creationId === record.creationId) lastUsed.set(record.id, { id: record.id, creationId: record.creationId, at: record.at });
    }
    const archivedIds = new Set(trash.filter(trashSession).map(item => item.id));
    const available = new Set([...sessions.keys()].filter(id => !archivedIds.has(id))), seen = new Set(archivedIds);
    // The auto-created first workspace used the home folder, where Claude never
    // remembers folder trust. Move only that default entry to the trusted default folder.
    const { defaultCwd, homeCwd } = bootstrap.terminalWorkspace || {};
    const migrateDefaultSpace = item => defaultCwd && homeCwd && defaultCwd !== homeCwd && item.cwd === homeCwd
      && ['내 작업 공간', 'My workspace', '我的工作区'].includes(item.name) ? { ...item, cwd: defaultCwd } : item;
    spaces = (Array.isArray(saved.spaces) ? saved.spaces : []).filter(item => typeof item.cwd === 'string' && item.cwd).slice(0, 100).map(migrateDefaultSpace).map(item => {
      const tabs = (Array.isArray(item.tabs) ? item.tabs : []).map(item => ({ ...item, layout: layout.restore(item.layout, available, seen) })).filter(item => item.layout);
      return { ...item, tabs, nextNumber: Math.max(1, Number(item.nextNumber) || tabs.length + 1), activeTab: tabs.some(tab => tab.id === item.activeTab) ? item.activeTab : tabs[0]?.id || '' };
    });
    chat.restore(saved.chatModes);
    groups.restore(saved.groups);
    const savedStandalone = saved.standalone || {};
    const independentTabs = (Array.isArray(savedStandalone.tabs) ? savedStandalone.tabs : []).map(item => ({ ...item, layout: layout.restore(item.layout, available, seen) })).filter(item => item.layout);
    standalone = { id: 'standalone', standalone: true, name: t('독립 패널'), cwd: bootstrap.terminalWorkspace?.defaultCwd || '.',
      viewLayout: savedStandalone.viewLayout, activeSurface: savedStandalone.activeSurface, canvasHidden: savedStandalone.canvasHidden === true,
      tabs: independentTabs, nextNumber: Math.max(1, Number(savedStandalone.nextNumber) || independentTabs.length + 1),
      activeTab: independentTabs.some(item => item.id === savedStandalone.activeTab) ? savedStandalone.activeTab : independentTabs[0]?.id || '' };
    for (const workspace of bootstrap.workspaces || []) {
      if (!spaces.some(item => item.cwd === workspace.path)) spaces.push({ id: uuid(), cwd: workspace.path, name: workspace.name || base(workspace.path), tabs: [], activeTab: '', nextNumber: 1 });
    }
    for (const session of sessions.values()) {
      if (seen.has(session.id)) continue;
      const owner = standalone;
      const item = { id: uuid(), name: t('패널'), layout: { id: session.id }, activePane: session.id };
      owner.tabs.push(item); owner.activeTab ||= item.id;
    }
    if (!spaces.length && !Array.isArray(saved.spaces)) spaces.push({ id: uuid(), cwd: bootstrap.terminalWorkspace?.defaultCwd || '.', name: t('내 작업 공간'), tabs: [], activeTab: '', nextNumber: 1 });
    pinnedPanels = Array.isArray(saved.pinnedPanels) ? [...new Set(saved.pinnedPanels.filter(id => typeof id === 'string'))] : [];
    for (const owner of owners()) { owner.viewLayout = layout.fit(owner.viewLayout, available); for (const panel of owner.tabs) panel.viewLayout = layout.fit(panel.viewLayout, available); }
    selectedSpace = owners().some(item => item.id === saved.selectedSpace) ? saved.selectedSpace : spaces[0]?.id || standalone.id;
    // The saved canvas can intentionally show only some members of a panel.
    // Older profiles without a canvas may still recover their pinned panels.
    if (pinnedPanels.length && !space()?.viewLayout && !tab()?.viewLayout) space().viewLayout = layout.reconcile(canvasLayout(), visiblePanels().map(panel => panel.layout));
    // Hydrate visible panes first; unopened panels retain their PTYs without allocating views.
    $('#wbFont').value = fontSize;
    renderUpdates();
    $('#wbConnection').innerHTML = t('<i></i>셸 연결됨');
    renderLayout(false);
    api.onTerminalReview?.(({ id, value }) => {
      const session = sessions.get(id);
      if (!session || trashed(id) || !value || !acceptReview(id, value)) return;
      const history = retainReview(session, value);
      const task = value.result?.tasks?.at(-1);
      if (task?.analysisMetrics) { task.analysisMetrics.displayedAt = Date.now(); save(); }
      reviews.set(id, history ? { ...value, result: history.result } : value);
      refreshPaneChrome(); renderPaneTabs(); renderInstances(); renderChatState();
    });
    Promise.resolve(api.setLocale?.(window.WhiteboxI18n?.getLocale() || 'ko')).catch(error => report(error, 'locale'));
    api.onAttentionRequested?.(payload => {
      if (payload?.activationId) {
        // Automatic attention never moves focus away from the user's current work.
        if (!payload.cancelled) Promise.resolve(api.ackAttentionActivation?.({
          activationId: payload.activationId, deliveryToken: payload.deliveryToken, status: 'notified',
        })).catch(report);
        return;
      }
      openAttentionTerminal(payload);
    });
    api.onTerminalPromptResolved?.(payload => {
      const resolution = terminal.resolveAttentionPrompt?.(payload);
      if (resolution?.ok && resolution.requiresText) openAttentionTerminal(resolution);
    });
    // Tell the app (and an updater waiting on it) the workspace is up as soon
    // as it is drawn. Terminals then attach in the background: a slow replay or
    // a busy machine must not make an update look failed and roll it back.
    await api.rendererReady();
    await Promise.all(layout.ids(canvasLayout()).map(id => ensurePane(sessions.get(id))));
    if (!Array.isArray(saved.spaces) && space() && !space().tabs.length && sessions.size === 0 && trash.length === 0) await createTerminal();
    // The main process forwards terminal state only after the ready signal,
    // so a PID published while startup panes were created was dropped. Every
    // later PID event is delivered; read the earlier ones once.
    reconcileMissingPids().then(() => { refreshPaneChrome(); renderInstances(); }).catch(error => report(error, 'terminal-pid'));
    let panelSyncBusy = false;
    setInterval(() => {
      // A completed sync renders the chrome and sidebar itself; render here
      // only for time-based state while a slow sync is in flight or failed.
      const renderTimedState = () => { refreshPaneChrome(); renderInstances(); };
      if (panelSyncBusy || !api.terminalCollaboration) { renderTimedState(); return; }
      panelSyncBusy = true;
      syncCollaboration().catch(error => { renderTimedState(); report(error, 'collaboration'); }).finally(() => { panelSyncBusy = false; });
    }, 1000);
    setInterval(() => captureReviews(), 2500);
    setInterval(() => { if (reviews.get(activeId())?.state === 'reviewing' || reviews.get(activeId())?.retryAt > Date.now()) renderChatState(); }, 1000);
    window.WhiteboxWorkspace = { createTerminal, selectPane, captureReviews, trashInstance, getState: () => ({ busy, spaces, standalone, trash, selectedSpace, pinnedPanels, activeId: activeId(), sessions: [...sessions.values()] }) };
    initialized = true;
    if ($('#wbError').dataset.scope === 'startup') $('#wbError').hidden = true;
    document.title = `Whitebox ${bootstrap.versions.app}`;
  }
  initializeWorkspace();
})();
