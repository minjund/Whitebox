'use strict';

// Keep this historical package entry point while exercising the current UX.
// Deleted drawer/conversation/additional-tools surfaces are negative contracts;
// every writable task interaction now opens the full-screen PTY focus surface.
const { app, BrowserWindow, session: electronSession } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-interaction-pty-'));
const roundCount = Math.max(1, Math.min(3, Number(process.env.WHITEBOX_INTERACTION_ROUNDS || 3)));
const removedSelectors = [
  '#detailDrawer', '#drawerBackdrop', '#drawerContent', '#drawerComposer',
  '#drawerTerminalSurface', '#drawerTerminalViewport', '#ptyFocusChildModal',
  '#ptyFocusChildBody', '#mobileMoreBtn', '#mobileToolsMenu', '#advancedToolsNav',
  '#terminalSection', '#terminalHistoryPanel', '#terminalHistoryList',
  '#automationOverview', '#tmuxSection', '#tmuxCreateModal',
];
const PROJECT_TREE_INTERACTIONS = [
  { selector: '[data-source-workspace]', action: 'workspace:source-select' },
  { selector: '[data-sidebar-project-toggle]', action: 'workspace:project-toggle' },
  { selector: '[data-sidebar-source-toggle]', action: 'workspace:source-toggle' },
];
app.setPath('userData', userData);

function assert(value, message) {
  if (!value) throw new Error(message);
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function rendererValue(win, expression) {
  return win.webContents.executeJavaScript(expression);
}

async function waitFor(win, expression, message, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await rendererValue(win, expression)) return;
    } catch (error) {
      lastError = error;
    }
    await wait(50);
  }
  throw new Error(message + (lastError ? ' (' + lastError.message + ')' : ''));
}

function installWorktreeDependencyRedirect() {
  const configured = String(process.env.WHITEBOX_TEST_NODE_MODULES || '').trim();
  const dependencyRoot = configured ? path.resolve(configured) : '';
  const localRoot = path.join(root, 'node_modules');
  if (!dependencyRoot || !fs.existsSync(dependencyRoot) || fs.existsSync(localRoot)) return;
  electronSession.defaultSession.webRequest.onBeforeRequest({ urls: ['file:///*'] }, (details, callback) => {
    let requested = '';
    try { requested = fileURLToPath(details.url); } catch {}
    const relative = requested ? path.relative(localRoot, requested) : '..';
    const alternate = relative && relative !== '..' && !relative.startsWith('..' + path.sep)
      && !path.isAbsolute(relative) ? path.join(dependencyRoot, relative) : '';
    callback(alternate && fs.existsSync(alternate) ? { redirectURL: pathToFileURL(alternate).href } : {});
  });
}

async function prepareProject(win) {
  await rendererValue(win, "(() => {"
    + "const app=window.WhiteboxApp;"
    + "app.closePtyFocus?.({restoreFocus:false});"
    + "document.querySelector('#closeQuickPaletteBtn')?.click();"
    + "document.querySelector('#cancelRunBtn')?.click();"
    + "const root=(app.state.snapshot?.sessions||[]).find(item=>item.id==='fixture-root');"
    + "app.state.workspace=root?.originCwd||root?.cwd||'D:\\\\fixture';app.state.workspaceSource='all';"
    + "app.state.view='all';app.state.graphFocusId=null;app.state.search='';"
    + "app.state.providerFilters?.clear?.();app.renderWorkspaces?.();app.renderSessions?.('interaction-reset');"
    + "window.interactionTest.clearControls();window.interactionTest.clearCalls();return true;"
    + "})()");
  await waitFor(win,
    "Boolean(document.querySelector('[data-pty-focus-trigger=\"fixture-root\"]')"
      + "&&document.querySelector('#operationsOverview'))",
    '작업 현황의 fixture-root PTY 진입점이 준비되지 않았습니다.');
}

