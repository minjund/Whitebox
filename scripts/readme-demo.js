'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const demoUserData = path.join(root, 'artifacts', 'readme-demo-user-data');
fs.rmSync(demoUserData, { recursive: true, force: true });
fs.mkdirSync(demoUserData, { recursive: true });
app.setPath('userData', demoUserData);
app.setPath('sessionData', path.join(demoUserData, 'session-data'));
process.env.WHITEBOX_DEMO_CAPTURE = '1';
process.env.WHITEBOX_TEST_INSTANCE = '1';
require('../main');

const assetDir = path.join(root, 'docs', 'assets');
const screenshotOutput = path.join(assetDir, 'whitebox-dashboard.png');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureSettled(win, count = 6) {
  let image = null;
  for (let index = 0; index < count; index += 1) {
    image = await win.webContents.capturePage();
    await delay(90);
  }
  return image;
}

async function waitForRenderer(win, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ready = await win.webContents.executeJavaScript("window.WhiteboxApp?.state?.providers?.length >= 4 && typeof window.WhiteboxApp.render === 'function' && Boolean(window.interactionTest)");
    if (ready) return;
    await delay(100);
  }
  throw new Error('Whitebox 화면이 준비되지 않았습니다.');
}

async function waitFor(win, expression, message, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await delay(100);
  }
  throw new Error(message);
}

