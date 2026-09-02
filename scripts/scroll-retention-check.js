'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const { app, BrowserWindow, session: electronSession } = require('electron');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce');
app.on('window-all-closed', () => {});

const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-scroll-retention-'));
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
app.setPath('userData', userData);

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function value(win, expression) {
  return win.webContents.executeJavaScript(expression);
}

async function waitFor(win, expression, message, attempts = 200) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await value(win, expression)) return;
    } catch (error) {
      lastError = error;
    }
    await wait(50);
  }
  throw new Error(message + (lastError ? ` (${lastError.message})` : ''));
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
    const alternate = relative && relative !== '..' && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative) ? path.join(dependencyRoot, relative) : '';
    callback(alternate && fs.existsSync(alternate) ? { redirectURL: pathToFileURL(alternate).href } : {});
  });
}

async function auditWheelControls(win, label) {
  const result = await value(win, `(() => {
    window.__wheelAuditedControls ||= new Set();
    const identity = element => {
      if (element.id) return '#' + element.id;
      const attributes = [...element.attributes]
        .filter(attribute => attribute.name.startsWith('data-') && !/^data-(?:i18n|motion|quality)/.test(attribute.name))
        .map(attribute => '[' + attribute.name + '=' + JSON.stringify(attribute.value) + ']')
        .sort()
        .join('');
      const text = String(element.getAttribute('aria-label') || element.textContent || '')
        .replace(/\\s+/g, ' ').trim().slice(0, 80);
      return element.tagName.toLowerCase() + attributes + ':' + text;
    };
    const state = () => JSON.stringify({
      view: window.WhiteboxApp.state.view,
      selectedId: window.WhiteboxApp.state.selectedId,
      ptyFocusSessionId: window.WhiteboxApp.state.ptyFocusSessionId,
      overlays: ['#runModal', '#tmuxCreateModal', '#quickPaletteModal', '#shortcutHelpModal', '#ptyFocusSurface', '#beginnerGuide']
        .map(selector => {
          const element = document.querySelector(selector);
          return [selector, Boolean(element?.classList.contains('hidden')), Boolean(element?.classList.contains('open'))];
        }),
      details: [...document.querySelectorAll('details')]
        .map((element, index) => [element.dataset.disclosureKey || element.className || index, element.open]),
      expanded: [...document.querySelectorAll('[aria-expanded]')]
        .map(element => [identity(element), element.getAttribute('aria-expanded')]),
      checked: [...document.querySelectorAll('input[type="checkbox"]')]
        .map(element => [identity(element), element.checked]),
      selected: [...document.querySelectorAll('select')].map(element => [identity(element), element.value]),
    });
    const controls = [...document.querySelectorAll(
      'button, summary, select, input[type="checkbox"], [role="button"], [data-session-id], [data-provider-card], [data-workspace]'
    )].filter(element => !element.disabled && element.getClientRects().length
      && getComputedStyle(element).visibility !== 'hidden');
    const failures = [];
    let checked = 0;
    for (const control of controls) {
      const key = identity(control);
      if (window.__wheelAuditedControls.has(key)) continue;
      const before = state();
      control.dispatchEvent(new WheelEvent('wheel', { deltaY: 180, bubbles: true, cancelable: true }));
      const after = state();
      if (after !== before) failures.push({ key, before, after });
      window.__wheelAuditedControls.add(key);
      checked += 1;
    }
    return { label: ${JSON.stringify(label)}, checked, total: window.__wheelAuditedControls.size, failures };
  })()`);
  assert(result.failures.length === 0, `휠이 UI 열림·선택 상태를 변경했습니다: ${JSON.stringify(result)}`);
  return result;
}

async function checkMainViews(win) {
  const results = [];
  for (const view of ['all', 'active', 'waiting', 'settings']) {
    await value(win, `window.WhiteboxApp.selectView(${JSON.stringify(view)})`);
    await wait(250);
    const result = await value(win, `(async () => {
      const stage = document.querySelector('.main-stage');
      let spacer = document.querySelector('#scrollRetentionSpacer');
      if (!spacer) {
        spacer = document.createElement('div');
        spacer.id = 'scrollRetentionSpacer';
        spacer.style.cssText = 'height:2400px;pointer-events:none;';
        stage.appendChild(spacer);
      }
      const target = Math.min(420, stage.scrollHeight - stage.clientHeight - 20);
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 420, bubbles: true, cancelable: true }));
      stage.scrollTop = target;
      document.querySelector('.main-stage section:not(.hidden) button:not([disabled]),'
        + '.main-stage section:not(.hidden) input:not([disabled])')?.focus({ preventScroll: true });
      window.interactionTest.emitSnapshot();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise(resolve => setTimeout(resolve, 120));
      return {
        requested: ${JSON.stringify(view)},
        view: window.WhiteboxApp.state.view,
        target,
        top: stage.scrollTop,
        maximum: stage.scrollHeight - stage.clientHeight,
      };
    })()`);
    assert(result.view === view && result.target >= 1 && Math.abs(result.top - result.target) <= 2
      && result.top < result.maximum - 2,
    `메인 화면 스크롤 유지 실패: ${JSON.stringify(result)}`);
    await auditWheelControls(win, `main:${view}`);
    results.push(result);
  }
  return results;
}