async function exerciseNavigationAndSettings(win) {
  const projectTree = await rendererValue(win, `(async () => {
    const app = window.WhiteboxApp;
    const twoFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const readPreferences = () => JSON.parse(localStorage.getItem('whitebox:dashboard-preferences:v2') || '{}');
    const source = document.querySelector('#projectSidebarList [data-source-workspace]');
    if (!source) return { ok: false, missing: '[data-source-workspace]' };
    const expected = {
      workspace: source.dataset.sourceWorkspace,
      sourceId: source.dataset.projectSource,
      sourceKey: source.dataset.sidebarSourceRef,
      projectKey: source.dataset.sidebarProjectRef,
    };
    source.click();
    await twoFrames();
    const selectedSource = document.querySelector(
      '[data-sidebar-source-key="' + CSS.escape(expected.sourceKey) + '"] [data-source-workspace]'
    );
    const selected = app.state.workspace === expected.workspace
      && app.state.workspaceSource === expected.sourceId
      && app.state.view === 'all'
      && selectedSource?.getAttribute('aria-selected') === 'true'
      && selectedSource?.closest('.project-sidebar-source')?.classList.contains('selected')
      && readPreferences().workspace === expected.workspace
      && readPreferences().workspaceSource === expected.sourceId;

    let projectToggle = document.querySelector(
      '[data-sidebar-project-toggle="' + CSS.escape(expected.projectKey) + '"]'
    );
    if (!projectToggle) return { ok: false, missing: '[data-sidebar-project-toggle]', expected, selected };
    projectToggle.click();
    await twoFrames();
    let projectItem = document.querySelector(
      '[data-sidebar-project-key="' + CSS.escape(expected.projectKey) + '"] .project-sidebar-item'
    );
    let projectSources = projectItem && document.getElementById(projectItem.getAttribute('aria-owns'));
    const projectCollapsed = app.state.sidebarCollapsedProjects.has(expected.projectKey)
      && projectItem?.getAttribute('aria-expanded') === 'false'
      && Boolean(projectSources?.hidden)
      && readPreferences().sidebarCollapsedProjects?.includes(expected.projectKey)
      && document.activeElement === projectItem;
    projectToggle = document.querySelector(
      '[data-sidebar-project-toggle="' + CSS.escape(expected.projectKey) + '"]'
    );
    projectToggle?.click();
    await twoFrames();
    projectItem = document.querySelector(
      '[data-sidebar-project-key="' + CSS.escape(expected.projectKey) + '"] .project-sidebar-item'
    );
    projectSources = projectItem && document.getElementById(projectItem.getAttribute('aria-owns'));
    const projectExpanded = !app.state.sidebarCollapsedProjects.has(expected.projectKey)
      && projectItem?.getAttribute('aria-expanded') === 'true'
      && !projectSources?.hidden
      && !readPreferences().sidebarCollapsedProjects?.includes(expected.projectKey);

    let sourceToggle = document.querySelector(
      '[data-sidebar-source-toggle="' + CSS.escape(expected.sourceKey) + '"]'
    );
    if (!sourceToggle) return { ok: false, missing: '[data-sidebar-source-toggle]', expected, selected };
    sourceToggle.click();
    await twoFrames();
    let sourceItem = document.querySelector(
      '[data-sidebar-source-key="' + CSS.escape(expected.sourceKey) + '"] [data-source-workspace]'
    );
    let sourceSessions = sourceItem && document.getElementById(sourceItem.getAttribute('aria-owns'));
    const sourceCollapsed = app.state.sidebarCollapsedSources.has(expected.sourceKey)
      && sourceItem?.getAttribute('aria-expanded') === 'false'
      && Boolean(sourceSessions?.hidden)
      && readPreferences().sidebarCollapsedSources?.includes(expected.sourceKey)
      && document.activeElement === sourceItem;
    sourceToggle = document.querySelector(
      '[data-sidebar-source-toggle="' + CSS.escape(expected.sourceKey) + '"]'
    );
    sourceToggle?.click();
    await twoFrames();
    sourceItem = document.querySelector(
      '[data-sidebar-source-key="' + CSS.escape(expected.sourceKey) + '"] [data-source-workspace]'
    );
    sourceSessions = sourceItem && document.getElementById(sourceItem.getAttribute('aria-owns'));
    const sourceExpanded = !app.state.sidebarCollapsedSources.has(expected.sourceKey)
      && sourceItem?.getAttribute('aria-expanded') === 'true'
      && !sourceSessions?.hidden
      && !readPreferences().sidebarCollapsedSources?.includes(expected.sourceKey);
    return {
      ok: selected && projectCollapsed && projectExpanded && sourceCollapsed && sourceExpanded,
      expected, selected, projectCollapsed, projectExpanded, sourceCollapsed, sourceExpanded,
      interactions: ${JSON.stringify(PROJECT_TREE_INTERACTIONS)},
    };
  })()`);
  assert(projectTree.ok && projectTree.interactions.length === PROJECT_TREE_INTERACTIONS.length,
    '프로젝트/프로그램 트리 상호작용이 올바르지 않습니다: ' + JSON.stringify(projectTree));
  await prepareProject(win);
  const navigation = await rendererValue(win, "(async()=>{"
    + "const result=[];"
    + "for(const view of ['active','waiting','settings','all']){"
      + "const button=document.querySelector('[data-view=\"'+view+'\"]');"
      + "if(!button)return{ok:false,missing:view,result};button.click();"
      + "await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));"
      + "result.push({requested:view,selected:window.WhiteboxApp.state.view});}"
    + "return{ok:result.every(item=>item.requested===item.selected),result,"
      + "removedNavigationAbsent:!document.querySelector("
        + "'[data-view=\"runtime\"],[data-view=\"tmux\"],#advancedToolsNav,#mobileMoreBtn,#mobileToolsMenu')};"
    + "})()");
  assert(navigation.ok && navigation.removedNavigationAbsent,
    '기본 화면 이동 또는 삭제된 추가 기능 영역 계약이 올바르지 않습니다: '
      + JSON.stringify(navigation));

  await rendererValue(win, "document.querySelector('[data-view=\"settings\"]')?.click()");
  await waitFor(win,
    "window.WhiteboxApp.state.view==='settings'"
      + "&&!document.querySelector('#settingsSection')?.classList.contains('hidden')",
    '설정 화면을 열지 못했습니다.');
  const providerRollback = await rendererValue(win, "(()=>{const input=document.querySelector('[data-provider-visibility]');"
    + "window.__providerVisibilityBefore=input?.checked;window.__providerVisibilityId=input?.dataset.providerVisibility||'';"
    + "window.interactionTest.clearCalls();window.interactionTest.configure({failures:{setProviderVisibility:1}});"
    + "input?.click();return{found:Boolean(input),id:window.__providerVisibilityId,before:window.__providerVisibilityBefore};})()");
  assert(providerRollback.found && providerRollback.id, 'AI 표시 설정 rollback 검증 대상을 찾지 못했습니다.');
  await waitFor(win,
    "window.interactionTest.getCalls().filter(call=>call.name==='setProviderVisibility').length===1"
      + "&&(()=>{const input=document.querySelector('[data-provider-visibility=\"'"
        + "+CSS.escape(window.__providerVisibilityId)+'\"]');"
        + "return input&&!input.disabled&&input.checked===window.__providerVisibilityBefore;})()",
    'AI 표시 설정 저장 실패 뒤 checkbox가 원래 상태로 rollback되지 않았습니다.');
  await rendererValue(win, "window.interactionTest.clearControls();window.interactionTest.clearCalls()");
  const settings = await rendererValue(win, "(async()=>{"
    + "const language=document.querySelector('#languageSelect');const before=language?.value||'';"
    + "if(language){language.value='en';language.dispatchEvent(new Event('change',{bubbles:true}));}"
    + "document.querySelector('[data-theme-choice=\"light\"]')?.click();"
    + "await new Promise(resolve=>requestAnimationFrame(resolve));"
    + "const light=document.documentElement.dataset.theme==='light';"
    + "document.querySelector('[data-theme-choice=\"dark\"]')?.click();"
    + "await new Promise(resolve=>requestAnimationFrame(resolve));"
    + "const dark=document.documentElement.dataset.theme==='dark';"
    + "const provider=document.querySelector('[data-provider-visibility]');"
    + "const providerId=provider?.dataset.providerVisibility||'';const providerBefore=provider?.checked;provider?.click();"
    + "await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));"
    + "const changedProvider=document.querySelector('[data-provider-visibility=\"'+CSS.escape(providerId)+'\"]');"
    + "const providerChanged=changedProvider?changedProvider.checked!==providerBefore:false;changedProvider?.click();"
    + "await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));"
    + "const restoredProvider=document.querySelector('[data-provider-visibility=\"'+CSS.escape(providerId)+'\"]');"
    + "if(language){language.value=before||'ko';language.dispatchEvent(new Event('change',{bubbles:true}));}"
    + "return{languageRestored:Boolean(language&&language.value===(before||'ko')),light,dark,providerChanged,"
      + "providerRestored:Boolean(restoredProvider&&restoredProvider.checked===providerBefore),"
      + "noPopupSettings:!document.querySelector('#attentionPopupSettingsCard,#attentionPopupEnabled')};"
    + "})()");
  assert(settings.languageRestored && settings.light && settings.dark
    && settings.providerChanged && settings.providerRestored && settings.noPopupSettings,
  '언어·테마·AI 표시 설정 상호작용이 올바르지 않습니다: ' + JSON.stringify(settings));

  await rendererValue(win, "(()=>{window.interactionTest.restoreCurrentUpdate();"
    + "window.interactionTest.clearCalls();document.querySelector('#checkUpdateBtn')?.click();})()");
  await waitFor(win,
    "window.interactionTest.getCalls().some(call=>call.name==='checkForUpdate')"
      + "&&window.WhiteboxApp.state.update?.status==='available'",
    '설정의 업데이트 확인 동작이 최신 상태를 반영하지 못했습니다.');
}

