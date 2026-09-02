'use strict';

// Visual coverage for the current project-first shell and full PTY focus UX.
// The old drawer/conversation/tmux-detail screenshots were intentionally
// retired with those product surfaces.
const { app, BrowserWindow, session: electronSession } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'artifacts');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-visual-pty-'));
const removedSelectors = [
  '#detailDrawer', '#drawerBackdrop', '#drawerContent', '#drawerComposer',
  '#drawerTerminalSurface', '#ptyFocusChildModal', '#mobileMoreBtn',
  '#mobileToolsMenu', '#advancedToolsNav',
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

async function capture(win, name) {
  const output = path.join(outputDir, name);
  fs.writeFileSync(output, (await win.webContents.capturePage()).toPNG());
  return output;
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

async function selectProject(win) {
  await value(win, "(()=>{const app=window.WhiteboxApp;"
    + "const root=(app.state.snapshot?.sessions||[]).find(item=>item.id==='fixture-root');"
    + "app.state.workspace=root?.originCwd||root?.cwd||'D:\\\\fixture';app.state.view='all';"
    + "app.state.graphFocusId=null;app.state.search='';app.state.providerFilters?.clear?.();"
    + "app.renderWorkspaces?.();app.renderSessions?.('visual-project');})()");
  await waitFor(win, "Boolean(document.querySelector('[data-pty-focus-trigger=\"fixture-root\"]'))",
    '선택한 프로젝트의 PTY 진입점이 표시되지 않았습니다.');
}

async function run() {
  installWorktreeDependencyRedirect();
  const rendererErrors = [];
  const outputs = [];
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    show: false,
    backgroundColor: '#08111b',
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
      "Boolean(window.WhiteboxApp?.initialized&&window.WhiteboxTerminal&&window.interactionTest)",
      'visual renderer가 준비되지 않았습니다.', 20000);

    await value(win, "(()=>{const app=window.WhiteboxApp;app.state.workspace='all';"
      + "app.state.view='all';app.renderWorkspaces?.();app.renderSessions?.('visual-project-selection');})()");
    await wait(250);
    const projectSelection = await value(win, "(()=>{"
      + "const prompt=document.querySelector('#projectSelectionPrompt');const rect=prompt?.getBoundingClientRect();"
      + "return{visible:Boolean(rect&&rect.width>0&&rect.height>0),"
        + "title:prompt?.querySelector('h2')?.textContent.trim()||'',"
        + "motion:[...(prompt?.querySelectorAll('.project-selection-orbit,.project-selection-stack,"
          + ".project-selection-scan')||[])].filter(node=>getComputedStyle(node).animationName!=='none').length,"
        + "noOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth+2,"
        + "removedAbsent:" + JSON.stringify(removedSelectors)
          + ".every(selector=>!document.querySelector(selector))};})()");
    assert(projectSelection.visible && projectSelection.motion >= 3 && projectSelection.noOverflow
      && projectSelection.removedAbsent,
    '프로젝트 선택 화면 시각 계약이 올바르지 않습니다: ' + JSON.stringify(projectSelection));
    outputs.push(await capture(win, 'whitebox-dashboard.png'));

    await selectProject(win);
    await wait(250);
    const dashboard = await value(win, "(()=>{const overview=document.querySelector('#liveSection');"
      + "const rect=overview?.getBoundingClientRect();return{"
        + "visible:Boolean(rect&&rect.width>0&&rect.height>0),"
        + "rootCards:document.querySelectorAll('[data-control-session]').length,"
        + "visibleRootCards:[...document.querySelectorAll('[data-control-session]')]"
          + ".filter(card=>card.getBoundingClientRect().width>0&&card.getBoundingClientRect().height>0).length,"
        + "rootTrigger:Boolean(document.querySelector('[data-pty-focus-trigger=\"fixture-root\"]')),"
        + "helperNodes:document.querySelectorAll('[data-open-subagent-chat]').length,"
        + "noOverflow:overview?overview.scrollWidth<=overview.clientWidth+2:false,"
        + "noConversationComposer:!document.querySelector('#operationsOverview [data-conversation-shell],"
          + "#operationsOverview .conversation-composer'),"
        + "removedNavigationAbsent:!document.querySelector('[data-view=\"runtime\"],"
          + "[data-view=\"tmux\"],#advancedToolsNav')};})()");
    assert(dashboard.visible && dashboard.rootCards >= 1 && dashboard.visibleRootCards >= 1 && dashboard.rootTrigger
      && dashboard.helperNodes >= 1 && dashboard.noOverflow && dashboard.noConversationComposer
      && dashboard.removedNavigationAbsent,
    '작업 현황 시각 계약이 올바르지 않습니다: ' + JSON.stringify(dashboard));
    outputs.push(await capture(win, 'whitebox-control-room.png'));

    await value(win, "(()=>{const app=window.WhiteboxApp;"
      + "const base=app.state.snapshot.sessions.find(session=>session.id==='fixture-waiting');"
      + "const input={...base,id:'fixture-input-required',externalId:'fixture-input-required-external',"
        + "provider:'claude',title:'배포 방식 선택이 필요한 작업',status:'waiting',"
        + "statusDetail:'내 선택을 기다리는 중',"
        + "attention:{category:'required',required:true,actionable:true,kind:'question',"
          + "summary:'안전한 배포 방식을 선택해 주세요.',requestText:'검증 후 배포할까요?',"
          + "requestedAt:new Date().toISOString(),source:'input-tool',confidence:'high'},"
        + "responseIntent:{category:'required',required:true,optional:false,"
          + "requestText:'검증 후 배포할까요?',confidence:'high',source:'structured-input'},"
        + "controlCapabilities:{...(base?.controlCapabilities||{}),sendInstruction:true}};"
      + "const sessions=app.state.snapshot.sessions.filter(session=>session.id!==input.id).map(session=>{"
        + "if(session.id==='fixture-failed')return{...session,attention:{category:'required',required:true,"
          + "actionable:true,kind:'error',summary:session.statusDetail,requestText:'실패한 작업을 처리해 주세요.',"
          + "requestedAt:new Date().toISOString(),source:'input-tool',confidence:'high'}};"
        + "if(session.id==='fixture-paused-run')return{...session,attention:{category:'required',required:true,"
          + "actionable:true,kind:'paused',summary:session.statusDetail,requestText:'멈춘 작업을 처리해 주세요.',"
          + "requestedAt:new Date().toISOString(),source:'input-tool',confidence:'high'}};return session;});"
      + "app.state.snapshot.sessions=[...sessions,input];"
      + "app.selectViewFromUser?.('waiting',{motionKind:'filter'});"
      + "if(app.state.view!=='waiting')app.selectView('waiting');else app.renderSessions?.('visual-waiting-states');})()");
    await waitFor(win,
      "window.WhiteboxApp.state.view==='waiting'"
        + "&&!document.querySelector('#attentionInbox')?.classList.contains('hidden')",
      '확인 대기 화면이 표시되지 않았습니다.');
    const waitingCardIds = await value(win,
      "[...document.querySelectorAll('#attentionInbox [data-management-session]')]"
        + ".map(card=>card.dataset.managementSession)");
    assert(['fixture-waiting', 'fixture-input-required', 'fixture-failed', 'fixture-paused-run']
      .every(id => waitingCardIds.includes(id)),
    '확인 대기 approval/input/failed/paused 카드가 모두 표시되지 않았습니다: '
      + JSON.stringify(waitingCardIds));
    await value(win, "(()=>{const details=document.querySelector('#attentionInbox .attention-more-cards');"
      + "if(details)details.open=true;return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()");
    const waiting = await value(win, "(()=>{const inbox=document.querySelector('#attentionInbox');"
      + "const card=id=>inbox?.querySelector('[data-management-session=\"'+id+'\"]');"
      + "const approval=card('fixture-waiting'),input=card('fixture-input-required'),"
        + "failed=card('fixture-failed'),paused=card('fixture-paused-run');"
      + "const quick=[...(approval?.querySelectorAll('[data-attention-quick]')||[])];"
      + "const failedPrimary=failed?.querySelector('.attention-primary-action[data-open-session=\"fixture-failed\"]');"
      + "const pausedPrimary=paused?.querySelector('.attention-primary-action[data-open-session=\"fixture-paused-run\"]');"
      + "const hiddenControls=[...inbox.querySelectorAll('.management-control-buttons')].flatMap(group=>"
        + "[...group.querySelectorAll('button')].map(button=>{const rect=button.getBoundingClientRect();"
          + "return{display:getComputedStyle(group).display,width:rect.width,height:rect.height};}));"
      + "const visibleActions=[approval?.querySelector('[data-attention-quick].approve'),failedPrimary,pausedPrimary];"
      + "const inside=element=>{const item=element?.getBoundingClientRect(),host=element?.closest('.attention-card')"
        + "?.getBoundingClientRect();return Boolean(item&&host&&item.width>0&&item.height>0"
          + "&&item.left>=host.left-1&&item.right<=host.right+1);};"
      + "return{visible:[approval,input,failed,paused].every(item=>{const rect=item?.getBoundingClientRect();"
        + "return rect&&rect.width>0&&rect.height>0;}),quickActions:quick.length,"
        + "approve:Boolean(approval?.querySelector('[data-attention-quick].approve')),"
        + "named:quick.every(button=>button.textContent.trim()&&button.dataset.attentionQuick),"
        + "inputComposer:Boolean(input?.querySelector('[data-agent-command-form]')"
          + "&&input?.querySelector('[data-agent-command-draft]')),"
        + "failurePtyActions:Boolean(failedPrimary&&pausedPrimary),"
        + "legacyControlsHidden:hiddenControls.length>=4&&hiddenControls.every(control=>"
          + "control.display==='none'&&control.width===0&&control.height===0),"
        + "controlsInside:visibleActions.every(inside),"
        + "states:[approval,input,failed,paused].map(item=>[...item.classList]),"
        + "inboxLabelled:Boolean(inbox?.getAttribute('aria-label')?.trim()"
          + "||(inbox?.getAttribute('aria-labelledby')"
            + "&&document.getElementById(inbox.getAttribute('aria-labelledby')))),"
        + "noOverflow:Boolean(inbox&&inbox.scrollWidth<=inbox.clientWidth+2),"
        + "removedAbsent:" + JSON.stringify(removedSelectors)
          + ".every(selector=>!document.querySelector(selector))};})()");
    assert(waiting.visible && waiting.quickActions >= 2 && waiting.approve && waiting.named
      && waiting.inputComposer && waiting.failurePtyActions && waiting.legacyControlsHidden
      && waiting.controlsInside && waiting.inboxLabelled && waiting.noOverflow && waiting.removedAbsent,
    '확인 대기/관리 카드 시각 계약이 올바르지 않습니다: ' + JSON.stringify(waiting));
    outputs.push(await capture(win, 'whitebox-review-waiting.png'));
    await value(win, "document.querySelector('[data-management-session=\"fixture-input-required\"]')"
      + "?.scrollIntoView({block:'center',behavior:'auto'})");
    await wait(120);
    outputs.push(await capture(win, 'whitebox-review-input.png'));
    await value(win, "document.querySelector('[data-management-session=\"fixture-failed\"]')"
      + "?.scrollIntoView({block:'center',behavior:'auto'})");
    await wait(120);
    outputs.push(await capture(win, 'whitebox-review-management.png'));

    await selectProject(win);
    win.setContentSize(480, 720);
    await wait(300);
    const compactDashboard = await value(win, "(()=>{const nav=document.querySelector('#projectContextNav');"
      + "const cards=[...document.querySelectorAll('[data-control-session]')];"
      + "const buttons=[...document.querySelectorAll('#projectViewTabs [data-view]')];"
      + "const newRun=document.querySelector('#newRunBtn');const rootPty=[...document.querySelectorAll("
        + "'[data-pty-focus-trigger=\"fixture-root\"]')].find(node=>node.getBoundingClientRect().height>0);"
      + "return{width:innerWidth,height:innerHeight,navPosition:getComputedStyle(nav).position,"
        + "sidebarHidden:getComputedStyle(document.querySelector('.sidebar')).display==='none',"
        + "buttons:buttons.length,retiredTabsHidden:buttons.every(button=>getComputedStyle(button).display==='none'),"
        + "primaryTouchTargets:Boolean(newRun?.getBoundingClientRect().height>=44"
          + "&&rootPty?.getBoundingClientRect().height>=38),"
        + "rootCards:cards.length,visibleRootCards:cards.filter(card=>card.getBoundingClientRect().width>0"
          + "&&card.getBoundingClientRect().height>0).length,"
        + "noOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth+2,"
        + "removedAbsent:" + JSON.stringify(removedSelectors)
          + ".every(selector=>!document.querySelector(selector))};})()");
    assert(compactDashboard.width === 480 && compactDashboard.navPosition === 'sticky'
      && compactDashboard.sidebarHidden && compactDashboard.buttons === 3
      && compactDashboard.retiredTabsHidden && compactDashboard.primaryTouchTargets
      && compactDashboard.rootCards >= 1
      && compactDashboard.visibleRootCards >= 1 && compactDashboard.noOverflow
      && compactDashboard.removedAbsent,
    'compact 작업 현황 시각 계약이 올바르지 않습니다: ' + JSON.stringify(compactDashboard));
    outputs.push(await capture(win, 'whitebox-control-room-compact.png'));
    win.setContentSize(1440, 940);
    await wait(300);

    await value(win, "document.querySelector('[data-view=\"settings\"]')?.click()");
    await waitFor(win, "window.WhiteboxApp.state.view==='settings'", '설정 화면을 열지 못했습니다.');
    const settings = await value(win, "(()=>{const section=document.querySelector('#settingsSection');"
      + "const rect=section?.getBoundingClientRect();return{visible:Boolean(rect&&rect.width>0&&rect.height>0),"
        + "language:Boolean(document.querySelector('#languageSelect')),"
        + "themes:document.querySelectorAll('[data-theme-choice]').length,"
        + "providers:document.querySelectorAll('[data-provider-visibility]').length,"
        + "update:Boolean(document.querySelector('#updatePanel,#checkUpdateBtn')),"
        + "noPopupSettings:!document.querySelector('#attentionPopupSettingsCard,#attentionPopupEnabled'),"
        + "noOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth+2};})()");
    assert(settings.visible && settings.language && settings.themes >= 2 && settings.providers >= 1
      && settings.update && settings.noPopupSettings && settings.noOverflow,
    '설정 화면 시각 계약이 올바르지 않습니다: ' + JSON.stringify(settings));
    outputs.push(await capture(win, 'whitebox-language-settings.png'));

    await selectProject(win);
    await value(win, "window.interactionTest.clearCalls();"
      + "document.querySelector('[data-pty-focus-trigger=\"fixture-root\"]')?.click()");
    await waitFor(win, "(()=>{const embedded=window.WhiteboxTerminal.embeddedState();"
      + "return window.WhiteboxApp.state.ptyFocusSessionId==='fixture-root'"
        + "&&window.WhiteboxApp.state.ptyFocusTargetId==='terminal-main'"
        + "&&embedded.connected&&embedded.agentSessionId==='fixture-root'"
        + "&&embedded.terminalId==='terminal-main'"
        + "&&document.querySelector('#ptyFocusTerminalViewport .xterm');})()",
    'full PTY focus 화면에 exact fixture PTY가 mount되지 않았습니다.');
    const marker = 'PTY_VISUAL_' + Date.now();
    await value(win, "window.interactionTest.emitTerminalData('terminal-main',"
      + JSON.stringify('\r\n' + marker + '\r\n') + ")");
    await value(win, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await waitFor(win, "(()=>{const shell=document.querySelector('#ptyFocusTerminalShell');"
      + "const empty=shell?.querySelector('[data-inline-terminal-empty]');"
      + "const host=document.querySelector('#ptyFocusTerminalViewport>"
        + ".terminal-screen[data-terminal-screen=\"terminal-main\"]');"
      + "const style=host?getComputedStyle(host):null;return shell?.dataset.connection==='connected'"
        + "&&empty?.classList.contains('hidden')&&getComputedStyle(empty).display==='none'"
        + "&&style?.display!=='none'&&style?.visibility!=='hidden'"
        + "&&host?.getBoundingClientRect().width>0&&host?.getBoundingClientRect().height>0"
        + "&&[...(host?.querySelectorAll('.xterm-rows>div')||[])]"
          + ".some(row=>(row.textContent||'').includes(" + JSON.stringify(marker) + "));})()",
    'PTY focus 시각 화면이 live 출력을 표시하지 못했습니다.');

    const focusMetrics = await value(win, "(()=>{const surface=document.querySelector('#ptyFocusSurface');"
      + "const shell=document.querySelector('#ptyFocusTerminalShell');"
      + "const empty=shell?.querySelector('[data-inline-terminal-empty]');"
      + "const host=document.querySelector('#ptyFocusTerminalViewport>"
        + ".terminal-screen[data-terminal-screen=\"terminal-main\"]');"
      + "const hostStyle=host?getComputedStyle(host):null;"
      + "const rect=surface?.getBoundingClientRect();const helper=document.querySelector("
        + "'#ptyFocusTerminalViewport .xterm-helper-textarea');helper?.focus({preventScroll:true});"
      + "return{fullViewport:Boolean(rect&&Math.abs(rect.left)<=1&&Math.abs(rect.top)<=1"
        + "&&Math.abs(rect.right-innerWidth)<=1&&Math.abs(rect.bottom-innerHeight)<=1),"
        + "surfaceInteractive:Boolean(surface&&!surface.inert"
          + "&&surface.getAttribute('aria-hidden')==='false'),"
        + "backgroundInert:Boolean(document.querySelector('#mainContent')?.inert"
          + "&&document.querySelector('.sidebar')?.inert),"
        + "flowLanes:surface?.querySelectorAll('.pty-focus-flow-lane').length||0,"
        + "statusOnly:!document.querySelector('#ptyFocusFlow button,#ptyFocusFlow a,"
          + "#ptyFocusFlow input,#ptyFocusFlow textarea,#ptyFocusFlow select'),"
        + "xtermMounted:Boolean(host?.querySelector('.xterm')),"
        + "connectionTone:shell?.dataset.connection||'',"
        + "emptyHidden:Boolean(empty?.classList.contains('hidden')"
          + "&&getComputedStyle(empty).display==='none'),"
        + "hostVisible:Boolean(hostStyle?.display!=='none'&&hostStyle?.visibility!=='hidden'"
          + "&&host?.getBoundingClientRect().width>0&&host?.getBoundingClientRect().height>0),"
        + "markerVisible:[...(host?.querySelectorAll('.xterm-rows>div')||[])]"
          + ".some(row=>(row.textContent||'').includes(" + JSON.stringify(marker) + ")),"
        + "focused:document.activeElement===helper,"
        + "terminalCreates:window.interactionTest.getCalls().filter(call=>call.name==='terminalCreate').length,"
        + "removedAbsent:" + JSON.stringify(removedSelectors)
          + ".every(selector=>!document.querySelector(selector)),"
        + "noOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth+2};})()");
    assert(focusMetrics.fullViewport && focusMetrics.surfaceInteractive && focusMetrics.backgroundInert
      && focusMetrics.flowLanes === 3 && focusMetrics.statusOnly && focusMetrics.xtermMounted
      && focusMetrics.connectionTone === 'connected' && focusMetrics.emptyHidden
      && focusMetrics.hostVisible && focusMetrics.markerVisible
      && focusMetrics.focused && focusMetrics.terminalCreates === 0
      && focusMetrics.removedAbsent && focusMetrics.noOverflow,
    'PTY focus 시각/accessibility 계약이 올바르지 않습니다: ' + JSON.stringify(focusMetrics));
    win.show();
    win.focus();
    win.webContents.invalidate();
    await wait(250);
    await waitFor(win, "(()=>{const shell=document.querySelector('#ptyFocusTerminalShell');"
      + "const empty=shell?.querySelector('[data-inline-terminal-empty]');"
      + "const host=document.querySelector('#ptyFocusTerminalViewport>"
        + ".terminal-screen[data-terminal-screen=\"terminal-main\"]');"
      + "const style=host?getComputedStyle(host):null;return shell?.dataset.connection==='connected'"
        + "&&empty?.classList.contains('hidden')&&getComputedStyle(empty).display==='none'"
        + "&&style?.display!=='none'&&style?.visibility!=='hidden'"
        + "&&host?.getBoundingClientRect().width>0&&host?.getBoundingClientRect().height>0"
        + "&&[...(host?.querySelectorAll('.xterm-rows>div')||[])]"
          + ".some(row=>(row.textContent||'').includes(" + JSON.stringify(marker) + "));})()",
    'capture 직전 PTY focus 연결 상태가 유지되지 않았습니다.');
    win.webContents.invalidate();
    await wait(100);
    outputs.push(await capture(win, 'whitebox-pty-focus-visual.png'));

    win.setContentSize(900, 700);
    await wait(300);
    const compact = await value(win, "(()=>{const surface=document.querySelector('#ptyFocusSurface');"
      + "const flow=document.querySelector('.pty-focus-flow-region');"
      + "const terminal=document.querySelector('#ptyFocusTerminalShell');"
      + "const back=document.querySelector('#ptyFocusBackBtn');"
      + "const rect=surface?.getBoundingClientRect();const backRect=back?.getBoundingClientRect();"
      + "return{width:innerWidth,height:innerHeight,"
        + "fullViewport:Boolean(rect&&Math.abs(rect.left)<=1&&Math.abs(rect.top)<=1"
          + "&&Math.abs(rect.right-innerWidth)<=1&&Math.abs(rect.bottom-innerHeight)<=1),"
        + "backVisible:Boolean(backRect&&backRect.width>=38&&backRect.height>=38),"
        + "flowScrollable:Boolean(flow&&flow.scrollWidth>=flow.clientWidth),"
        + "terminalVisible:Boolean(terminal&&terminal.getBoundingClientRect().height>180),"
        + "xtermVisible:Boolean(document.querySelector('#ptyFocusTerminalViewport .xterm')),"
        + "noBodyOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth+2};})()");
    assert(compact.fullViewport && compact.backVisible && compact.flowScrollable
      && compact.terminalVisible && compact.xtermVisible && compact.noBodyOverflow,
    'compact PTY focus 시각 계약이 올바르지 않습니다: ' + JSON.stringify(compact));
    outputs.push(await capture(win, 'whitebox-session-terminal-compact.png'));

    await value(win, "document.querySelector('#ptyFocusBackBtn')?.click()");
    await waitFor(win, "!window.WhiteboxApp.state.ptyFocusSessionId"
      + "&&document.querySelector('#ptyFocusSurface')?.classList.contains('hidden')",
    'PTY focus에서 작업 현황으로 돌아오지 못했습니다.');
    assert(rendererErrors.length === 0, 'renderer 오류가 발생했습니다: ' + rendererErrors.join(' | '));
    process.stdout.write(outputs.join('\n') + '\n'
      + JSON.stringify({ projectSelection, dashboard, waiting, compactDashboard,
        settings, focus: focusMetrics, compact }) + '\n');
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