async function installFixture(win) {
  await win.webContents.executeJavaScript(`(() => {
    try { Object.defineProperty(motionPreference, 'matches', { configurable: true, value: true }); } catch {}
    document.documentElement.dataset.motion = 'reduced';
    const now = Date.now();
    const usage = (input, output, total) => ({ input, output, cachedInput: Math.round(input * .42), cacheWrite: 0, reasoning: Math.round(output * .15), total });
    const context = (used, windowSize = 258400) => ({ used, window: windowSize, percent: used / windowSize * 100, source: 'session' });
    const message = (id, role, text, offset) => ({ id, role, text, timestamp: new Date(now - offset).toISOString() });
    const fixtureRoot = window.WhiteboxApp.state.snapshot.sessions.find(item => item.id === 'fixture-root');
    if (!fixtureRoot) throw new Error('기존 PTY fixture root를 찾지 못했습니다.');
    const session = (value) => ({
      externalId: value.id.replace(/[^a-z0-9]/gi, '-'),
      model: value.provider === 'codex' ? 'gpt-5' : (value.provider === 'claude' ? 'claude-sonnet' : (value.provider === 'gemini' ? 'gemini-2.5-pro' : 'grok-4')),
      cwd: '/Users/demo/whitebox',
      workspace: 'Whitebox Demo',
      sourceLabel: '샘플 작업 기록',
      statusDetail: '작업을 진행하고 있습니다',
      startedAt: new Date(now - 180000).toISOString(),
      updatedAt: new Date(now - value.offset).toISOString(),
      childIds: [],
      lifecycle: [{ type: 'tool', status: 'running', label: '코드를 확인하는 중', detail: '안전한 샘플 데이터를 분석하고 있습니다', timestamp: new Date(now - 5000).toISOString() }],
      messages: [
        message(value.id + ':user', 'user', value.request || '이 작업을 진행해 주세요.', value.offset + 6000),
        message(value.id + ':assistant', 'assistant', value.reply || '현재 상태를 확인하고 다음 단계를 진행하고 있습니다.', value.offset),
      ],
      usage: value.usage || usage(48000, 3200, 72400),
      turnUsage: usage(8200, 900, 10200),
      context: value.context || context(64000),
      runtimePresence: [],
      ...value,
    });
    const root = session({
      ...fixtureRoot,
      id: fixtureRoot.id, provider: fixtureRoot.provider, externalId: fixtureRoot.externalId,
      environment: fixtureRoot.environment, runtimePresence: fixtureRoot.runtimePresence,
      controlCapabilities: fixtureRoot.controlCapabilities,
      cwd: '/Users/demo/whitebox', originCwd: '/Users/demo/whitebox', workspace: 'Whitebox Demo',
      title: '결제 흐름 안정성 검토', status: 'running', offset: 1000,
      childIds: ['demo:claude:child', 'demo:gemini:child', 'demo:grok:child'],
      request: '결제 흐름을 점검하고 위험한 부분을 찾아줘.',
      reply: '세 개의 도움 AI와 코드, 테스트, 문서를 나눠 확인하고 있습니다.',
      usage: usage(92000, 7400, 142300), context: context(118000),
    });
    const claude = session({
      id: 'demo:claude:child', parentId: root.id, provider: 'claude', agentName: 'Atlas', agentRole: 'reviewer',
      title: '결제 코드 경계 조건 검토', status: 'running', offset: 1800,
      request: '결제 코드의 경계 조건을 검토해줘.', reply: '재시도와 중복 결제 방지 조건을 확인하고 있습니다.',
    });
    const gemini = session({
      id: 'demo:gemini:child', parentId: root.id, provider: 'gemini', agentName: 'Nova', agentRole: 'tester',
      title: '회귀 테스트 시나리오 작성', status: 'waiting', statusDetail: '테스트 범위 확인이 필요합니다', offset: 2400,
      request: '실패하기 쉬운 결제 시나리오를 테스트로 정리해줘.', reply: '추가로 확인할 결제 수단을 기다리고 있습니다.',
    });
    const grok = session({
      id: 'demo:grok:child', parentId: root.id, provider: 'grok', agentName: 'Echo', agentRole: 'explorer',
      title: '오류 로그 패턴 조사', status: 'completed', statusDetail: '조사를 마쳤습니다', offset: 3200,
      request: '오류 로그에서 반복되는 패턴을 찾아줘.', reply: '네트워크 재시도 구간에서 반복되는 패턴을 찾았습니다.',
    });
    const extra = [
      session({ id: 'demo:claude:root', provider: 'claude', title: '인증 화면 리팩터링', status: 'running', offset: 4100 }),
      session({ id: 'demo:gemini:root', provider: 'gemini', title: '릴리스 노트 초안 작성', status: 'running', offset: 5200 }),
      session({ id: 'demo:grok:root', provider: 'grok', title: '느린 테스트 원인 조사', status: 'waiting', offset: 6300 }),
    ];
    const sessions = [root, claude, gemini, grok, ...extra];
    for (const current of window.interactionTest.getSnapshot().sessions) {
      if (current.id !== root.id) window.interactionTest.removeSession(current.id);
    }
    window.interactionTest.updateSession(root.id, root);
    for (const item of sessions.slice(1)) window.interactionTest.addSession(item);
    const summaries = window.WhiteboxApp.state.providers.map(provider => {
      const owned = sessions.filter(item => item.provider === provider.id);
      return {
        ...provider,
        installed: true,
        sessions: owned.length,
        active: owned.filter(item => ['running', 'starting'].includes(item.status)).length,
        waiting: owned.filter(item => item.status === 'waiting').length,
        subagents: owned.filter(item => item.parentId).length,
        usage: usage(owned.length * 42000, owned.length * 3200, owned.reduce((total, item) => total + item.usage.total, 0)),
      };
    });
    const totalUsage = sessions.reduce((total, item) => total + item.usage.total, 0);
    window.__whiteboxReadmeDemo = {
      rootId: root.id,
      childId: claude.id,
      sessions,
      snapshot: {
        generatedAt: new Date().toISOString(),
        sessions,
        tmux: { generatedAt: new Date().toISOString(), available: false, status: '샘플', distros: [], summary: { distros: 0, sessions: 0, windows: 0, panes: 0, aiPanes: 0, linked: 0 } },
        summary: {
          providers: summaries,
          totals: {
            sessions: sessions.length,
            active: sessions.filter(item => ['running', 'starting'].includes(item.status)).length,
            waiting: sessions.filter(item => item.status === 'waiting').length,
            subagents: sessions.filter(item => item.parentId).length,
            usage: usage(240000, 21000, totalUsage),
          },
        },
      },
    };
    window.__ensureWhiteboxReadmeDemo = (focusId = null) => {
      const demo = window.__whiteboxReadmeDemo;
      window.WhiteboxApp.state.snapshot = demo.snapshot;
      window.WhiteboxApp.state.details = new Map(demo.sessions.map(item => [item.id, item]));
      window.WhiteboxApp.state.availability = Object.fromEntries(window.WhiteboxApp.state.providers.map(provider => [provider.id, true]));
      window.WhiteboxApp.state.workspaces = [{ path: '/Users/demo/whitebox', name: 'Whitebox Demo' }];
      window.WhiteboxApp.state.view = 'all';
      window.WhiteboxApp.state.provider = 'all';
      window.WhiteboxApp.state.providerFilters.clear();
      window.WhiteboxApp.state.workspace = '/Users/demo/whitebox';
      window.WhiteboxApp.state.search = '';
      window.WhiteboxApp.state.graphFocusId = focusId;
      window.WhiteboxApp.render();
      document.querySelector('.main-stage')?.scrollTo(0, 0);
    };
    const style = document.createElement('style');
    style.textContent = '.readme-demo-cursor{position:fixed;z-index:99999;width:18px;height:24px;left:50%;top:50%;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.65));transition:left .32s cubic-bezier(.22,1,.36,1),top .32s cubic-bezier(.22,1,.36,1)}.readme-demo-cursor:before{content:"";display:block;width:100%;height:100%;background:#fff;clip-path:polygon(0 0,0 88%,28% 67%,46% 100%,61% 91%,43% 61%,78% 60%)}.readme-demo-cursor:after{content:"";position:absolute;left:-9px;top:-9px;width:34px;height:34px;border:2px solid #72e9b3;border-radius:50%;opacity:0;transform:scale(.35)}.readme-demo-cursor.click:after{animation:readme-demo-click .5s ease-out}@keyframes readme-demo-click{0%{opacity:.95;transform:scale(.35)}100%{opacity:0;transform:scale(1.25)}}';
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.className = 'readme-demo-cursor';
    document.body.appendChild(cursor);
    window.__readmeDemoPoint = (selector, click = false) => {
      const target = document.querySelector(selector);
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      cursor.style.left = Math.round(rect.left + Math.min(rect.width * .68, rect.width - 18)) + 'px';
      cursor.style.top = Math.round(rect.top + Math.min(rect.height * .52, rect.height - 20)) + 'px';
      if (click) {
        cursor.classList.remove('click');
        void cursor.offsetWidth;
        cursor.classList.add('click');
      }
      return true;
    };
    window.__readmeDemoFinishMotion = () => {
      document.getAnimations().forEach(animation => {
        const target = animation.effect && animation.effect.target;
        if (target && target.closest && target.closest('.readme-demo-cursor')) return;
        try { animation.finish(); } catch {}
      });
    };
    window.__ensureWhiteboxReadmeDemo();
    window.__readmeDemoFinishMotion();
    window.__readmeDemoPoint('[data-graph-focus="' + root.id + '"]');
  })()`);
}