async function exerciseQualityAndProviderUsage(win) {
  await rendererValue(win, "document.querySelector('[data-view=\"settings\"]')?.click()");
  await waitFor(win, "window.WhiteboxApp.state.view==='settings'", '품질 기능 검증용 설정 화면을 열지 못했습니다.');
  await rendererValue(win, "document.querySelector('#shortcutHelpBtn')?.focus();document.querySelector('#shortcutHelpBtn')?.click()");
  await waitFor(win,
    "!document.querySelector('#shortcutHelpModal')?.classList.contains('hidden')"
      + "&&document.querySelector('#appShell')?.inert&&document.activeElement?.id==='closeShortcutHelpBtn'",
    '단축키 도움말이 배경 격리와 초기 초점을 제공하지 못했습니다.');
  await rendererValue(win, "document.querySelector('#closeShortcutHelpBtn')?.click()");
  await waitFor(win,
    "document.querySelector('#shortcutHelpModal')?.classList.contains('hidden')"
      + "&&!document.querySelector('#appShell')?.inert&&document.activeElement?.id==='shortcutHelpBtn'",
    '단축키 도움말을 닫은 뒤 원래 초점이 복원되지 않았습니다.');

  const storage = await rendererValue(win, "(()=>{const app=window.WhiteboxApp;"
    + "const original=localStorage.getItem(app.DASHBOARD_STORAGE_KEY);"
    + "localStorage.setItem(app.DASHBOARD_STORAGE_KEY,JSON.stringify({version:2,search:'  fixture   task  ',"
      + "providers:['gpt'],workspace:'D:\\\\fixture',sort:'tokens',controlRoomSort:'context'}));"
    + "app.loadQualityState();const restored={search:app.state.search,providers:[...app.state.providerFilters],"
      + "workspace:app.state.workspace,sort:app.state.sort,controlRoomSort:app.state.controlRoomSort};"
    + "localStorage.setItem(app.DASHBOARD_STORAGE_KEY,'{broken');app.loadQualityState();"
    + "const recovered={search:app.state.search,providers:app.state.providerFilters.size,workspace:app.state.workspace,"
      + "sort:app.state.sort,controlRoomSort:app.state.controlRoomSort};"
    + "if(original==null)localStorage.removeItem(app.DASHBOARD_STORAGE_KEY);else localStorage.setItem(app.DASHBOARD_STORAGE_KEY,original);"
    + "app.loadQualityState();app.render('interaction-quality-storage');return{restored,recovered};})()");
  assert(storage.restored.search === 'fixture task' && storage.restored.providers[0] === 'gpt'
    && storage.restored.sort === 'tokens' && storage.restored.controlRoomSort === 'context',
  '대시보드 품질 설정 복원이 올바르지 않습니다: ' + JSON.stringify(storage));
  assert(storage.recovered.search === '' && storage.recovered.providers === 0
    && storage.recovered.workspace === 'all' && storage.recovered.sort === 'recent'
    && storage.recovered.controlRoomSort === 'recent',
  '손상된 대시보드 품질 설정을 기본값으로 복구하지 못했습니다: ' + JSON.stringify(storage));

  await prepareProject(win);
  const usage = await rendererValue(win, "(()=>{const overview=document.querySelector('#sessionTokenOverview');return{"
    + "cards:overview?.querySelectorAll('[data-token-provider]').length||0,"
    + "gauges:overview?.querySelectorAll('[role=\"progressbar\"]').length||0,"
    + "labels:[...(overview?.querySelectorAll('.session-token-detail')||[])].map(node=>node.textContent.trim()),"
    + "overflow:Boolean(overview&&overview.scrollWidth>overview.clientWidth+2),"
    + "duplicate:Boolean(document.querySelector('.provider-usage-disclosure,[data-provider-usage-refresh]'))};})()");
  assert(usage.cards >= 1 && usage.gauges >= 1 && usage.labels.some(label => /\d|used|사용/u.test(label))
    && !usage.overflow && !usage.duplicate,
  '상단 AI별 사용량 단일 표시가 올바르지 않습니다: ' + JSON.stringify(usage));

  await rendererValue(win, "window.interactionTest.clearCalls();window.interactionTest.configure({failures:{providerUsage:1}})");
  const usageFailure = await rendererValue(win, "window.WhiteboxApp.refreshProviderUsage(true)"
    + ".then(()=>({failed:false})).catch(error=>({failed:true,message:error.message,loading:window.WhiteboxApp.state.providerUsageLoading}))");
  const failedUsageCalls = await rendererValue(win,
    "window.interactionTest.getCalls().filter(call=>call.name==='providerUsage').length");
  assert(usageFailure.failed && usageFailure.loading === false && failedUsageCalls === 1,
    'AI 사용량 새로고침 실패가 loading 상태를 남기거나 중복 호출되었습니다: '
      + JSON.stringify({ usageFailure, failedUsageCalls }));
  await rendererValue(win, "window.interactionTest.clearControls();window.interactionTest.clearCalls();"
    + "window.WhiteboxApp.refreshProviderUsage(true)");
  await waitFor(win,
    "window.interactionTest.getCalls().filter(call=>call.name==='providerUsage').length===1"
      + "&&window.WhiteboxApp.state.providerUsage?.providers?.claude?.available===true",
    'AI 사용량 실패 뒤 정상 새로고침이 복구되지 않았습니다.');
}

async function exerciseUpdateDetails(win) {
  await rendererValue(win, "(()=>{window.interactionTest.restoreCurrentUpdate();"
    + "window.interactionTest.clearControls();window.interactionTest.clearCalls();"
    + "window.WhiteboxApp.selectView('settings');})()");
  await waitFor(win,
    "window.WhiteboxApp.state.update?.status==='current'"
      + "&&Boolean(document.querySelector('#currentVersion')?.textContent)"
      + "&&document.querySelector('#checkUpdateBtn')&&!document.querySelector('#checkUpdateBtn').disabled",
    '현재 버전 업데이트 상태가 설정 화면에 표시되지 않았습니다.');

  await rendererValue(win, "window.interactionTest.configure({failures:{checkForUpdate:1}});"
    + "document.querySelector('#checkUpdateBtn')?.click()");
  await waitFor(win,
    "window.interactionTest.getCalls().filter(call=>call.name==='checkForUpdate').length===1"
      + "&&window.WhiteboxApp.state.update?.status==='error'&&!document.querySelector('#checkUpdateBtn')?.disabled",
    '업데이트 확인 실패가 오류 상태와 재시도 가능한 버튼으로 복구되지 않았습니다.');

  await rendererValue(win, "window.interactionTest.clearControls();window.interactionTest.clearCalls();"
    + "window.interactionTest.configure({delays:{checkForUpdate:160}});"
    + "document.querySelector('#checkUpdateBtn')?.click();document.querySelector('#checkUpdateBtn')?.click()");
  await waitFor(win,
    "window.WhiteboxApp.state.update?.status==='available'"
      + "&&window.interactionTest.getCalls().some(call=>call.name==='checkForUpdate')",
    '업데이트 재확인이 최신 릴리스를 표시하지 못했습니다.');
  const updateCheckCount = await rendererValue(win,
    "window.interactionTest.getCalls().filter(call=>call.name==='checkForUpdate').length");
  assert(updateCheckCount === 1, '업데이트 확인 연속 클릭이 중복 요청을 만들었습니다: ' + updateCheckCount);
  const updateBadge = await rendererValue(win, "(()=>{const badge=document.querySelector('#navUpdateBadge');"
    + "const settings=document.querySelector('#sidebarSettingsBtn');return{available:Boolean(badge&&!badge.classList.contains('hidden')"
      + "&&badge.textContent.trim()),label:settings?.getAttribute('aria-label')||'',"
      + "title:settings?.getAttribute('title')||''};})()");
  assert(updateBadge.available && updateBadge.label.includes('1.5.2') && updateBadge.title.includes('1.5.2'),
    '설정 진입점의 업데이트 배지·접근성 설명이 올바르지 않습니다: ' + JSON.stringify(updateBadge));

  await rendererValue(win, "window.interactionTest.clearControls();window.interactionTest.clearCalls();"
    + "window.interactionTest.configure({delays:{installDownloadedUpdate:160}});"
    + "document.querySelector('#installUpdateBtn')?.click();document.querySelector('#installUpdateBtn')?.click()");
  await waitFor(win,
    "window.WhiteboxApp.state.update?.status==='downloaded'"
      + "&&window.interactionTest.getCalls().some(call=>call.name==='installDownloadedUpdate')",
    '업데이트 설치 경로가 검증된 다운로드 상태를 반영하지 못했습니다.');
  const updateInstallCount = await rendererValue(win,
    "window.interactionTest.getCalls().filter(call=>call.name==='installDownloadedUpdate').length");
  assert(updateInstallCount === 1, '업데이트 설치 연속 클릭이 중복 요청을 만들었습니다: ' + updateInstallCount);
  await rendererValue(win, "window.interactionTest.clearControls()");
}

