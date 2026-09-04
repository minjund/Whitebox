'use strict';

// Keep this historical entry-point name stable for CI. The main/root task uses
// the full PTY focus view, while child and execution rows open the read-only
// right detail drawer over that exact PTY.
const { app, BrowserWindow, session: electronSession } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'artifacts');
const logPath = path.join(outputDir, 'drawer-terminal-visual.log');
const screenshotPath = path.join(outputDir, 'whitebox-pty-focus-visual.png');
const drawerScreenshotPath = path.join(outputDir, 'whitebox-drawer-subnode.png');
const failureScreenshotPath = path.join(outputDir, 'whitebox-pty-focus-visual-failure.png');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-pty-focus-visual-'));

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(logPath, `[${new Date().toISOString()}] full PTY focus visual check started\n`);
app.setPath('userData', userData);

function log(message) {
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${String(message || '')}\n`);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function rendererValue(win, expression) {
  return win.webContents.executeJavaScript(expression);
}

async function waitForRenderer(win, expression, message, timeoutMs = 15_000) {
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
  throw new Error(`${message}${lastError ? ` (${lastError.message})` : ''}`);
}

function installWorktreeDependencyRedirect() {
  const value = String(process.env.WHITEBOX_TEST_NODE_MODULES || '').trim();
  const dependencyRoot = value ? path.resolve(value) : '';
  const localRoot = path.join(root, 'node_modules');
  if (!dependencyRoot || !fs.existsSync(dependencyRoot) || fs.existsSync(localRoot)) return;
  electronSession.defaultSession.webRequest.onBeforeRequest({ urls: ['file:///*'] }, (details, callback) => {
    let requested = '';
    try { requested = fileURLToPath(details.url); } catch {}
    const relative = requested ? path.relative(localRoot, requested) : '..';
    const alternate = relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      ? path.join(dependencyRoot, relative)
      : '';
    callback(alternate && fs.existsSync(alternate) ? { redirectURL: pathToFileURL(alternate).href } : {});
  });
}

async function run() {
  installWorktreeDependencyRedirect();
  const rendererErrors = [];
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
    log(`renderer ${message}`);
  });

  try {
    await win.loadFile(path.join(root, 'renderer', 'index.html'));
    await waitForRenderer(win,
      `Boolean(window.WhiteboxApp?.initialized && window.WhiteboxApp?.openPtyFocus
        && window.WhiteboxTerminal && window.WhiteboxInlineTerminal && window.interactionTest)`,
      'PTY focus renderer fixture가 준비되지 않았습니다.');

    const opened = await rendererValue(win, `(() => {
      window.interactionTest.clearCalls();
      return window.WhiteboxApp.openPtyFocus('fixture-root', { focus: true });
    })()`);
    assert(opened === true, 'fixture-root의 full PTY focus 화면을 열지 못했습니다.');
    await waitForRenderer(win, `(() => {
      const app = window.WhiteboxApp;
      const surface = document.querySelector('#ptyFocusSurface');
      const shell = document.querySelector('#ptyFocusTerminalShell');
      const embedded = window.WhiteboxTerminal.embeddedState();
      return app.state.ptyFocusSessionId === 'fixture-root'
        && surface && !surface.classList.contains('hidden') && !surface.inert
        && surface.getAttribute('aria-hidden') === 'false'
        && shell?.dataset.inlineAgentTerminal === 'fixture-root'
        && embedded.connected && embedded.agentSessionId === 'fixture-root'
        && embedded.terminalId === 'terminal-main'
        && shell?.dataset.connection === 'connected'
        && shell?.querySelector('[data-inline-terminal-empty]')?.classList.contains('hidden')
        && document.querySelector('#ptyFocusTerminalViewport > .terminal-screen[data-terminal-screen="terminal-main"] .xterm')
        && document.querySelector('#ptyFocusTerminalViewport .xterm-helper-textarea');
    })()`, 'full PTY focus 화면에 fixture PTY가 mount되지 않았습니다.');

    const initial = await rendererValue(win, `(() => {
      const surface = document.querySelector('#ptyFocusSurface');
      const viewport = document.querySelector('#ptyFocusTerminalViewport');
      const host = viewport?.querySelector(':scope > .terminal-screen');
      const helper = host?.querySelector('.xterm-helper-textarea');
      const deletedSelectors = [
        '#agentInlineTerminalViewport', '#ptyFocusChildModal',
        '#automationOverview', '#tmuxSection', '#tmuxCreateModal',
      ];
      const drawer = document.querySelector('#detailDrawer');
      const backdrop = document.querySelector('#drawerBackdrop');
      helper?.focus({ preventScroll: true });
      window.__whiteboxPtyFocusVisualIdentity = { surface, viewport, host, helper };
      return {
        focusOpen: document.body.classList.contains('pty-focus-open'),
        sessionId: window.WhiteboxApp.state.ptyFocusSessionId || '',
        targetId: window.WhiteboxApp.state.ptyFocusTargetId || '',
        surfaceVisible: Boolean(surface && !surface.classList.contains('hidden') && !surface.inert),
        backgroundInactive: Boolean(document.querySelector('#mainContent')?.inert && document.querySelector('.sidebar')?.inert),
        rootNodes: surface?.querySelectorAll('.pty-focus-root-node').length || 0,
        flowLanes: surface?.querySelectorAll('.pty-focus-flow-lane').length || 0,
        detailFlowControls: document.querySelector('#ptyFocusFlow')?.querySelectorAll('button[data-pty-focus-child], button[data-pty-focus-execution]').length || 0,
        writableFlowInputs: document.querySelector('#ptyFocusFlow')?.querySelectorAll('input, textarea, select, [contenteditable="true"]').length || 0,
        oldDomAbsent: deletedSelectors.every(selector => !document.querySelector(selector)),
        drawerDomPresent: Boolean(drawer && backdrop && document.querySelector('#drawerContent') && document.querySelector('#closeDrawerBtn')),
        drawerClosed: Boolean(drawer && !drawer.classList.contains('open') && drawer.inert
          && drawer.getAttribute('aria-hidden') === 'true' && backdrop?.classList.contains('hidden')),
        focused: document.activeElement === helper,
        xtermMounted: Boolean(host?.querySelector('.xterm')),
        emptyHidden: Boolean(surface?.querySelector('[data-inline-terminal-empty]')?.classList.contains('hidden')),
        connectionTone: document.querySelector('#ptyFocusTerminalShell')?.dataset.connection || '',
        composerAbsent: !surface?.querySelector('[data-inline-terminal-composer]'),
        terminalCreates: window.interactionTest.getCalls().filter(call => call.name === 'terminalCreate').length,
      };
    })()`);
    assert(initial.focusOpen && initial.surfaceVisible && initial.backgroundInactive,
      `PTY focus 전용 화면/배경 상태가 올바르지 않습니다: ${JSON.stringify(initial)}`);
    assert(initial.sessionId === 'fixture-root' && initial.targetId === 'terminal-main'
      && initial.rootNodes === 1 && initial.flowLanes === 3,
    `PTY focus 담당 노드/흐름 구성이 올바르지 않습니다: ${JSON.stringify(initial)}`);
    assert(initial.oldDomAbsent && initial.drawerDomPresent && initial.drawerClosed
      && initial.detailFlowControls >= 2 && initial.writableFlowInputs === 0 && initial.composerAbsent,
      `PTY와 오른쪽 상세 패널의 역할 분리가 올바르지 않습니다: ${JSON.stringify(initial)}`);
    assert(initial.focused && initial.xtermMounted && initial.emptyHidden
      && initial.connectionTone === 'connected' && initial.terminalCreates === 0,
      `기존 PTY의 focus-only xterm mount가 올바르지 않습니다: ${JSON.stringify(initial)}`);

    const flowLayout = await rendererValue(win, `(() => {
      const lists = [...document.querySelectorAll('#ptyFocusFlow .pty-focus-flow-list')];
      return lists.map((list, index) => {
        const nodes = [...list.querySelectorAll('.pty-focus-node')];
        const before = nodes.map(node => Math.round(node.getBoundingClientRect().width * 100) / 100);
        const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth);
        list.scrollLeft = maxScroll;
        const endScroll = list.scrollLeft;
        const listAtEnd = list.getBoundingClientRect();
        const lastAtEnd = nodes.at(-1)?.getBoundingClientRect();
        list.scrollLeft = 0;
        const startScroll = list.scrollLeft;
        const listAtStart = list.getBoundingClientRect();
        const firstAtStart = nodes[0]?.getBoundingClientRect();
        const after = nodes.map(node => Math.round(node.getBoundingClientRect().width * 100) / 100);
        return {
          index,
          nodeCount: nodes.length,
          clientWidth: list.clientWidth,
          scrollWidth: list.scrollWidth,
          maxScroll,
          endScroll,
          startScroll,
          before,
          after,
          minWidths: nodes.map(node => getComputedStyle(node).minWidth),
          flexShrink: nodes.map(node => getComputedStyle(node).flexShrink),
          copyWidths: nodes.map(node => Math.round((node.querySelector('.pty-focus-node-copy')?.getBoundingClientRect().width || 0) * 100) / 100),
          stateInside: nodes.every(node => {
            const state = node.querySelector('.pty-focus-node-state');
            if (!state) return true;
            const nodeRect = node.getBoundingClientRect();
            const stateRect = state.getBoundingClientRect();
            return stateRect.left >= nodeRect.left - 1 && stateRect.right <= nodeRect.right + 1;
          }),
          textClippedSafely: nodes.every(node => [...node.querySelectorAll('.pty-focus-node-copy small, .pty-focus-node-copy b, .pty-focus-node-copy em, .pty-focus-node-state')]
            .every(part => {
              const style = getComputedStyle(part);
              return style.whiteSpace === 'nowrap' && style.overflow === 'hidden' && style.textOverflow === 'ellipsis';
            })),
          firstVisibleAtStart: !firstAtStart || (firstAtStart.left >= listAtStart.left - 1 && firstAtStart.right <= listAtStart.right + 1),
          lastVisibleAtEnd: !lastAtEnd || (lastAtEnd.left >= listAtEnd.left - 1 && lastAtEnd.right <= listAtEnd.right + 1),
        };
      });
    })()`);
    const crowdedFlowLists = flowLayout.filter(list => list.nodeCount >= 3);
    assert(crowdedFlowLists.length >= 2
      && crowdedFlowLists.every(list => list.before.every(width => width >= 188)
        && list.after.every((width, index) => Math.abs(width - list.before[index]) <= 1)
        && list.maxScroll > 0 && Math.abs(list.endScroll - list.maxScroll) <= 1 && list.startScroll === 0
        && list.firstVisibleAtStart && list.lastVisibleAtEnd
        && list.flexShrink.every(value => value === '0')
        && list.copyWidths.every(width => width >= 48)
        && list.stateInside && list.textClippedSafely),
    `가로 이동 중 PTY 흐름 카드의 폭 또는 처음/끝 표시가 깨졌습니다: ${JSON.stringify(flowLayout)}`);

    win.setSize(720, 700);
    await rendererValue(win, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const narrowFlowLayout = await rendererValue(win, `(() => {
      const region = document.querySelector('.pty-focus-flow-region');
      const flow = document.querySelector('.pty-focus-flow');
      const lists = [...document.querySelectorAll('#ptyFocusFlow .pty-focus-flow-list')];
      return {
        viewportWidth: innerWidth,
        bodyOverflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        regionOverflowsX: Boolean(region && region.scrollWidth > region.clientWidth + 1),
        flowOverflowsX: Boolean(flow && flow.scrollWidth > flow.clientWidth + 1),
        arrowsHidden: [...document.querySelectorAll('.pty-focus-flow-arrow')]
          .every(arrow => getComputedStyle(arrow).display === 'none'),
        lists: lists.map(list => {
          const nodes = [...list.querySelectorAll('.pty-focus-node')];
          const before = nodes.map(node => Math.round(node.getBoundingClientRect().width * 100) / 100);
          const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth);
          list.scrollLeft = maxScroll;
          const endScroll = list.scrollLeft;
          const listAtEnd = list.getBoundingClientRect();
          const lastAtEnd = nodes.at(-1)?.getBoundingClientRect();
          list.scrollLeft = 0;
          const listAtStart = list.getBoundingClientRect();
          const firstAtStart = nodes[0]?.getBoundingClientRect();
          return {
            nodeCount: nodes.length,
            maxScroll,
            endScroll,
            before,
            after: nodes.map(node => Math.round(node.getBoundingClientRect().width * 100) / 100),
            copyWidths: nodes.map(node => Math.round((node.querySelector('.pty-focus-node-copy')?.getBoundingClientRect().width || 0) * 100) / 100),
            stateInside: nodes.every(node => {
              const state = node.querySelector('.pty-focus-node-state');
              if (!state) return true;
              const nodeRect = node.getBoundingClientRect();
              const stateRect = state.getBoundingClientRect();
              return stateRect.left >= nodeRect.left - 1 && stateRect.right <= nodeRect.right + 1;
            }),
            firstVisibleAtStart: !firstAtStart || (firstAtStart.left >= listAtStart.left - 1 && firstAtStart.right <= listAtStart.right + 1),
            lastVisibleAtEnd: !lastAtEnd || (lastAtEnd.left >= listAtEnd.left - 1 && lastAtEnd.right <= listAtEnd.right + 1),
          };
        }),
      };
    })()`);
    const narrowCrowdedLists = narrowFlowLayout.lists.filter(list => list.nodeCount >= 3);
    assert(narrowFlowLayout.viewportWidth <= 720 && !narrowFlowLayout.bodyOverflowsX
      && !narrowFlowLayout.regionOverflowsX && !narrowFlowLayout.flowOverflowsX
      && narrowFlowLayout.arrowsHidden && narrowCrowdedLists.length >= 2
      && narrowCrowdedLists.every(list => list.maxScroll > 0
        && Math.abs(list.endScroll - list.maxScroll) <= 1
        && list.before.every(width => width >= 188)
        && list.after.every((width, index) => Math.abs(width - list.before[index]) <= 1)
        && list.copyWidths.every(width => width >= 48)
        && list.stateInside && list.firstVisibleAtStart && list.lastVisibleAtEnd),
    `좁은 화면에서 PTY 흐름의 바깥/안쪽 가로 이동 경계가 올바르지 않습니다: ${JSON.stringify(narrowFlowLayout)}`);
    win.setSize(1440, 940);
    await rendererValue(win, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);

    await rendererValue(win, `(() => {
      const child = document.querySelector('[data-pty-focus-child="fixture-child"]');
      child?.focus({ preventScroll: true });
      child?.click();
    })()`);
    await waitForRenderer(win, `(() => {
      const app = window.WhiteboxApp;
      const drawer = document.querySelector('#detailDrawer');
      const surface = document.querySelector('#ptyFocusSurface');
      return app.state.ptyFocusSessionId === 'fixture-root'
        && app.state.selectedId === 'fixture-child' && app.state.drawerMode === 'subagent'
        && drawer?.classList.contains('open') && !drawer.inert
        && drawer.getAttribute('aria-hidden') === 'false'
        && !document.querySelector('#drawerBackdrop')?.classList.contains('hidden')
        && surface && !surface.classList.contains('hidden');
    })()`, '서브노드가 기존 PTY 위의 오른쪽 상세 패널을 열지 못했습니다.');
    const childDrawer = await rendererValue(win, `(() => {
      const content = document.querySelector('#drawerContent');
      const embedded = window.WhiteboxTerminal.embeddedState();
      return {
        drawerMode: document.querySelector('#detailDrawer')?.dataset.mode || '',
        contentLength: content?.textContent?.trim().length || 0,
        hasConversation: Boolean(content?.querySelector('.subagent-conversation, .chat-list, .chat-turn')),
        terminalConnected: embedded.connected,
        terminalId: embedded.terminalId || '',
        terminalCreates: window.interactionTest.getCalls().filter(call => call.name === 'terminalCreate').length,
      };
    })()`);
    assert(childDrawer.drawerMode === 'subagent' && childDrawer.contentLength > 80 && childDrawer.hasConversation,
      `서브노드 상세 패널에 읽기 전용 대화가 표시되지 않았습니다: ${JSON.stringify(childDrawer)}`);
    assert(childDrawer.terminalConnected && childDrawer.terminalId === 'terminal-main' && childDrawer.terminalCreates === 0,
      `서브노드 상세 패널이 기존 root PTY 연결을 바꿨습니다: ${JSON.stringify(childDrawer)}`);
    win.show();
    win.webContents.invalidate();
    await wait(300);
    fs.writeFileSync(drawerScreenshotPath, (await win.webContents.capturePage()).toPNG());
    await rendererValue(win, `document.querySelector('#closeDrawerBtn')?.click()`);
    await waitForRenderer(win, `(() => {
      const app = window.WhiteboxApp;
      const drawer = document.querySelector('#detailDrawer');
      const surface = document.querySelector('#ptyFocusSurface');
      const embedded = window.WhiteboxTerminal.embeddedState();
      return app.state.ptyFocusSessionId === 'fixture-root'
        && drawer && !drawer.classList.contains('open') && drawer.inert
        && drawer.getAttribute('aria-hidden') === 'true'
        && surface && !surface.classList.contains('hidden') && !surface.inert
        && embedded.connected && embedded.terminalId === 'terminal-main'
        && document.activeElement?.dataset.ptyFocusChild === 'fixture-child';
    })()`, '서브노드 상세 패널을 닫은 뒤 기존 PTY와 포커스가 복원되지 않았습니다.');

    await rendererValue(win, `(() => {
      const execution = document.querySelector('[data-pty-focus-execution="fixture-shell-running"]');
      execution?.focus({ preventScroll: true });
      execution?.click();
    })()`);
    await waitForRenderer(win, `(() => {
      const app = window.WhiteboxApp;
      const drawer = document.querySelector('#detailDrawer');
      const content = document.querySelector('#drawerContent');
      const embedded = window.WhiteboxTerminal.embeddedState();
      return app.state.ptyFocusSessionId === 'fixture-root'
        && app.state.selectedId === 'fixture-root' && app.state.drawerMode === 'execution'
        && app.state.drawerExecutionId === 'fixture-shell-running'
        && drawer?.classList.contains('open') && !drawer.inert
        && embedded.connected && embedded.terminalId === 'terminal-main'
        && content?.textContent.includes('npm run dev');
    })()`, '실행 항목이 기존 PTY 위의 오른쪽 상세 패널을 열지 못했습니다.');
    await rendererValue(win, `document.querySelector('#closeDrawerBtn')?.click()`);
    await waitForRenderer(win, `(() => {
      const drawer = document.querySelector('#detailDrawer');
      return window.WhiteboxApp.state.ptyFocusSessionId === 'fixture-root'
        && drawer && !drawer.classList.contains('open') && drawer.inert
        && window.WhiteboxTerminal.embeddedState().terminalId === 'terminal-main';
    })()`, '실행 상세 패널을 닫은 뒤 기존 PTY가 유지되지 않았습니다.');

    const marker = `PTY_FOCUS_VISUAL_REFRESH_${Date.now()}`;
    await rendererValue(win, `(() => {
      window.interactionTest.updateSession('fixture-root', { statusDetail: 'PTY focus snapshot 갱신 확인' });
      window.interactionTest.emitSnapshot();
    })()`);
    // Let both the snapshot render and its follow-up focus sync start before
    // publishing the marker. Otherwise the old connected frame can satisfy
    // the assertion while the next RAF has already queued a connecting state.
    await rendererValue(win, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await rendererValue(win,
      `window.interactionTest.emitTerminalData('terminal-main', ${JSON.stringify(`\r\n${marker}\r\n`)})`);
    await waitForRenderer(win, `(() => {
      const baseline = window.__whiteboxPtyFocusVisualIdentity;
      const surface = document.querySelector('#ptyFocusSurface');
      const viewport = document.querySelector('#ptyFocusTerminalViewport');
      const host = viewport?.querySelector(':scope > .terminal-screen');
      const empty = surface?.querySelector('[data-inline-terminal-empty]');
      const hostStyle = host ? getComputedStyle(host) : null;
      return surface === baseline?.surface && viewport === baseline?.viewport && host === baseline?.host
        && window.WhiteboxTerminal.embeddedState().connected
        && document.querySelector('#ptyFocusTerminalShell')?.dataset.connection === 'connected'
        && empty?.classList.contains('hidden') && getComputedStyle(empty).display === 'none'
        && hostStyle?.display !== 'none' && hostStyle?.visibility !== 'hidden'
        && host.getBoundingClientRect().width > 0 && host.getBoundingClientRect().height > 0
        && Boolean(host.querySelector('.xterm'))
        && [...(host?.querySelectorAll('.xterm-rows > div') || [])]
          .some(row => (row.textContent || '').includes(${JSON.stringify(marker)}));
    })()`, 'snapshot 갱신 중 PTY focus host identity 또는 live 출력이 끊겼습니다.');

    // Hidden Electron windows can retain an older compositor frame even after
    // the DOM/xterm state has settled. Expose and invalidate the test window,
    // then verify the live state again before capturing what a user would see.
    win.show();
    win.webContents.invalidate();
    await wait(250);
    await waitForRenderer(win, `(() => {
      const shell = document.querySelector('#ptyFocusTerminalShell');
      const host = document.querySelector('#ptyFocusTerminalViewport > .terminal-screen[data-terminal-screen="terminal-main"]');
      const empty = shell?.querySelector('[data-inline-terminal-empty]');
      const style = host ? getComputedStyle(host) : null;
      return shell?.dataset.connection === 'connected'
        && empty?.classList.contains('hidden') && getComputedStyle(empty).display === 'none'
        && style?.display !== 'none' && style?.visibility !== 'hidden'
        && host.getBoundingClientRect().width > 0 && host.getBoundingClientRect().height > 0
        && Boolean(host.querySelector('.xterm'))
        && [...(host?.querySelectorAll('.xterm-rows > div') || [])]
          .some(row => (row.textContent || '').includes(${JSON.stringify(marker)}));
    })()`, 'capture 직전 PTY 출력 상태가 유지되지 않았습니다.');
    win.webContents.invalidate();
    await wait(100);
    fs.writeFileSync(screenshotPath, (await win.webContents.capturePage()).toPNG());
    await rendererValue(win, `document.querySelector('#ptyFocusBackBtn')?.click()`);
    await waitForRenderer(win, `(() => {
      const surface = document.querySelector('#ptyFocusSurface');
      return !window.WhiteboxApp.state.ptyFocusSessionId
        && surface?.classList.contains('hidden') && surface?.inert
        && !document.body.classList.contains('pty-focus-open')
        && !document.querySelector('#mainContent')?.inert
        && !document.querySelector('.sidebar')?.inert;
    })()`, 'PTY focus 종료 후 원래 작업 화면 상태가 복원되지 않았습니다.');

    assert(rendererErrors.length === 0, `renderer 오류가 발생했습니다: ${rendererErrors.join(' | ')}`);
    const summary = { ...initial, marker, screenshotPath, drawerScreenshotPath };
    log(`passed ${JSON.stringify(summary)}`);
    process.stdout.write(`✓ root PTY와 서브노드/실행 오른쪽 상세 패널 시각·mount 검증\n${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    log(`failed ${error.stack || error}`);
    try {
      fs.writeFileSync(failureScreenshotPath, (await win.webContents.capturePage()).toPNG());
      log(`failure screenshot ${failureScreenshotPath}`);
    } catch (captureError) {
      log(`failure screenshot error ${captureError.stack || captureError}`);
    }
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    app.exit(process.exitCode || 0);
  }
}

app.whenReady().then(run).catch(error => {
  log(`startup failed ${error.stack || error}`);
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});

app.on('quit', () => {
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
});
