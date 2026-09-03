'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const vm = require('vm');
const { app, BrowserWindow, ipcMain, session: electronSession } = require('electron');
const { fileURLToPath, pathToFileURL } = require('url');

const testNodeModulesValue = String(process.env.WHITEBOX_TEST_NODE_MODULES || '').trim();
const testNodeModules = testNodeModulesValue ? path.resolve(testNodeModulesValue) : '';
if (testNodeModules && fs.existsSync(testNodeModules)) {
  process.env.NODE_PATH = [testNodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  Module._initPaths();
}

const { TerminalManager, isInternalTerminalProjectionSessionId } = require('../src/terminalManager');
const { TerminalHostServer, TerminalHostClient } = require('../src/terminalHost');
const { registerTerminalIpc } = require('../src/ipc/registerTerminalIpc');
const { applyRuntimePresence } = require('../src/processMonitor');

app.disableHardwareAcceleration();
// Keep cleanup in control after the hidden integration window is destroyed;
// otherwise Electron may exit successfully on `window-all-closed` before the
// test can propagate a failure status.
app.on('window-all-closed', () => {});

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
const logFile = path.join(artifacts, 'pty-focus-actual-pty-integration.log');
const screenshotFile = path.join(artifacts, 'whitebox-pty-focus-actual-pty-failure.png');
const temporary = (() => {
  const candidate = path.resolve(String(process.env.WHITEBOX_DRAWER_ACTUAL_PTY_TEMP_ROOT || ''));
  const nonce = String(process.env.WHITEBOX_DRAWER_ACTUAL_PTY_TEMP_NONCE || '');
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const stat = fs.lstatSync(candidate);
  const real = fs.realpathSync(candidate);
  const owner = JSON.parse(fs.readFileSync(path.join(real, '.whitebox-drawer-actual-pty-owner.json'), 'utf8'));
  if (!stat.isDirectory()
    || stat.isSymbolicLink()
    || path.dirname(real) !== temporaryParent
    || !path.basename(real).startsWith('whitebox-drawer-actual-pty-')
    || !nonce
    || owner.nonce !== nonce
    || owner.runnerPid !== process.ppid) {
    throw new Error(`Untrusted actual PTY integration temporary root: ${candidate}`);
  }
  return real;
})();
const discoveryFile = path.join(temporary, 'terminal-host.json');
const storeFile = path.join(temporary, 'terminals.json');
const endpoint = process.platform === 'win32'
  ? `\\\\.\\pipe\\whitebox-drawer-actual-pty-${process.pid}-${Date.now()}`
  : path.join(temporary, 'terminal-host.sock');
const ipcChannels = [
  'terminals:list', 'wsl:list-distros', 'terminals:get', 'terminals:create',
  'terminals:write', 'terminals:command', 'terminals:respond', 'terminals:resize', 'terminals:signal',
  'terminals:restart', 'terminals:reconnect', 'terminals:detach', 'terminals:stop',
  'terminals:close', 'terminals:retire',
];

fs.mkdirSync(artifacts, { recursive: true });
fs.writeFileSync(logFile, '');
app.setPath('userData', path.join(temporary, 'electron-user-data'));

function log(message) {
  const line = `[${new Date().toISOString()}] ${String(message || '')}`;
  fs.appendFileSync(logFile, `${line}\n`);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function installWorktreeDependencyRedirect() {
  const localRoot = path.join(root, 'node_modules');
  if (!testNodeModules || !fs.existsSync(testNodeModules) || fs.existsSync(localRoot)) return;
  electronSession.defaultSession.webRequest.onBeforeRequest({ urls: ['file:///*'] }, (details, callback) => {
    let requested = '';
    try { requested = fileURLToPath(details.url); } catch {}
    const relative = requested ? path.relative(localRoot, requested) : '..';
    const alternate = relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      ? path.join(testNodeModules, relative)
      : '';
    callback(alternate && fs.existsSync(alternate) ? { redirectURL: pathToFileURL(alternate).href } : {});
  });
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitUntil(check, message, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await wait(50);
  }
  throw new Error(`${message}${lastError ? ` (${lastError.message})` : ''}`);
}

function encodedMarkerCommand(marker) {
  return `LTA_DRAWER_ECHO:${Buffer.from(marker, 'utf8').toString('base64url')}`;
}

function encodedAdditionalArgument(name, value) {
  return `--${name}=${Buffer.from(String(value || ''), 'utf8').toString('base64url')}`;
}

function fixtureLaunchArgumentsMarker(args) {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(args), 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `WHITEBOX_DRAWER_BOUND_PTY_ARGV_${hash}`;
}

function mainBridgePresenceProjector() {
  const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const start = source.indexOf('function bridgePresenceSessionEligible(session)');
  const end = source.indexOf('function bridgePresence()', start);
  if (start < 0 || end <= start) {
    throw new Error('main.js bridge presence projector를 찾지 못했습니다.');
  }
  const sandbox = {
    process: { platform: process.platform },
    isInternalTerminalProjectionSessionId,
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.projectTerminalBridgePresence = projectTerminalBridgePresence;`, sandbox, {
    filename: 'main-bridge-presence.js',
  });
  return sessions => Array.from(sandbox.projectTerminalBridgePresence(sessions, process.platform));
}

async function rendererValue(win, expression) {
  return win.webContents.executeJavaScript(expression);
}

async function waitForRenderer(win, expression, message, timeoutMs = 12_000) {
  return waitUntil(() => rendererValue(win, expression), message, timeoutMs);
}

async function run() {
  installWorktreeDependencyRedirect();
  const fixtureProvider = {
    command: 'node',
    args: [path.join(__dirname, 'drawer-bound-pty-agent-fixture.js')],
    label: 'Signed PTY focus integration',
  };
  const manager = new TerminalManager({
    storeFile,
    agentProviders: {
      claude: fixtureProvider,
      codex: { ...fixtureProvider, label: 'Codex Desktop fork PTY integration' },
    },
  });
  const server = new TerminalHostServer({
    manager,
    discoveryFile,
    endpoint,
    idleShutdownMs: 60_000,
  });
  const client = new TerminalHostClient({ discoveryFile, connectTimeoutMs: 8_000 });
  const clientData = [];
  const ipcCalls = [];
  let win = null;
  let terminalId = '';
  let codexForkTerminalId = '';
  let terminalRetired = false;
  let exitCode = 0;

  const collectData = payload => {
    clientData.push(String(payload?.data || ''));
    if (win && !win.isDestroyed()) win.webContents.send('terminals:data', payload);
  };
  const forwardState = payload => {
    if (win && !win.isDestroyed()) win.webContents.send('terminals:state', payload);
  };
  const forwardDisconnect = () => {
    if (win && !win.isDestroyed()) win.webContents.send('terminals:connection', { state: 'reconnecting' });
  };
  const forwardReconnect = payload => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('terminals:state', { change: 'reconnected', session: null, sessions: payload?.sessions || client.list() });
    win.webContents.send('terminals:connection', { state: 'connected' });
  };
  const forwardReconnectError = error => {
    if (win && !win.isDestroyed()) win.webContents.send('terminals:connection', { state: 'failed', message: String(error?.message || error) });
  };

  client.on('data', collectData);
  client.on('state', forwardState);
  client.on('disconnect', forwardDisconnect);
  client.on('reconnect', forwardReconnect);
  client.on('reconnect-error', forwardReconnectError);

  const ipcManager = new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        ipcCalls.push({ operation: String(property), args });
        return Reflect.apply(value, target, args);
      };
    },
  });

  try {
    const hostInfo = await server.start();
    await client.connect();
    assert(client.connected, 'TerminalHostClient가 실제 소켓에 연결되지 않았습니다.');
    assert(hostInfo.endpoint === endpoint && server.clients.size === 1,
      'TerminalHostServer의 인증 소켓 연결을 확인하지 못했습니다.');

    const agentSessionId = 'fixture-root';
    const agentResumeSessionId = 'fixture-root-external';
    const agentConnectionSignature = `acs1:${crypto.createHash('sha256').update(JSON.stringify([
      agentSessionId,
      'claude',
      agentResumeSessionId,
      '',
      '',
    ]), 'utf8').digest('hex')}`;
    const resumeArgs = ['--resume', agentResumeSessionId];
    let session = await client.create({
      type: 'agent',
      provider: 'claude',
      cwd: root,
      args: resumeArgs,
      recoveryArgs: resumeArgs,
      bridgeId: agentSessionId,
      agentConnectionSignature,
      sessionBackend: 'direct',
      reuseBridge: true,
      cols: 120,
      rows: 32,
      title: '실제 PTY focus 통합 검증',
    });
    terminalId = String(session?.id || '');
    assert(terminalId && session.status === 'running'
      && session.type === 'agent'
      && session.provider === 'claude'
      && session.bridgeId === agentSessionId
      && session.agentResumeSessionId === agentResumeSessionId
      && session.agentConnectionSignature === agentConnectionSignature
      && session.conversationBound === true
      && session.backend === 'direct',
    `서명된 앱 소유 agent PTY가 실행되지 않았습니다: ${JSON.stringify(session)}`);

    const hydrationMarker = `LTA_REPLAY_${Date.now()}`;
    const scrollHistoryMarker = `LTA_SCROLL_HISTORY_${Date.now()}`;
    const liveMarker = `LTA_LIVE_${Date.now()}`;
    const hydrationText = `${Array.from({ length: 96 }, (_item, index) => (
      `${scrollHistoryMarker}_${String(index).padStart(3, '0')}`
    )).join('\r\n')}\r\n${hydrationMarker}`;
    const hydrationCommand = encodedMarkerCommand(hydrationText);
    const liveCommand = encodedMarkerCommand(liveMarker);

    await client.command(terminalId, hydrationCommand);
    await waitUntil(() => clientData.join('').includes(hydrationMarker),
      'TerminalManager 출력이 TerminalHost 소켓을 통해 돌아오지 않았습니다.');
    await waitUntil(async () => String((await client.get(terminalId, true))?.replay || '').includes(hydrationMarker),
      '실제 PTY replay에 사전 출력 marker가 기록되지 않았습니다.');
    session = await client.get(terminalId, true);
    const claudeLaunchMarker = fixtureLaunchArgumentsMarker(resumeArgs);
    assert(Number(session?.pid) > 0,
      `실제 node-pty 자식 프로세스 id를 확인하지 못했습니다: ${JSON.stringify(session)}`);
    assert(String(session?.replay || '').includes(claudeLaunchMarker),
      `Claude launch spec의 정확한 --resume argv가 실제 node-pty fixture에 도착하지 않았습니다: ${JSON.stringify(session)}`);

    win = new BrowserWindow({
      width: 1440,
      height: 960,
      show: false,
      backgroundColor: '#08111b',
      webPreferences: {
        preload: path.join(__dirname, 'interaction-fixture-preload.js'),
        additionalArguments: [
          `--whitebox-real-terminal-id=${terminalId}`,
          `--whitebox-real-terminal-pid=${session.pid}`,
          encodedAdditionalArgument('whitebox-real-terminal-cwd', root),
        ],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.on('console-message', (_event, details, legacyMessage, legacyLine, legacySourceId) => {
      const message = typeof details === 'object' ? details.message : String(legacyMessage || details || '');
      const location = typeof details === 'object'
        ? `${details.sourceId || 'renderer'}:${details.lineNumber || 0}`
        : `${legacySourceId || 'renderer'}:${legacyLine || 0}`;
      log(`renderer ${location} ${message}`);
    });

    registerTerminalIpc({
      ipcMain,
      requireTrustedSender: event => {
        if (!win || win.isDestroyed() || event.sender !== win.webContents) {
          throw new Error('신뢰할 수 없는 실제 PTY 통합 검증 요청입니다.');
        }
      },
      trustedSender: event => Boolean(win && !win.isDestroyed() && event.sender === win.webContents),
      manager: () => ipcManager,
      isProviderVisible: () => true,
      listWslDistros: () => [],
      sendError: payload => {
        if (win && !win.isDestroyed()) win.webContents.send('terminals:error', payload);
      },
    });

    await win.loadFile(path.join(root, 'renderer', 'index.html'));
    await waitForRenderer(win,
      `Boolean(window.WhiteboxApp?.initialized && window.WhiteboxTerminal && window.WhiteboxInlineTerminal && window.interactionTest)`,
      'renderer와 실제 PTY preload가 준비되지 않았습니다.');

    const openedFocus = await rendererValue(win, `(() => {
      const findWorkspace = () => [...document.querySelectorAll('#projectSidebarList [data-workspace]')]
        .find(node => node.dataset.workspace === ${JSON.stringify(root)});
      let workspace = findWorkspace();
      workspace?.click();
      // An expanded accordion row closes on its first click. Re-query after
      // that synchronous render and click the collapsed row to select/open it;
      // if it began collapsed, the first click already performed that action.
      workspace = findWorkspace();
      if (workspace?.getAttribute('aria-expanded') === 'false') workspace.click();
      const trigger = document.querySelector('.control-room-main[data-pty-focus-trigger="fixture-root"]');
      trigger?.click();
      return Boolean(workspace && trigger);
    })()`);
    assert(openedFocus, '실제 PTY focus를 열 프로젝트 또는 담당 노드 진입점을 찾지 못했습니다.');
    await waitForRenderer(win, `(() => {
      const surface = document.querySelector('#ptyFocusSurface');
      const shell = document.querySelector('#ptyFocusTerminalShell[data-inline-agent-terminal="fixture-root"]');
      const embedded = window.WhiteboxTerminal.embeddedState();
      const rootSession = window.WhiteboxApp.state.snapshot.sessions.find(item => item.id === 'fixture-root');
      const terminal = window.interactionTest.getTerminals().find(item =>
        item.id === ${JSON.stringify(terminalId)});
      const retiredDomAbsent = [
        '#agentInlineTerminalViewport', '#ptyFocusChildModal',
      ].every(selector => !document.querySelector(selector));
      const drawer = document.querySelector('#detailDrawer');
      const drawerReady = Boolean(drawer && document.querySelector('#drawerBackdrop')
        && document.querySelector('#drawerTerminalViewport') && document.querySelector('#drawerContent')
        && document.querySelector('#drawerComposer') && !drawer.classList.contains('open')
        && drawer.inert && drawer.getAttribute('aria-hidden') === 'true');
      return surface && !surface.classList.contains('hidden') && !surface.inert
        && surface.getAttribute('aria-hidden') === 'false'
        && document.body.classList.contains('pty-focus-open')
        && shell
        && retiredDomAbsent && drawerReady
        && document.querySelector('#mainContent')?.inert
        && document.querySelector('.sidebar')?.inert
        && embedded.connected
        && embedded.agentSessionId === 'fixture-root'
        && embedded.terminalId === ${JSON.stringify(terminalId)}
        && window.WhiteboxApp.state.ptyFocusTargetId === ${JSON.stringify(terminalId)}
        && window.WhiteboxTerminal.agentTargets(rootSession).some(target =>
          target.terminalId === ${JSON.stringify(terminalId)})
        && terminal?.conversationBound === true
        && terminal?.backend === 'direct'
        && terminal?.agentResumeSessionId === rootSession.externalId
        && document.querySelector('#ptyFocusTerminalViewport > .terminal-screen .xterm')
        && document.querySelector('#ptyFocusTerminalViewport .xterm-helper-textarea')
        && !document.querySelector('[data-inline-terminal-composer]');
    })()`, 'root PTY 화면과 닫힌 오른쪽 상세 패널이 실제 PTY에 연결되지 않았습니다.');

    const terminalTextExpression = `(() => {
      const screen = document.querySelector('#ptyFocusTerminalViewport > .terminal-screen');
      if (!screen) return '';
      return [
        ...[...screen.querySelectorAll('.xterm-rows > div')].map(row => row.textContent || ''),
        screen.querySelector('.xterm-accessibility-tree')?.textContent || '',
        screen.querySelector('.xterm-accessibility .live-region')?.textContent || '',
      ].join('\\n');
    })()`;
    await waitForRenderer(win, `${terminalTextExpression}.includes(${JSON.stringify(hydrationMarker)})`,
      'terminalGet replay가 PTY focus xterm에 hydrate되지 않았습니다.', 20_000);

    const focused = await rendererValue(win, `(() => {
      window.interactionTest.clearCalls();
      return window.WhiteboxTerminal.focusEmbedded()
        && document.activeElement === document.querySelector('#ptyFocusTerminalViewport .xterm-helper-textarea');
    })()`);
    assert(focused, 'PTY focus의 실제 xterm 입력 커서에 포커스하지 못했습니다.');

    const writesBeforeShiftTab = await rendererValue(win,
      `window.interactionTest.getCalls().filter(call => call.name === 'terminalWrite').length`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] });
    await waitForRenderer(win, `window.interactionTest.getCalls()
      .filter(call => call.name === 'terminalWrite').length === ${writesBeforeShiftTab + 1}`,
    'Shift+Tab이 PTY raw 입력으로 정확히 한 번 전달되지 않았습니다.');
    const shiftTabResult = await rendererValue(win, `(() => {
      const input = document.querySelector('#ptyFocusTerminalViewport .xterm-helper-textarea');
      const writes = window.interactionTest.getCalls().filter(call => call.name === 'terminalWrite');
      const call = writes[${writesBeforeShiftTab}];
      return {
        focused: document.activeElement === input,
        terminalId: call?.args?.[0] || '',
        data: call?.args?.[1] || '',
      };
    })()`);
    assert(shiftTabResult.focused, 'Shift+Tab 뒤 xterm 입력 포커스가 브라우저의 이전 컨트롤로 이동했습니다.');
    assert(shiftTabResult.terminalId === terminalId && shiftTabResult.data === '\u001b[Z',
      `Shift+Tab raw 입력이 정확한 PTY backtab 한 번이 아닙니다: ${JSON.stringify(shiftTabResult)}`);
    if (process.env.WHITEBOX_SHIFT_TAB_ONLY === '1') {
      process.stdout.write(`✓ xterm Shift+Tab → PTY backtab 통합 검증\n${JSON.stringify(shiftTabResult, null, 2)}\n`);
      return;
    }

    const remountResult = await rendererValue(win, `(async () => {
      const result = await window.WhiteboxInlineTerminal.sync({
        force: true,
        targetId: ${JSON.stringify(terminalId)},
        requireTargetId: true,
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const screen = document.querySelector('#ptyFocusTerminalViewport > .terminal-screen');
      return {
        result,
        mountedTerminalId: screen?.dataset.terminalScreen || '',
        xtermMounted: Boolean(screen?.querySelector('.xterm')),
      };
    })()`);
    assert(remountResult.result?.ok && remountResult.result?.reused
      && remountResult.mountedTerminalId === terminalId && remountResult.xtermMounted,
    `PTY focus를 다시 맞춘 뒤 기존 실제 PTY mount가 유지되지 않았습니다: ${JSON.stringify(remountResult)}`);

    const pasted = await rendererValue(win, `(() => {
      const input = document.querySelector('#ptyFocusTerminalViewport .xterm-helper-textarea');
      if (!input) return false;
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', ${JSON.stringify(liveCommand)});
      input.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }));
      return true;
    })()`);
    assert(pasted, 'xterm의 실제 붙여넣기 입력 경로가 명령을 처리하지 않았습니다.');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });

    await waitUntil(() => clientData.join('').includes(liveMarker),
      'PTY focus 입력 명령이 TerminalHost 소켓을 거쳐 실제 PTY 출력으로 돌아오지 않았습니다.');
    await waitForRenderer(win, `${terminalTextExpression}.includes(${JSON.stringify(liveMarker)})`,
      '실제 PTY live marker가 PTY focus xterm 출력과 접근성 버퍼에 표시되지 않았습니다.');

    const rendererResult = await rendererValue(win, `(() => ({
      embedded: window.WhiteboxTerminal.embeddedState(),
      focusMounted: Boolean(document.querySelector('#ptyFocusTerminalShell[data-inline-agent-terminal="fixture-root"]')),
      focusVisible: Boolean(document.querySelector('#ptyFocusSurface:not(.hidden):not([inert])')),
      retiredDomAbsent: ['#agentInlineTerminalViewport', '#ptyFocusChildModal']
        .every(selector => !document.querySelector(selector)),
      drawerReady: (() => {
        const drawer = document.querySelector('#detailDrawer');
        return Boolean(drawer && document.querySelector('#drawerBackdrop')
          && document.querySelector('#drawerTerminalViewport') && document.querySelector('#drawerContent')
          && !drawer.classList.contains('open') && drawer.inert);
      })(),
      xtermMounted: Boolean(document.querySelector('#ptyFocusTerminalViewport > .terminal-screen .xterm')),
      composerAbsent: !document.querySelector('[data-inline-terminal-composer]'),
      detailFlowControls: document.querySelector('#ptyFocusFlow')
        ?.querySelectorAll('button[data-pty-focus-child], button[data-pty-focus-execution]').length || 0,
      writableFlowInputs: document.querySelector('#ptyFocusFlow')
        ?.querySelectorAll('input, textarea, select, [contenteditable="true"]').length || 0,
      calls: window.interactionTest.getCalls(),
      text: ${terminalTextExpression},
    }))()`);
    const rendererWrites = rendererResult.calls.filter(call => call.name === 'terminalWrite');
    const rendererWriteText = rendererWrites
      .filter(call => call.args[0] === terminalId)
      .map(call => String(call.args[1] || ''))
      .join('');
    assert(rendererResult.focusMounted && rendererResult.focusVisible && rendererResult.retiredDomAbsent
      && rendererResult.drawerReady && rendererResult.xtermMounted && rendererResult.composerAbsent
      && rendererResult.detailFlowControls >= 2 && rendererResult.writableFlowInputs === 0,
    `root PTY와 오른쪽 상세 패널의 역할 분리가 올바르지 않습니다: ${JSON.stringify(rendererResult)}`);
    assert(rendererWriteText.endsWith(`${liveCommand}\r`),
      `xterm 직접 입력이 terminalWrite IPC로 전달되지 않았습니다: ${JSON.stringify(rendererWrites)}`);
    assert(!rendererResult.calls.some(call => call.name === 'terminalCreate'),
      '기존 실제 PTY가 있는데 PTY focus 화면이 별도 터미널을 생성했습니다.');
    assert(!rendererResult.calls.some(call => call.name === 'terminalCommand'),
      'PTY 직접 입력 중 별도 메시지 command 경로가 호출되었습니다.');

    await rendererValue(win, `(() => {
      const child = document.querySelector('[data-pty-focus-child="fixture-child"]');
      child?.focus({ preventScroll: true });
      child?.click();
    })()`);
    await waitForRenderer(win, `(() => {
      const app = window.WhiteboxApp;
      const drawer = document.querySelector('#detailDrawer');
      const embedded = window.WhiteboxTerminal.embeddedState();
      return app.state.ptyFocusSessionId === 'fixture-root'
        && app.state.selectedId === 'fixture-child' && app.state.drawerMode === 'subagent'
        && drawer?.classList.contains('open') && !drawer.inert
        && drawer.dataset.mode === 'subagent'
        && embedded.connected && embedded.terminalId === ${JSON.stringify(terminalId)}
        && (document.querySelector('#drawerContent')?.textContent?.trim().length || 0) > 80;
    })()`, '실제 root PTY 위에서 서브노드 오른쪽 상세 패널을 열지 못했습니다.');
    await rendererValue(win, `document.querySelector('#closeDrawerBtn')?.click()`);
    await waitForRenderer(win, `(() => {
      const drawer = document.querySelector('#detailDrawer');
      const embedded = window.WhiteboxTerminal.embeddedState();
      return window.WhiteboxApp.state.ptyFocusSessionId === 'fixture-root'
        && drawer && !drawer.classList.contains('open') && drawer.inert
        && embedded.connected && embedded.terminalId === ${JSON.stringify(terminalId)};
    })()`, '서브노드 상세 패널을 닫은 뒤 실제 root PTY가 유지되지 않았습니다.');
    assert(!(await rendererValue(win, `window.interactionTest.getCalls().some(call => call.name === 'terminalCreate')`)),
      '서브노드 상세 패널이 별도 PTY를 생성했습니다.');
    assert(ipcCalls.some(call => call.operation === 'list')
      && ipcCalls.some(call => call.operation === 'get' && call.args[0] === terminalId)
      && ipcCalls.filter(call => call.operation === 'write' && call.args[0] === terminalId)
        .map(call => String(call.args[1] || '')).join('').endsWith(`${liveCommand}\r`),
    `preload→IPC→TerminalHostClient 호출 경로가 완주하지 않았습니다: ${JSON.stringify(ipcCalls)}`);
    assert(String((await client.get(terminalId, true))?.replay || '').includes(liveMarker),
      'TerminalManager/node-pty replay에서 live marker를 확인하지 못했습니다.');

    const directSessionCountBeforeCreate = manager.list().length;
    const directIpcCreateCountBefore = ipcCalls.filter(call => call.operation === 'create').length;
    const directPrompt = `실제 새 AI PTY 생성 경로를 검증해줘 ${Date.now()}`;
    const directRunPrepared = await rendererValue(win, `(() => {
      window.WhiteboxApp.closePtyFocus({ restore: false });
      const originalStartAgent = window.WhiteboxTerminal.startAgent;
      const capture = { options: null, result: null, error: '' };
      window.__whiteboxActualDirectStart = capture;
      window.WhiteboxTerminal.startAgent = async options => {
        capture.options = {
          sourcePluginId: options.sourcePluginId || '',
          provider: options.provider || '',
          cwd: options.cwd || '',
          prompt: options.prompt || '',
          creationId: options.creationId || '',
        };
        try {
          const result = await originalStartAgent(options);
          capture.result = {
            ok: result?.ok === true,
            terminalId: result?.terminalId || '',
            creationId: result?.creationId || '',
            deliveryState: result?.deliveryState || '',
            promptSent: result?.promptSent === true,
          };
          return result;
        } catch (error) {
          capture.error = String(error?.stack || error?.message || error);
          throw error;
        } finally {
          window.WhiteboxTerminal.startAgent = originalStartAgent;
        }
      };
      window.interactionTest.clearCalls();
      const opened = window.WhiteboxApp.openRunModal();
      if (opened === false) {
        window.WhiteboxTerminal.startAgent = originalStartAgent;
        return { opened: false };
      }
      const source = document.querySelector('[data-run-source="direct"]');
      if (source?.getAttribute('aria-checked') !== 'true') source?.click();
      const provider = document.querySelector('[data-run-provider="claude"]');
      if (provider?.getAttribute('aria-checked') !== 'true') provider?.click();
      const prompt = document.querySelector('#runPrompt');
      const form = document.querySelector('#runForm');
      const submit = form?.querySelector('button[type="submit"]');
      if (!prompt || !form || !submit) return { opened: true, formReady: false };
      prompt.value = ${JSON.stringify(directPrompt)};
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      const prepared = {
        opened: true,
        formReady: true,
        source: document.querySelector('[data-run-source][aria-checked="true"]')?.dataset.runSource || '',
        provider: document.querySelector('[data-run-provider][aria-checked="true"]')?.dataset.runProvider || '',
        cwd: document.querySelector('#runCwd')?.value || '',
        prompt: prompt.value,
        submitDisabled: submit.disabled,
      };
      form.requestSubmit();
      return prepared;
    })()`);
    assert(directRunPrepared.opened && directRunPrepared.formReady
      && directRunPrepared.source === 'direct'
      && directRunPrepared.provider === 'claude'
      && directRunPrepared.cwd === root
      && directRunPrepared.prompt === directPrompt
      && directRunPrepared.submitDisabled === false,
    `새 작업 modal의 직접 실행 제출을 준비하지 못했습니다: ${JSON.stringify(directRunPrepared)}`);
    await waitForRenderer(win, `(() => {
      const capture = window.__whiteboxActualDirectStart;
      return Boolean((capture?.result?.terminalId || capture?.error)
        && document.querySelector('#runModal')?.classList.contains('hidden'));
    })()`, '새 작업 modal의 직접 AI 생성 결과가 돌아오지 않았습니다.', 20_000);

    const directRunOutcome = await rendererValue(win, `(() => ({
      capture: window.__whiteboxActualDirectStart,
      calls: window.interactionTest.getCalls(),
      focusSessionId: window.WhiteboxApp.state.ptyFocusSessionId || '',
      focusTargetId: window.WhiteboxApp.state.ptyFocusTargetId || '',
      focusHidden: document.querySelector('#ptyFocusSurface')?.classList.contains('hidden') === true,
    }))()`);
    const directCreateCalls = directRunOutcome.calls.filter(call => call.name === 'terminalCreate');
    const directCreateOptions = directCreateCalls[0]?.args?.[0] || null;
    const directCreationResult = directRunOutcome.capture?.result || null;
    const directTerminalId = String(directCreationResult?.terminalId || '');
    const directCreationId = String(directCreationResult?.creationId || '');
    assert(!directRunOutcome.capture?.error
      && directCreationResult?.ok === true
      && directCreationResult?.deliveryState === 'accepted'
      && directCreationResult?.promptSent === true
      && directTerminalId
      && /^create:[A-Za-z0-9][A-Za-z0-9._:-]{0,193}$/u.test(directCreationId),
    `새 작업 modal이 terminalId + creationId 성공 결과를 반환하지 않았습니다: ${JSON.stringify(directRunOutcome)}`);
    assert(directCreateCalls.length === 1
      && directCreateOptions?.type === 'agent'
      && directCreateOptions.provider === 'claude'
      && directCreateOptions.cwd === root
      && directCreateOptions.sessionBackend === 'direct'
      && directCreateOptions.transient === false
      && directCreateOptions.initialCommand === directPrompt
      && directCreateOptions.creationId === directCreationId
      && directRunOutcome.capture.options?.creationId === directCreationId,
    `새 작업 modal이 동일 creationId의 fresh direct PTY를 정확히 한 번 생성하지 않았습니다: ${JSON.stringify(directRunOutcome)}`);
    assert(directRunOutcome.focusHidden
      && directRunOutcome.focusSessionId !== `bridge:${directTerminalId}`
      && directRunOutcome.focusTargetId !== directTerminalId,
    `monitor projection 전에 새 PTY가 다른 세션으로 추측되어 열렸습니다: ${JSON.stringify(directRunOutcome)}`);

    const directLaunchMarker = fixtureLaunchArgumentsMarker(directCreateOptions.args || []);
    await waitUntil(async () => {
      const created = await client.get(directTerminalId, true);
      return Number(created?.pid) > 0
        && String(created?.replay || '').includes(directLaunchMarker);
    }, '새 작업 modal의 fresh direct argv가 실제 node-pty fixture에 도착하지 않았습니다.', 20_000);
    const directSession = await client.get(directTerminalId, true);
    assert(directSession?.status === 'running'
      && directSession.type === 'agent'
      && directSession.provider === 'claude'
      && directSession.backend === 'direct'
      && directSession.conversationBound === false
      && directSession.bridgeId === ''
      && directSession.creationId === directCreationId
      && Number(directSession.pid) > 0
      && manager.list().length === directSessionCountBeforeCreate + 1,
    `새 작업 modal의 실제 fresh direct node-pty가 고유하게 실행되지 않았습니다: ${JSON.stringify(directSession)}`);

    const directBridgePresence = mainBridgePresenceProjector()([directSession]);
    assert(directBridgePresence.length === 1
      && directBridgePresence[0].id === directTerminalId
      && directBridgePresence[0].terminalId === directTerminalId
      && directBridgePresence[0].linkedSessionId === ''
      && directBridgePresence[0].creationId === directCreationId,
    `main bridge presence가 실제 fresh PTY의 terminalId + creationId를 보존하지 않았습니다: ${JSON.stringify(directBridgePresence)}`);
    const monitoredDirectSessions = applyRuntimePresence(
      [],
      { available: false, distros: [] },
      { available: true, processes: [] },
      Date.now(),
      directBridgePresence,
    );
    const directProjectionId = `bridge:${directTerminalId}`;
    const directProjection = monitoredDirectSessions.find(item => item.id === directProjectionId);
    const directProjectionPresence = directProjection?.runtimePresence?.filter(item => item.kind === 'bridge') || [];
    assert(directProjection
      && directProjection.externalId === directTerminalId
      && directProjection.source === 'whitebox-bridge'
      && directProjection.clientKind === 'whitebox-bridge'
      && directProjectionPresence.length === 1
      && directProjectionPresence[0].terminalId === directTerminalId
      && directProjectionPresence[0].creationId === directCreationId,
    `monitor가 exact creationId의 provisional app-owned bridge:${directTerminalId} session을 노출하지 않았습니다: ${JSON.stringify(monitoredDirectSessions)}`);

    const mismatchedCreationId = `${directCreationId}:mismatch`;
    const mismatchedProjection = {
      ...directProjection,
      runtimePresence: directProjection.runtimePresence.map(presence => ({
        ...presence,
        creationId: presence.kind === 'bridge' ? mismatchedCreationId : presence.creationId,
      })),
    };
    const mismatchedSelection = await rendererValue(win, `(async () => {
      const projection = ${JSON.stringify(mismatchedProjection)};
      const added = window.interactionTest.addSession(projection);
      const listenerCount = window.interactionTest.emitSnapshot();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise(resolve => setTimeout(resolve, 50));
      const visible = window.WhiteboxApp.state.snapshot.sessions.find(item => item.id === projection.id);
      return {
        added,
        listenerCount,
        visibleIdentity: window.WhiteboxRendererUtils.appOwnedBridgeTerminalIdentity(visible),
        focusSessionId: window.WhiteboxApp.state.ptyFocusSessionId || '',
        focusTargetId: window.WhiteboxApp.state.ptyFocusTargetId || '',
        focusHidden: document.querySelector('#ptyFocusSurface')?.classList.contains('hidden') === true,
        embedded: window.WhiteboxTerminal.embeddedState(),
        terminalCreateCount: window.interactionTest.getCalls()
          .filter(call => call.name === 'terminalCreate').length,
      };
    })()`);
    assert(mismatchedSelection.added
      && mismatchedSelection.listenerCount > 0
      && mismatchedSelection.visibleIdentity?.terminalId === directTerminalId
      && mismatchedSelection.visibleIdentity?.creationId === mismatchedCreationId
      && mismatchedSelection.focusHidden
      && mismatchedSelection.focusSessionId !== directProjectionId
      && mismatchedSelection.focusTargetId !== directTerminalId
      && mismatchedSelection.embedded?.terminalId !== directTerminalId
      && mismatchedSelection.terminalCreateCount === 1,
    `creationId가 다른 provisional projection이 pending 새 작업 PTY 대상으로 선택되었습니다: ${JSON.stringify(mismatchedSelection)}`);

    const exactProjectionUpdated = await rendererValue(win, `(() => {
      const projection = ${JSON.stringify(directProjection)};
      const updated = window.interactionTest.updateSession(projection.id, projection);
      const listenerCount = window.interactionTest.emitSnapshot();
      return Boolean(updated && listenerCount > 0);
    })()`);
    assert(exactProjectionUpdated,
      'mismatched provisional projection을 monitor의 exact projection으로 갱신하지 못했습니다.');
    await waitForRenderer(win, `(() => {
      const embedded = window.WhiteboxTerminal.embeddedState();
      const projection = window.WhiteboxApp.state.snapshot.sessions
        .find(item => item.id === ${JSON.stringify(directProjectionId)});
      const identity = window.WhiteboxRendererUtils.appOwnedBridgeTerminalIdentity(projection);
      return identity?.terminalId === ${JSON.stringify(directTerminalId)}
        && identity?.creationId === ${JSON.stringify(directCreationId)}
        && embedded.connected
        && embedded.agentSessionId === ${JSON.stringify(directProjectionId)}
        && embedded.terminalId === ${JSON.stringify(directTerminalId)}
        && window.WhiteboxApp.state.ptyFocusSessionId === ${JSON.stringify(directProjectionId)}
        && window.WhiteboxApp.state.ptyFocusTargetId === ${JSON.stringify(directTerminalId)}
        && document.querySelector(${JSON.stringify(`#ptyFocusTerminalShell[data-inline-agent-terminal="${directProjectionId}"]`)})
        && document.querySelector('#ptyFocusTerminalViewport > .terminal-screen .xterm');
    })()`, 'exact terminalId + creationId projection이 같은 실제 node-pty/xterm PTY focus를 열지 못했습니다.', 20_000);
    await waitForRenderer(win, `${terminalTextExpression}.includes(${JSON.stringify(directLaunchMarker)})`,
      'fresh direct PTY argv marker가 exact provisional bridge의 xterm에 hydrate되지 않았습니다.', 20_000);

    const directLiveMarker = `LTA_FRESH_DIRECT_LIVE_${Date.now()}`;
    const directLiveCommand = encodedMarkerCommand(directLiveMarker);
    const directPasted = await rendererValue(win, `(() => {
      const input = document.querySelector('#ptyFocusTerminalViewport .xterm-helper-textarea');
      if (!input || !window.WhiteboxTerminal.focusEmbedded()) return false;
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', ${JSON.stringify(directLiveCommand)});
      input.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }));
      return document.activeElement === input;
    })()`);
    assert(directPasted, 'fresh direct PTY xterm의 실제 입력 경로에 포커스/붙여넣기를 전달하지 못했습니다.');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await waitUntil(async () => String((await client.get(directTerminalId, true))?.replay || '').includes(directLiveMarker),
      'fresh direct xterm 입력이 TerminalHost/node-pty를 거쳐 되돌아오지 않았습니다.');
    await waitForRenderer(win, `${terminalTextExpression}.includes(${JSON.stringify(directLiveMarker)})`,
      'fresh direct live marker가 동일한 renderer xterm에 표시되지 않았습니다.');
    const directFocusResult = await rendererValue(win, `(() => ({
      embedded: window.WhiteboxTerminal.embeddedState(),
      focusSessionId: window.WhiteboxApp.state.ptyFocusSessionId || '',
      focusTargetId: window.WhiteboxApp.state.ptyFocusTargetId || '',
      xtermMounted: Boolean(document.querySelector('#ptyFocusTerminalViewport > .terminal-screen .xterm')),
      calls: window.interactionTest.getCalls(),
    }))()`);
    const directFocusCreates = directFocusResult.calls.filter(call => call.name === 'terminalCreate');
    const directFocusWrites = directFocusResult.calls.filter(call => call.name === 'terminalWrite');
    const directFocusWriteText = directFocusWrites
      .filter(call => call.args[0] === directTerminalId)
      .map(call => String(call.args[1] || ''))
      .join('');
    assert(directFocusResult.embedded?.connected
      && directFocusResult.embedded?.agentSessionId === directProjectionId
      && directFocusResult.embedded?.terminalId === directTerminalId
      && directFocusResult.focusSessionId === directProjectionId
      && directFocusResult.focusTargetId === directTerminalId
      && directFocusResult.xtermMounted
      && directFocusCreates.length === 1
      && directFocusWriteText.endsWith(`${directLiveCommand}\r`)
      && manager.list().length === directSessionCountBeforeCreate + 1
      && manager.list().filter(item => item.id === directTerminalId).length === 1
      && ipcCalls.filter(call => call.operation === 'create').length === directIpcCreateCountBefore + 1,
    `fresh direct PTY focus가 같은 node-pty를 재사용하지 않았거나 별도 terminal을 만들었습니다: ${JSON.stringify(directFocusResult)}`);

    const codexForkExternalId = 'actual-pty-fork-source';
    const codexForkSource = {
      id: `codex:${codexForkExternalId}`,
      externalId: codexForkExternalId,
      provider: 'codex',
      clientKind: 'codex-desktop',
      status: 'completed',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cwd: root,
      environment: {
        kind: process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'macos' : 'linux'),
        distro: '',
      },
      parentId: null,
      runId: '',
      messages: [],
      lifecycle: [],
    };
    const forkLaunch = await rendererValue(win, `(async () => {
      const source = ${JSON.stringify(codexForkSource)};
      window.interactionTest.clearCalls();
      const support = window.WhiteboxTerminal.forkSupport(source);
      const result = await window.WhiteboxTerminal.forkForAgent(source, '', false, {
        focus: false,
        includeReplay: true,
      });
      return {
        support,
        result: {
          terminalId: result.terminalId,
          forked: result.forked,
          background: result.background,
          creationId: result.creationId,
          sourceSessionId: result.forkSourceSessionId,
          sourceSignature: result.forkSourceSignature,
        },
        createCalls: window.interactionTest.getCalls()
          .filter(call => call.name === 'terminalCreate'),
      };
    })()`);
    codexForkTerminalId = String(forkLaunch?.result?.terminalId || '');
    const forkCreateOptions = forkLaunch?.createCalls?.[0]?.args?.[0] || null;
    assert(forkLaunch?.support?.supported === true
      && JSON.stringify(forkLaunch.support.args) === JSON.stringify(['fork', codexForkExternalId]),
    `Codex Desktop 대화가 renderer에서 정확한 fork launch로 판별되지 않았습니다: ${JSON.stringify(forkLaunch)}`);
    assert(codexForkTerminalId
      && forkLaunch.result.forked === true
      && forkLaunch.result.background === true
      && forkLaunch.createCalls.length === 1,
    `renderer→IPC Codex fork 생성이 정확히 한 번 완주하지 않았습니다: ${JSON.stringify(forkLaunch)}`);
    assert(forkCreateOptions?.type === 'agent'
      && forkCreateOptions.provider === 'codex'
      && JSON.stringify(forkCreateOptions.args) === JSON.stringify(['fork', codexForkExternalId])
      && forkCreateOptions.cwd === root
      && forkCreateOptions.sessionBackend === 'direct'
      && forkCreateOptions.agentForkSourceSessionId === codexForkSource.id
      && forkCreateOptions.agentForkSourceSignature === forkLaunch.support.sourceSignature
      && !forkCreateOptions.bridgeId
      && !forkCreateOptions.recoveryArgs
      && !forkCreateOptions.initialCommand,
    `Codex fork renderer launch spec에 원본 attach/resume 또는 질문이 섞였습니다: ${JSON.stringify(forkCreateOptions)}`);

    const codexLaunchArgs = ['fork', codexForkExternalId];
    const codexLaunchMarker = fixtureLaunchArgumentsMarker(codexLaunchArgs);
    await waitUntil(async () => {
      const forkSession = await client.get(codexForkTerminalId, true);
      return Number(forkSession?.pid) > 0
        && String(forkSession?.replay || '').includes(codexLaunchMarker);
    }, 'Codex fork launch spec이 실제 node-pty 자식 fixture에 도착하지 않았습니다.');
    const codexForkSession = await client.get(codexForkTerminalId, true);
    assert(codexForkSession.status === 'running'
      && codexForkSession.provider === 'codex'
      && codexForkSession.backend === 'direct'
      && codexForkSession.agentForkSourceSessionId === codexForkSource.id
      && codexForkSession.agentForkSourceSignature === forkLaunch.support.sourceSignature
      && codexForkSession.agentResumeSessionId === ''
      && codexForkSession.conversationBound === false,
    `실제 Codex fork PTY가 원본 대화 writer에 attach되지 않은 새 세션이 아닙니다: ${JSON.stringify(codexForkSession)}`);

    const codexMainRoute = await rendererValue(win, `(async () => {
      const source = { ...${JSON.stringify(codexForkSource)}, status: 'running', completedAt: null };
      window.WhiteboxApp.closePtyFocus({ restore: false });
      window.WhiteboxApp.state.controlRoomObservedIds.add(source.id);
      window.interactionTest.addSession(source);
      window.interactionTest.emitSnapshot();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const main = document.querySelector('.control-room-main[data-pty-focus-trigger="' + CSS.escape(source.id) + '"]');
      if (!main) return { button: false, opened: false };
      const support = window.WhiteboxTerminal.forkSupport(source);
      const forkTarget = window.WhiteboxTerminal.forkTargetForAgent(source);
      const regularTargets = window.WhiteboxTerminal.agentTargets(source);
      const canOpen = window.WhiteboxApp.canOpenPtyFocus(source);
      main.click();
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const embedded = window.WhiteboxTerminal.embeddedState();
        if (window.WhiteboxApp.state.ptyFocusSessionId === source.id
          && embedded.connected
          && embedded.agentSessionId === source.id
          && embedded.terminalId === forkTarget?.terminalId) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const embedded = window.WhiteboxTerminal.embeddedState();
      return {
        button: true,
        opened: window.WhiteboxApp.state.ptyFocusSessionId === source.id
          && embedded.connected
          && embedded.agentSessionId === source.id
          && embedded.terminalId === forkTarget?.terminalId,
        support,
        forkTarget,
        regularTargets,
        canOpen,
      };
    })()`);
    assert(codexMainRoute?.button === true
      && codexMainRoute.opened === true
      && codexMainRoute.support?.supported === false
      && codexMainRoute.forkTarget?.terminalId === codexForkTerminalId
      && codexMainRoute.regularTargets?.length === 0
      && codexMainRoute.canOpen === true,
      `Codex Desktop 메인 노드가 PTY 집중모드 route를 열지 못했습니다: ${JSON.stringify(codexMainRoute)}`);
    await waitForRenderer(win, `(() => {
      const embedded = window.WhiteboxTerminal.embeddedState();
      return embedded.connected
        && embedded.agentSessionId === ${JSON.stringify(codexForkSource.id)}
        && embedded.terminalId === ${JSON.stringify(codexForkTerminalId)}
        && window.WhiteboxApp.state.ptyFocusSessionId === ${JSON.stringify(codexForkSource.id)}
        && window.WhiteboxApp.state.ptyFocusTargetId === ${JSON.stringify(codexForkTerminalId)}
        && document.querySelector('#ptyFocusTerminalViewport > .terminal-screen .xterm');
    })()`, 'Codex fork 실제 PTY가 full PTY focus xterm에 mount되지 않았습니다.');
    const codexMount = await rendererValue(win, `(() => ({
        embedded: window.WhiteboxTerminal.embeddedState(),
        focusSessionId: window.WhiteboxApp.state.ptyFocusSessionId || '',
        focusTargetId: window.WhiteboxApp.state.ptyFocusTargetId || '',
        focusVisible: Boolean(document.querySelector('#ptyFocusSurface:not(.hidden):not([inert])')),
        xtermMounted: Boolean(document.querySelector('#ptyFocusTerminalViewport > .terminal-screen .xterm')),
        retiredDomAbsent: ['#agentInlineTerminalViewport', '#ptyFocusChildModal']
          .every(selector => !document.querySelector(selector)),
        drawerReady: (() => {
          const drawer = document.querySelector('#detailDrawer');
          return Boolean(drawer && document.querySelector('#drawerTerminalViewport')
            && !drawer.classList.contains('open') && drawer.inert);
        })(),
        terminalCreateCount: window.interactionTest.getCalls()
          .filter(call => call.name === 'terminalCreate').length,
      }))()`);
    assert(codexMount.embedded?.connected
      && codexMount.embedded?.agentSessionId === codexForkSource.id
      && codexMount.embedded?.terminalId === codexForkTerminalId
      && codexMount.focusSessionId === codexForkSource.id
      && codexMount.focusTargetId === codexForkTerminalId
      && codexMount.focusVisible && codexMount.xtermMounted && codexMount.retiredDomAbsent && codexMount.drawerReady
      && codexMount.terminalCreateCount === 1,
    `Codex fork 실제 PTY가 full PTY focus xterm에 정확히 한 번 mount되지 않았습니다: ${JSON.stringify(codexMount)}`);
    await waitForRenderer(win, `${terminalTextExpression}.includes(${JSON.stringify(codexLaunchMarker)})`,
      'Codex fork argv marker가 실제 renderer xterm에 hydrate되지 않았습니다.');

    const codexLiveMarker = `LTA_CODEX_FORK_LIVE_${Date.now()}`;
    const codexLiveCommand = encodedMarkerCommand(codexLiveMarker);
    const codexPasted = await rendererValue(win, `(() => {
      const input = document.querySelector('#ptyFocusTerminalViewport .xterm-helper-textarea');
      if (!input || !window.WhiteboxTerminal.focusEmbedded()) return false;
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', ${JSON.stringify(codexLiveCommand)});
      input.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }));
      return document.activeElement === input;
    })()`);
    assert(codexPasted, 'Codex fork xterm의 실제 입력 경로에 포커스/붙여넣기를 전달하지 못했습니다.');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await waitUntil(async () => String((await client.get(codexForkTerminalId, true))?.replay || '').includes(codexLiveMarker),
      'Codex fork renderer 입력이 TerminalHost/node-pty를 거쳐 되돌아오지 않았습니다.');
    await waitForRenderer(win, `${terminalTextExpression}.includes(${JSON.stringify(codexLiveMarker)})`,
      'Codex fork live marker가 renderer xterm에 표시되지 않았습니다.');

    const summary = {
      terminalId,
      pid: session.pid,
      directTerminalId,
      directCreationId,
      directPid: directSession.pid,
      directProjectionId,
      mismatchedCreationIdRejected: mismatchedCreationId,
      directLiveMarker,
      codexForkTerminalId,
      codexForkPid: codexForkSession.pid,
      codexForkSourceSessionId: codexForkSource.id,
      codexForkArgs: codexLaunchArgs,
      codexForkLiveMarker: codexLiveMarker,
      hostEndpoint: hostInfo.endpoint,
      authenticatedHostClients: server.clients.size,
      hydrationMarker,
      scrollHistoryMarker,
      liveMarker,
      remountedTerminalId: remountResult.mountedTerminalId,
      rendererTerminalWriteCalls: rendererWrites.length,
      shiftTab: shiftTabResult,
      ipcOperations: ipcCalls.map(call => call.operation),
    };
    log(`passed ${JSON.stringify(summary)}`);
    process.stdout.write(`✓ full PTY focus → preload → IPC → TerminalHost socket → TerminalManager → node-pty → xterm 통합 검증\n${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    log(`failed ${error.stack || error}`);
    if (win && !win.isDestroyed()) {
      try {
        const diagnostic = await rendererValue(win, `(() => {
          const viewport = document.querySelector('#ptyFocusTerminalViewport');
          const screen = viewport?.querySelector(':scope > .terminal-screen');
          return {
            embedded: window.WhiteboxTerminal?.embeddedState?.() || null,
            focusSessionId: window.WhiteboxApp?.state?.ptyFocusSessionId || '',
            focusTargetId: window.WhiteboxApp?.state?.ptyFocusTargetId || '',
            focusVisible: Boolean(document.querySelector('#ptyFocusSurface:not(.hidden):not([inert])')),
            unexpectedDomPresent: ['#agentInlineTerminalViewport', '#ptyFocusChildModal']
              .filter(selector => document.querySelector(selector)),
            viewportHtml: viewport?.innerHTML?.slice(0, 2_000) || '',
            rows: [...(screen?.querySelectorAll('.xterm-rows > div') || [])]
              .map(row => row.textContent || ''),
            accessibility: screen?.querySelector('.xterm-accessibility-tree')?.textContent || '',
            liveRegion: screen?.querySelector('.xterm-accessibility .live-region')?.textContent || '',
          };
        })()`);
        log(`failure renderer diagnostic ${JSON.stringify(diagnostic)}`);
        fs.writeFileSync(screenshotFile, (await win.webContents.capturePage()).toPNG());
        log(`failure screenshot ${screenshotFile}`);
      } catch (captureError) {
        log(`failure screenshot error ${captureError.stack || captureError}`);
      }
    }
    process.stderr.write(`${error.stack || error}\n`);
    exitCode = 1;
    process.exitCode = 1;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    client.removeListener('data', collectData);
    client.removeListener('state', forwardState);
    client.removeListener('disconnect', forwardDisconnect);
    client.removeListener('reconnect', forwardReconnect);
    client.removeListener('reconnect-error', forwardReconnectError);
    const sessionIdsToRetire = manager.list().map(item => String(item.id || '')).filter(Boolean);
    for (const sessionId of sessionIdsToRetire) {
      try {
        await client.retire(sessionId);
        await waitUntil(() => !manager.get(sessionId, false),
          `실제 PTY retire 완료가 확인되지 않았습니다: ${sessionId}`, 5_000);
      } catch (error) {
        log(`client retire failed session=${sessionId} ${error.stack || error}`);
        exitCode = 1;
        try {
          await manager.retire(sessionId);
        } catch (fallbackError) {
          log(`manager retire fallback failed session=${sessionId} ${fallbackError.stack || fallbackError}`);
          exitCode = 1;
        }
      }
    }
    terminalRetired = manager.list().length === 0;
    log(`cleanup terminalRetired=${terminalRetired}`);
    client.dispose();
    server.dispose();
    await manager.dispose();
    for (const channel of ipcChannels) ipcMain.removeHandler(channel);
    // The Node runner owns this exact temporary root. It waits for this
    // Electron process to release Chromium's userData locks, then deletes and
    // verifies the directory before it returns the npm command's exit code.
    if (!terminalRetired) exitCode = 1;
    process.exitCode = exitCode;
    app.exit(exitCode);
  }
}

app.whenReady().then(run).catch(error => {
  log(`startup failed ${error.stack || error}`);
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