async function exerciseKeyboardAndRunModal(win) {
  await rendererValue(win, "document.dispatchEvent(new KeyboardEvent('keydown',"
    + "{key:'k',ctrlKey:true,bubbles:true,cancelable:true}))");
  await waitFor(win,
    "!document.querySelector('#quickPaletteModal')?.classList.contains('hidden')"
      + "&&document.activeElement?.id==='quickPaletteInput'",
    'Ctrl+K 빠른 이동 검색을 열지 못했습니다.');
  await rendererValue(win, "(()=>{const input=document.querySelector('#quickPaletteInput');"
    + "input.value='settings';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await waitFor(win, "document.querySelectorAll('[data-quick-command]:not([hidden])').length>=1",
    '빠른 이동 검색 결과가 표시되지 않았습니다.');
  const quickKeyboard = await rendererValue(win, "(()=>{const input=document.querySelector('#quickPaletteInput');"
    + "input.value='일치하지않는명령';input.dispatchEvent(new Event('input',{bubbles:true}));"
    + "const empty=document.querySelectorAll('[data-quick-command]').length===0"
      + "&&Boolean(document.querySelector('#quickPaletteStatus')?.textContent);"
    + "input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));"
    + "input.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));"
    + "const endSelected=document.querySelector('[data-quick-command]:last-child')?.getAttribute('aria-selected')==='true';"
    + "input.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));"
    + "return{empty,endSelected,activeDescendant:input.getAttribute('aria-activedescendant'),"
      + "labelled:Boolean(input.getAttribute('aria-label')),count:document.querySelectorAll('[data-quick-command]').length};})()");
  assert(quickKeyboard.empty && quickKeyboard.endSelected && quickKeyboard.activeDescendant
    && quickKeyboard.labelled && quickKeyboard.count >= 8,
  '빠른 이동 검색의 빈 결과·Home/End·ARIA 계약이 올바르지 않습니다: ' + JSON.stringify(quickKeyboard));
  await rendererValue(win, "document.querySelector('#closeQuickPaletteBtn')?.click()");
  await waitFor(win,
    "document.querySelector('#quickPaletteModal')?.classList.contains('hidden')"
      + "&&!document.querySelector('#appShell')?.inert",
    '빠른 이동 검색을 닫은 뒤 배경 상호작용이 복원되지 않았습니다.');

  await prepareProject(win);
  await rendererValue(win, "document.querySelector('#newRunBtn')?.click()");
  await waitFor(win,
    "!document.querySelector('#runModal')?.classList.contains('hidden')"
      + "&&document.activeElement?.id==='runPrompt'&&document.querySelector('#appShell')?.inert",
    '새 AI 작업 창이 열리거나 배경을 격리하지 못했습니다.');
  const runMetrics = await rendererValue(win, "(()=>{"
    + "const modal=document.querySelector('#runModal .run-modal');const rect=modal?.getBoundingClientRect();"
    + "const prompt=document.querySelector('#runPrompt');const providers=document.querySelector('#runProviderPicker');"
    + "return{insideViewport:Boolean(rect&&rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight),"
      + "promptFirst:Boolean(prompt&&providers&&(prompt.compareDocumentPosition(providers)"
        + "&Node.DOCUMENT_POSITION_FOLLOWING)),"
      + "oldConversationAbsent:!document.querySelector('#drawerComposer,[data-conversation-shell]')};})()");
  assert(runMetrics.insideViewport && runMetrics.promptFirst && runMetrics.oldConversationAbsent,
    '새 AI 작업 modal 계약이 올바르지 않습니다: ' + JSON.stringify(runMetrics));

  await rendererValue(win, "(()=>{const prompt=document.querySelector('#runPrompt');"
    + "prompt.value='   ';prompt.dispatchEvent(new Event('input',{bubbles:true}));"
    + "document.querySelector('#runForm')?.requestSubmit();})()");
  await waitFor(win,
    "document.querySelector('#runPrompt')?.getAttribute('aria-invalid')==='true'"
      + "&&document.activeElement?.id==='runPrompt'"
      + "&&!document.querySelector('#runError')?.classList.contains('hidden')"
      + "&&window.interactionTest.getCalls().filter(call=>"
        + "['terminalCreate','runAgent'].includes(call.name)).length===0",
    '새 작업 form이 공백 요청을 거부하거나 오류 입력으로 초점을 옮기지 못했습니다.');

  await rendererValue(win, "(()=>{window.interactionTest.clearCalls();"
    + "window.interactionTest.configure({failures:{terminalCreate:2}});"
    + "document.querySelector('[data-run-provider=\"codex\"]')?.click();"
    + "const prompt=document.querySelector('#runPrompt');prompt.value='실패해도 보존할 새 작업 요청';"
    + "prompt.dispatchEvent(new Event('input',{bubbles:true}));"
    + "document.querySelector('#runModel').value='failure-model';"
    + "document.querySelector('#runForm')?.requestSubmit();})()");
  await waitFor(win,
    "window.interactionTest.getCalls().filter(call=>call.name==='terminalCreate').length===2"
      + "&&!document.querySelector('#runError')?.classList.contains('hidden')"
      + "&&document.activeElement?.id==='runError'"
      + "&&!document.querySelector('#runModal')?.classList.contains('hidden')"
      + "&&document.querySelector('#runPrompt')?.value==='실패해도 보존할 새 작업 요청'"
      + "&&document.querySelector('#runCwd')?.value==='D:\\\\fixture'"
      + "&&document.querySelector('#runForm button[type=\"submit\"]')?.dataset.submitting==='false'",
    '새 작업 PTY 생성 실패가 오류·초안·프로젝트 잠금·재시도 상태를 보존하지 못했습니다.');
  const failureCalls = await rendererValue(win,
    "window.interactionTest.getCalls().filter(call=>call.name==='runAgent').length");
  assert(failureCalls === 0, '직접 새 작업 실패가 legacy runAgent 경로를 호출했습니다.');

  await rendererValue(win, "(()=>{window.interactionTest.clearControls();"
    + "window.interactionTest.restoreTerminals();window.interactionTest.clearCalls();"
    + "const prompt=document.querySelector('#runPrompt');prompt.value='실제 DOM submit PTY 집중 모드 검증';"
    + "prompt.dispatchEvent(new Event('input',{bubbles:true}));"
    + "document.querySelector('#runModel').value='gpt-fixture';"
    + "const writes=document.querySelector('#allowWrites');"
    + "if(writes&&!writes.checked)writes.click();"
    + "document.querySelector('#runForm')?.requestSubmit();})()");
  await waitFor(win,
    "window.interactionTest.getCalls().filter(call=>call.name==='terminalCreate').length===1"
      + "&&document.querySelector('#runModal')?.classList.contains('hidden')",
    '새 작업 form submit이 지속형 PTY를 한 번 만들고 modal을 닫지 못했습니다.');
  const submitted = await rendererValue(win, "(()=>{const calls=window.interactionTest.getCalls();"
    + "const creates=calls.filter(call=>call.name==='terminalCreate');const payload=creates[0]?.args?.[0]||{};"
    + "return{creates:creates.length,legacyRuns:calls.filter(call=>call.name==='runAgent').length,payload};})()");
  assert(submitted.creates === 1 && submitted.legacyRuns === 0
    && submitted.payload.type === 'agent' && submitted.payload.provider === 'codex'
    && submitted.payload.cwd === 'D:\\fixture'
    && submitted.payload.initialCommand === '실제 DOM submit PTY 집중 모드 검증'
    && submitted.payload.initialCommandInArgs === true
    && submitted.payload.args.includes('gpt-fixture')
    && submitted.payload.args.includes('workspace-write')
    && Boolean(submitted.payload.creationId),
  '새 작업 form의 exact PTY 생성 payload가 올바르지 않습니다: ' + JSON.stringify(submitted));
  await rendererValue(win, "document.querySelector('[data-view=\"all\"]')?.click();"
    + "window.interactionTest.restoreTerminals();window.interactionTest.clearCalls()");
  await waitFor(win,
    "document.querySelector('#runModal')?.classList.contains('hidden')"
      + "&&!document.querySelector('#appShell')?.inert",
    '새 AI 작업 완료 뒤 배경과 작업 현황을 복원하지 못했습니다.');
}

