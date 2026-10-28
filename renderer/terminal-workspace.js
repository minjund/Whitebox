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
    split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    down: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    review: '<path d="M4 6h16M4 12h10M4 18h7m4-1 2 2 4-5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  };
  const icon = name => `<svg class="wb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const uuid = () => crypto.randomUUID();
  const base = path => String(path).split(/[\\/]/u).filter(Boolean).at(-1) || path;
  let bootstrap, spaces = [], trash = [], selectedSpace = '', busy = false, reviewBusy = false;
  let fontSize = 14, autoReview = true, reviewWidth = 332, expanded = false;
  let reviewView = 'current';
  let reviewTask = null;
  let pinnedPanels = [];
  let projectQuery = '';
  let standalone = { id: 'standalone', standalone: true, name: t('독립 패널'), cwd: '.', tabs: [], activeTab: '', nextNumber: 1 };
  const owners = () => [...spaces, standalone];
  let analysisSettings = { provider: 'auto', models: { claude: '', codex: '' } };
  let modelCatalog = { claude: [], codex: [] };
  let collaborationJobs = [];
  let updateState = null, updateEventSeen = false, updateRevision = 0, updateOperation = '', updateActionError = '', announcedUpdateVersion = '';

  const handledCollaborations = new Set();
  const collaborationStates = new Map(), collaborationNotices = new Map();
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
  const workStates = new Map();
  const root = document.createElement('div');
  root.id = 'terminalWorkspace';
  root.innerHTML = msg`
    <aside class="wb-sidebar">
      <div class="wb-brand"><img src="../build/icon.png" alt=""/><strong>whitebox</strong><span>2.0</span></div>
      <div class="wb-local-workspace"><span>W</span><div><strong>내 작업 공간</strong><small>Local workspace</small></div></div>
      <label class="wb-project-search">${icon('search')}<input id="wbProjectSearch" type="search" placeholder="프로젝트 찾기" aria-label="프로젝트 찾기" autocomplete="off"/><kbd>⌘ K</kbd></label>
      <div class="wb-sidebar-scroll">
      <div class="wb-side-heading"><span>프로젝트</span><button data-action="workspace" title="프로젝트 추가" aria-label="프로젝트 추가">${icon('plus')}</button></div>
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
      <header class="wb-topbar"><div class="wb-breadcrumbs"><button data-action="toggle-sidebar" aria-label="사이드바 접기">${icon('panel')}</button><span class="wb-breadcrumb-rule"></span>${icon('folder')}<span id="wbBreadcrumbProject"></span><span class="wb-slash">/</span><strong>작업 공간</strong></div><div class="wb-top-actions"><div class="wb-layout-controls" role="group" aria-label="터미널 배치"><button data-action="layout-row" aria-label="좌우 분할">${icon('split')}</button><button data-action="layout-column" aria-label="상하 분할">${icon('down')}</button></div><button data-theme-toggle class="wb-theme-button"><span class="wb-theme-moon">${icon('moon')}</span><span class="wb-theme-sun">${icon('sun')}</span></button><button id="wbReviewToggle" data-action="toggle-review" aria-controls="wbReview" title="이해 · 검토" aria-label="이해 · 검토">${icon('review')}</button><button data-action="settings" aria-label="설정">${icon('settings')}</button></div></header>
      <div id="wbTabs" role="tablist" aria-label="이 패널의 터미널" hidden></div>
      <div id="wbError" class="wb-error" role="alert" hidden></div>
      <section id="wbCanvas" aria-label="터미널 작업 공간"></section>
      <footer class="wb-status"><span id="wbConnection"><i></i>터미널 연결 중</span><span id="wbTerminalStatus"></span><span>⌘/Ctrl T 터미널 추가 <b>·</b> ⌘/Ctrl D 분할</span></footer>
    </main>
    <aside id="wbReview" class="wb-review" aria-label="선택한 터미널 이해와 검토">
      <div id="wbReviewResize" role="separator" tabindex="0" aria-label="이해 검토 패널 너비" aria-orientation="vertical"></div>
      <header><h1>이해 · 검토</h1><button id="wbReviewAuto" data-action="auto-review" aria-pressed="true"><span>자동 분석</span><i class="wb-auto-switch" aria-hidden="true"></i></button><button class="wb-review-close" data-action="toggle-review" aria-label="닫기">${icon('close')}</button></header>
      <div id="wbReviewTarget" class="wb-review-target"></div>
      <nav id="wbReviewTabs" class="wb-review-tabs" aria-label="이해와 검토 내용"><button data-review-view="current" aria-pressed="true" class="active">이번 요청</button><button data-review-view="history" aria-pressed="false">히스토리</button></nav>
      <div id="wbReviewActivity" role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="wbCollaborationStatus" class="wb-collaboration-status" aria-live="polite" hidden></div>
      <div id="wbReviewContent" class="wb-review-content"></div>
      <footer><span id="wbReviewModel"></span><button data-action="refresh" title="지금 검토" aria-label="현재 터미널 다시 검토">${icon('refresh')} 다시 분석</button></footer>
    </aside>
    <div id="wbParking" hidden></div>
    <dialog id="wbArrange"><form method="dialog"><header><h2>패널 분리 · 화면 배치</h2><button aria-label="닫기">${icon('close')}</button></header><p>패널을 분리해도 같은 화면에서 함께 봅니다. 다른 패널은 테두리 색으로 구분합니다.</p><label>함께 볼 패널<select id="wbMoveTarget"></select></label><label>배치<select id="wbMoveDirection"><option value="right">오른쪽에 배치</option><option value="down">아래에 배치</option><option value="left">왼쪽에 배치</option><option value="up">위에 배치</option></select></label><div class="wb-dialog-actions"><button type="button" data-action="detach-panel">패널 분리</button><button type="button" data-action="join-panel">같은 패널로 묶기</button><button value="cancel">취소</button><button type="button" data-action="pin-arranged">함께 보기</button><button type="button" data-action="move-terminal">분할 배치</button></div></form></dialog>
    <dialog id="wbSettings"><form method="dialog"><header><h2>Whitebox 설정</h2><button aria-label="설정 닫기">${icon('close')}</button></header>
      <fieldset id="wbUpdateSettings" class="wb-analysis-settings"><legend>업데이트</legend>
        <p id="wbUpdateVersions"></p><p id="wbUpdateInstalledVersion" hidden></p>
        <strong id="wbUpdateStatus" role="status" aria-live="polite"></strong>
        <p>앱 시작 시와 15분마다 새 버전을 자동으로 확인합니다.</p>
        <p id="wbUpdateCheckedAt"></p><p id="wbUpdateError" role="status" hidden></p>
        <progress id="wbUpdateProgress" max="100" aria-label="업데이트 다운로드" hidden></progress>
        <div class="wb-update-actions"><button type="button" data-action="update-check">업데이트 확인</button><button type="button" data-action="update-install" hidden>업데이트 설치</button><button type="button" data-action="update-release" hidden>버전 안내 보기</button></div>
        <details id="wbUpdateNotes" hidden><summary>이번 버전의 변경 사항</summary><pre></pre></details>
      </fieldset>
      <label>언어 / Language <select id="wbLanguage"><option value="ko">한국어</option><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
      <label>터미널 글자 크기 <input id="wbFont" type="number" min="11" max="24" step="1" value="14"/></label>
      <fieldset id="wbAttentionCard" class="wb-analysis-settings"><legend>권한·질문 팝업</legend>
        <label>오른쪽 아래 응답 창 <input id="wbAttentionEnabled" type="checkbox" role="switch" aria-describedby="wbAttentionDescription wbAttentionStatus" checked/></label>
        <p id="wbAttentionDescription">AI가 권한이나 답변을 요청하면 다른 창 위에서도 바로 확인하고 응답할 수 있는 작은 창을 표시합니다.</p>
        <p id="wbAttentionStatus" role="status" aria-live="polite"></p>
      </fieldset>
      <label>자동 이해 · 검토 <input id="wbAutoReview" type="checkbox" checked/></label>