async function checkDisclosureStates(win) {
  await value(win, `(() => {
    const app = window.WhiteboxApp;
    app.state.workspace = app.state.workspaces[0]?.path || 'all';
    app.selectView('all');
  })()`);
  await waitFor(win,
    `Boolean(document.querySelector('details.control-room-project-group[data-disclosure-key^="control-project:"]'))`,
    '홈 프로젝트 실행 그룹이 없습니다.');
  const projectGroups = [];
  for (const expected of [false, true]) {
    const actual = await value(win, `(async () => {
      const details = document.querySelector('details.control-room-project-group[data-disclosure-key^="control-project:"]');
      details.open = ${expected};
      details.querySelector('summary').dispatchEvent(new WheelEvent('wheel', { deltaY: 160, bubbles: true, cancelable: true }));
      window.interactionTest.emitSnapshot();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.querySelector('details.control-room-project-group[data-disclosure-key^="control-project:"]')?.open;
    })()`);
    assert(actual === expected,
      `홈 프로젝트 실행 그룹의 ${expected ? '열림' : '닫힘'} 상태가 자동 갱신으로 뒤집혔습니다.`);
    projectGroups.push(actual);
  }

  await value(win, `window.WhiteboxApp.openRunModal()`);
  await waitFor(win, `!document.querySelector('#runModal').classList.contains('hidden')`,
    '고급 설정 상태 검사용 새 작업 창이 열리지 않았습니다.');
  const advanced = [];
  for (const expected of [true, false]) {
    await value(win, `(() => {
      const details = document.querySelector('.run-advanced');
      details.open = ${expected};
      details.dispatchEvent(new Event('toggle'));
      details.querySelector('summary').dispatchEvent(new WheelEvent('wheel', { deltaY: 160, bubbles: true, cancelable: true }));
      window.WhiteboxApp.closeRunModal(true);
    })()`);
    await wait(300);
    await value(win, `window.WhiteboxApp.openRunModal()`);
    await wait(30);
    const actual = await value(win, `document.querySelector('.run-advanced').open`);
    assert(actual === expected,
      `새 작업 고급 설정의 ${expected ? '열림' : '닫힘'} 상태가 다시 열 때 뒤집혔습니다.`);
    advanced.push(actual);
  }
  await auditWheelControls(win, 'run-modal');
  await value(win, `window.WhiteboxApp.closeRunModal(true)`);
  await wait(300);
  return { projectGroups, advanced };
}

async function checkHistoryCards(win) {
  const ids = await value(win, `(() => {
    const app = window.WhiteboxApp;
    app.state.graphFocusId = null;
    app.state.search = '';
    app.state.providerFilters.clear();
    app.state.workspace = 'all';
    app.state.sort = 'recent';
    app.state.visibleLimit = 999;
    app.state.guideExpanded = false;
    app.selectView('active');
    app.state.visibleLimit = 999;
    app.renderSessions('scroll-history-audit');
    return [...document.querySelectorAll('#sessionGrid [data-session-id]')]
      .map(element => element.dataset.sessionId);
  })()`);
  assert(ids.length >= 30, `기억 기록 전수 검사용 카드 수가 부족합니다: ${ids.length}`);
  for (const id of ids) {
    const stable = await value(win, `(() => {
      const card = document.querySelector('[data-session-id=${JSON.stringify(id)}]');
      const before = {
        view: window.WhiteboxApp.state.view,
        selectedId: window.WhiteboxApp.state.selectedId,
        graphFocusId: window.WhiteboxApp.state.graphFocusId,
      };
      card?.dispatchEvent(new WheelEvent('wheel', { deltaY: 220, bubbles: true, cancelable: true }));
      return {
        exists: Boolean(card),
        same: before.view === window.WhiteboxApp.state.view
          && before.selectedId === window.WhiteboxApp.state.selectedId
          && before.graphFocusId === window.WhiteboxApp.state.graphFocusId,
      };
    })()`);
    assert(stable.exists && stable.same, `기억 기록 ${id}에서 휠이 선택 상태를 바꿨습니다.`);
    await auditWheelControls(win, `memory:${id}`);
  }
  return { count: ids.length, ids };
}

