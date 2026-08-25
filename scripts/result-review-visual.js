'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

process.env.WHITEBOX_TEST_UPDATE_BOOTSTRAP_RACE = '1';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-completion-status-'));
app.setPath('userData', userData);
app.once('quit', () => {
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
});

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(win, expression, message, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await wait(60);
  }
  throw new Error(message);
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

async function completionState(win) {
  return win.webContents.executeJavaScript(`(() => {
    const control = window.WhiteboxApp;
    const ended = control.state.snapshot.sessions.find(item => item.id === 'fixture-ended');
    const projectResult = control.state.snapshot.sessions.find(item => item.id === 'fixture-project-result-ready');
    const projectButton = [...document.querySelectorAll('#projectSidebarList [data-workspace]')]
      .find(item => item.dataset.workspace === 'D:\\\\fixture-other');
    const card = document.querySelector('.memory-record[data-session-id="fixture-ended"]');
    const badge = card?.querySelector('.memory-review-status.completed');
    const badgeBounds = badge?.getBoundingClientRect();
    const badgeStyle = badge ? getComputedStyle(badge) : null;
    return {
      endedTargets: control.resultReviewTargets(ended).length,
      projectTargets: control.resultReviewTargets(projectResult).length,
      endedComplete: control.isResultReviewComplete(ended),
      projectComplete: control.isResultReviewComplete(projectResult),
      storedReview: Boolean(localStorage.getItem(control.RESULT_REVIEW_STORAGE_KEY)),
      projectCount: Number(projectButton?.dataset.resultReadyCount || 0),
      projectBadge: Boolean(projectButton?.closest('.project-sidebar-project')
        ?.querySelector('.project-sidebar-result-ready')),
      cardVisible: Boolean(card?.getBoundingClientRect().height),
      badgeVisible: Boolean(badgeBounds && badgeBounds.width > 0 && badgeBounds.height > 0),
      badgeText: badge?.textContent.trim() || '',
      badgeColor: badgeStyle?.color || '',
      legacyReviewTrigger: Boolean(card?.matches('[data-result-review="true"]')
        || card?.querySelector('[data-result-review], .memory-review-action')),
      legacyReviewCopy: /확인 상태가 저장|결과 확인하기/.test(card?.textContent || ''),
    };
  })()`);
}

