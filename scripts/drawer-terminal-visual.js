'use strict';

// Keep this historical entry-point name stable for CI. The product surface it
// verifies is now the full PTY focus view; no drawer/conversation UI is used.
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
        '#detailDrawer', '#drawerBackdrop', '#drawerTerminalViewport', '#drawerContent',
        '#drawerComposer', '#agentInlineTerminalViewport', '#ptyFocusChildModal',
        '#automationOverview', '#tmuxSection', '#tmuxCreateModal',
      ];
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
        writableFlowControls: document.querySelector('#ptyFocusFlow')?.querySelectorAll('button, a, input, textarea, select, [contenteditable="true"]').length || 0,
        oldDomAbsent: deletedSelectors.every(selector => !document.querySelector(selector)),
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
    assert(initial.oldDomAbsent && initial.writableFlowControls === 0 && initial.composerAbsent,
      `삭제된 drawer/conversation UI 또는 별도 입력 UI가 남아 있습니다: ${JSON.stringify(initial)}`);
    assert(initial.focused && initial.xtermMounted && initial.emptyHidden
      && initial.connectionTone === 'connected' && initial.terminalCreates === 0,
      `기존 PTY의 focus-only xterm mount가 올바르지 않습니다: ${JSON.stringify(initial)}`);

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
    const summary = { ...initial, marker, screenshotPath };
    log(`passed ${JSON.stringify(summary)}`);
    process.stdout.write(`✓ full PTY focus-only 시각/mount 검증\n${JSON.stringify(summary, null, 2)}\n`);
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