async function checkCompactShell(win) {
  await value(win, `(() => {
    const app = window.WhiteboxApp;
    const rootSession = (app.state.snapshot?.sessions || []).find(item => item.id === 'fixture-root');
    app.state.workspace = rootSession?.originCwd || rootSession?.cwd || 'D:\\fixture';
    app.state.view = 'all';
    app.state.graphFocusId = null;
    app.state.search = '';
    app.state.providerFilters?.clear?.();
    app.renderWorkspaces?.();
    app.renderSessions?.('scroll-compact-shell');
  })()`);
  win.setContentSize(480, 720);
  await waitFor(win, `window.innerWidth <= 480
    && Boolean(document.querySelector('[data-pty-focus-trigger="fixture-root"]'))
    && document.querySelector('#projectViewTabs')?.getClientRects().length`,
    'compact 내비게이션 레이아웃으로 전환되지 않았습니다.');
  const compact = await value(win, `(() => {
    const nav = [...document.querySelectorAll('#projectViewTabs [data-view]')];
    const stage = document.querySelector('.main-stage');
    const sidebar = document.querySelector('.sidebar');
    return {
      views: nav.map(item => item.dataset.view),
      named: nav.every(item => Boolean(item.getAttribute('aria-label')?.trim())),
      controlledTargetsPresent: nav.every(item => String(item.getAttribute('aria-controls') || '')
        .split(/\\s+/).filter(Boolean).every(id => document.getElementById(id))),
      retiredTabsHidden: nav.every(item => item.getClientRects().length === 0),
      visibleCards: [...document.querySelectorAll('[data-control-session]')]
        .filter(card => card.getClientRects().length).length,
      sidebarHidden: getComputedStyle(sidebar).display === 'none',
      bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      stageOverflow: stage.scrollWidth > stage.clientWidth + 2,
      deletedAbsent: !document.querySelector('#mobileMoreBtn,#mobileToolsMenu,#advancedToolsNav,'
        + '#detailDrawer,#drawerBackdrop,#drawerComposer,#automationOverview,#tmuxSection,#tmuxCreateModal'),
    };
  })()`);
  assert(JSON.stringify(compact.views) === JSON.stringify(['all', 'active', 'waiting'])
    && compact.named && compact.controlledTargetsPresent && compact.retiredTabsHidden
    && compact.visibleCards >= 1 && compact.sidebarHidden
    && !compact.bodyOverflow && !compact.stageOverflow
    && compact.deletedAbsent,
  `compact shell 배치 또는 삭제 UI 계약이 올바르지 않습니다: ${JSON.stringify(compact)}`);
  const wheel = await auditWheelControls(win, 'compact-shell');
  win.setContentSize(1440, 940);
  await waitFor(win,
    `window.innerWidth > 1280 && !document.querySelector('#advancedToolsNav,#mobileMoreBtn,#mobileToolsMenu')`,
    '데스크톱 내비게이션 레이아웃으로 복원되지 않았습니다.');
  return { ...compact, wheel };
}

