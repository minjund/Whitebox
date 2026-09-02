'use strict';

// Responsive renderer coverage for the project-first shell and full PTY focus.
// Historical drawer/mobile-more/runtime-terminal view assumptions were removed
// together with those product surfaces.
const { app, BrowserWindow, session: electronSession } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'artifacts');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-responsive-pty-'));
const sizes = [
  [1440, 900], [1376, 900], [1375, 900], [1181, 820], [1180, 820],
  [1000, 760], [999, 760], [901, 700], [900, 700], [721, 640],
  [720, 640], [480, 720], [360, 520],
];
const removedSelectors = [
  '#detailDrawer', '#drawerBackdrop', '#drawerContent', '#drawerComposer',
  '#drawerTerminalSurface', '#drawerTerminalViewport', '#ptyFocusChildModal',
  '#ptyFocusChildBody', '#mobileMoreBtn', '#mobileToolsMenu', '#advancedToolsNav',
  '#terminalSection', '#terminalHistoryPanel', '#terminalHistoryList',
  '#automationOverview', '#tmuxSection', '#tmuxCreateModal',
];
fs.mkdirSync(outputDir, { recursive: true });
app.setPath('userData', userData);

function assert(value, message) {
  if (!value) throw new Error(message);
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function value(win, expression) {
  return win.webContents.executeJavaScript(expression);
}

async function waitFor(win, expression, message, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await value(win, expression)) return;
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

async function resize(win, width, height) {
  win.setContentSize(width, height);
  await wait(180);
  const actual = await value(win, "({width:innerWidth,height:innerHeight})");
  assert(Math.abs(actual.width - width) <= 1 && Math.abs(actual.height - height) <= 1,
    'viewport 크기가 적용되지 않았습니다: ' + JSON.stringify({ requested: [width, height], actual }));
  return actual;
}

async function showProjectSelection(win) {
  await value(win, "(()=>{const app=window.WhiteboxApp;app.closePtyFocus?.({restoreFocus:false});"
    + "document.querySelector('#cancelRunBtn')?.click();app.state.workspace='all';app.state.view='all';"
    + "app.state.graphFocusId=null;app.state.search='';app.state.providerFilters?.clear?.();"
    + "app.renderWorkspaces?.();app.renderSessions?.('responsive-project-selection');})()");
  await wait(80);
}

async function selectFixtureProject(win) {
  await value(win, "(()=>{const app=window.WhiteboxApp;"
    + "const root=(app.state.snapshot?.sessions||[]).find(item=>item.id==='fixture-root');"
    + "app.state.workspace=root?.originCwd||root?.cwd||'D:\\\\fixture';app.state.view='all';"
    + "app.state.graphFocusId=null;app.state.search='';app.state.providerFilters?.clear?.();"
    + "app.renderWorkspaces?.();app.renderSessions?.('responsive-project');})()");
  await waitFor(win, "Boolean(document.querySelector('[data-pty-focus-trigger=\"fixture-root\"]'))",
    '선택한 프로젝트의 PTY trigger가 표시되지 않았습니다.');
}

async function projectSelectionMetrics(win) {
  return value(win, "(()=>{const prompt=document.querySelector('#projectSelectionPrompt');"
    + "const rect=prompt?.getBoundingClientRect();const stage=document.querySelector('.main-stage');"
    + "const projects=document.querySelector('#sidebarProjects');const tree=document.querySelector('#projectSidebarList');"
    + "return{visible:Boolean(rect&&rect.width>0&&rect.height>0),"
      + "insideWidth:Boolean(rect&&rect.left>=-1&&rect.right<=innerWidth+1),"
      + "stageInside:Boolean(stage&&stage.getBoundingClientRect().left>=-1"
        + "&&stage.getBoundingClientRect().right<=innerWidth+1),"
      + "bodyOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,"
      + "promptOverflow:Boolean(prompt&&prompt.scrollWidth>prompt.clientWidth+2),"
      + "sidebarLabelled:Boolean(projects?.getAttribute('aria-labelledby')"
        + "&&document.getElementById(projects.getAttribute('aria-labelledby'))?.textContent.trim()),"
      + "projectTreeNamed:Boolean(tree?.getAttribute('role')==='tree'&&tree.getAttribute('aria-label')?.trim()),"
      + "removedAbsent:" + JSON.stringify(removedSelectors)
        + ".every(selector=>!document.querySelector(selector)),"
      + "extraViewsAbsent:!document.querySelector('[data-view=\"runtime\"],[data-view=\"tmux\"]')};})()");
}

async function dashboardMetrics(win) {
  return value(win, "(async()=>{const stage=document.querySelector('.main-stage');"
    + "const nav=document.querySelector('#projectContextNav');const topbar=document.querySelector('.topbar');"
    + "const before=stage?.scrollTop||0;if(stage)stage.scrollTop=Math.min(220,"
      + "Math.max(0,stage.scrollHeight-stage.clientHeight));"
    + "await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));"
    + "const navRect=nav?.getBoundingClientRect();const topRect=topbar?.getBoundingClientRect();"
    + "const stageRect=stage?.getBoundingClientRect();const navStyle=nav?getComputedStyle(nav):null;"
    + "const navButtons=[...(nav?.querySelectorAll('[data-view]')||[])];"
    + "const sidebar=document.querySelector('.sidebar');const sidebarStyle=sidebar?getComputedStyle(sidebar):null;"
    + "const compact=innerWidth<=720;const mobileLabels=[...document.querySelectorAll("
      + "'#projectViewTabs .mobile-nav-label')];const desktopLabels=[...document.querySelectorAll("
      + "'#projectViewTabs .desktop-nav-label')];"
    + "const newRun=document.querySelector('#newRunBtn');const rootPty=[...document.querySelectorAll("
      + "'[data-pty-focus-trigger=\"fixture-root\"]')].find(node=>node.getBoundingClientRect().height>0);"
    + "const cards=[...document.querySelectorAll('[data-control-session]')];"
    + "const result={rootTrigger:Boolean(document.querySelector("
      + "'[data-pty-focus-trigger=\"fixture-root\"]')),"
      + "visibleCards:cards.filter(card=>card.getBoundingClientRect().width>0"
        + "&&card.getBoundingClientRect().height>0).length,"
      + "helperNodes:document.querySelectorAll('[data-open-subagent-chat]').length,"
      + "statusOnly:!document.querySelector('#operationsOverview [data-conversation-shell],"
        + "#operationsOverview .conversation-composer'),"
      + "bodyOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,"
      + "stageOverflow:Boolean(stage&&stage.scrollWidth>stage.clientWidth+2),"
      + "navInside:Boolean(navRect&&navRect.left>=-1&&navRect.right<=innerWidth+1),"
      + "topbarInside:Boolean(topRect&&topRect.left>=-1&&topRect.right<=innerWidth+1),"
      + "navPosition:navStyle?.position||'',"
      + "navSticky:Boolean(navStyle?.position==='sticky'&&navRect&&stageRect"
        + "&&navRect.top>=stageRect.top+(Number.parseFloat(navStyle.top)||0)-2),"
      + "navAccessible:Boolean(document.querySelector('#projectViewTabs')?.getAttribute('aria-label')?.trim()"
        + "&&navButtons.length===3&&navButtons.every(button=>button.getAttribute('aria-label')?.trim()"
          + "&&String(button.getAttribute('aria-controls')||'').split(/\\s+/).filter(Boolean)"
            + ".every(id=>document.getElementById(id)))),"
      + "sidebarAccessible:Boolean(document.querySelector('#projectSidebarList[role=\"tree\"]')"
        + "?.getAttribute('aria-label')?.trim()),"
      + "compactDetails:{sidebarDisplay:sidebarStyle?.display||'',"
        + "navDisplay:navStyle?.display||'',navHidden:nav?.classList.contains('hidden')||false,"
        + "navAriaHidden:nav?.getAttribute('aria-hidden')||'',"
        + "newRunHeight:newRun?.getBoundingClientRect().height||0,"
        + "rootPtyHeight:rootPty?.getBoundingClientRect().height||0,"
        + "buttonHeights:navButtons.map(button=>button.getBoundingClientRect().height),"
        + "buttonDisplays:navButtons.map(button=>getComputedStyle(button).display),"
        + "mobileDisplays:mobileLabels.map(label=>getComputedStyle(label).display),"
        + "desktopDisplays:desktopLabels.map(label=>getComputedStyle(label).display)},"
      + "compactNavigation:compact?Boolean(sidebarStyle?.display==='none'"
        + "&&navButtons.every(button=>getComputedStyle(button).display==='none')"
        + "&&newRun?.getBoundingClientRect().height>=44"
        + "&&rootPty?.getBoundingClientRect().height>=38"
        + "&&!document.querySelector('#mobileMoreBtn,#mobileToolsMenu'))"
        + ":Boolean(sidebarStyle?.display!=='none'&&sidebar?.getBoundingClientRect().width>0),"
      + "removedAbsent:" + JSON.stringify(removedSelectors)
        + ".every(selector=>!document.querySelector(selector))};"
    + "if(stage)stage.scrollTop=before;return result;})()");
}

async function settingsMetrics(win) {
  await value(win, "window.WhiteboxApp.selectView('settings',{focusMain:false})");
  await wait(80);
  return value(win, "(()=>{const section=document.querySelector('#settingsSection');"
    + "const sectionRect=section?.getBoundingClientRect();"
    + "const controls=[...document.querySelectorAll('#settingsSection button,#settingsSection select,"
      + "#settingsSection .provider-visibility-option')].filter(item=>{"
        + "const rect=item.getBoundingClientRect();return rect.width>0&&rect.height>0;});"
    + "const outside=controls.filter(item=>{const rect=item.getBoundingClientRect();"
      + "return rect.left<-1||rect.right>innerWidth+1;}).length;"
    + "const short=controls.filter(item=>item.getBoundingClientRect().height<38).length;"
    + "return{visible:Boolean(sectionRect&&sectionRect.width>0&&sectionRect.height>0),"
      + "sectionInside:Boolean(sectionRect&&sectionRect.left>=-1&&sectionRect.right<=innerWidth+1),"
      + "bodyOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,"
      + "controls:controls.length,outside,short,"
      + "language:Boolean(document.querySelector('#languageSelect')),"
      + "themes:document.querySelectorAll('[data-theme-choice]').length,"
      + "providers:document.querySelectorAll('[data-provider-visibility]').length,"
      + "update:Boolean(document.querySelector('#checkUpdateBtn')),"
      + "updateOverflow:Boolean(document.querySelector('#updatePanel')"
        + "&&document.querySelector('#updatePanel').scrollWidth>document.querySelector('#updatePanel').clientWidth+2),"
      + "popupSettingsAbsent:!document.querySelector('#attentionPopupSettingsCard,"
        + "#attentionPopupEnabled')};})()");
}

async function runModalMetrics(win) {
  await selectFixtureProject(win);
  await value(win, "window.WhiteboxApp.openRunModal()");
  await wait(120);
  const metrics = await value(win, "(()=>{const modal=document.querySelector('#runModal .run-modal');"
    + "const form=document.querySelector('#runForm');const actions=document.querySelector('.run-modal-actions');"
    + "const rect=modal?.getBoundingClientRect();const actionsRect=actions?.getBoundingClientRect();"
    + "return{visible:Boolean(rect&&rect.width>0&&rect.height>0),"
      + "rect:rect?{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}:null,"
      + "inside:Boolean(rect&&rect.left>=-1&&rect.right<=innerWidth+1"
        + "&&rect.top>=-1&&rect.bottom<=innerHeight+1),"
      + "formOverflow:Boolean(form&&form.scrollWidth>form.clientWidth+2),"
      + "actionsInside:Boolean(actionsRect&&actionsRect.left>=rect.left-1"
        + "&&actionsRect.right<=rect.right+1&&actionsRect.bottom<=innerHeight+1),"
      + "promptFirst:Boolean(document.querySelector('#runPrompt')?.compareDocumentPosition("
        + "document.querySelector('#runProviderPicker'))&Node.DOCUMENT_POSITION_FOLLOWING),"
      + "backgroundInert:Boolean(document.querySelector('#appShell')?.inert)};})()");
  await value(win, "document.querySelector('#cancelRunBtn')?.click()");
  await waitFor(win, "document.querySelector('#runModal')?.classList.contains('hidden')"
    + "&&!document.querySelector('#appShell')?.inert", '새 작업 modal 닫기/복원 실패');
  return metrics;
}

async function auxiliaryOverlayMetrics(win) {
  await selectFixtureProject(win);
  await value(win, "window.WhiteboxApp.openQuickPalette()");
  await waitFor(win,
    "!document.querySelector('#quickPaletteModal')?.classList.contains('hidden')"
      + "&&document.activeElement?.id==='quickPaletteInput'",
    '빠른 이동 overlay를 열지 못했습니다.');
  const quick = await value(win, "(()=>{const overlay=document.querySelector('#quickPaletteModal');"
    + "const panel=overlay?.querySelector('.quality-modal');const rect=panel?.getBoundingClientRect();"
    + "const close=document.querySelector('#closeQuickPaletteBtn')?.getBoundingClientRect();"
    + "return{visible:Boolean(rect&&rect.width>0&&rect.height>0),"
      + "inside:Boolean(rect&&rect.left>=-1&&rect.right<=innerWidth+1&&rect.top>=-1&&rect.bottom<=innerHeight+1),"
      + "noOverflow:Boolean(panel&&panel.scrollWidth<=panel.clientWidth+2"
        + "&&document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),"
      + "input:Boolean(document.querySelector('#quickPaletteInput[role=\"combobox\"]')),"
      + "list:Boolean(document.querySelector('#quickPaletteList[role=\"listbox\"]')),"
      + "closeTarget:Boolean(close&&close.width>=38&&close.height>=38),"
      + "backgroundInert:Boolean(document.querySelector('#appShell')?.inert)};})()");
  await value(win, "window.WhiteboxApp.closeQuickPalette()");
  await waitFor(win,
    "document.querySelector('#quickPaletteModal')?.classList.contains('hidden')"
      + "&&!document.querySelector('#appShell')?.inert",
    '빠른 이동 overlay를 닫지 못했습니다.');

  await value(win, "window.WhiteboxApp.openShortcutHelp()");
  await waitFor(win,
    "!document.querySelector('#shortcutHelpModal')?.classList.contains('hidden')"
      + "&&document.activeElement?.id==='closeShortcutHelpBtn'",
    '단축키 도움말 overlay를 열지 못했습니다.');
  const shortcuts = await value(win, "(()=>{const overlay=document.querySelector('#shortcutHelpModal');"
    + "const panel=overlay?.querySelector('.quality-modal');const rect=panel?.getBoundingClientRect();"
    + "const close=document.querySelector('#closeShortcutHelpBtn')?.getBoundingClientRect();"
    + "return{visible:Boolean(rect&&rect.width>0&&rect.height>0),"
      + "inside:Boolean(rect&&rect.left>=-1&&rect.right<=innerWidth+1&&rect.top>=-1&&rect.bottom<=innerHeight+1),"
      + "noOverflow:Boolean(panel&&panel.scrollWidth<=panel.clientWidth+2"
        + "&&document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),"
      + "rows:document.querySelectorAll('.shortcut-help-list>div').length,"
      + "closeTarget:Boolean(close&&close.width>=38&&close.height>=38),"
      + "backgroundInert:Boolean(document.querySelector('#appShell')?.inert)};})()");
  await value(win, "window.WhiteboxApp.closeShortcutHelp()");
  await waitFor(win,
    "document.querySelector('#shortcutHelpModal')?.classList.contains('hidden')"
      + "&&!document.querySelector('#appShell')?.inert",
    '단축키 도움말 overlay를 닫지 못했습니다.');

  await value(win, "(()=>{window.WhiteboxApp.selectView('settings',{focusMain:false});"
    + "window.interactionTest.restoreUpdate();document.querySelector('#updatePanel')?.scrollIntoView({block:'start'});})()");
  await waitFor(win,
    "document.querySelector('#updatePanel')?.dataset.updateStatus==='available'"
      + "&&!document.querySelector('#installUpdateBtn')?.classList.contains('hidden')",
    '업데이트 available 상태가 설정 화면에 표시되지 않았습니다.');
  const update = await value(win, "(()=>{const panel=document.querySelector('#updatePanel');"
    + "const rect=panel?.getBoundingClientRect();const actions=document.querySelector('.update-actions');"
    + "const actionRect=actions?.getBoundingClientRect();const controls=[...document.querySelectorAll("
      + "'#updatePanel button')].filter(button=>button.getBoundingClientRect().width>0);"
    + "return{status:panel?.dataset.updateStatus||'',title:document.querySelector('#updateStateTitle')?.textContent.trim()||'',"
      + "panelInside:Boolean(rect&&rect.left>=-1&&rect.right<=innerWidth+1),"
      + "actionsInside:Boolean(rect&&actionRect&&actionRect.left>=rect.left-1&&actionRect.right<=rect.right+1),"
      + "controlsInside:Boolean(rect&&controls.length&&controls.every(button=>{const item=button.getBoundingClientRect();"
        + "return item.left>=rect.left-1&&item.right<=rect.right+1&&item.height>=38;})),"
      + "noOverflow:Boolean(panel&&panel.scrollWidth<=panel.clientWidth+2"
        + "&&document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),"
      + "installVisible:Boolean(document.querySelector('#installUpdateBtn')?.getBoundingClientRect().width)};})()");
  return { quick, shortcuts, update };
}

async function workflowMetrics(win) {
  await selectFixtureProject(win);
  await value(win, "(()=>{const app=window.WhiteboxApp;app.state.graphFocusId='fixture-root';"
    + "app.renderSessions?.('responsive-focus');app.drawAgentWorkflowConnections?.();})()");
  await wait(120);
  return value(win, "(()=>{const canvas=document.querySelector('.agent-workflow-canvas');"
    + "const stage=document.querySelector('.main-stage');const selected=document.querySelector("
      + "'.agent-workflow-selected,[data-workflow-selected]');"
    + "return{canvas:Boolean(canvas&&canvas.getBoundingClientRect().width>0),"
      + "selected:Boolean(selected),nodes:document.querySelectorAll('.agent-workflow-node').length,"
      + "progress:Boolean(document.querySelector('[data-workflow-progress=\"fixture-root\"]')),"
      + "composerAbsent:!document.querySelector('.agent-workflow-canvas [data-agent-command-form],"
        + ".agent-workflow-canvas .conversation-composer'),"
      + "bodyOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,"
      + "stageOverflow:Boolean(stage&&stage.scrollWidth>stage.clientWidth+2)};})()");
}

async function ptyFocusMetrics(win) {
  await selectFixtureProject(win);
  await value(win, "window.interactionTest.clearCalls();"
    + "document.querySelector('[data-pty-focus-trigger=\"fixture-root\"]')?.click()");
  await waitFor(win, "(()=>{const embedded=window.WhiteboxTerminal.embeddedState();"
    + "return window.WhiteboxApp.state.ptyFocusSessionId==='fixture-root'"
      + "&&window.WhiteboxApp.state.ptyFocusTargetId==='terminal-main'"
      + "&&embedded.connected&&embedded.terminalId==='terminal-main'"
      + "&&document.querySelector('#ptyFocusTerminalViewport .xterm');})()",
  'exact PTY focus가 mount되지 않았습니다.');
  const metrics = await value(win, "(()=>{const surface=document.querySelector('#ptyFocusSurface');"
    + "const rect=surface?.getBoundingClientRect();const flow=document.querySelector("
      + "'.pty-focus-flow-region');const terminal=document.querySelector('#ptyFocusTerminalShell');"
    + "const back=document.querySelector('#ptyFocusBackBtn');const backRect=back?.getBoundingClientRect();"
    + "return{fullViewport:Boolean(rect&&Math.abs(rect.left)<=1&&Math.abs(rect.top)<=1"
      + "&&Math.abs(rect.right-innerWidth)<=1&&Math.abs(rect.bottom-innerHeight)<=1),"
      + "backVisible:Boolean(backRect&&backRect.width>=38&&backRect.height>=38),"
      + "flowContained:Boolean(flow&&flow.getBoundingClientRect().left>=-1"
        + "&&flow.getBoundingClientRect().right<=innerWidth+1),"
      + "terminalHeight:terminal?.getBoundingClientRect().height||0,"
      + "xterm:Boolean(document.querySelector('#ptyFocusTerminalViewport .xterm')),"
      + "statusOnly:!document.querySelector('#ptyFocusFlow button,#ptyFocusFlow a,"
        + "#ptyFocusFlow input,#ptyFocusFlow textarea,#ptyFocusFlow select'),"
      + "backgroundInert:Boolean(document.querySelector('#mainContent')?.inert"
        + "&&document.querySelector('.sidebar')?.inert),"
      + "bodyOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,"
      + "terminalCreates:window.interactionTest.getCalls().filter("
        + "call=>call.name==='terminalCreate').length,"
      + "removedAbsent:" + JSON.stringify(removedSelectors)
        + ".every(selector=>!document.querySelector(selector))};})()");
  await value(win, "document.querySelector('#ptyFocusBackBtn')?.click()");
  await waitFor(win, "!window.WhiteboxApp.state.ptyFocusSessionId"
    + "&&document.querySelector('#ptyFocusSurface')?.classList.contains('hidden')",
  'PTY focus 뒤로가기가 작업 현황을 복원하지 못했습니다.');
  return metrics;
}

async function run() {
  installWorktreeDependencyRedirect();
  let win = null;
  try {
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'interaction-fixture-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    await win.loadFile(path.join(root, 'renderer', 'index.html'));
    await waitFor(win,
      "Boolean(window.WhiteboxApp?.initialized&&window.WhiteboxTerminal&&window.interactionTest)",
      'responsive renderer가 준비되지 않았습니다.', 20000);
    const reports = [];
    for (const requested of sizes) {
      const actual = await resize(win, requested[0], requested[1]);
      await showProjectSelection(win);
      const projectSelection = await projectSelectionMetrics(win);
      assert(projectSelection.visible && projectSelection.insideWidth && projectSelection.stageInside
        && !projectSelection.bodyOverflow && !projectSelection.promptOverflow
        && projectSelection.sidebarLabelled && projectSelection.projectTreeNamed
        && projectSelection.removedAbsent && projectSelection.extraViewsAbsent,
      requested.join('×') + ' 프로젝트 선택 배치가 올바르지 않습니다: '
        + JSON.stringify(projectSelection));

      await selectFixtureProject(win);
      const dashboard = await dashboardMetrics(win);
      assert(dashboard.rootTrigger && dashboard.visibleCards >= 1 && dashboard.helperNodes >= 1
        && dashboard.statusOnly && !dashboard.bodyOverflow && !dashboard.stageOverflow
        && dashboard.navInside && dashboard.topbarInside && dashboard.navPosition === 'sticky'
        && dashboard.navSticky && dashboard.navAccessible && dashboard.sidebarAccessible
        && dashboard.compactNavigation && dashboard.removedAbsent,
      requested.join('×') + ' 작업 현황 배치가 올바르지 않습니다: ' + JSON.stringify(dashboard));

      const settings = await settingsMetrics(win);
      assert(settings.visible && settings.sectionInside && !settings.bodyOverflow
        && settings.controls >= 8 && settings.outside === 0 && settings.short === 0
        && settings.language && settings.themes >= 2 && settings.providers >= 1
        && settings.update && !settings.updateOverflow && settings.popupSettingsAbsent,
      requested.join('×') + ' 설정 배치가 올바르지 않습니다: ' + JSON.stringify(settings));

      const modal = await runModalMetrics(win);
      assert(modal.visible && modal.inside && !modal.formOverflow && modal.actionsInside
        && modal.promptFirst && modal.backgroundInert,
      requested.join('×') + ' 새 작업 modal 배치가 올바르지 않습니다: ' + JSON.stringify(modal));

      const overlays = await auxiliaryOverlayMetrics(win);
      assert(overlays.quick.visible && overlays.quick.inside && overlays.quick.noOverflow
        && overlays.quick.input && overlays.quick.list && overlays.quick.closeTarget
        && overlays.quick.backgroundInert,
      requested.join('×') + ' 빠른 이동 overlay 배치가 올바르지 않습니다: '
        + JSON.stringify(overlays.quick));
      assert(overlays.shortcuts.visible && overlays.shortcuts.inside && overlays.shortcuts.noOverflow
        && overlays.shortcuts.rows >= 6 && overlays.shortcuts.closeTarget
        && overlays.shortcuts.backgroundInert,
      requested.join('×') + ' 단축키 도움말 overlay 배치가 올바르지 않습니다: '
        + JSON.stringify(overlays.shortcuts));
      assert(overlays.update.status === 'available' && overlays.update.title
        && overlays.update.panelInside && overlays.update.actionsInside
        && overlays.update.controlsInside && overlays.update.noOverflow && overlays.update.installVisible,
      requested.join('×') + ' 업데이트 available 배치가 올바르지 않습니다: '
        + JSON.stringify(overlays.update));

      const workflow = await workflowMetrics(win);
      assert(workflow.canvas && workflow.selected && workflow.nodes >= 1 && workflow.progress
        && workflow.composerAbsent && !workflow.bodyOverflow && !workflow.stageOverflow,
      requested.join('×') + ' 작업 흐름 배치가 올바르지 않습니다: ' + JSON.stringify(workflow));

      const focus = await ptyFocusMetrics(win);
      assert(focus.fullViewport && focus.backVisible && focus.flowContained
        && focus.terminalHeight >= 80 && focus.xterm && focus.statusOnly
        && focus.backgroundInert && !focus.bodyOverflow && focus.terminalCreates === 0
        && focus.removedAbsent,
      requested.join('×') + ' PTY focus 배치가 올바르지 않습니다: ' + JSON.stringify(focus));

      if ([1375, 720, 360].includes(requested[0])) {
        await selectFixtureProject(win);
        await value(win, "document.querySelector('[data-pty-focus-trigger=\"fixture-root\"]')?.click()");
        await waitFor(win, "Boolean(document.querySelector('#ptyFocusTerminalViewport .xterm'))",
          'responsive screenshot PTY mount 실패');
        fs.writeFileSync(path.join(outputDir, 'whitebox-responsive-pty-' + requested[0] + '.png'),
          (await win.webContents.capturePage()).toPNG());
        await value(win, "document.querySelector('#ptyFocusBackBtn')?.click()");
      }
      reports.push({ requested: requested.join('×'), actual, projectSelection, dashboard,
        settings, modal, overlays, workflow, focus });
    }
    process.stdout.write('responsive check passed ' + JSON.stringify({ views: reports }) + '\n');
  } catch (error) {
    process.stderr.write(String(error.stack || error) + '\n');
    process.exitCode = 1;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
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
