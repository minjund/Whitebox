'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain } = require('electron');
const { TerminalManager } = require('../src/terminalManager');
const { TerminalHostServer, TerminalHostClient } = require('../src/terminalHost');
const { registerTerminalIpc } = require('../src/ipc/registerTerminalIpc');

app.disableHardwareAcceleration();
// Keep cleanup in control after the hidden integration window is destroyed;
// otherwise Electron may exit successfully on `window-all-closed` before the
// test can propagate a failure status.
app.on('window-all-closed', () => {});

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
const logFile = path.join(artifacts, 'inline-actual-pty-integration.log');
const screenshotFile = path.join(artifacts, 'whitebox-inline-actual-pty-failure.png');
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

async function rendererValue(win, expression) {
  return win.webContents.executeJavaScript(expression);
}

async function waitForRenderer(win, expression, message, timeoutMs = 12_000) {
  return waitUntil(() => rendererValue(win, expression), message, timeoutMs);
}

async function run() {
  const fixtureProvider = {
    command: 'node',
    args: [path.join(__dirname, 'drawer-bound-pty-agent-fixture.js')],
    label: 'Signed drawer PTY integration',
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
      title: '실제 drawer PTY 통합 검증',
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
    win.webContents.on('console-message', (_event, details, legacyMessage) => {
      const message = typeof details === 'object' ? details.message : String(legacyMessage || details || '');
      log(`renderer ${message}`);
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

    const openedInline = await rendererValue(win, `(() => {
      const workspace = [...document.querySelectorAll('#projectSidebarList [data-workspace]')]
        .find(node => node.dataset.workspace === ${JSON.stringify(root)});
      workspace?.click();
      const trigger = document.querySelector('.control-room-main[data-inline-pty-trigger="fixture-root"]');
      trigger?.click();
      return Boolean(workspace && trigger);
    })()`);
    assert(openedInline, '실제 PTY를 열 프로젝트 또는 메인 AI 영역을 찾지 못했습니다.');
    await waitForRenderer(win, `(() => {
      const inline = document.querySelector('[data-inline-agent-terminal="fixture-root"]');
      const embedded = window.WhiteboxTerminal.embeddedState();
      const rootSession = window.WhiteboxApp.state.snapshot.sessions.find(item => item.id === 'fixture-root');
      const terminal = window.interactionTest.getTerminals().find(item =>
        item.id === ${JSON.stringify(terminalId)});
      return inline
        && !document.querySelector('#detailDrawer')?.classList.contains('open')
        && embedded.connected
        && embedded.agentSessionId === 'fixture-root'
        && embedded.terminalId === ${JSON.stringify(terminalId)}
        && window.WhiteboxTerminal.agentTargets(rootSession).some(target =>
          target.terminalId === ${JSON.stringify(terminalId)})
        && terminal?.conversationBound === true
        && terminal?.backend === 'direct'
        && terminal?.agentResumeSessionId === rootSession.externalId
        && document.querySelector('#agentInlineTerminalViewport > .terminal-screen .xterm')
        && document.querySelector('#agentInlineTerminalViewport .xterm-helper-textarea')
        && !document.querySelector('[data-inline-terminal-composer]');
    })()`, '클릭한 메인 AI 바로 아래에 별도 메시지 입력란 없는 실제 PTY가 연결되지 않았습니다.');

    const terminalTextExpression = `(() => {
      const screen = document.querySelector('#agentInlineTerminalViewport > .terminal-screen');
      if (!screen) return '';
      return [
        ...[...screen.querySelectorAll('.xterm-rows > div')].map(row => row.textContent || ''),
        screen.querySelector('.xterm-accessibility-tree')?.textContent || '',
        screen.querySelector('.xterm-accessibility .live-region')?.textContent || '',
      ].join('\\n');
    })()`;
    await waitForRenderer(win, `${terminalTextExpression}.includes(${JSON.stringify(hydrationMarker)})`,
      'terminalGet replay가 인라인 xterm에 hydrate되지 않았습니다.', 20_000);

    const focused = await rendererValue(win, `(() => {
      window.interactionTest.clearCalls();
      return window.WhiteboxTerminal.focusEmbedded()
        && document.activeElement === document.querySelector('#agentInlineTerminalViewport .xterm-helper-textarea');
    })()`);
    assert(focused, '인라인 PTY의 실제 xterm 입력 커서에 포커스하지 못했습니다.');

    const writesBeforeShiftTab = await rendererValue(win,
      `window.interactionTest.getCalls().filter(call => call.name === 'terminalWrite').length`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] });
    await waitForRenderer(win, `window.interactionTest.getCalls()
      .filter(call => call.name === 'terminalWrite').length === ${writesBeforeShiftTab + 1}`,
    'Shift+Tab이 PTY raw 입력으로 정확히 한 번 전달되지 않았습니다.');
    const shiftTabResult = await rendererValue(win, `(() => {
      const input = document.querySelector('#agentInlineTerminalViewport .xterm-helper-textarea');
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

    const scrollStateExpression = `(() => {
      const screen = document.querySelector('#agentInlineTerminalViewport > .terminal-screen');
      return {
        viewportY: Number(screen?.dataset.viewportY || 0),
        baseY: Number(screen?.dataset.baseY || 0),
      };
    })()`;
    await waitForRenderer(win, `(() => {
      const state = ${scrollStateExpression};
      return state.baseY > 0 && state.viewportY >= state.baseY;
    })()`, '긴 PTY replay가 xterm scrollback으로 쌓이지 않았습니다.');
    const wheelDispatched = await rendererValue(win, `(() => {
      const terminal = document.querySelector('#agentInlineTerminalViewport > .terminal-screen .xterm-screen');
      if (!terminal) return false;
      terminal.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: -720,
      }));
      return true;
    })()`);
    assert(wheelDispatched, '인라인 xterm에 마우스 휠 이벤트를 전달하지 못했습니다.');
    await waitForRenderer(win, `(() => {
      const state = ${scrollStateExpression};
      return state.baseY > 0 && state.viewportY < state.baseY;
    })()`, '인라인 PTY의 마우스 휠이 이전 scrollback으로 이동하지 않았습니다.');
    const scrolledState = await rendererValue(win, scrollStateExpression);

    const remountResult = await rendererValue(win, `(async () => {
      const rootSession = window.WhiteboxApp.state.snapshot.sessions.find(item => item.id === 'fixture-root');
      const mount = document.querySelector('#agentInlineTerminalViewport');
      const result = await window.WhiteboxTerminal.mountForAgent(rootSession, {
        mount,
        targetId: ${JSON.stringify(terminalId)},
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { result, state: ${scrollStateExpression} };
    })()`);
    assert(remountResult.result?.ok && remountResult.result?.reused
      && remountResult.state.baseY > 0 && remountResult.state.viewportY < remountResult.state.baseY,
    `PTY를 다시 맞춘 뒤 마우스 휠 scrollback 위치가 맨 아래로 돌아갔습니다: ${JSON.stringify({ scrolledState, remountResult })}`);

    const pasted = await rendererValue(win, `(() => {
      const input = document.querySelector('#agentInlineTerminalViewport .xterm-helper-textarea');
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
      '인라인 PTY 입력 명령이 TerminalHost 소켓을 거쳐 실제 PTY 출력으로 돌아오지 않았습니다.');
    await waitForRenderer(win, `${terminalTextExpression}.includes(${JSON.stringify(liveMarker)})`,
      '실제 PTY live marker가 인라인 xterm 출력과 접근성 버퍼에 표시되지 않았습니다.');

    const rendererResult = await rendererValue(win, `(() => ({
      embedded: window.WhiteboxTerminal.embeddedState(),
      inlineMounted: Boolean(document.querySelector('[data-inline-agent-terminal="fixture-root"]')),
      drawerOpen: document.querySelector('#detailDrawer')?.classList.contains('open') || false,
      xtermMounted: Boolean(document.querySelector('#agentInlineTerminalViewport > .terminal-screen .xterm')),
      composerAbsent: !document.querySelector('[data-inline-terminal-composer]'),
      calls: window.interactionTest.getCalls(),
      text: ${terminalTextExpression},
    }))()`);
    const rendererWrites = rendererResult.calls.filter(call => call.name === 'terminalWrite');
    const rendererWriteText = rendererWrites
      .filter(call => call.args[0] === terminalId)
      .map(call => String(call.args[1] || ''))
      .join('');
    assert(rendererResult.inlineMounted && !rendererResult.drawerOpen && rendererResult.xtermMounted && rendererResult.composerAbsent,
      `메인 AI 바로 아래 인라인 영역이 실제 PTY 전용 화면이 아닙니다: ${JSON.stringify(rendererResult)}`);
    assert(rendererWriteText.endsWith(`${liveCommand}\r`),
      `xterm 직접 입력이 terminalWrite IPC로 전달되지 않았습니다: ${JSON.stringify(rendererWrites)}`);
    assert(!rendererResult.calls.some(call => call.name === 'terminalCreate'),
      '기존 실제 PTY가 있는데 인라인 화면이 별도 터미널을 생성했습니다.');
    assert(!rendererResult.calls.some(call => call.name === 'terminalCommand'),
      'PTY 직접 입력 중 별도 메시지 command 경로가 호출되었습니다.');
    assert(ipcCalls.some(call => call.operation === 'list')
      && ipcCalls.some(call => call.operation === 'get' && call.args[0] === terminalId)
      && ipcCalls.filter(call => call.operation === 'write' && call.args[0] === terminalId)
        .map(call => String(call.args[1] || '')).join('').endsWith(`${liveCommand}\r`),
    `preload→IPC→TerminalHostClient 호출 경로가 완주하지 않았습니다: ${JSON.stringify(ipcCalls)}`);
    assert(String((await client.get(terminalId, true))?.replay || '').includes(liveMarker),
      'TerminalManager/node-pty replay에서 live marker를 확인하지 못했습니다.');

    const codexForkExternalId = 'actual-pty-fork-source';
    const codexForkSource = {
      id: `codex:${codexForkExternalId}`,
      externalId: codexForkExternalId,
      provider: 'codex',
      clientKind: 'codex-desktop',
      cwd: root,
      environment: {
        kind: process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'macos' : 'linux'),
        distro: '',
      },
      parentId: null,
      runId: '',
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

    const codexMount = await rendererValue(win, `(async () => {
      const source = ${JSON.stringify(codexForkSource)};
      const mount = document.querySelector('#agentInlineTerminalViewport');
      const result = await window.WhiteboxTerminal.mountForAgent(source, {
        mount,
        targetId: ${JSON.stringify(codexForkTerminalId)},
        forkIfOriginOwned: true,
      });
      return {
        ok: result.ok,
        reason: result.reason || '',
        terminalId: result.target?.terminalId || result.target?.id || '',
        embedded: window.WhiteboxTerminal.embeddedState(),
      };
    })()`);
    assert(codexMount.ok
      && codexMount.terminalId === codexForkTerminalId
      && codexMount.embedded?.connected
      && codexMount.embedded?.agentSessionId === codexForkSource.id
      && codexMount.embedded?.terminalId === codexForkTerminalId,
    `Codex fork 실제 PTY가 renderer xterm에 mount되지 않았습니다: ${JSON.stringify(codexMount)}`);
    await waitForRenderer(win, `${terminalTextExpression}.includes(${JSON.stringify(codexLaunchMarker)})`,
      'Codex fork argv marker가 실제 renderer xterm에 hydrate되지 않았습니다.');

    const codexLiveMarker = `LTA_CODEX_FORK_LIVE_${Date.now()}`;
    const codexLiveCommand = encodedMarkerCommand(codexLiveMarker);
    const codexPasted = await rendererValue(win, `(() => {
      const input = document.querySelector('#agentInlineTerminalViewport .xterm-helper-textarea');
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
      scrolledState,
      rendererTerminalWriteCalls: rendererWrites.length,
      shiftTab: shiftTabResult,
      ipcOperations: ipcCalls.map(call => call.operation),
    };
    log(`passed ${JSON.stringify(summary)}`);
    process.stdout.write(`✓ AI 아래 인라인 PTY → preload → IPC → TerminalHost socket → TerminalManager → node-pty → xterm 통합 검증\n${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    log(`failed ${error.stack || error}`);
    if (win && !win.isDestroyed()) {
      try {
        const diagnostic = await rendererValue(win, `(() => {
          const viewport = document.querySelector('#agentInlineTerminalViewport');
          const screen = viewport?.querySelector(':scope > .terminal-screen');
          return {
            embedded: window.WhiteboxTerminal?.embeddedState?.() || null,
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