async function checkPtyFocusScroll(win) {
  await value(win, `(() => {
    const app = window.WhiteboxApp;
    const session = app.state.snapshot.sessions.find(item => item.id === 'fixture-root');
    app.state.workspace = session.originCwd || session.cwd;
    app.state.view = 'all';
    app.state.graphFocusId = null;
    app.renderWorkspaces();
    app.renderSessions('scroll-pty-focus');
    window.interactionTest.clearCalls();
    document.querySelector('[data-pty-focus-trigger="fixture-root"]')?.click();
  })()`);
  await waitFor(win, `window.WhiteboxApp.state.ptyFocusSessionId === 'fixture-root'
    && window.WhiteboxApp.state.ptyFocusTargetId === 'terminal-main'
    && Boolean(document.querySelector('#ptyFocusTerminalViewport '
      + '[data-terminal-screen="terminal-main"]:not(.hidden) .xterm'))`,
  '담당 root의 exact PTY 집중 모드가 준비되지 않았습니다.');

  await value(win, `window.interactionTest.emitTerminalData('terminal-main',
    Array.from({ length: 180 }, (_, index) => 'history-' + index + '\\r\\n').join(''))`);
  await waitFor(win, `(() => {
    const screen = document.querySelector('[data-terminal-screen="terminal-main"]');
    return Number(screen.dataset.baseY) > 140 && screen.textContent.includes('history-179');
  })()`,
    'PTY 스크롤 기록이 만들어지지 않았습니다.');
  await wait(120);
  const didRequestScroll = await value(win, `(() => {
    const screen = document.querySelector('[data-terminal-screen="terminal-main"]');
    return window.WhiteboxTerminal.scrollTerminalToLine(
      'terminal-main', Math.max(0, Number(screen.dataset.baseY) - 12));
  })()`);
  assert(didRequestScroll, 'PTY 스크롤 대상으로 exact terminal-main을 찾지 못했습니다.');
  await waitFor(win, `(() => {
    const screen = document.querySelector('[data-terminal-screen="terminal-main"]');
    return Number(screen.dataset.viewportY) < Number(screen.dataset.baseY);
  })()`, 'PTY 과거 출력 위치로 이동하지 못했습니다.');
  const before = await value(win, `(() => {
    const screen = document.querySelector('[data-terminal-screen="terminal-main"]');
    return {
      top: Number(screen.dataset.viewportY),
      maximum: Number(screen.dataset.baseY),
    };
  })()`);
  assert(before.top >= 0 && before.top < before.maximum,
    `PTY 과거 출력 위치를 만들지 못했습니다: ${JSON.stringify(before)}`);
  await value(win,
    `window.interactionTest.emitTerminalData('terminal-main', 'new-output-after-user-action\\r\\n')`);
  await wait(120);
  const after = await value(win, `(() => {
    const screen = document.querySelector('[data-terminal-screen="terminal-main"]');
    return { top: Number(screen.dataset.viewportY), maximum: Number(screen.dataset.baseY) };
  })()`);
  assert(Math.abs(after.top - before.top) <= 1,
    `PTY 출력이 사용자 휠 위치를 맨 아래로 이동했습니다: ${JSON.stringify({ before, after })}`);

  const focus = await value(win, `(() => ({
    lanes: document.querySelectorAll('#ptyFocusFlow .pty-focus-flow-lane').length,
    statusOnly: !document.querySelector('#ptyFocusFlow button,#ptyFocusFlow a,#ptyFocusFlow input,'
      + '#ptyFocusFlow textarea,#ptyFocusFlow select'),
    deletedAbsent: !document.querySelector('#detailDrawer,#drawerBackdrop,#drawerComposer,'
      + '#mobileMoreBtn,#mobileToolsMenu,#advancedToolsNav,#terminalSection,#terminalHistoryPanel,'
      + '#automationOverview,#tmuxSection,#tmuxCreateModal'),
    terminalCreates: window.interactionTest.getCalls().filter(call => call.name === 'terminalCreate').length,
  }))()`);
  assert(focus.lanes === 3 && focus.statusOnly && focus.deletedAbsent && focus.terminalCreates === 0,
    `PTY 집중 모드 상태/삭제 UI 계약이 올바르지 않습니다: ${JSON.stringify(focus)}`);
  await value(win, `window.WhiteboxApp.closePtyFocus({ restoreFocus: false })`);
  await waitFor(win, `!window.WhiteboxApp.state.ptyFocusSessionId
    && document.querySelector('#ptyFocusSurface')?.classList.contains('hidden')`,
  'PTY 집중 모드에서 작업 현황으로 돌아오지 못했습니다.');
  return { before, after, focus };
}

async function run() {
  installWorktreeDependencyRedirect();
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
  try {
    await win.loadFile(path.join(root, 'renderer', 'index.html'));
    await waitFor(win, `Boolean(window.WhiteboxApp?.initialized && window.WhiteboxTerminal
      && window.interactionTest)`, '렌더러가 준비되지 않았습니다.');
    const report = {
      mainViews: await checkMainViews(win),
      disclosures: await checkDisclosureStates(win),
      historyCards: await checkHistoryCards(win),
      compactShell: await checkCompactShell(win),
      ptyFocus: await checkPtyFocusScroll(win),
      wheelControls: await auditWheelControls(win, 'final'),
    };
    process.stdout.write(`스크롤 위치 유지 검사 통과: ${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    app.exit(process.exitCode || 0);
  }
}

app.whenReady().then(run).catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});

app.on('quit', () => {
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
});