async function exerciseApprovalQuickResponse(win) {
  await prepareProject(win);
  const target = await rendererValue(win, "(()=>{const app=window.WhiteboxApp;"
    + "const session=app.state.snapshot.sessions.find(item=>item.id==='fixture-waiting');"
    + "const terminal={id:'terminal-waiting',type:'agent',title:'승인 응답 PTY',status:'running',pid:41998,"
      + "cwd:session.cwd||'D:\\\\fixture',provider:session.provider,bridgeId:session.id,"
      + "agentResumeSessionId:session.externalId,agentConnectionSignature:"
        + "window.interactionTest.connectionSignatureForSession(session),conversationBound:true,"
      + "background:true,backend:'direct',distro:'',outputSequence:0};"
    + "window.interactionTest.addTerminal(terminal);window.interactionTest.emitTerminalState('updated');"
    + "app.selectViewFromUser?.('waiting',{motionKind:'filter'});"
    + "if(app.state.view!=='waiting')app.selectView('waiting');return terminal;})()");
  assert(target.id === 'terminal-waiting', '승인 빠른 응답용 exact PTY fixture를 만들지 못했습니다.');
  await waitFor(win,
    "(()=>{const card=document.querySelector('[data-management-session=\"fixture-waiting\"]');"
      + "const form=card?.querySelector('[data-agent-command-form=\"fixture-waiting\"]');"
      + "return Boolean(card?.querySelector('[data-attention-quick].approve')&&form"
        + "&&form.dataset.agentTerminalReady==='true'"
        + "&&form.dataset.agentSendAvailable==='true');})()",
    '확인 대기 카드의 승인 빠른 응답이 exact PTY와 연결되지 않았습니다.');
  const approveCommand = await rendererValue(win,
    "document.querySelector('[data-management-session=\"fixture-waiting\"] "
      + "[data-attention-quick].approve')?.dataset.attentionQuick||''");
  assert(approveCommand, '승인 빠른 응답의 실제 전달 문구를 찾지 못했습니다.');
  await rendererValue(win, "window.interactionTest.clearCalls();"
    + "document.querySelector('[data-management-session=\"fixture-waiting\"] "
      + "[data-attention-quick].approve')?.click()");
  await waitFor(win,
    "(()=>{const calls=window.interactionTest.getCalls();const embedded=window.WhiteboxTerminal.embeddedState();"
      + "return calls.filter(call=>call.name==='terminalCommand'"
        + "&&call.args[0]==='terminal-waiting'&&call.args[1]===" + JSON.stringify(approveCommand) + ").length===1"
        + "&&!calls.some(call=>call.name==='terminalCreate')"
        + "&&window.WhiteboxApp.state.ptyFocusSessionId==='fixture-waiting'"
        + "&&window.WhiteboxApp.state.ptyFocusTargetId==='terminal-waiting'"
        + "&&embedded.connected&&embedded.terminalId==='terminal-waiting'"
        + "&&document.querySelector('#ptyFocusTerminalViewport .xterm');})()",
    '승인 빠른 응답 클릭이 exact 기존 PTY로 한 번 전달되고 집중 모드를 열지 못했습니다.');
  await rendererValue(win, "document.querySelector('#ptyFocusBackBtn')?.click()");
  await waitFor(win,
    "!window.WhiteboxApp.state.ptyFocusSessionId"
      + "&&document.querySelector('#ptyFocusSurface')?.classList.contains('hidden')"
      + "&&!document.querySelector('#mainContent')?.inert",
    '승인 응답 PTY 집중 모드에서 작업 현황으로 돌아오지 못했습니다.');
  await rendererValue(win, "window.interactionTest.removeTerminal('terminal-waiting');"
    + "window.interactionTest.emitTerminalState('removed');window.interactionTest.clearCalls();"
    + "window.WhiteboxApp.selectViewFromUser?.('all',{motionKind:'filter'})");
  await prepareProject(win);
}

