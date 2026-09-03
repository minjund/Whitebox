'use strict';

// This historical visual entry point verifies the active result-review
// contract: the completed record acknowledges review only after the owning PTY
// is mounted. The retired attention page stays absent and the restored right
// drawer stays closed for this writable root-task action.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, session: electronSession } = require('electron');
const { fileURLToPath, pathToFileURL } = require('url');

process.env.WHITEBOX_TEST_UPDATE_BOOTSTRAP_RACE = '1';
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-result-review-'));
const resultSessionId = 'fixture-ended';
const resultTerminalId = 'terminal-result-review';

app.setPath('userData', userData);
app.once('quit', () => {
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
});

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(win, expression, message, attempts = 180) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await win.webContents.executeJavaScript(expression)) return;
    } catch (error) {
      lastError = error;
    }
    await wait(60);
  }
  throw new Error(`${message}${lastError ? ` (${lastError.message})` : ''}`);
}

async function capture(win, output) {
  await win.webContents.executeJavaScript(
    'document.fonts.ready.then(() => { for (const animation of document.getAnimations()) { try { animation.finish(); } catch {} } return true; })',
  );
  win.webContents.invalidate();
  await wait(220);
  fs.writeFileSync(output, (await win.webContents.capturePage()).toPNG());
  return output;
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

const resultCardSelector = `.memory-record[data-session-id="${resultSessionId}"][data-result-review="true"]`;
const completeButtonSelector = resultCardSelector;

async function resultState(win) {
  return win.webContents.executeJavaScript(`(() => {
    const appControl = window.WhiteboxApp;
    const session = appControl.state.snapshot.sessions.find(item => item.id === ${JSON.stringify(resultSessionId)});
    const projectButton = [...document.querySelectorAll('#projectSidebarList [data-workspace]')]
      .find(item => item.dataset.workspace === session.cwd);
    const card = document.querySelector(${JSON.stringify(resultCardSelector)});
    const complete = document.querySelector(${JSON.stringify(completeButtonSelector)});
    const target = window.WhiteboxTerminal.agentTargets(session)
      .find(item => (item.terminalId || item.id) === ${JSON.stringify(resultTerminalId)});
    return {
      stamp: appControl.resultReviewStamp(session),
      pending: appControl.resultReviewTargets(session).length,
      complete: appControl.isResultReviewComplete(session),
      storedReview: Boolean(localStorage.getItem(appControl.RESULT_REVIEW_STORAGE_KEY)),
      cardVisible: Boolean(card?.getBoundingClientRect().height),
      completeVisible: Boolean(complete?.getBoundingClientRect().height),
      completeLabel: complete?.querySelector('.memory-record-open')?.textContent.replace('→', '').trim() || '',
      quickResponseAbsent: !card?.querySelector('[data-attention-quick], [data-agent-command-form]'),
      projectCount: Number(projectButton?.dataset.resultReadyCount || 0),
      projectBadge: Boolean(projectButton?.closest('.project-sidebar-project')?.classList.contains('has-result-ready')),
      ptyEligible: appControl.canOpenPtyFocus(session),
      exactTarget: target ? { id: target.id, terminalId: target.terminalId || target.id } : null,
      retiredDomAbsent: ['#ptyFocusChildModal', '#automationOverview', '#tmuxSection', '#tmuxCreateModal']
        .every(selector => !document.querySelector(selector)),
      drawerReady: (() => {
        const drawer = document.querySelector('#detailDrawer');
        return Boolean(drawer && document.querySelector('#drawerBackdrop') && document.querySelector('#drawerContent')
          && document.querySelector('#drawerComposer') && !drawer.classList.contains('open') && drawer.inert);
      })(),
    };
  })()`);
}

async function run() {
  installWorktreeDependencyRedirect();
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
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

  try {
    await win.loadFile(path.join(root, 'renderer', 'index.html'));
    await waitFor(win, 'Boolean(window.WhiteboxApp?.initialized && window.interactionTest && window.WhiteboxTerminal)',
      '앱과 PTY fixture 초기화를 기다리다 시간이 초과되었습니다.');
    await waitFor(
      win,
      `window.WhiteboxApp.state.update.status === 'current'
        && !document.querySelector('#checkUpdateBtn').disabled
        && document.querySelector('#updatePanel').dataset.updateStatus === 'current'`,
      'bootstrap 도중 끝난 업데이트 확인 상태를 놓쳐 확인 화면이 멈췄습니다.',
    );

    const setup = await win.webContents.executeJavaScript(`(() => {
      const appControl = window.WhiteboxApp;
      const current = appControl.state.snapshot.sessions.find(item => item.id === ${JSON.stringify(resultSessionId)});
      const completedAt = new Date().toISOString();
      const updated = window.interactionTest.updateSession(${JSON.stringify(resultSessionId)}, {
        provider: 'gpt', status: 'completed', statusDetail: '확인할 완료 결과가 있습니다.',
        completedAt, updatedAt: completedAt,
        controlCapabilities: { ...(current.controlCapabilities || {}), pty: true },
        presentation: { ...(current.presentation || {}), conversationSurface: 'pty' },
        runtimePresence: [{ kind: 'terminal', terminalId: ${JSON.stringify(resultTerminalId)}, pid: 43001, label: '완료 결과 담당 PTY' }],
        attention: { category: 'none', required: false },
        outcome: { status: 'completed', verified: true, completedAt, summary: '첫 번째 완료 결과를 확인해 주세요.' },
      });
      const signature = window.interactionTest.connectionSignatureForSession(updated);
      window.interactionTest.addTerminal({
        id: ${JSON.stringify(resultTerminalId)}, type: 'agent', title: '완료 결과 담당 PTY', status: 'running',
        pid: 43001, cwd: updated.cwd, provider: updated.provider, bridgeId: updated.id,
        agentResumeSessionId: updated.externalId, agentConnectionSignature: signature,
        conversationBound: true, background: true, backend: 'direct', distro: '', outputSequence: 0,
        replay: 'RESULT_REVIEW_PTY_READY\\r\\n',
      });
      window.interactionTest.emitSnapshot();
      window.interactionTest.emitTerminalState('added');
      window.WhiteboxI18n.setLocale('ko');
      appControl.state.workspace = updated.cwd;
      appControl.state.providerFilters.clear();
      appControl.state.search = '';
      appControl.selectView('active');
      appControl.render();
      return { cwd: updated.cwd, signature };
    })()`);

    await waitFor(win, `(() => {
      const appControl = window.WhiteboxApp;
      const session = appControl.state.snapshot.sessions.find(item => item.id === ${JSON.stringify(resultSessionId)});
      return appControl.resultReviewTargets(session).length === 1
        && appControl.canOpenPtyFocus(session)
        && window.WhiteboxTerminal.agentTargets(session).some(target =>
          (target.terminalId || target.id) === ${JSON.stringify(resultTerminalId)})
        && Boolean(document.querySelector(${JSON.stringify(completeButtonSelector)}));
    })()`, '지난 기록의 완료 카드에서 exact PTY가 연결된 완료 결과를 찾지 못했습니다.');

    const initial = await resultState(win);
    if (initial.pending !== 1 || initial.complete || initial.storedReview
      || !initial.cardVisible || !initial.completeVisible || initial.completeLabel !== 'PTY에서 결과 확인'
      || !initial.quickResponseAbsent
      || initial.projectCount < 1 || !initial.projectBadge
      || !initial.ptyEligible || initial.exactTarget?.terminalId !== resultTerminalId
      || !initial.retiredDomAbsent || !initial.drawerReady) {
      throw new Error(`완료 결과의 초기 확인/PTY 계약이 올바르지 않습니다: ${JSON.stringify(initial)}`);
    }

    const outputDir = path.join(root, 'artifacts');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputs = {};
    const themeStates = {};
    win.show();
    for (const theme of ['dark', 'light']) {
      await win.webContents.executeJavaScript(`window.WhiteboxTheme.setTheme(${JSON.stringify(theme)})`);
      await waitFor(win, `document.documentElement.dataset.theme === ${JSON.stringify(theme)}
        && Boolean(document.querySelector(${JSON.stringify(completeButtonSelector)}))`,
      `${theme} 테마의 완료 결과 확인 카드가 준비되지 않았습니다.`);
      themeStates[theme] = await win.webContents.executeJavaScript(`(() => {
        const button = document.querySelector(${JSON.stringify(completeButtonSelector)});
        const bounds = button?.getBoundingClientRect();
        return {
          buttonVisible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
          label: button?.querySelector('.memory-record-open')?.textContent.replace('→', '').trim() || '',
          retiredDomAbsent: ['#ptyFocusChildModal', '#automationOverview', '#tmuxSection', '#tmuxCreateModal']
            .every(selector => !document.querySelector(selector)),
          drawerClosed: Boolean(document.querySelector('#detailDrawer')?.inert
            && !document.querySelector('#detailDrawer')?.classList.contains('open')),
        };
      })()`);
      if (!themeStates[theme].buttonVisible || themeStates[theme].label !== 'PTY에서 결과 확인'
        || !themeStates[theme].retiredDomAbsent || !themeStates[theme].drawerClosed) {
        throw new Error(`${theme} 테마의 완료 결과 primary 동작이 올바르지 않습니다: ${JSON.stringify(themeStates[theme])}`);
      }
      outputs[theme] = await capture(win, path.join(outputDir, `whitebox-result-review-${theme}.png`));
    }
    fs.copyFileSync(outputs.light, path.join(outputDir, 'whitebox-result-review.png'));

    // Looking at the project clears only its badge; it must not complete the
    // independent result-review stamp.
    await win.webContents.executeJavaScript(`(() => {
      const appControl = window.WhiteboxApp;
      appControl.acknowledgeProjectNotices(${JSON.stringify(setup.cwd)});
      appControl.renderWorkspaces();
    })()`);
    await waitFor(win, `(() => {
      const appControl = window.WhiteboxApp;
      const session = appControl.state.snapshot.sessions.find(item => item.id === ${JSON.stringify(resultSessionId)});
      const projectButton = [...document.querySelectorAll('#projectSidebarList [data-workspace]')]
        .find(item => item.dataset.workspace === session.cwd);
      return appControl.resultReviewTargets(session).length === 1
        && !appControl.isResultReviewComplete(session)
        && Number(projectButton?.dataset.resultReadyCount || 0) === 0
        && Boolean(document.querySelector(${JSON.stringify(completeButtonSelector)}));
    })()`, '프로젝트 알림 확인이 완료 결과 확인 상태까지 잘못 지웠습니다.');
    const projectAcknowledged = await resultState(win);

    await win.webContents.executeJavaScript(`(() => {
      window.interactionTest.clearCalls();
      document.querySelector(${JSON.stringify(completeButtonSelector)})?.click();
    })()`);
    await waitFor(win, `(() => {
      const appControl = window.WhiteboxApp;
      const session = appControl.state.snapshot.sessions.find(item => item.id === ${JSON.stringify(resultSessionId)});
      const embedded = window.WhiteboxTerminal.embeddedState();
      const stored = JSON.parse(localStorage.getItem(appControl.RESULT_REVIEW_STORAGE_KEY) || '{}');
      return appControl.isResultReviewComplete(session)
        && appControl.resultReviewTargets(session).length === 0
        && stored[session.id]?.stamp === appControl.resultReviewStamp(session)
        && !document.querySelector(${JSON.stringify(resultCardSelector)})
        && !document.querySelector('#ptyFocusSurface')?.classList.contains('hidden')
        && appControl.state.ptyFocusSessionId === session.id
        && appControl.state.ptyFocusTargetId === ${JSON.stringify(resultTerminalId)}
        && embedded.connected && embedded.agentSessionId === session.id
        && embedded.terminalId === ${JSON.stringify(resultTerminalId)}
        && Boolean(document.querySelector('#ptyFocusTerminalViewport > .terminal-screen .xterm'));
    })()`, '확인 완료가 exact PTY mount 성공 뒤 review 저장·카드 제거까지 완료하지 못했습니다.');
    const firstReview = await win.webContents.executeJavaScript(`(() => ({
      calls: window.interactionTest.getCalls(),
      focusVisible: !document.querySelector('#ptyFocusSurface')?.classList.contains('hidden'),
      backgroundInactive: Boolean(document.querySelector('#mainContent')?.inert && document.querySelector('.sidebar')?.inert),
      retiredDomAbsent: ['#ptyFocusChildModal', '#automationOverview', '#tmuxSection', '#tmuxCreateModal']
        .every(selector => !document.querySelector(selector)),
      drawerClosed: Boolean(document.querySelector('#detailDrawer')?.inert
        && !document.querySelector('#detailDrawer')?.classList.contains('open')),
      composerAbsent: !document.querySelector('[data-inline-terminal-composer]'),
    }))()`);
    if (!firstReview.focusVisible || !firstReview.backgroundInactive || !firstReview.retiredDomAbsent
      || !firstReview.drawerClosed || !firstReview.composerAbsent
      || firstReview.calls.some(call => call.name === 'terminalCreate')) {
      throw new Error(`인라인 확인 동작이 기존 담당 PTY만 여는 경로가 아닙니다: ${JSON.stringify(firstReview)}`);
    }

    const newResult = await win.webContents.executeJavaScript(`(() => {
      const appControl = window.WhiteboxApp;
      const before = appControl.state.snapshot.sessions.find(item => item.id === ${JSON.stringify(resultSessionId)});
      const previousStamp = appControl.resultReviewStamp(before);
      appControl.closePtyFocus({ restore: false, suppressManualSelection: true });
      const completedAt = new Date(Date.now() + 5000).toISOString();
      window.interactionTest.updateSession(${JSON.stringify(resultSessionId)}, {
        completedAt, updatedAt: completedAt,
        messages: [...(before.messages || []), {
          id: 'result-review-new-stamp', role: 'assistant', text: '두 번째 완료 결과가 도착했습니다.', timestamp: completedAt,
        }],
        outcome: { status: 'completed', verified: true, completedAt, summary: '두 번째 완료 결과가 도착했습니다.' },
      });
      window.interactionTest.emitSnapshot();
      appControl.selectView('active');
      appControl.render();
      return { previousStamp };
    })()`);
    await waitFor(win, `(() => {
      const appControl = window.WhiteboxApp;
      const session = appControl.state.snapshot.sessions.find(item => item.id === ${JSON.stringify(resultSessionId)});
      const projectButton = [...document.querySelectorAll('#projectSidebarList [data-workspace]')]
        .find(item => item.dataset.workspace === session.cwd);
      return appControl.resultReviewStamp(session) !== ${JSON.stringify(newResult.previousStamp)}
        && !appControl.isResultReviewComplete(session)
        && appControl.resultReviewTargets(session).length === 1
        && Boolean(document.querySelector(${JSON.stringify(completeButtonSelector)}))
        && Number(projectButton?.dataset.resultReadyCount || 0) >= 1;
    })()`, '새 완료 결과 stamp가 확인 카드와 프로젝트 배지를 다시 만들지 못했습니다.');
    const reappeared = await resultState(win);

    await win.webContents.executeJavaScript(`(() => {
      window.interactionTest.clearCalls();
      document.querySelector(${JSON.stringify(completeButtonSelector)})?.click();
    })()`);
    await waitFor(win, `(() => {
      const appControl = window.WhiteboxApp;
      const session = appControl.state.snapshot.sessions.find(item => item.id === ${JSON.stringify(resultSessionId)});
      const stored = JSON.parse(localStorage.getItem(appControl.RESULT_REVIEW_STORAGE_KEY) || '{}');
      return appControl.isResultReviewComplete(session)
        && appControl.resultReviewTargets(session).length === 0
        && stored[session.id]?.stamp === appControl.resultReviewStamp(session)
        && !document.querySelector(${JSON.stringify(resultCardSelector)});
    })()`, '새 완료 결과의 두 번째 확인 상태가 저장되지 않았습니다.');
    const secondReview = await win.webContents.executeJavaScript(`(() => ({
      terminalCreates: window.interactionTest.getCalls().filter(call => call.name === 'terminalCreate').length,
      terminalId: window.WhiteboxTerminal.embeddedState().terminalId,
      focusSessionId: window.WhiteboxApp.state.ptyFocusSessionId,
    }))()`);
    if (secondReview.terminalCreates !== 0 || secondReview.terminalId !== resultTerminalId
      || secondReview.focusSessionId !== resultSessionId) {
      throw new Error(`새 stamp 확인도 동일한 담당 PTY를 재사용해야 합니다: ${JSON.stringify(secondReview)}`);
    }

    process.stdout.write(`완료 기록 → verified PTY focus → 확인 저장/재등장 검증 통과\n${JSON.stringify({
      setup, initial, projectAcknowledged, firstReview, reappeared, secondReview, themeStates,
    }, null, 2)}\n${Object.values(outputs).join('\n')}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.exit(process.exitCode || 0);
  }
}

app.whenReady().then(run).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
  app.exit(1);
});