<p class="wb-budget-note">기록만으로 확인할 수 있는 작업은 AI 호출 없이 표시합니다. 해석이 필요한 결과는 변경 이유와 동작 방식을 함께 설명합니다.</p><fieldset class="wb-analysis-settings"><legend>이해·검토용 모델</legend>
        <label>분석 서비스 <select id="wbAnalysisProvider"><option value="auto">터미널과 같은 서비스</option><option value="claude">Claude</option><option value="codex">Codex</option><option value="jev">Jev · 판단 분석</option></select></label>
        <fieldset class="wb-analysis-settings" id="wbJevSettings"><legend>Jev 플러그인</legend><p>API 키를 저장한 뒤 분석 서비스에서 Jev를 선택하세요. 요청과 연결된 작업 기록을 TypeSafe에 전송해 근거 충족 여부·검증 범위 변화·복구·중복 확인을 판단합니다.</p><label>API 키 <input id="wbJevKey" type="password" autocomplete="off" placeholder="TypeSafe API key"/></label><div><button type="button" data-action="jev-save">키 저장</button><button type="button" data-action="jev-remove">연결 해제</button></div><p id="wbJevStatus" role="status"></p></fieldset>
        <label data-model-row="claude">Claude 모델 <select id="wbClaudeModel"></select></label>
        <label id="wbClaudeCustomRow" hidden>모델 ID <input id="wbClaudeCustom" type="text" maxlength="128" placeholder="모델 ID 직접 입력"/></label>
        <label data-model-row="codex">Codex 모델 <select id="wbCodexModel"></select></label>
        <label id="wbCodexCustomRow" hidden>모델 ID <input id="wbCodexCustom" type="text" maxlength="128" placeholder="모델 ID 직접 입력"/></label>
        <p>다음 분석부터 적용됩니다. 터미널에서 작업 중인 AI의 모델은 바꾸지 않습니다. 선택한 서비스의 로그인과 모델 이용 권한이 필요합니다.</p>
        <p id="wbModelNotice" role="status"></p>
      </fieldset>
      <p>작업 중에도 의미 있는 결과가 수집되면 분석합니다. 근거가 부족하면 기다리고, 같은 결과는 다시 분석하지 않습니다. 결과가 나오기 전에는 분석중 상태만 표시합니다. 고정 사용량 상한은 없으며 자동 이해·검토를 끄면 추가 호출을 멈춥니다.</p>
      <p>검토는 관찰한 출력에 대한 AI 해석입니다. 코드와 테스트를 별도로 실행해 보증하지 않으며, 화면에서 사라진 내용은 확인할 수 없을 수 있습니다.</p>
      <button type="button" data-theme-toggle>화면 테마 전환</button>
      <dl><dt>⌘/Ctrl T</dt><dd>새 터미널</dd><dt>⌘/Ctrl D</dt><dd>오른쪽 분할</dd><dt>⌘/Ctrl Shift D</dt><dd>아래 분할</dd><dt>⌘/Ctrl 1–9</dt><dd>터미널 탭 이동</dd><dt>⌘/Ctrl Shift [ / ]</dt><dd>분할 터미널 이동</dd></dl>
    </form></dialog>
    <dialog id="wbFollowup"><form method="dialog"><header><h2>다음 요청 준비</h2><button aria-label="닫기">${icon('close')}</button></header><p>내용을 확인하고 복사해 터미널에 붙여 넣으세요. 자동으로 전송하지 않습니다.</p><label for="wbFollowupText">요청 내용</label><textarea id="wbFollowupText" rows="7"></textarea><p id="wbFollowupStatus" role="status"></p><div class="wb-dialog-actions"><button type="button" data-action="copy-followup">요청 복사</button><button value="close">닫기</button></div></form></dialog>
    <dialog id="wbRemoveProject"><form method="dialog"><h2>프로젝트를 목록에서 삭제할까요?</h2><p id="wbRemoveDescription"></p><p>실제 프로젝트 폴더와 파일은 그대로 남습니다.</p><div class="wb-dialog-actions"><button value="cancel">취소</button><button value="remove" class="wb-danger">프로젝트 삭제</button></div></form></dialog>
    <dialog id="wbTrash"><header><h2>인스턴스 휴지통</h2><button data-action="trash-close" aria-label="휴지통 닫기">${icon('close')}</button></header><p>삭제한 인스턴스는 실행 상태를 유지합니다. 휴지통에 있는 동안 자동 이해·검토는 멈춥니다.</p><div id="wbTrashList"></div><p id="wbTrashNotice" role="status"></p><div class="wb-dialog-actions"><button data-action="trash-empty" class="wb-danger" disabled>휴지통 전체 삭제</button></div></dialog>
    <dialog id="wbEmptyTrash"><form method="dialog"><h2>휴지통을 비울까요?</h2><p id="wbEmptyTrashDescription"></p><div class="wb-dialog-actions"><button value="cancel">취소</button><button value="empty" class="wb-danger">전체 영구 삭제</button></div></form></dialog>
    <dialog id="wbClose"><form method="dialog"><h2>인스턴스를 영구 삭제할까요?</h2><p>실행 중인 프로그램도 종료됩니다. 삭제 후에는 이 인스턴스를 복구할 수 없습니다.</p><div><button value="cancel">취소</button><button value="close" class="wb-danger">영구 삭제</button></div></form></dialog>`;
  document.body.append(root);
  const $ = selector => root.querySelector(selector);
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
  const activeId = () => space()?.activeSurface || tab()?.activePane || '';
  const panelFor = id => owners().flatMap(owner => owner.tabs).find(panel => layout.ids(panel.layout).includes(id));
  // Each panel remembers its own screen arrangement. Explicit drag/arrange
  // operations may include other panels without changing logical membership.
  function canvasLayout(owner = space()) {
    if (!owner) return null;
    const current = owner.tabs.find(panel => panel.id === owner.activeTab);
    if (!current || current.pending) return null;
    const available = new Set(owners().flatMap(item => item.tabs.flatMap(panel => layout.ids(panel.layout))));
    const view = owner.viewLayout || current.viewLayout, present = layout.ids(view);
    owner.viewLayout = present.length && present.length === new Set(present).size && present.every(id => available.has(id))
      ? view : layout.restore(view, available) || layout.restore(current.layout, available);
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
    selectedSpace = owner.id; owner.activeTab = panel.id; panel.collapsed = false;
    owner.viewLayout = panel.viewLayout || panel.layout;
    if (id && !layout.ids(owner.viewLayout).includes(id)) owner.viewLayout = panel.layout;
    owner.activeSurface = layout.ids(owner.viewLayout).includes(id) ? id : layout.ids(panel.layout)[0] || '';
    panel.activePane = owner.activeSurface;
    expanded = false; root.classList.remove('terminal-expanded');
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
  let lastReviewKey = '';
  const DRAG_TYPE = 'application/x-whitebox-workspace-terminal';
  let draggingId = '';
  let arrangingId = '';
  let pendingCreation = null;

  function report(error, scope = 'general') {
    $('#wbError').hidden = false;
    $('#wbError').dataset.scope = scope;
    const message = String(error?.message || error).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u, '');
    $('#wbError').dataset.connection = String(/명령창.*연결|터미널.*연결/u.test(message));
    $('#wbError').innerHTML = `<span>${esc(message)}</span><button data-action="dismiss-error" aria-label="${t('닫기')}">${icon('close')}</button>`;
    console.error('terminal-workspace:', error);
  }
  function save() {
    owners().forEach(rememberCanvas);
    // A visible creation placeholder is not a terminal and must not survive reload.
    const storedOwner = owner => {
      const tabs = owner.tabs.filter(panel => !panel.pending);
      return { ...owner, tabs, activeTab: tabs.some(panel => panel.id === owner.activeTab) ? owner.activeTab : tabs[0]?.id || '' };
    };
    try { localStorage.setItem(KEY, JSON.stringify({ version: 2, spaces: spaces.map(storedOwner), standalone: storedOwner(standalone), trash, selectedSpace, pinnedPanels, fontSize, autoReview, reviewWidth, analysisSettings, handledCollaborations: [...handledCollaborations].slice(-200), reviewHistory: [...reviewHistory.values()] })); }
    catch (error) { report(error); }
  }
  function savedReview(session) {
    const record = reviewHistory.get(session?.id);
    return record?.creationId === session?.creationId && record?.pid === session?.pid ? record : null;
  }
  function retainReview(session, value) {
    if (!value?.result || !Array.isArray(value.result.tasks)) return savedReview(session);
    const previous = savedReview(session);
    const digest = JSON.stringify(value.result);
    if (previous?.digest === digest && previous.providerPid === value.providerPid) return previous;
    const sameRun = previous && previous.provider === value.provider && previous.providerPid === value.providerPid;
    const tasks = sameRun ? [...previous.result.tasks] : [];
    for (const task of value.result.tasks) {
      const index = task.taskId ? tasks.findIndex(item => item.taskId === task.taskId)
        : task.requestQuote ? tasks.findIndex(item => !item.taskId && item.requestQuote === task.requestQuote && item.analysisId === task.analysisId) : -1;
      if (index < 0) tasks.push(task);
      else {
        const runs = new Map();
        for (const candidate of [tasks[index], task]) {
          for (const run of candidate.analysisRuns || [candidate]) {
            if (run.analysisId) runs.set(run.analysisId, { analysisId: run.analysisId, observedAt: run.observedAt,
              analysisUsage: run.analysisUsage, analysisProvider: run.analysisProvider, analysisModel: run.analysisModel });
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
  function activeFocus() { terminal.focusTerminal(activeId()); }
  function title(id) {
    const session = sessions.get(id);
    const review = reviews.get(id);
    const tasks = review?.result?.tasks || savedReview(session)?.result?.tasks || [];
    const namedTask = [...tasks].reverse().find(task => !task.recordOnly && !task.deferred
      && !window.WhiteboxTerminalReviewTurns.isStartupRequest(task.request)
      && task.analysisDepth !== 'deferred' && typeof task.summary === 'string' && task.summary.trim());
    return namedTask?.summary.trim() || review?.provider || session?.title || t('터미널');
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
  function renderPaneTabs() {
    $('#wbTabs').innerHTML = layout.ids(canvasLayout()).map(id => `<button role="tab" aria-selected="${id === activeId()}" tabindex="${id === activeId() ? 0 : -1}" class="wb-tab ${id === activeId() ? 'active' : ''}" data-pane-tab="${esc(id)}" aria-controls="${esc(panes.get(id)?.node.id || '')}"><span class="wb-tab-icon">${icon('terminal')}</span><span class="wb-tab-title" title="${esc(title(id))}">${esc(title(id))}</span></button>`).join('');
  }
  function refreshPaneChrome() {
    const visiblePanels = new Set(layout.ids(canvasLayout()).map(panelFor).filter(Boolean));
    for (const [id, pane] of panes) {
      const panel = panelFor(id), separated = visiblePanels.size > 1 && visiblePanels.has(panel);
      pane.node.classList.toggle('is-separate-panel', separated);
      pane.node.style.setProperty('--wb-panel-color', panelColor(panel));
      pane.node.dataset.panelId = panel?.id || '';
      const panelBadge = pane.node.querySelector('.wb-pane-panel');
      panelBadge.hidden = true;
      panelBadge.textContent = '';
      panelBadge.removeAttribute('title');
      pane.node.querySelector('.wb-pane-title').textContent = title(id);
      pane.node.querySelector('.wb-pane-title').title = title(id);
      pane.node.setAttribute('aria-label', `${title(id)} ${t('터미널')}`);
      const expandButton = pane.node.querySelector('[data-expand-terminal]');
      expandButton.setAttribute('aria-pressed', String(expanded && id === activeId()));
      expandButton.title = expanded && id === activeId() ? t('기존 배치로 돌아가기') : t('선택한 터미널 넓게 보기');
      expandButton.setAttribute('aria-label', expandButton.title);
      const value = terminalState(id);
      const badge = pane.node.querySelector('.wb-pane-state');
      badge.innerHTML = '<i aria-hidden="true"></i>';
      badge.dataset.state = value.state;
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', value.label);
      badge.title = value.label;
    }
    if (activeId()) $('#wbTerminalStatus').innerHTML = `${esc(title(activeId()))} ${stateBadge(terminalState(activeId()))}`;
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
    // Selecting a pane changes its logical panel, without replacing the canvas.
    if (owner === space()) owner.activeTab = panel.id;
    space().activeSurface = id;
    panel.activePane = id;
    if (changed) reviewView = 'current';
    if (expanded && changed) { renderLayout(focus); return; }
    root.querySelectorAll('.wb-pane').forEach(node => node.classList.toggle('is-selected', node.dataset.terminalId === id));
    refreshPaneChrome();
    renderPaneTabs();
    renderReview();
    renderInstances();
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
    $('#wbBreadcrumbProject').textContent = space()?.name || t('내 작업 공간');
    root.querySelectorAll('.wb-layout-controls button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.action === `layout-${canvasLayout()?.axis || 'row'}`)));
    renderInstances();
    renderTrash();
    refreshPaneChrome();
    renderPaneTabs();
  }

  function instanceRows(owner) {
    return owner.tabs.map(item => {
      const ids = layout.ids(item.layout), visible = selectedSpace === owner.id && owner.activeTab === item.id;
      return msg`<section class="wb-panel-group ${visible ? 'active' : ''}" style="--wb-panel-color:${panelColor(item)}" data-drop-panel="${esc(item.id)}" role="group" aria-label="패널" ${item.pending ? 'aria-busy="true"' : ''}><div class="wb-panel-members" id="wbMembers-${esc(item.id)}">${item.pending ? '<div class="wb-panel-pending" role="status">터미널 연결 중…</div>' : ''}${ids.map(id => {
        const value = terminalState(id);
        return msg`<div class="wb-instance-row"><button class="wb-instance ${id === activeId() ? 'active' : ''}" data-instance="${esc(id)}" data-drag-terminal="${esc(id)}" draggable="true" aria-current="${id === activeId()}" title="${esc(title(id))} · ${esc(value.label)}"><span class="wb-terminal-icon">${icon('terminal')}</span><span class="wb-instance-copy"><strong>${esc(title(id))}</strong>${stateBadge(value)}</span></button><button data-trash-instance="${esc(id)}" class="wb-trash-instance" title="휴지통으로 이동" aria-label="${esc(title(id))} ${t('휴지통으로 이동')}">${icon('trash')}</button></div>`;
      }).join('')}</div><button class="wb-panel-add" data-add-panel-terminal="${esc(item.id)}" aria-label="이 패널에 터미널 추가" ${busy ? 'disabled' : ''}>${icon('plus')}<span>${pendingCreation?.panelId === item.id ? t('생성 중…') : t('터미널 추가')}</span></button></section>`;
    }).join('') + msg`<button class="wb-new-panel-drop" data-drop-owner="${esc(owner.id)}" data-new-panel="${esc(owner.id)}" ${busy ? 'disabled' : ''}>${icon('panel')} <span>패널 추가</span>${icon('plus')}<small>여기로 끌어 분리</small></button>`;
  }
  let lastProjectsMarkup = '', lastInstancesMarkup = '';
  function renderInstances() {
    if (draggingId) return; // Keep the native drag source and drop targets attached during polling.
    const matchingProjects = spaces.filter(item => !projectQuery || [item.name, item.cwd, ...item.tabs.flatMap(panel => layout.ids(panel.layout).map(title))].some(value => String(value).toLocaleLowerCase().includes(projectQuery)));
    const projectsMarkup = matchingProjects.map(item => msg`<section class="wb-project"><div class="wb-space-row"><button class="wb-project-toggle" data-toggle-project="${esc(item.id)}" aria-expanded="${!item.collapsed}" aria-label="${esc(item.name)} ${t('프로젝트 펼치기·접기')}">${icon('chevron')}</button><button class="wb-space ${item.id === selectedSpace ? 'active' : ''}" data-space="${esc(item.id)}" title="${esc(item.cwd)}"><span class="wb-space-icon">${icon('folder')}</span><span><strong>${esc(item.name)}</strong></span></button><button class="wb-remove-project" data-remove-project="${esc(item.id)}" title="프로젝트 목록에서 삭제" aria-label="${esc(item.name)} 프로젝트 삭제">${icon('trash')}</button></div><div class="wb-project-terminals" data-project-terminals="${esc(item.id)}" ${item.collapsed ? 'hidden' : ''}>${instanceRows(item)}</div></section>`).join('');
    const independentMarkup = instanceRows(standalone) || t('<p class="wb-no-instances">프로젝트 없는 세션이 여기에 표시됩니다.</p>');
    if (projectsMarkup !== lastProjectsMarkup) { $('#wbSpaces').innerHTML = projectsMarkup; lastProjectsMarkup = projectsMarkup; }
    if (independentMarkup !== lastInstancesMarkup) { $('#wbInstances').innerHTML = independentMarkup; lastInstancesMarkup = independentMarkup; }
  }

  $('#wbProjectSearch').addEventListener('input', event => { projectQuery = event.target.value.trim().toLocaleLowerCase(); renderInstances(); });

  function selectInstance(id) {
    const owner = owners().find(item => item.tabs.some(tab => layout.ids(tab.layout).includes(id)));
    const target = owner?.tabs.find(item => layout.ids(item.layout).includes(id));
    if (!target) return;
    activatePanel(owner, target, id);
    renderLayout();
  }

  function panelOwner(panelId) { return owners().find(owner => owner.tabs.some(item => item.id === panelId)); }
  function selectPanel(panelId) {
    const owner = panelOwner(panelId);
    if (!owner) return;
    activatePanel(owner, owner.tabs.find(item => item.id === panelId));
    renderLayout();
  }
  function moveTerminal(id, { panelId, targetId, ownerId, direction = 'right', join = false }) {
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
      destination.layout = layout.split(destination.layout, targetId, id,
        ['up', 'down'].includes(direction) ? 'column' : 'row', ['left', 'up'].includes(direction));
      destination.activePane = id; destination.collapsed = false; owner.activeTab = destination.id;
    } else if (!destination) {
      const next = { id: uuid(), name: t('패널'), layout: { id }, activePane: id };
      owner.tabs.push(next); owner.activeTab = next.id;
    }
    sourceOwner.viewLayout = sourceView;
    if (destination) {
      owner.viewLayout = layout.split(layout.remove(destinationView, id), targetId, id,
        ['up', 'down'].includes(direction) ? 'column' : 'row', ['left', 'up'].includes(direction));
    } else owner.viewLayout = sourceOwner === owner ? sourceView
      : layout.reconcile(destinationView, [{ id }], new Set([...layout.ids(destinationView), id]));
    rememberCanvas(owner);
    owner.activeSurface = id;
    selectedSpace = owner.id; owner.collapsed = false;
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
    draggingId = ''; clearDrop(); root.classList.remove('is-dragging-terminal'); renderInstances();
  }
  function dropTarget(event) {
    const target = event.target.closest('[data-drop-owner], [data-drop-panel], #wbCanvas .wb-pane');
    if (!target) return null;
    if (target.dataset.dropOwner) return { node: target, ownerId: target.dataset.dropOwner, direction: 'new' };
    if (target.dataset.dropPanel) return { node: target, panelId: target.dataset.dropPanel, direction: 'right' };
    if (target.dataset.terminalId === draggingId) return null;
    const bounds = target.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width, y = (event.clientY - bounds.top) / bounds.height;
    const direction = y < .25 ? 'up' : y > .75 ? 'down' : x < .5 ? 'left' : 'right';
    return { node: target, panelId: tab()?.id, targetId: target.dataset.terminalId, direction };
  }
  root.addEventListener('dragstart', event => {
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
    target.node.dataset.dropDirection = target.direction;
    target.node.dataset.dropLabel = t({ new: '새 패널로 분리', left: '왼쪽에 배치', right: '오른쪽에 배치', up: '위에 배치', down: '아래에 배치' }[target.direction]);
  });
  root.addEventListener('dragleave', event => { if (!event.target.contains(event.relatedTarget)) clearDrop(); });
  root.addEventListener('drop', event => {
    if (!draggingId || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    const target = dropTarget(event), id = event.dataTransfer.getData(DRAG_TYPE);
    event.preventDefault(); event.stopPropagation();
    const valid = id === draggingId; finishDrag();
    if (valid && target) moveTerminal(id, target);
  });
  root.addEventListener('dragend', finishDrag);
  window.addEventListener('blur', () => { if (draggingId) finishDrag(); });

  async function ensurePane(session, restoring = false) {
    let pane = panes.get(session.id);
    if (pane) return pane.promise || pane;
    const node = document.createElement('section');
    node.className = 'wb-pane';
    node.id = `wbPane-${session.id}`;
    node.dataset.terminalId = session.id;
    node.setAttribute('aria-label', msg`${session.title} 터미널`);
    node.innerHTML = msg`<header data-drag-terminal="${esc(session.id)}" draggable="true"><span class="wb-pane-title"></span><span class="wb-pane-panel" hidden></span><span class="wb-pane-state"></span><button data-expand-terminal="${esc(session.id)}" title="선택한 터미널 넓게 보기" aria-label="선택한 터미널 넓게 보기">${icon('expand')}</button><button data-arrange-instance="${esc(session.id)}" title="패널 분리 · 화면 배치" aria-label="패널 분리 · 화면 배치">${icon('panel')}</button><button data-trash-instance="${esc(session.id)}" title="휴지통으로 이동" aria-label="이 인스턴스를 휴지통으로 이동">${icon('close')}</button></header><div class="wb-terminal-mount"></div>`;
    node.querySelector('.wb-pane-title').textContent = title(session.id);
    $('#wbParking').append(node);
    pane = { node, dispose: null, promise: null, loading: true, error: false };
    panes.set(session.id, pane);
    node.addEventListener('pointerdown', () => selectPane(session.id));
    pane.promise = terminal.mountTerminal(session.id, node.querySelector('.wb-terminal-mount'), {
      requireSessionIdentity: restoring ? { creationId: session.creationId, pid: session.pid } : null,
      onUserInput: data => {
        if (autoReview && !trashed(session.id) && ['awaiting-answer', 'collecting', 'reviewing'].includes(reviews.get(session.id)?.state)
          && (data === '\x03' || data === '\x1b' && /esc to (?:interrupt|cancel)/iu.test(terminal.readTerminal(session.id)))) {
          interruptions.set(session.id, { id: uuid(), at: Date.now() });
          captureReviews();
          return;
        }
        if (!autoReview || !['\r', '\n'].includes(data) || trashed(session.id)
          || ['shell', 'unbound', 'paused'].includes(reviews.get(session.id)?.state)) return;
        const screen = terminal.readTerminal(session.id);
        const { submittedPrompt, completionStamp } = window.WhiteboxTerminalReviewTurns;
        const request = submittedPrompt(screen);
        if (!request) return;
        submissions.set(session.id, { id: uuid(), at: Date.now(), request, stamps: { claude: completionStamp(screen, 'claude'), codex: completionStamp(screen, 'codex') } });
        captureReviews();
      },
      fontSize, inputLabel: msg`${session.title} ${session.id.slice(-5)} 터미널 입력`,
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
  function renderTree(tree) {
    if (tree.id) return panes.get(tree.id)?.node || document.createElement('div');
    const node = document.createElement('div');
    node.className = `wb-split wb-split-${tree.axis}`;
    const first = renderTree(tree.first), second = renderTree(tree.second);
    first.style.flex = `${tree.ratio} 1 0%`; second.style.flex = `${1 - tree.ratio} 1 0%`;
    const handle = document.createElement('div');
    handle.className = 'wb-divider'; handle.tabIndex = 0;
    handle.setAttribute('role', 'separator'); handle.setAttribute('aria-label', t('터미널 분할 크기'));
    handle.setAttribute('aria-orientation', tree.axis === 'row' ? 'vertical' : 'horizontal');
    const resize = ratio => {
      tree.ratio = Math.min(.85, Math.max(.15, ratio));
      first.style.flex = `${tree.ratio} 1 0%`; second.style.flex = `${1 - tree.ratio} 1 0%`;
      handle.setAttribute('aria-valuenow', String(Math.round(tree.ratio * 100)));
    };
    resize(tree.ratio);
    handle.addEventListener('pointerdown', event => { handle.setPointerCapture(event.pointerId); event.preventDefault(); });
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
  function togglePanelView(id) {
    const target = panelOwner(id)?.tabs.find(panel => panel.id === id);
    if (!target) return;
    if (pinnedPanels.includes(id)) {
      pinnedPanels = pinnedPanels.filter(item => item !== id);
      if (target !== tab()) for (const member of layout.ids(target.layout)) space().viewLayout = layout.remove(space().viewLayout, member);
    } else {
      pinnedPanels = [...new Set([...pinnedPanels, tab()?.id, id].filter(Boolean))];
      space().viewLayout = layout.reconcile(canvasLayout(), visiblePanels().map(panel => panel.layout));
    }
    expanded = false; root.classList.remove('terminal-expanded'); renderLayout(false);
  }
  function renderLayout(focus = true) {
    for (const pane of panes.values()) $('#wbParking').append(pane.node);
    $('#wbCanvas').replaceChildren();
    const current = tab();
    const view = canvasLayout();
    if (current?.pending) {
      $('#wbCanvas').innerHTML = msg`<div class="wb-empty wb-creating" role="status" aria-live="polite" aria-busy="true"><span>${icon('terminal')}</span><h2>패널 생성 중…</h2><p>터미널을 연결하고 있어요.</p></div>`;
      $('#wbTerminalStatus').innerHTML = stateBadge({ state: 'starting', label: t('시작 중…') });
      renderReview();
    } else if (view) {
      if (!layout.ids(view).includes(activeId())) space().activeSurface = layout.ids(view)[0];
      const tree = renderTree(expanded ? { id: activeId() } : view); tree.style.flex = '1';
      $('#wbCanvas').append(tree);
      selectPane(activeId());
      if (focus) requestAnimationFrame(activeFocus);
    } else {
      $('#wbCanvas').innerHTML = msg`<div class="wb-empty"><span>${icon('terminal')}</span><h2>터미널에서 바로 시작하세요.</h2><p>셸을 열고 평소처럼 명령어를 입력하세요.<br/>claude, codex도 이 터미널에서 실행합니다.</p><button data-action="${space() ? 'new' : 'workspace'}">${icon('plus')} ${space() ? t('터미널 열기') : t('프로젝트 추가')}</button></div>`;
      $('#wbTerminalStatus').textContent = t('선택한 터미널 없음');
      renderReview();
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
    const owner = destination, previousTab = owner.tabs.find(item => item.id === panelId), selected = previousTab?.activePane || '';
    rememberCanvas(); rememberCanvas(owner);
    const previousActive = owner.activeTab, previousSpace = selectedSpace, previousView = owner.viewLayout, previousSurface = owner.activeSurface, previousPins = pinnedPanels;
    const splitting = axis && previousTab?.layout && layout.ids(previousTab.layout).includes(selected);
    const next = splitting ? previousTab : { id: uuid(), name: t('패널'), layout: null, activePane: '', pending: true };
    if (!splitting) { owner.tabs.push(next); pinnedPanels = []; }
    owner.viewLayout = splitting ? previousTab.viewLayout || previousTab.layout : null;
    if (splitting && !layout.ids(owner.viewLayout).includes(selected)) owner.viewLayout = previousTab.layout;
    expanded = false; root.classList.remove('terminal-expanded');
    pendingCreation = { panelId: next.id };
    owner.activeTab = next.id; owner.collapsed = false; next.collapsed = false; selectedSpace = owner.id;
    renderLayout(false);
    let created = false;
    try {
      const session = await api.terminalCreate({ type: bootstrap.platform.localShell, cwd: owner.cwd, cols: 100, rows: 30, creationId: `workspace:${uuid()}` });
      sessions.set(session.id, session);
      created = true;
      next.layout = splitting ? layout.split(next.layout, selected, session.id, axis) : { id: session.id };
      next.activePane = session.id; delete next.pending;
      const view = layout.remove(canvasLayout(owner), session.id);
      owner.viewLayout = splitting ? layout.split(view, layout.ids(view).includes(selected) ? selected : layout.ids(view)[0], session.id, axis) : { id: session.id };
      next.viewLayout = owner.viewLayout;
      owner.activeSurface = session.id;
      // Mount in the visible layout so engine/replay initialization does not
      // hold the whole panel offscreen or fit it against the hidden parking lot.
      const mounted = ensurePane(session);
      renderLayout(false);
      await mounted;
      // Retain the released ConPTY post-mount PID reconciliation.
      const current = await api.terminalGet(session.id);
      if (current?.creationId === session.creationId) sessions.set(session.id, current);
      refreshPaneChrome(); renderInstances();
      if (tab() === next) activeFocus();
    } catch (error) {
      if (!created && !splitting) {
        owner.tabs = owner.tabs.filter(item => item !== next);
        if (owner.activeTab === next.id) {
          owner.activeTab = previousActive; owner.viewLayout = previousView; owner.activeSurface = previousSurface; pinnedPanels = previousPins;
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
    panes.delete(id); sessions.delete(id); reviews.delete(id); reviewHistory.delete(id); submissions.delete(id); interruptions.delete(id);
    trash = trash.filter(item => item.id !== id);
    detachFromLayout(id);
  }

  function trashed(id) { return trash.some(item => item.id === id && trashSession(item)); }
  function trashSession(item) {
    const session = sessions.get(item.id);
    return session?.creationId === item.creationId ? session : null;
  }
  function renderTrash() {
    $('#wbTrashCount').textContent = String(trash.length);
    $('[data-action="trash-empty"]').disabled = busy || trash.length === 0;
    $('#wbTrashList').innerHTML = [...trash].sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt)).map(item => {
      const session = trashSession(item);
      const provider = item.provider === 'claude' ? 'Claude' : item.provider === 'codex' ? 'Codex' : t('일반 셸');
      const restorable = session?.status === 'running';
      return msg`<article class="wb-trash-row"><div><strong>${esc(provider)} · ${esc(item.name)} · ${esc(item.id.slice(-5))}</strong><small>${esc(item.projectName)} · ${esc(new Date(item.deletedAt).toLocaleString(window.WhiteboxI18n.getLocaleTag()))}</small><small>${session ? session.status === 'running' ? t('실행 중 · 자동 검토 중지') : t('원래 실행 세션에 연결할 수 없습니다. 새 셸로 대체하지 않습니다.') : t('원래 실행 세션에 연결할 수 없습니다. 새 셸로 대체하지 않습니다.')}</small></div><div class="wb-trash-actions"><button data-restore-instance="${esc(item.id)}" ${restorable ? '' : 'disabled'} aria-label="${esc(provider)} ${esc(item.name)} ${esc(item.id.slice(-5))} 복구">${restorable ? msg`${esc(provider)} 세션 복구` : t('세션 연결 불가')}</button><button data-purge-instance="${esc(item.id)}" class="wb-danger" aria-label="${esc(item.name)} 영구 삭제">영구 삭제</button></div></article>`;
    }).join('') || t('<div class="wb-trash-empty">휴지통이 비어 있습니다.</div>');
  }

  async function trashInstance(id) {
    if (busy || trashed(id)) return;
    const owner = owners().find(item => item.tabs.some(tab => layout.ids(tab.layout).includes(id)));
    const target = owner?.tabs.find(item => layout.ids(item.layout).includes(id));
    const session = sessions.get(id);
    if (!target || !session) return;
    trash.push({ id, creationId: session.creationId, pid: session.pid, name: title(id), provider: reviews.get(id)?.provider || '', projectId: owner.id,
      review: retainReview(session, reviews.get(id)), projectName: owner.name, standalone: owner.standalone === true, cwd: owner.cwd, deletedAt: new Date().toISOString() });
    detachFromLayout(id);
    renderLayout();
    // Invalidates any pending review result without sending new model work.
    try { const review = await api.terminalReview?.({ id, creationId: session.creationId, enabled: false });
      const item = trash.find(item => item.id === id);
      if (item && review?.provider) { item.provider = review.provider; item.providerPid = review.providerPid; save(); renderTrash(); }
    }
    catch (error) { report(error); }
  }

  async function restoreInstance(id) {
    if (busy) return;
    const item = trash.find(item => item.id === id);
    if (!item) return;
    busy = true;
    try {
      // Verify the host's current identity, not a possibly stale renderer list.
      // Restoring must never spawn a replacement shell or reconnect a dead PTY.
      const session = await api.terminalGet(item.id);
      if (!session || session.creationId !== item.creationId || session.status !== 'running'
        || (item.pid && session.pid !== item.pid)) {
        throw new Error(t('원래 실행 세션에 연결할 수 없습니다. 새 셸로 대체하지 않습니다.'));
      }
      sessions.set(session.id, session);
      await ensurePane(session, true);
      if (item.review?.creationId === session.creationId && item.review?.pid === session.pid && Array.isArray(item.review?.result?.tasks)) reviewHistory.set(session.id, item.review);
      const history = savedReview(session);
      if (history) reviews.set(session.id, { state: 'watching', provider: history.provider, providerPid: history.providerPid, result: history.result, restored: true });
      let owner = item.standalone ? standalone : spaces.find(owner => owner.id === item.projectId) || spaces.find(owner => owner.cwd === item.cwd);
      if (!owner) {
        owner = { id: uuid(), cwd: item.cwd, name: item.projectName, tabs: [], activeTab: '', nextNumber: 1 };
        spaces.push(owner);
      }
      const restored = { id: uuid(), name: item.name || t('패널'), layout: { id: session.id }, activePane: session.id };
      rememberCanvas(); rememberCanvas(owner);
      owner.tabs.push(restored); owner.activeTab = restored.id; selectedSpace = owner.id; owner.viewLayout = restored.layout; owner.activeSurface = session.id;
      trash = trash.filter(record => record !== item);
      $('#wbTrash').close();
      renderLayout();
      await captureReviews();
    } catch (error) { $('#wbTrashNotice').textContent = msg`복구하지 못했습니다: ${error.message}`; }
    finally { busy = false; renderTrash(); }
  }

  async function deleteTrashItem(item) {
    if (!trash.includes(item)) return;
    const live = await api.terminalGet(item.id);
    if (live) {
      if (live.creationId !== item.creationId || (item.pid && live.pid !== item.pid)) {
        throw new Error(t('터미널 세션이 바뀌어 삭제하지 않았습니다.'));
      }
      await api.terminalClose(item.id);
      removeTerminalLocally(item.id);
    } else {
      trash = trash.filter(record => record !== item);
      reviewHistory.delete(item.id);
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

  function analysisTokens(task, result, inSummary = false) {
    // Older saved results only stored the latest call's usage at result level.
    // Never attribute that usage to a different historical analysis.
    const usage = Object.hasOwn(task, 'analysisUsage') ? task.analysisUsage
      : task.observedAt === result.observedAt ? result.usage : null;
    const known = typeof usage?.total === 'number' && Number.isFinite(usage.total) && usage.total >= 0;
    const number = value => Number.isFinite(value) && value >= 0 ? value.toLocaleString(window.WhiteboxI18n.getLocaleTag()) : '—';
    const label = task.recordOnly ? t('0 토큰 · 호출 없음') : known ? `${number(usage.total)} ${t('토큰')}` : t('토큰 미제공');
    const detail = known ? `${t('터미널 작업 토큰을 제외한 Whitebox 이해·검토 생성 토큰입니다.')} ${t('입력')} ${number(usage.input)} · ${t('출력')} ${number(usage.output)} · ${t('캐시 읽기')} ${number(usage.cachedInput)} · ${t('캐시 쓰기')} ${number(usage.cacheWrite)}` : t('이 분석의 토큰 사용량이 기록되지 않았습니다.');
    return `<span class="wb-analysis-tokens" ${inSummary ? '' : 'tabindex="0"'} title="${esc(detail)}" aria-label="${esc(`${label}. ${detail}`)}">${esc(label)}</span>`;
  }

  function renderModelSettings() {
    $('#wbAnalysisProvider').value = analysisSettings.provider;
    for (const provider of ['claude', 'codex']) {
      const name = provider === 'claude' ? 'Claude' : 'Codex';
      const select = $(`#wb${name}Model`), custom = $(`#wb${name}Custom`);
      const value = analysisSettings.models[provider];
      select.innerHTML = t('<option value="">CLI 기본 모델</option>') + (modelCatalog[provider] || []).map(item => `<option value="${esc(item.id)}">${esc(item.label)}</option>`).join('') + t('<option value="custom">직접 입력</option>');
      const isCustom = Boolean(value && !(modelCatalog[provider] || []).some(item => item.id === value));
      select.value = isCustom ? 'custom' : value; custom.value = isCustom ? value : '';
      $(`[data-model-row="${provider}"]`).hidden = analysisSettings.provider !== 'auto' && analysisSettings.provider !== provider;
      $(`#wb${name}CustomRow`).hidden = select.value !== 'custom' || $(`[data-model-row="${provider}"]`).hidden;
    }
  }
  $('#wbAnalysisProvider').addEventListener('change', event => { analysisSettings.provider = event.target.value; save(); renderModelSettings(); });
  for (const provider of ['claude', 'codex']) {
    const name = provider === 'claude' ? 'Claude' : 'Codex';
    $(`#wb${name}Model`).addEventListener('change', event => {
      const custom = event.target.value === 'custom';
      $(`#wb${name}CustomRow`).hidden = !custom;
      analysisSettings.models[provider] = custom ? $(`#wb${name}Custom`).value.trim() : event.target.value;
      save(); $('#wbModelNotice').textContent = t('다음 분석부터 선택한 모델을 사용합니다.');
    });
    $(`#wb${name}Custom`).addEventListener('change', event => {
      const value = event.target.value.trim();
      if (value && !/^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,127}$/u.test(value)) {
        event.target.value = analysisSettings.models[provider]; $('#wbModelNotice').textContent = t('모델 ID의 형식을 확인해 주세요.'); return;
      }
      analysisSettings.models[provider] = value; save(); $('#wbModelNotice').textContent = t('다음 분석부터 적용됩니다.');
    });
  }

  function renderReview() {
    renderCollaborationStatus();
    const id = activeId(), value = reviews.get(id);
    const key = JSON.stringify([id, title(id), selectedSpace, tab()?.id, value, autoReview, reviewView]);
    if (key === lastReviewKey) return;
    lastReviewKey = key;
    $('#wbReviewTarget').innerHTML = msg`<span class="wb-target-icon">${icon('terminal')}</span><div><strong>${esc(id ? t('선택한 터미널') : t('선택한 터미널 없음'))}</strong><small>${esc(id ? title(id) : t('터미널을 먼저 열어 주세요'))}</small></div>`;
    ui?.reviewTabs($('#wbReviewTabs'), { value: reviewView, current: t('이번 요청'), history: t('히스토리'), onChange: value => { reviewView = value; renderReview(); } });
    $('#wbReviewAuto').setAttribute('aria-pressed', String(autoReview));
    $('#wbReviewAuto').setAttribute('aria-label', t(autoReview ? '자동 분석 켜짐' : '자동 분석 꺼짐'));
    root.querySelectorAll('[data-review-view]').forEach(button => {
      const selected = button.dataset.reviewView === reviewView;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const analyst = value?.result?.analysisProvider || (analysisSettings.provider === 'auto' ? value?.provider : analysisSettings.provider);
    $('#wbReviewModel').textContent = autoReview ? `${{ claude: 'Claude', codex: 'Codex', jev: 'Jev' }[analyst] || t('자동 분석')}${value?.result?.analysisModel ? ` · ${value.result.analysisModel}` : ''}` : t('자동 분석 꺼짐');
    const state = !autoReview ? 'paused' : value?.state || 'watching';
    const analyzing = state === 'reviewing';
    const rateLimited = value?.retryAt > Date.now();
    const pending = ['awaiting-answer', 'collecting', 'reviewing'].includes(state);
    const states = { 'awaiting-answer': t('작업 관찰 중'), paused: t('자동 검토 꺼짐'), watching: t('새 요청을 기다리는 중'), collecting: t('분석 대기'), shell: t('셸 사용 중'), unbound: t('연결 확인 필요'), reviewing: t('분석중…'), ready: t('이번 요청 검토 완료'), error: t('검토를 완료하지 못했습니다') };
    const activity = $('#wbReviewActivity');
    activity.hidden = !['awaiting-answer', 'collecting', 'reviewing', 'error', 'unbound'].includes(state);
    const activityLabel = state === 'collecting' && rateLimited ? t('분석 사용 한도 대기') : state === 'reviewing' && value?.phase === 'evidence' ? t('근거 준비 중…') : states[state];
    const previousLoader = activity.querySelector('.wb-review-state-label');
    if (previousLoader) ui?.clear(previousLoader);
    activity.innerHTML = activity.hidden ? '' : `<div class="wb-review-state ${pending ? 'is-loading' : ''}"><i aria-hidden="true"></i><div><strong class="wb-review-state-label">${esc(activityLabel)}</strong>${rateLimited ? `<small>${t('다시 시도까지')} ${Math.ceil((value.retryAt - Date.now()) / 1000)}s</small>` : ''}</div></div>`;
    if (analyzing) ui?.thinking(activity.querySelector('.wb-review-state-label'), activityLabel);
    $('#wbReviewContent').setAttribute('aria-busy', String(analyzing));
    $('[data-action="refresh"]').disabled = analyzing;
    $('[data-action="refresh"]').title = state === 'awaiting-answer' ? t('답변 완료 다시 확인') : t('지금 검토');
    let html = '';
    if (value?.message && ['error', 'unbound'].includes(state)) html += `<p class="wb-review-notice">${esc(value.message)}</p>`;
    // Deferred entries are bookkeeping, not analysis. Keep them in history data
    // but never echo the user's request as an empty result card.
    const tasks = (value?.result?.tasks || []).filter(task => !task.deferred && task.analysisDepth !== 'deferred'
      && !window.WhiteboxTerminalReviewTurns.isStartupRequest(task.request));
    if (!tasks.length && (pending || value?.result?.tasks?.length)) {
      // The activity indicator is the entire waiting UI.
    } else if (!tasks.length && value?.result && !['error', 'awaiting-answer'].includes(state)) {
      html += t('<div class="wb-review-empty wb-review-complete"><h2>검토를 마쳤습니다.</h2><p>현재 대화에서 비교할 작업 요청을 찾지 못했습니다. 새 작업을 요청하면 답변이 끝난 뒤 이곳에 검토 결과를 표시합니다.</p></div>');
    } else if (!tasks.length) {
      html += msg`<div class="wb-review-empty"><div class="wb-evidence-icon">${icon('review')}</div><h2>아직 분석할 작업이 없어요.</h2><p>이 터미널에서 AI와 작업하면 요청과 결과를 분석해 이곳에 표시합니다.</p><small>화면 기록을 설정한 모델로 분석합니다.<br/>AI 계정의 사용량이 발생하며 설정에서 끌 수 있습니다.</small></div>`;
    } else {
      const cards = [...tasks].reverse().map((task, index) => {
        const alignment = ['aligned', 'partial', 'different', 'in-progress'].includes(task.alignment) ? task.alignment : 'unknown';
        const label = { aligned: t('답변은 요청 취지에 맞아요'), different: t('요청과 다른 부분이 있어요'), partial: t('일부 요구사항이 남아 있어요'), 'in-progress': t('현재까지의 작업을 설명합니다'), unknown: t('아직 확인이 필요해요') }[alignment];
        const taskKey = task.taskId || task.analysisId || `${task.observedAt}:${task.request}`;
        const observed = new Date(task.observedAt || value.result.observedAt);
        const time = Number.isFinite(observed.getTime()) ? `<time class="wb-task-time" datetime="${observed.toISOString()}" title="${esc(observed.toLocaleString(window.WhiteboxI18n.getLocaleTag()))}">${esc(observed.toLocaleTimeString(window.WhiteboxI18n.getLocaleTag(), { hour: '2-digit', minute: '2-digit' }))}</time>` : '';
        const lifecycleLabel = task.lifecycle === 'interrupted' ? t('중단됨 · 수행 기록') : task.lifecycle === 'in-progress' ? t('작업 진행 중 · 현재까지 분석') : task.deferred ? t('근거 수집 대기') : '';
        const lifecycle = lifecycleLabel ? `<p class="wb-record-label">${lifecycleLabel}</p>` : '';
        if (task.recordOnly) {
          const record = msg`<article class="wb-task wb-record-only"><div class="wb-task-title"><h2>${esc(task.request)}</h2>${analysisTokens(task, value.result)}</div>${time}${lifecycle}<p class="wb-record-label">${t(task.deferred ? "근거가 확보되면 분석합니다" : "AI 분석 없이 기록")}</p><p>${esc(task.actual)}</p></article>`;
          return index === 0 ? record : msg`<details class="wb-history" data-review-request="${esc(taskKey)}"><summary><strong>${esc(task.request)}</strong>${analysisTokens(task, value.result, true)}</summary>${record}</details>`;
        }
        const checks = task.reviewSchema === 3
          ? `${task.verification ? `<div class="wb-task-section"><h3>${t('확인된 근거')}</h3><p>${esc(task.verification)}</p></div>` : ''}${task.unverified?.length ? `<div class="wb-remaining"><h3>${t('완료 판단에 필요한 확인')}</h3>${task.unverified.map(item => `<p><strong>${esc(item.item)}</strong><br/>${esc(item.reason)}</p>`).join('')}</div>` : ''}`
          : `${task.verification ? `<div class="wb-task-section"><h3>${t('기록에서 확인한 범위')}</h3><p>${esc(task.verification)}</p></div>` : ''}`;
        const typed = task.typedAnalysis ? `<section class="wb-task-section wb-typed-analysis"><h3>Jev · ${t('판단 요약')}</h3><p>${esc(task.actual)}</p>${task.typedAnalysis.findings.map(item => `<p>${esc(item.text)}</p>`).join('')}<details><summary>${t('판단의 근거 기록')}</summary><blockquote>${esc(task.evidenceQuote)}</blockquote><pre>${esc(JSON.stringify(task.typedAnalysis.probabilities, null, 2))}</pre></details></section>` : '';
        const brief = window.WhiteboxReviewDecision.render(task, { t, esc, taskKey });
        const card = msg`<article class="wb-task">
          <div class="wb-task-section wb-request"><h3>${!value.currentTaskId ? index === 0 ? t('이번 요청') : t('이전 요청') : task.taskId === value.currentTaskId ? t('이번 요청') : t('이전 요청')}</h3><div class="wb-task-title"><h2>${esc(task.summary || task.request)}</h2>${analysisTokens(task, value.result)}</div>${time}</div>
          ${lifecycle}
          ${typed}
          ${brief || `<div class="wb-request-comparison"><div class="wb-comparison-row"><h3>${t('요청한 일')}</h3><p>${esc(task.request)}</p></div><div class="wb-comparison-row"><h3>${t('실제로 한 일')}</h3><p>${esc(task.actual)}</p></div></div>${task.why ? `<div class="wb-task-section"><h3>${t('왜 이렇게 바꿨나요?')}</h3><p>${esc(task.why)}</p></div>` : ''}${checks}`}
          ${task.decisionIssues?.length ? `<p class="wb-evidence-limit">${t('판단 요약을 확인하지 못해 작업 기록을 표시합니다.')}</p>` : ''}
          ${task.nextStep ? msg`<button class="wb-next-request" data-followup="${esc(taskKey)}">확인할 내용으로 다음 요청 준비</button>` : ''}
          <details class="wb-task-details" data-review-request="${esc(`details:${taskKey}`)}"><summary>요청과 분석 기록</summary>
            <div class="wb-task-section"><h3>내가 보낸 요청</h3><p>${esc(task.request)}</p></div>
            ${brief ? `<div class="wb-task-section"><h3>${t('실제로 한 일')}</h3><p>${esc(task.actual)}</p></div>${task.why ? `<div class="wb-task-section"><h3>${t('왜 이렇게 바꿨나요?')}</h3><p>${esc(task.why)}</p></div>` : ''}${checks}<div class="wb-task-section"><h3>${t('판단의 근거 기록')}</h3>${task.decision.reasons.map(reason => `<blockquote>${esc(reason.evidenceQuote)}</blockquote>`).join('')}</div>` : ''}
            <div class="wb-verdict ${alignment}"><span class="wb-check-label">요청 충족 여부</span><strong>${label}</strong><p>${esc(task.explanation)}</p></div>
            ${task.understanding ? msg`<div class="wb-task-section"><h3>어떻게 동작하나요?</h3><p>${esc(task.understanding)}</p></div>` : ''}
            ${task.impact ? msg`<div class="wb-task-section"><h3>사용자에게 어떤 영향이 있나요?</h3><p>${esc(task.impact)}</p></div>` : ''}
            ${task.relation === 'changed' ? `<p>${t('이전 요청의 요구사항이 변경됐어요. 이후 결과는 새 요청을 기준으로 분석합니다.')}</p>` : ''}
            ${task.analysisRuns?.length > 1 ? msg`<div class="wb-task-section"><h3>이 요청의 분석 기록</h3>${task.analysisRuns.map((run, runIndex) => msg`<div class="wb-analysis-run"><span>분석 ${runIndex + 1}</span>${analysisTokens(run, value.result)}</div>`).join('')}</div>` : ''}
          </details>
        </article>`;
        if (index === 0) return card;
        return msg`<details class="wb-history" data-review-request="${esc(`${task.taskId || task.analysisId || task.observedAt || ''}:${task.request}`)}"><summary><span class="wb-history-label">이전 요청 ${tasks.length - index}</span>${analysisTokens(task, value.result, true)}<strong>${esc(task.summary || task.request)}</strong></summary>${card}</details>`;
      });
      html += `<section class="wb-current-review" ${reviewView === 'history' ? 'hidden' : ''}>${cards[0]}</section><section class="wb-review-history" ${reviewView === 'history' ? '' : 'hidden'}>${cards.slice(1).join('') || (reviewView === 'history' ? `<p class="wb-review-notice">${t('아직 이전 분석 기록이 없어요.')}</p>` : '')}</section>`;
    }
    const content = $('#wbReviewContent');
    const position = content.scrollTop;
    const openDetails = new Set([...content.querySelectorAll('details[data-review-request][open]')].map(item => item.dataset.reviewRequest));
    content.innerHTML = html;
    content.querySelectorAll('details[data-review-request]').forEach(item => { item.open = openDetails.has(item.dataset.reviewRequest); });
    content.scrollTop = position;
  }
  $('#wbReviewContent').addEventListener('click', event => {
    const button = event.target.closest('[data-followup]');
    if (!button) return;
    const task = reviews.get(activeId())?.result?.tasks.find(item =>
      (item.taskId || item.analysisId || `${item.observedAt}:${item.request}`) === button.dataset.followup);
    if (!task?.nextStep) return;
    $('#wbFollowupText').value = task.nextStep;
    $('#wbFollowupStatus').textContent = '';
    $('#wbFollowup').showModal();
  });
  $('[data-action="copy-followup"]').addEventListener('click', async () => {
    try {
      await api.writeClipboard($('#wbFollowupText').value);
      $('#wbFollowupStatus').textContent = t('복사했어요. 원하는 터미널에 붙여 넣고 보내세요.');
    } catch (error) { $('#wbFollowupStatus').textContent = t('복사하지 못했어요. 내용을 선택해 직접 복사해 주세요.'); }
  });
  let collaborationSync = null;
  function syncCollaboration() {
    if (collaborationSync) return collaborationSync;
    collaborationSync = syncCollaborationNow().finally(() => { collaborationSync = null; });
    return collaborationSync;
  }
  async function syncCollaborationNow() {
    if (!api.terminalCollaboration) return;
    const groups = owners().flatMap(owner => owner.tabs.filter(panel => !panel.pending).map(panel => ({ id: panel.id, name: `${owner.name} · ${panel.name}`, cwd: owner.cwd,
      members: layout.ids(panel.layout).map(id => ({ ...sessions.get(id), title: title(id) })).filter(item => item.id && !trashed(item.id)) })));
    const frames = [...panes.keys()].filter(id => !trashed(id)).map(id => ({ id, creationId: sessions.get(id)?.creationId, ...terminal.readTerminalSnapshot(id) }));
    const result = await api.terminalCollaboration({ operation: 'sync', groups, frames });
    workStates.clear();
    for (const panel of result.panels || []) for (const member of panel.members || []) {
      if (member.activity) workStates.set(member.id, { ...member.activity, observedAt: Date.now() });
    }
    refreshPaneChrome(); renderInstances();
    collaborationJobs = result.jobs || [];
    for (const job of collaborationJobs) {
      if (collaborationLoaded && job.state === 'completed' && collaborationStates.get(job.id) !== 'completed') {
        collaborationNotices.set(job.id, Date.now() + 7000);
        setTimeout(renderCollaborationStatus, 7100);
      }
      collaborationStates.set(job.id, job.state);
    }
    collaborationLoaded = true;
    for (const job of collaborationJobs) {
      if (job.terminal && !handledCollaborations.has(`new:${job.id}`)) {
        const owner = panelOwner(job.groupId);
        const panel = owner?.tabs.find(item => item.id === job.groupId);
        const live = await api.terminalGet(job.terminal.id);
        if (panel && live && live.creationId === job.terminal.creationId) {
          if (!owner.tabs.some(item => layout.ids(item.layout).includes(live.id))) {
            detachFromLayout(live.id);
            sessions.set(live.id, live); await ensurePane(live);
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
  function renderCollaborationStatus() {
    const related = collaborationJobs.filter(job => job.sourceId === activeId() || job.targetId === activeId());
    const jobs = related.filter(job => job.state !== 'completed' || (collaborationNotices.get(job.id) || 0) > Date.now()).slice(-3);
    const status = $('#wbCollaborationStatus'); status.hidden = !jobs.length;
    const labels = { queued: t('전달 대기'), sending: t('전달 중'), running: t('상대 답변 대기'), completed: t('응답 도착'), failed: t('전달 실패'), interrupted: t('확인 필요') };
    const markup = job => `<div><strong>${esc(job.terminal && job.state === 'completed' ? t('새 터미널 열림') : labels[job.state] || job.state)}</strong><span>${esc((job.targetId || '').slice(-5))} · ${esc(job.request || t('새 터미널'))}</span>${job.error ? `<small>${esc(job.error)}</small>` : ''}</div>`;
    status.innerHTML = jobs.map(markup).join('');
  }
  function captureReviews(force = false) {
    if (!api.terminalReview) return Promise.resolve();
    // A manual refresh must observe its selected terminal after an in-flight
    // background observation, rather than silently dropping the request.
    if (reviewBusy) return force ? reviewTask.then(() => captureReviews(true)) : reviewTask;
    reviewTask = captureReviewsNow(force);
    return reviewTask;
  }
  async function captureReviewsNow(force) {
    reviewBusy = true;
    try {
      try { await syncCollaboration(); } catch (error) {
        $('#wbCollaborationStatus').hidden = false;
        $('#wbCollaborationStatus').textContent = `${t('협업 연결 확인 필요')}: ${String(error.message || error)}`;
      }
      const ids = force ? [activeId()] : [...panes.keys()];
      for (const id of ids) {
        const session = sessions.get(id);
        if (!session || trashed(id)) continue;
        if (!session.creationId) {
          reviews.set(id, { state: 'unbound', message: t('이전 터미널에는 검토 연결 식별자가 없습니다. 새 터미널을 열면 이해·검토가 연결됩니다.') });
          continue;
        }
        let result;
        try { result = await api.terminalReview({ id, creationId: session.creationId, text: autoReview ? terminal.readTerminal(id) : '', enabled: autoReview, force: force && id === activeId(), foreground: id === activeId(), submission: submissions.get(id), interruption: interruptions.get(id), analysis: { ...analysisSettings, locale: window.WhiteboxI18n?.getLocale() || 'ko' } });
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
      renderReview();
      renderInstances();
    } catch (error) {
      if (activeId()) reviews.set(activeId(), { ...reviews.get(activeId()), state: 'error', message: String(error.message || error) });
      renderReview();
    } finally { reviewBusy = false; }
  }
  async function act(action) {
    if (action === 'dismiss-error') $('#wbError').hidden = true;
    if (action === 'toggle-sidebar') root.classList.toggle('sidebar-hidden');
    if (action === 'layout-row' || action === 'layout-column') {
      const view = canvasLayout();
      if (view && !view.id) { view.axis = action === 'layout-row' ? 'row' : 'column'; renderLayout(false); }
    }
    if (action === 'toggle-review') setReviewVisible(root.classList.contains('review-hidden'));

    if (action === 'jev-save' || action === 'jev-remove') {
      try {
        const result = await api.terminalJevConfigure(action === 'jev-remove' ? { remove: true } : { apiKey: $('#wbJevKey').value });
        $('#wbJevKey').value = ''; $('#wbJevStatus').textContent = result.configured ? t('Jev 연결됨') : t('Jev 연결 해제됨');
        if (!result.configured && analysisSettings.provider === 'jev') { analysisSettings.provider = 'auto'; save(); renderModelSettings(); }
      } catch (error) { $('#wbJevStatus').textContent = String(error.message || error); }
      return;
    }
    if (action === 'new') return createTerminal();
    if (action === 'new-independent') return createTerminal('', standalone);
    if (action === 'new-panel') return createTerminal('');
    if (action === 'pin-arranged') { const id = $('#wbMoveTarget').value; if (!id.startsWith('owner:')) togglePanelView(id); $('#wbArrange').close(); }
    if (action === 'detach-panel') {
      const panel = panelFor(arrangingId);
      if (panel) moveTerminal(arrangingId, { ownerId: panelOwner(panel.id).id });
      $('#wbArrange').close();
    }
    if (action === 'join-panel') {
      const panelId = $('#wbMoveTarget').value;
      if (!panelId.startsWith('owner:')) moveTerminal(arrangingId, { panelId, direction: $('#wbMoveDirection').value, join: true });
      $('#wbArrange').close();
    }
    if (action === 'archive-arranged') { $('#wbArrange').close(); return trashInstance(arrangingId); }
    if (action === 'move-terminal') {
      const value = $('#wbMoveTarget').value;
      if (value.startsWith('owner:')) moveTerminal(arrangingId, { ownerId: value.slice(6) });
      else moveTerminal(arrangingId, { panelId: value, direction: $('#wbMoveDirection').value });
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
      renderTrash(); $('#wbTrashNotice').textContent = ''; $('#wbTrash').showModal();
      for (const item of trash) {
        if (!trashSession(item)) continue;
        const review = await api.terminalReview?.({ id: item.id, creationId: item.creationId, enabled: false });
        if (review?.provider) { item.provider = review.provider; item.providerPid = review.providerPid; }
      }
      save(); renderTrash();
    }
    if (action === 'trash-empty') return emptyTrash();
    if (action === 'trash-close') $('#wbTrash').close();
    if (action === 'settings') { renderModelSettings(); $('#wbSettings').showModal(); }
    if (action === 'update-settings') { renderModelSettings(); $('#wbSettings').showModal(); $('#wbSettings').scrollTop = 0; }
    if (action === 'update-check') return runUpdateAction('check');
    if (action === 'update-install') return runUpdateAction('install');
    if (action === 'update-release') {
      try { await api.openUpdateRelease(); } catch (error) { updateActionError = String(error.message || error); renderUpdates(); }
    }
    if (action === 'auto-review') {
      $('#wbAutoReview').checked = !autoReview;
      $('#wbAutoReview').dispatchEvent(new Event('change'));
    }
    if (action === 'refresh') await captureReviews(true);
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.action) act(button.dataset.action).catch(report);
    if (button.dataset.space) { selectedSpace = button.dataset.space; space().collapsed = false; renderLayout(); }
    if (button.dataset.paneTab) selectPane(button.dataset.paneTab, true);
    if (button.dataset.reviewView) { reviewView = button.dataset.reviewView; renderReview(); }
    if (button.dataset.toggleProject) {
      const project = spaces.find(item => item.id === button.dataset.toggleProject);
      if (project) { project.collapsed = !project.collapsed; renderInstances(); save(); }
    }
    if (button.dataset.expandTerminal) { selectPane(button.dataset.expandTerminal); act('expand').catch(report); }
    if (button.dataset.instance) selectInstance(button.dataset.instance);
    if (button.dataset.togglePanel) {
      const owner = panelOwner(button.dataset.togglePanel);
      const panel = owner?.tabs.find(item => item.id === button.dataset.togglePanel);
      if (panel) {
        panel.collapsed = !panel.collapsed;
        renderInstances(); save();
      }
    }
    if (button.dataset.selectPanel) selectPanel(button.dataset.selectPanel);
    if (button.dataset.retryTerminal) {
      const id = button.dataset.retryTerminal, pane = panes.get(id);
      if (pane?.error && sessions.has(id)) {
        panes.delete(id); pane.node.remove();
        const mounted = ensurePane(sessions.get(id));
        renderLayout(false); mounted.then(() => { if ($('#wbError').dataset.connection === 'true') $('#wbError').hidden = true; }).catch(report);
      }
    }
    if (button.dataset.pinPanel) togglePanelView(button.dataset.pinPanel);
    if (button.dataset.newPanel) createTerminal('', owners().find(item => item.id === button.dataset.newPanel)).catch(report);
    if (button.dataset.addPanelTerminal) {
      const owner = panelOwner(button.dataset.addPanelTerminal);
      if (owner) createTerminal('row', owner, button.dataset.addPanelTerminal).catch(report);
    }
    if (button.dataset.arrangeInstance) openArrange(button.dataset.arrangeInstance);
    if (button.dataset.newProject) createTerminal('', spaces.find(item => item.id === button.dataset.newProject)).catch(report);
    if (button.dataset.removeProject) removeProject(button.dataset.removeProject).catch(report);
    if (button.dataset.trashInstance) trashInstance(button.dataset.trashInstance).catch(report);
    if (button.dataset.restoreInstance) restoreInstance(button.dataset.restoreInstance).catch(report);
    if (button.dataset.purgeInstance) purgeInstance(button.dataset.purgeInstance).catch(report);
  });
  function setReviewWidth(width) {
    const sidebarWidth = $('.wb-sidebar').getBoundingClientRect().width
      || Number.parseFloat(getComputedStyle(root).getPropertyValue('--wb-sidebar-width')) || 220;
    const maximum = window.innerWidth <= 850 ? Math.min(520, window.innerWidth - 32) : Math.max(260, Math.min(520, window.innerWidth - sidebarWidth - 360));
    reviewWidth = Math.max(260, Math.min(maximum, width));
    root.style.setProperty('--wb-review-width', `${reviewWidth}px`);
    $('#wbReviewResize').setAttribute('aria-valuenow', String(Math.round(reviewWidth)));
    $('#wbReviewResize').setAttribute('aria-valuemax', String(Math.round(maximum)));
  }
  function setReviewVisible(visible) {
    root.classList.toggle('review-hidden', !visible);
    $('#wbReviewToggle').setAttribute('aria-expanded', String(visible));
  }
  const compactLayout = window.matchMedia('(max-width: 850px)');
  setReviewVisible(!compactLayout.matches);
  compactLayout.addEventListener('change', event => setReviewVisible(!event.matches));
  const reviewResize = $('#wbReviewResize');
  reviewResize.setAttribute('aria-valuemin', '260'); reviewResize.setAttribute('aria-valuemax', '520');
  reviewResize.addEventListener('pointerdown', event => { reviewResize.setPointerCapture(event.pointerId); event.preventDefault(); });
  reviewResize.addEventListener('pointermove', event => { if (reviewResize.hasPointerCapture(event.pointerId)) setReviewWidth(window.innerWidth - event.clientX); });
  reviewResize.addEventListener('pointerup', event => { reviewResize.releasePointerCapture(event.pointerId); save(); });
  reviewResize.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); setReviewWidth(reviewWidth + (event.key === 'ArrowLeft' ? 20 : -20)); save();
  });
  window.addEventListener('resize', () => setReviewWidth(reviewWidth));
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
    save(); window.location.reload();
  });
  $('#wbFont').addEventListener('change', event => {
    fontSize = Math.max(11, Math.min(24, Number(event.target.value) || 14)); event.target.value = fontSize;
    panes.forEach(pane => pane.dispose?.setFontSize?.(fontSize)); save();
  });
  $('#wbAutoReview').addEventListener('change', event => { autoReview = event.target.checked; save(); renderReview(); captureReviews(); });

  async function init() {
    if (!api) throw new Error(t('Whitebox 앱에서 실행해 주세요.'));
    bootstrap = await window.WhiteboxRendererUtils.bootstrap();
    if (!updateEventSeen) receiveUpdate(window.WhiteboxRendererUtils.latestUpdateState?.() || bootstrap.update);
    renderUpdates();
    attentionSettings.loadAttentionPopupSettings(bootstrap.attentionPopups);
    attentionSettings.renderAttentionPopupSettings();
    attentionSettings.bindAttentionPopupSettings();
    const inventory = await api.terminalList();
    inventory.filter(item => !item.transient && ['shell', 'powershell', 'cmd'].includes(item.type)).forEach(item => sessions.set(item.id, item));
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { /* Recover with the live PTY inventory. */ }
    for (const id of saved.handledCollaborations || []) if (typeof id === 'string') handledCollaborations.add(id);
    analysisSettings = { provider: ['claude', 'codex', 'jev'].includes(saved.analysisSettings?.provider) ? saved.analysisSettings.provider : 'auto', models: { claude: String(saved.analysisSettings?.models?.claude || ''), codex: String(saved.analysisSettings?.models?.codex || '') } };
    try { modelCatalog = await api.terminalReviewModels?.() || modelCatalog; } catch { /* Keep CLI defaults and custom model entry available. */ }
    renderModelSettings();
    try { const jev = await api.terminalJevStatus?.(); if (jev) $('#wbJevStatus').textContent = jev.configured ? t('Jev 연결됨') : t('API 키를 저장해 연결하세요.'); } catch { /* Explicit setup errors appear when saving a key. */ }
    fontSize = Math.max(11, Math.min(24, Number(saved.fontSize) || 14));
    setReviewWidth(Number(saved.reviewWidth) || 332);
    autoReview = saved.autoReview !== false;
    const trashIds = new Set();
    trash = (Array.isArray(saved.trash) ? saved.trash : []).filter(item => {
      if (!item || typeof item.id !== 'string' || typeof item.cwd !== 'string' || !item.cwd || trashIds.has(item.id)) return false;
      trashIds.add(item.id); return true;
    });
    for (const record of [...(Array.isArray(saved.reviewHistory) ? saved.reviewHistory : []), ...trash.map(item => item.review)]) {
      if (!record || typeof record.id !== 'string' || !Array.isArray(record.result?.tasks)
        || !record.result.tasks.every(task => task && typeof task === 'object')
        || !(sessions.has(record.id) || trash.some(item => item.id === record.id && item.creationId === record.creationId))) continue;
      record.result = { ...record.result, tasks: record.result.tasks.slice(-12).map(task => Object.hasOwn(task, 'analysisUsage') ? task : {
        ...task, analysisUsage: task.observedAt && task.observedAt === record.result.observedAt ? record.result.usage ?? null : null
      }) };
      reviewHistory.set(record.id, record);
      const session = sessions.get(record.id);
      if (savedReview(session)) reviews.set(record.id, { state: 'watching', provider: record.provider, providerPid: record.providerPid, result: record.result, restored: true });
    }
    const archivedIds = new Set(trash.filter(trashSession).map(item => item.id));
    const available = new Set([...sessions.keys()].filter(id => !archivedIds.has(id))), seen = new Set(archivedIds);
    spaces = (Array.isArray(saved.spaces) ? saved.spaces : []).filter(item => typeof item.cwd === 'string' && item.cwd).slice(0, 100).map(item => {
      const tabs = (Array.isArray(item.tabs) ? item.tabs : []).map(item => ({ ...item, layout: layout.restore(item.layout, available, seen) })).filter(item => item.layout);
      return { ...item, tabs, nextNumber: Math.max(1, Number(item.nextNumber) || tabs.length + 1), activeTab: tabs.some(tab => tab.id === item.activeTab) ? item.activeTab : tabs[0]?.id || '' };
    });
    const savedStandalone = saved.standalone || {};
    const independentTabs = (Array.isArray(savedStandalone.tabs) ? savedStandalone.tabs : []).map(item => ({ ...item, layout: layout.restore(item.layout, available, seen) })).filter(item => item.layout);
    standalone = { id: 'standalone', standalone: true, name: t('독립 패널'), cwd: bootstrap.terminalWorkspace?.defaultCwd || '.',
      viewLayout: savedStandalone.viewLayout, activeSurface: savedStandalone.activeSurface,
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
    for (const owner of owners()) { owner.viewLayout = layout.restore(owner.viewLayout, available); for (const panel of owner.tabs) panel.viewLayout = layout.restore(panel.viewLayout, available); }
    selectedSpace = owners().some(item => item.id === saved.selectedSpace) ? saved.selectedSpace : spaces[0]?.id || standalone.id;
    if (pinnedPanels.length) space().viewLayout = layout.reconcile(canvasLayout(), visiblePanels().map(panel => panel.layout));
    for (const session of sessions.values()) if (!archivedIds.has(session.id)) await ensurePane(session);
    $('#wbAutoReview').checked = autoReview; $('#wbFont').value = fontSize;
    renderUpdates();
    $('#wbConnection').innerHTML = t('<i></i>셸 연결됨');
    renderLayout(false);
    if (!Array.isArray(saved.spaces) && space() && !space().tabs.length && sessions.size === 0 && trash.length === 0) await createTerminal();
    api.onTerminalReview?.(({ id, value }) => {
      const session = sessions.get(id);
      if (!session || trashed(id) || !value || !acceptReview(id, value)) return;
      const history = retainReview(session, value);
      const task = value.result?.tasks?.at(-1);
      if (task?.analysisMetrics) { task.analysisMetrics.displayedAt = Date.now(); save(); }
      reviews.set(id, history ? { ...value, result: history.result } : value);
      refreshPaneChrome(); renderPaneTabs(); renderInstances(); renderReview();
    });
    api.onTerminalState(payload => {
      for (const session of payload.sessions || []) {
        if (!sessions.has(session.id)) continue;
        sessions.set(session.id, session);
      }
      refreshPaneChrome();
      renderInstances();
    });
    api.onTerminalConnection?.(value => {
      $('#wbConnection').textContent = value.state === 'connected' ? t('셸 연결됨') : t('셸 다시 연결 중…');
      if (value.state === 'connected') {
        for (const [id, pane] of panes) { pane.dispose?.(); pane.node.remove(); panes.delete(id); }
        Promise.all([...sessions.values()].filter(session => !trashed(session.id)).map(ensurePane)).then(() => renderLayout()).catch(report);
      }
    });
    await api.setLocale?.(window.WhiteboxI18n?.getLocale() || 'ko');
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
    await api.rendererReady();
    let panelSyncBusy = false;
    setInterval(() => {
      refreshPaneChrome(); renderInstances();
      if (panelSyncBusy) return;
      panelSyncBusy = true;
      syncCollaboration().catch(error => report(error, 'collaboration')).finally(() => { panelSyncBusy = false; });
    }, 1000);
    setInterval(() => captureReviews(), 2500);
    setInterval(() => { if (reviews.get(activeId())?.state === 'reviewing' || reviews.get(activeId())?.retryAt > Date.now()) renderReview(); }, 1000);
    window.WhiteboxWorkspace = { createTerminal, selectPane, captureReviews, getState: () => ({ busy, spaces, standalone, trash, selectedSpace, pinnedPanels, activeId: activeId(), sessions: [...sessions.values()] }) };
    document.title = `Whitebox ${bootstrap.versions.app}`;
  }
  init().catch(report);
})();