async function exerciseDashboardGraphAndManagement(win) {
  await prepareProject(win);
  const sidebarReorder = await rendererValue(win, "(()=>{const app=window.WhiteboxApp;"
    + "const items=[...document.querySelectorAll('#projectSidebarList "
      + ".project-sidebar-project[data-project-sortable] .project-sidebar-item')];"
    + "if(items.length<2)return{ok:false,count:items.length};window.__interactionProjectOrder=[...(app.state.projectOrder||[])];"
    + "const source=items[0],target=items[1];const sourceId=source.closest('[data-project-sortable]').dataset.projectSortable;"
    + "const targetId=target.closest('[data-project-sortable]').dataset.projectSortable;source.focus();"
    + "const event=new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true});"
    + "source.dispatchEvent(event);return{ok:event.defaultPrevented,sourceId,targetId};})()");
  assert(sidebarReorder.ok, '프로젝트 사이드바 재배치 대상을 찾지 못했습니다: '
    + JSON.stringify(sidebarReorder));
  await waitFor(win,
    "window.WhiteboxApp.state.projectOrder.indexOf(" + JSON.stringify(sidebarReorder.sourceId) + ")>"
      + "window.WhiteboxApp.state.projectOrder.indexOf(" + JSON.stringify(sidebarReorder.targetId) + ")"
      + "&&document.activeElement?.closest('[data-project-sortable]')?.dataset.projectSortable==="
        + JSON.stringify(sidebarReorder.sourceId),
    '프로젝트 사이드바 Alt+아래 재배치가 순서·초점을 함께 갱신하지 못했습니다.');
  await rendererValue(win, "(()=>{const app=window.WhiteboxApp;app.state.projectOrder=window.__interactionProjectOrder||[];"
    + "delete window.__interactionProjectOrder;app.saveDashboardPreferences?.();app.renderWorkspaces?.();"
    + "window.__interactionWorkspaces=structuredClone(app.state.workspaces||[]);"
    + "app.state.workspaces=[...app.state.workspaces,{name:'삭제 상호작용 fixture',path:'D:\\\\remove-fixture'}];"
    + "app.renderWorkspaces?.();window.interactionTest.clearCalls();"
    + "const item=[...document.querySelectorAll('#projectSidebarList [data-workspace]')]"
      + ".find(node=>node.dataset.workspace==='D:\\\\remove-fixture');"
    + "item?.focus();item?.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));})()");
  await waitFor(win,
    "window.interactionTest.getCalls().filter(call=>call.name==='removeWorkspace'"
      + "&&call.args[0]==='D:\\\\remove-fixture').length===1"
      + "&&![...document.querySelectorAll('#projectSidebarList [data-workspace]')]"
        + ".some(node=>node.dataset.workspace==='D:\\\\remove-fixture')",
    '프로젝트 사이드바 Delete 상호작용이 정확한 저장 프로젝트를 한 번 제거하지 못했습니다.');
  await rendererValue(win, "(()=>{const app=window.WhiteboxApp;app.state.workspaces=window.__interactionWorkspaces||[];"
    + "delete window.__interactionWorkspaces;app.state.dismissedProjects?.delete?.('d:\\\\remove-fixture');"
    + "app.renderWorkspaces?.();window.interactionTest.clearCalls();})()");
  const overview = await rendererValue(win, "(()=>({"
    + "rooms:document.querySelectorAll('#liveSessionGrid [data-control-session]').length,"
    + "roots:document.querySelectorAll('#liveSessionGrid .control-room-main').length,"
    + "helpers:document.querySelectorAll('[data-control-session=\"fixture-root\"] .helper-node').length,"
    + "executions:document.querySelectorAll('[data-control-session=\"fixture-root\"] .execution-node').length,"
    + "completed:document.querySelectorAll('[data-control-session=\"fixture-root\"] .completed-list .control-room-node').length,"
    + "search:Boolean(document.querySelector('#controlRoomSearchInput')),"
    + "sort:Boolean(document.querySelector('#controlRoomSortSelect')),"
    + "expand:Boolean(document.querySelector('#controlRoomExpandAll')),"
    + "collapse:Boolean(document.querySelector('#controlRoomCollapseAll'))}))()");
  assert(overview.rooms >= 2 && overview.roots === overview.rooms && overview.helpers >= 1
    && overview.executions >= 1 && overview.completed >= 1
    && overview.search && overview.sort && overview.expand && overview.collapse,
  '작업 현황의 검색·정렬·관리 구조가 올바르지 않습니다: ' + JSON.stringify(overview));

  await rendererValue(win, "(()=>{const input=document.querySelector('#controlRoomSearchInput');"
    + "input.value='화면 개선';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await waitFor(win,
    "window.WhiteboxApp.state.search==='화면 개선'"
      + "&&document.querySelectorAll('#liveSessionGrid [data-control-session]').length>=1",
    '작업 현황 검색이 실제 root 목록을 좁히지 못했습니다.');
  await rendererValue(win, "(()=>{const input=document.querySelector('#controlRoomSearchInput');"
    + "input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));})()");
  await waitFor(win, "window.WhiteboxApp.state.search===''", '작업 현황 검색 Escape 초기화가 동작하지 않았습니다.');

  await rendererValue(win, "(()=>{const select=document.querySelector('#controlRoomSortSelect');"
    + "select.value='tokens';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor(win, "window.WhiteboxApp.state.controlRoomSort==='tokens'",
    '작업 현황 사용량 정렬이 상태에 반영되지 않았습니다.');
  await rendererValue(win, "document.querySelector('#controlRoomCollapseAll')?.click()");
  await waitFor(win,
    "[...document.querySelectorAll('#liveSessionGrid .control-room-project-group')].every(group=>!group.open)",
    '작업 현황 전체 접기가 동작하지 않았습니다.');
  await rendererValue(win, "document.querySelector('#controlRoomExpandAll')?.click()");
  await waitFor(win,
    "[...document.querySelectorAll('#liveSessionGrid .control-room-project-group')].every(group=>group.open)",
    '작업 현황 전체 펼치기가 동작하지 않았습니다.');

  const reorder = await rendererValue(win, "(()=>{const list=document.querySelector('#liveSessionGrid');"
    + "const items=[...list.querySelectorAll('[data-control-session][data-session-sortable]')];"
    + "if(items.length<2)return{ok:false,count:items.length};const source=items[0],target=items[1];"
    + "const sourceId=source.dataset.sessionSortable,targetId=target.dataset.sessionSortable;source.focus();"
    + "const event=new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true});"
    + "source.dispatchEvent(event);return{ok:event.defaultPrevented,sourceId,targetId,"
      + "order:[...window.WhiteboxApp.state.sessionOrder]};})()");
  assert(reorder.ok && reorder.order.indexOf(reorder.sourceId) > reorder.order.indexOf(reorder.targetId),
    'Alt+아래 방향키 작업 재배치가 고정 순서를 바꾸지 못했습니다: ' + JSON.stringify(reorder));
  await waitFor(win,
    "document.activeElement?.dataset.sessionSortable===" + JSON.stringify(reorder.sourceId),
    '작업 재배치 뒤 이동한 카드로 초점을 복원하지 못했습니다.');

  await rendererValue(win, "(()=>{window.interactionTest.clearCalls();"
    + "document.querySelector('#sidebarNewProjectBtn')?.click();})()");
  await waitFor(win,
    "window.interactionTest.getCalls().filter(call=>call.name==='addWorkspaces').length===1"
      + "&&window.WhiteboxApp.state.workspace==='D:\\\\fixture'",
    '프로젝트 추가가 중복 없이 선택한 프로젝트를 열지 못했습니다.');

  await prepareProject(win);
  await rendererValue(win, "document.querySelector('[data-view=\"active\"]')?.click()");
  await waitFor(win, "window.WhiteboxApp.state.view==='active'&&document.querySelector('#searchInput')",
    '지난 작업 검색 화면을 열지 못했습니다.');
  await rendererValue(win, "(()=>{const input=document.querySelector('#searchInput');"
    + "input.value='지난 작업 34';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await waitFor(win,
    "window.WhiteboxApp.state.search==='지난 작업 34'"
      + "&&document.querySelectorAll('#sessionGrid [data-session-id]').length===1"
      + "&&!document.querySelector('#searchClearBtn')?.classList.contains('hidden')",
    '지난 작업 검색이 결과를 정확히 한 건으로 좁히지 못했습니다.');
  await rendererValue(win, "document.querySelector('#searchClearBtn')?.click()");
  await waitFor(win,
    "window.WhiteboxApp.state.search===''&&document.activeElement?.id==='searchInput'",
    '지난 작업 검색 지우기가 상태와 초점을 복원하지 못했습니다.');
  const providerId = await rendererValue(win,
    "document.querySelector('#providerFilter [data-provider-filter]:not([data-provider-filter=\"all\"])')?.dataset.providerFilter||''");
  assert(providerId, '지난 작업 AI 필터 대상을 찾지 못했습니다.');
  await rendererValue(win, "document.querySelector('[data-provider-filter=" + JSON.stringify(providerId).slice(1, -1)
    + "]')?.click()");
  await waitFor(win,
    "window.WhiteboxApp.state.providerFilters.has(" + JSON.stringify(providerId) + ")",
    '지난 작업 AI 필터가 상태에 반영되지 않았습니다.');
  await rendererValue(win, "(()=>{const sort=document.querySelector('#sortSelect');"
    + "sort.value='tokens';sort.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor(win,
    "window.WhiteboxApp.state.sort==='tokens'&&!document.querySelector('#resetFiltersBtn')?.classList.contains('hidden')",
    '지난 작업 복합 필터와 정렬이 적용되지 않았습니다.');
  await rendererValue(win, "document.querySelector('#resetFiltersBtn')?.click()");
  await waitFor(win,
    "window.WhiteboxApp.state.search===''&&window.WhiteboxApp.state.providerFilters.size===0"
      + "&&window.WhiteboxApp.state.workspace==='all'&&window.WhiteboxApp.state.sort==='recent'",
    '지난 작업 전체 필터 초기화가 기본값을 복원하지 못했습니다.');
  const beforeMore = await rendererValue(win,
    "document.querySelectorAll('#sessionGrid [data-session-id]').length");
  const canLoadMore = await rendererValue(win,
    "!document.querySelector('#loadMoreBtn')?.classList.contains('hidden')");
  assert(canLoadMore && beforeMore === 30, '지난 작업 더 보기 fixture가 30개 기준으로 준비되지 않았습니다: ' + beforeMore);
  await rendererValue(win, "document.querySelector('#loadMoreBtn')?.click()");
  const afterMore = await rendererValue(win,
    "document.querySelectorAll('#sessionGrid [data-session-id]').length");
  assert(afterMore > beforeMore, '지난 작업 더 보기로 카드 수가 늘지 않았습니다: ' + beforeMore + ' -> ' + afterMore);

  await prepareProject(win);
  await rendererValue(win, "document.querySelector('#liveSessionGrid [data-graph-focus=\"fixture-root\"]')?.click()");
  await waitFor(win,
    "window.WhiteboxApp.state.graphFocusId==='fixture-root'"
      + "&&!document.querySelector('#graphResetBtn')?.classList.contains('hidden')",
    '작업 흐름 제어가 선택한 root 그래프로 이동하지 못했습니다.');
  await rendererValue(win, "document.querySelector('#graphResetBtn')?.click()");
  await waitFor(win, "window.WhiteboxApp.state.graphFocusId===null",
    '작업 흐름 전체 목록 복귀가 동작하지 않았습니다.');

  await rendererValue(win, "(()=>{const app=window.WhiteboxApp;const requestedAt=new Date().toISOString();"
    + "app.state.snapshot.sessions=app.state.snapshot.sessions.map(session=>{"
      + "if(session.id==='fixture-root')return{...session,attention:{category:'required',required:true,"
        + "actionable:true,kind:'error',summary:'실행 중인 작업 제어를 확인해 주세요.',"
        + "requestText:'실행 중인 작업을 일시정지하거나 중지해 주세요.',"
        + "requestedAt,source:'input-tool',confidence:'high'}};"
      + "if(session.id==='fixture-failed')return{...session,attention:{category:'required',required:true,"
        + "actionable:true,kind:'error',summary:session.statusDetail,requestText:'실패한 작업을 처리해 주세요.',"
        + "requestedAt,source:'input-tool',confidence:'high'}};"
      + "if(session.id==='fixture-paused-run')return{...session,attention:{category:'required',required:true,"
        + "actionable:true,kind:'paused',summary:session.statusDetail,requestText:'멈춘 작업을 처리해 주세요.',"
        + "requestedAt,source:'input-tool',confidence:'high'}};return session;});"
    + "app.state.managementFilter='all';app.state.search='화면 설명과 버튼을 쉽게 개선하기';"
    + "app.selectViewFromUser?.('waiting',{motionKind:'filter'});"
    + "if(app.state.view!=='waiting')app.selectView('waiting');else app.renderSessions?.('interaction-management');})()");
  const failureRoute = await rendererValue(win, "(async()=>{"
    + "await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));"
    + "const card=document.querySelector('#attentionInbox [data-management-session=\"fixture-root\"]');"
    + "const primary=card?.querySelector('.attention-primary-action[data-open-session=\"fixture-root\"]');"
    + "const primaryRect=primary?.getBoundingClientRect();"
    + "const hiddenControls=[...card?.querySelectorAll('[data-managed-run-action]')||[]].map(button=>{"
      + "const rect=button.getBoundingClientRect();return{action:button.dataset.managedRunAction,"
        + "display:getComputedStyle(button.closest('.management-control-buttons')).display,width:rect.width,height:rect.height};});"
    + "window.interactionTest.clearCalls();primary?.click();"
    + "return{found:Boolean(primary),visible:Boolean(primaryRect&&primaryRect.width>0&&primaryRect.height>0),"
      + "hiddenControls};})()");
  assert(failureRoute.found && failureRoute.visible
    && failureRoute.hiddenControls.length >= 2
    && failureRoute.hiddenControls.every(control => control.display === 'none'
      && control.width === 0 && control.height === 0),
  '확인 대기 실패 카드는 숨은 legacy 관리 버튼 대신 보이는 PTY 진입만 제공해야 합니다: '
    + JSON.stringify(failureRoute));
  await assertFocusedRoot(win, '실패 카드의 확인 버튼 클릭');
  const routeEvidence = await rendererValue(win, "({"
    + "calls:window.interactionTest.getCalls().filter(call=>['terminalGet','terminalCreate'].includes(call.name)),"
    + "terminalIds:window.interactionTest.getTerminals().map(terminal=>terminal.id)})");
  assert(routeEvidence.terminalIds.includes('terminal-main')
    && !routeEvidence.calls.some(call => call.name === 'terminalCreate'),
  '실패 카드가 exact 기존 PTY 대신 새 PTY를 중복 생성했습니다: ' + JSON.stringify(routeEvidence));
  await closeFocusedRoot(win);
}