app.whenReady().then(async () => {
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
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await waitFor(win, 'Boolean(window.WhiteboxApp?.initialized)', '앱 초기화를 기다리다 시간이 초과되었습니다.');
    await waitFor(
      win,
      `window.WhiteboxApp.state.update.status === 'current'
        && !document.querySelector('#checkUpdateBtn').disabled
        && document.querySelector('#updatePanel').dataset.updateStatus === 'current'`,
      'bootstrap 도중 끝난 업데이트 확인 상태를 놓쳐 확인 화면이 멈췄습니다.',
    );

    await win.webContents.executeJavaScript(`(() => {
      const completedAt = new Date().toISOString();
      window.interactionTest.addSession({
        id: 'fixture-project-result-ready', externalId: 'fixture-project-result-ready-external',
        provider: 'codex', model: 'gpt-fixture', title: '자동 시작 작업 완료',
        cwd: 'D:\\\\fixture-other', originCwd: 'D:\\\\fixture-other', workspace: '자동 시작 작업 결과',
        status: 'completed', statusDetail: '작업 완료', completionObserved: true,
        completedAt, updatedAt: completedAt, parentId: null, childIds: [], executions: [],
        messages: [{ id: 'project-result', role: 'assistant', text: '요청한 자동 시작 작업을 모두 마쳤습니다.', timestamp: completedAt }],
        outcome: { status: 'completed', verified: true, completedAt, summary: '자동 시작 작업을 모두 마쳤습니다.' },
      });
      window.interactionTest.emitSnapshot();
      const control = window.WhiteboxApp;
      window.WhiteboxI18n.setLocale('ko');
      control.state.workspace = control.state.snapshot.sessions.find(item => item.id === 'fixture-root').cwd;
      control.state.providerFilters.clear();
      control.state.search = '';
      control.selectView('active');
      control.render();
    })()`);
    await waitFor(
      win,
      `Boolean(document.querySelector('.memory-record[data-session-id="fixture-ended"].task-completed .memory-review-status.completed'))`,
      '완료된 작업 카드에서 작업 완료 상태를 찾지 못했습니다.',
    );

    const completion = await completionState(win);
    if (!completion.cardVisible || !completion.badgeVisible
      || completion.badgeText !== '현재 상태: 작업 완료'
      || completion.endedTargets !== 0 || completion.projectTargets !== 0
      || completion.endedComplete || completion.projectComplete || completion.storedReview
      || completion.projectCount !== 0 || completion.projectBadge
      || completion.legacyReviewTrigger || completion.legacyReviewCopy) {
      throw new Error(`완료 결과의 단일 완료 상태가 올바르지 않습니다: ${JSON.stringify(completion)}`);
    }

    const outputDir = path.join(__dirname, '..', 'artifacts');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputs = {};
    const themeStates = {};
    win.show();
    for (const theme of ['dark', 'light']) {
      await win.webContents.executeJavaScript(`window.WhiteboxTheme.setTheme(${JSON.stringify(theme)})`);
      await waitFor(
        win,
        `document.documentElement.dataset.theme === ${JSON.stringify(theme)}
          && Boolean(document.querySelector('.memory-record[data-session-id="fixture-ended"] .memory-review-status.completed'))`,
        `${theme} 테마의 작업 완료 상태가 준비되지 않았습니다.`,
      );
      themeStates[theme] = await win.webContents.executeJavaScript(`(() => {
        const badge = document.querySelector('.memory-record[data-session-id="fixture-ended"] .memory-review-status.completed');
        const probe = document.createElement('i');
        probe.style.color = 'var(--theme-success)';
        document.body.appendChild(probe);
        const successColor = getComputedStyle(probe).color;
        probe.remove();
        return {
          badgeColor: getComputedStyle(badge).color,
          successColor,
          reviewTrigger: Boolean(document.querySelector('[data-result-review], .memory-review-action')),
        };
      })()`);
      if (themeStates[theme].badgeColor !== themeStates[theme].successColor
        || themeStates[theme].reviewTrigger) {
        throw new Error(`${theme} 테마의 작업 완료 상태가 올바르지 않습니다: ${JSON.stringify(themeStates[theme])}`);
      }
      outputs[theme] = await capture(win, path.join(outputDir, `whitebox-result-review-${theme}.png`));
    }
    fs.copyFileSync(outputs.light, path.join(outputDir, 'whitebox-result-review.png'));

    await win.webContents.executeJavaScript(`(() => {
      const completedAt = new Date(Date.now() + 5000).toISOString();
      window.interactionTest.updateSession('fixture-ended', {
        completedAt,
        updatedAt: completedAt,
        outcome: { status: 'completed', verified: true, completedAt, summary: '새로 도착한 완료 결과' },
      });
      window.interactionTest.emitSnapshot();
    })()`);
    await waitFor(
      win,
      `(() => {
        const control = window.WhiteboxApp;
        const session = control.state.snapshot.sessions.find(item => item.id === 'fixture-ended');
        return control.resultReviewTargets(session).length === 0
          && !control.isResultReviewComplete(session)
          && !document.querySelector('[data-session-id="fixture-ended"][data-result-review="true"]')
          && !localStorage.getItem(control.RESULT_REVIEW_STORAGE_KEY);
      })()`,
      '새 완료 결과에 불필요한 결과 확인 단계가 다시 나타났습니다.',
    );

    await win.webContents.executeJavaScript(`(() => {
      const control = window.WhiteboxApp;
      control.state.workspace = control.state.snapshot.sessions.find(item => item.id === 'fixture-root').cwd;
      control.state.providerFilters.clear();
      control.state.search = '';
      control.selectView('all');
      control.render();
    })()`);
    await waitFor(
      win,
      `Boolean(document.querySelector('.home-attention-item[data-open-session="fixture-waiting"]'))`,
      '구조화된 답변 요청이 홈 확인 목록에서 사라졌습니다.',
    );
    const home = await win.webContents.executeJavaScript(`(() => ({
      waiting: Boolean(document.querySelector('.home-attention-item[data-open-session="fixture-waiting"]')),
      ended: Boolean(document.querySelector('.home-attention-item[data-open-session="fixture-ended"]')),
      projectResult: Boolean(document.querySelector('.home-attention-item[data-open-session="fixture-project-result-ready"]')),
      resultReviewEntry: Boolean(document.querySelector('.home-attention-item[data-result-review]')),
    }))()`);
    if (!home.waiting || home.ended || home.projectResult || home.resultReviewEntry) {
      throw new Error(`홈 확인 목록이 실제 답변 요청과 완료 결과를 구분하지 못했습니다: ${JSON.stringify(home)}`);
    }

    await win.webContents.executeJavaScript(`(() => {
      const control = window.WhiteboxApp;
      control.selectView('waiting');
      control.render();
    })()`);
    await waitFor(
      win,
      `Boolean(document.querySelector('.attention-card[data-management-session="fixture-waiting"]'))`,
      '확인 대기 화면에서 구조화된 답변 요청을 찾지 못했습니다.',
    );
    const waiting = await win.webContents.executeJavaScript(`(() => ({
      request: Boolean(document.querySelector('.attention-card[data-management-session="fixture-waiting"]')),
      ended: Boolean(document.querySelector('.attention-card[data-management-session="fixture-ended"]')),
      projectResult: Boolean(document.querySelector('.attention-card[data-management-session="fixture-project-result-ready"]')),
      resultReviewEntry: Boolean(document.querySelector('.attention-card [data-result-review]')),
    }))()`);
    if (!waiting.request || waiting.ended || waiting.projectResult || waiting.resultReviewEntry) {
      throw new Error(`확인 대기 화면이 실제 답변 요청과 완료 결과를 구분하지 못했습니다: ${JSON.stringify(waiting)}`);
    }

    await win.reload();
    await waitFor(win, 'Boolean(window.WhiteboxApp?.initialized)', '재시작 후 앱 초기화를 기다리다 시간이 초과되었습니다.');
    await win.webContents.executeJavaScript(`(() => {
      const control = window.WhiteboxApp;
      control.state.workspace = control.state.snapshot.sessions.find(item => item.id === 'fixture-root').cwd;
      control.selectView('waiting');
      control.render();
    })()`);
    const persisted = await win.webContents.executeJavaScript(`(() => {
      const control = window.WhiteboxApp;
      const ended = control.state.snapshot.sessions.find(item => item.id === 'fixture-ended');
      return {
        storedReview: Boolean(localStorage.getItem(control.RESULT_REVIEW_STORAGE_KEY)),
        pending: control.resultReviewTargets(ended).length,
        complete: control.isResultReviewComplete(ended),
        waiting: Boolean(document.querySelector('.attention-card[data-management-session="fixture-waiting"]')),
        ended: Boolean(document.querySelector('.attention-card[data-management-session="fixture-ended"]')),
      };
    })()`);
    if (persisted.storedReview || persisted.pending !== 0 || persisted.complete
      || !persisted.waiting || persisted.ended) {
      throw new Error(`재시작 후 불필요한 결과 확인 상태가 되살아났습니다: ${JSON.stringify(persisted)}`);
    }

    process.stdout.write(`확인 필요·작업 완료 UI 검증 통과\n${JSON.stringify({ completion, home, waiting, persisted, themeStates }, null, 2)}\n${Object.values(outputs).join('\n')}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.exit(process.exitCode || 0);
  }
});