async function setFocus(win, id, targetSelector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector(${JSON.stringify(targetSelector)});
    window.__readmeDemoPoint(${JSON.stringify(targetSelector)}, true);
    trigger?.click();
    window.__readmeDemoFinishMotion();
    return Boolean(trigger);
  })()`);
  if (!clicked) throw new Error(`README 데모의 PTY 진입점을 찾지 못했습니다: ${targetSelector}`);
  await waitFor(win, `(() => {
    const embedded = window.WhiteboxTerminal?.embeddedState?.() || {};
    return window.WhiteboxApp.state.ptyFocusSessionId === 'fixture-root'
      && window.WhiteboxApp.state.ptyFocusTargetId === 'terminal-main'
      && embedded.connected === true
      && embedded.agentSessionId === 'fixture-root'
      && embedded.terminalId === 'terminal-main'
      && Boolean(document.querySelector('#ptyFocusTerminalViewport [data-terminal-screen="terminal-main"] .xterm'));
  })()`, `README 데모의 ${id} 노드가 정확한 root PTY를 열지 못했습니다.`);
  await delay(180);
  await win.webContents.executeJavaScript('window.__readmeDemoFinishMotion()');
}

async function closeFocus(win) {
  await win.webContents.executeJavaScript(`(() => {
    window.__readmeDemoPoint('#ptyFocusBackBtn', true);
    document.querySelector('#ptyFocusBackBtn')?.click();
    window.__readmeDemoFinishMotion();
  })()`);
  await waitFor(win, `!window.WhiteboxApp.state.ptyFocusSessionId
    && document.querySelector('#ptyFocusSurface')?.classList.contains('hidden')`,
  'README 데모의 PTY 집중 화면이 닫히지 않았습니다.');
}

async function restoreDashboard(win) {
  await win.webContents.executeJavaScript(`(() => {
    window.__ensureWhiteboxReadmeDemo();
    window.__readmeDemoPoint('[data-pty-focus-trigger="fixture-root"]');
    window.__readmeDemoFinishMotion();
  })()`);
  await waitFor(win, `Boolean(document.querySelector('[data-open-subagent-chat="demo:claude:child"]'))`,
    'README 데모의 도움 AI 상태 노드를 찾지 못했습니다.');
}

async function assertDeletedSurfacesAbsent(win) {
  const result = await win.webContents.executeJavaScript(`(() => ({
    drawer: Boolean(document.querySelector('#detailDrawer,#drawerBackdrop,#drawerContent,#drawerComposer')),
    conversation: Boolean(document.querySelector('[data-conversation-shell],#terminalHistoryPanel')),
    additionalTools: Boolean(document.querySelector('#advancedToolsNav,#mobileMoreBtn,#mobileToolsMenu,'
      + '#automationOverview,#tmuxSection,#tmuxCreateModal')),
    ptyDestination: Boolean(document.querySelector('#ptyFocusSurface,#ptyFocusTerminalViewport')),
  }))()`);
  if (result.drawer || result.conversation || result.additionalTools || !result.ptyDestination) {
    throw new Error(`README 데모의 PTY-only 화면 계약이 올바르지 않습니다: ${JSON.stringify(result)}`);
  }
  return result;
}

async function buildDemo() {
  fs.mkdirSync(assetDir, { recursive: true });

  const win = new BrowserWindow({
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
  await waitForRenderer(win);
  await installFixture(win);
  await assertDeletedSurfacesAbsent(win);
  await delay(400);

  await setFocus(win, 'fixture-root', '[data-pty-focus-trigger="fixture-root"]');
  fs.writeFileSync(screenshotOutput, (await captureSettled(win)).toPNG());

  await closeFocus(win);
  await restoreDashboard(win);

  await setFocus(win, 'demo:claude:child', '[data-open-subagent-chat="demo:claude:child"]');

  await closeFocus(win);
  process.stdout.write(`${screenshotOutput}\n`);
  win.destroy();
}

app.whenReady().then(() => {
  const timeout = setTimeout(async () => {
    let exitCode = 0;
    try {
      await buildDemo();
    } catch (error) {
      process.stderr.write(`${error.stack || error.message}\n`);
      exitCode = 1;
    } finally {
      app.exit(exitCode);
    }
  }, 1200);
  timeout.unref?.();
});