async function assertFocusedRoot(win, context) {
  await waitFor(win, "(()=>{const embedded=window.WhiteboxTerminal.embeddedState();"
    + "return window.WhiteboxApp.state.ptyFocusSessionId==='fixture-root'"
      + "&&window.WhiteboxApp.state.ptyFocusTargetId==='terminal-main'"
      + "&&!document.querySelector('#ptyFocusSurface')?.classList.contains('hidden')"
      + "&&embedded.connected&&embedded.agentSessionId==='fixture-root'"
      + "&&embedded.terminalId==='terminal-main'"
      + "&&document.querySelector('#ptyFocusTerminalViewport>"
        + ".terminal-screen[data-terminal-screen=\"terminal-main\"] .xterm');})()",
  context + ': 담당 root의 exact PTY 집중 모드가 열리지 않았습니다.');
}

async function closeFocusedRoot(win) {
  await rendererValue(win, "document.querySelector('#ptyFocusBackBtn')?.click()");
  await waitFor(win, "(()=>{const surface=document.querySelector('#ptyFocusSurface');"
    + "return !window.WhiteboxApp.state.ptyFocusSessionId"
      + "&&surface?.classList.contains('hidden')&&surface?.inert"
      + "&&!document.querySelector('#mainContent')?.inert&&!document.querySelector('.sidebar')?.inert;})()",
  'PTY 집중 모드에서 작업 현황으로 돌아오지 못했습니다.');
}

async function exercisePtyFocus(win, round) {
  await prepareProject(win);
  const rootClick = await rendererValue(win, "(()=>{"
    + "const trigger=document.querySelector('[data-pty-focus-trigger=\"fixture-root\"]');"
    + "trigger?.click();return Boolean(trigger);})()");
  assert(rootClick, '작업 현황의 root PTY trigger가 없습니다.');
  await assertFocusedRoot(win, 'root 작업 클릭');

  const marker = 'PTY_INTERACTION_ROUND_' + round + '_' + Date.now();
  await rendererValue(win, "window.interactionTest.emitTerminalData('terminal-main',"
    + JSON.stringify('\r\n' + marker + '\r\n') + ")");
  await waitFor(win,
    "[...document.querySelectorAll('#ptyFocusTerminalViewport .xterm-rows>div')]"
      + ".some(row=>(row.textContent||'').includes(" + JSON.stringify(marker) + "))",
    'PTY 집중 모드가 실제 xterm live 출력을 표시하지 못했습니다.');
  const metrics = await rendererValue(win, "(()=>{const surface=document.querySelector('#ptyFocusSurface');"
    + "const deleted=" + JSON.stringify(removedSelectors) + ";return{"
      + "surfaceInteractive:Boolean(surface&&!surface.inert&&surface.getAttribute('aria-hidden')==='false'),"
      + "backgroundInert:Boolean(document.querySelector('#mainContent')?.inert"
        + "&&document.querySelector('.sidebar')?.inert),"
      + "flowLanes:surface?.querySelectorAll('.pty-focus-flow-lane').length||0,"
      + "rootNodes:surface?.querySelectorAll('.pty-focus-root-node').length||0,"
      + "statusOnly:!document.querySelector('#ptyFocusFlow button,#ptyFocusFlow a,"
        + "#ptyFocusFlow input,#ptyFocusFlow textarea,#ptyFocusFlow select,"
        + "#ptyFocusFlow [contenteditable=\"true\"]'),"
      + "composerAbsent:!surface?.querySelector('[data-inline-terminal-composer],"
        + "[data-agent-command-form],[data-conversation-shell]'),"
      + "removedAbsent:deleted.every(selector=>!document.querySelector(selector)),"
      + "terminalCreates:window.interactionTest.getCalls()"
        + ".filter(call=>call.name==='terminalCreate').length};})()");
  assert(metrics.surfaceInteractive && metrics.backgroundInert && metrics.flowLanes === 3
    && metrics.rootNodes === 1 && metrics.statusOnly && metrics.composerAbsent
    && metrics.removedAbsent && metrics.terminalCreates === 0,
  'PTY focus-only 상호작용 계약이 올바르지 않습니다: ' + JSON.stringify(metrics));
  await closeFocusedRoot(win);

  const childClick = await rendererValue(win, "(()=>{"
    + "const child=document.querySelector('[data-open-subagent-chat=\"fixture-child\"]');"
    + "child?.click();return Boolean(child);})()");
  assert(childClick, '도움 AI 상태 노드가 작업 현황에 없습니다.');
  await assertFocusedRoot(win, '도움 AI 클릭');
  assert(await rendererValue(win, "window.WhiteboxApp.state.selectedId==='fixture-child'"),
    '도움 AI 클릭 시 선택한 상태 노드 identity를 보존하지 못했습니다.');
  await closeFocusedRoot(win);

  await rendererValue(win, "window.interactionTest.triggerAttention('fixture-root')");
  await assertFocusedRoot(win, '확인 필요 알림');
  await closeFocusedRoot(win);
  return { marker, metrics };
}

async function run() {
  installWorktreeDependencyRedirect();
  const rendererErrors = [];
  const reports = [];
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'interaction-fixture-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (_event, details, legacyMessage) => {
    const level = typeof details === 'object' ? details.level : details;
    const message = typeof details === 'object' ? details.message : String(legacyMessage || '');
    if (Number(level) >= 3) rendererErrors.push(message);
  });
  try {
    await win.loadFile(path.join(root, 'renderer', 'index.html'));
    await waitFor(win,
      "Boolean(window.WhiteboxApp?.initialized&&window.WhiteboxApp?.openPtyFocus"
        + "&&window.WhiteboxTerminal&&window.interactionTest)",
      'interaction renderer가 준비되지 않았습니다.', 20000);
    for (let round = 1; round <= roundCount; round += 1) {
      if (round > 1) {
        await win.reload();
        await waitFor(win, "Boolean(window.WhiteboxApp?.initialized&&window.interactionTest)",
          'renderer reload가 준비되지 않았습니다.', 20000);
      }
      await prepareProject(win);
      await exerciseNavigationAndSettings(win);
      await exerciseQualityAndProviderUsage(win);
      await exerciseUpdateDetails(win);
      await exerciseKeyboardAndRunModal(win);
      await exerciseApprovalQuickResponse(win);
      await exerciseDashboardGraphAndManagement(win);
      reports.push(await exercisePtyFocus(win, round));
    }
    assert(rendererErrors.length === 0, 'renderer 오류가 발생했습니다: ' + rendererErrors.join(' | '));
    process.stdout.write(JSON.stringify({ ok: true, rounds: reports }, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(String(error.stack || error) + '\n');
    process.exitCode = 1;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    app.exit(process.exitCode || 0);
  }
}

app.whenReady().then(run).catch(error => {
  process.stderr.write(String(error.stack || error) + '\n');
  app.exit(1);
});

app.on('quit', () => {
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
});
