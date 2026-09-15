'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const rendererRoot = path.resolve(process.env.WHITEBOX_QUESTIONNAIRE_RENDERER_DIR || path.join(root, 'renderer'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-questionnaire-control-'));
app.setPath('userData', temporary);
app.commandLine.appendSwitch('disable-gpu');

function task(id, title) {
  return { id, title, provider: 'codex', cwd: 'D:\\fixture', workspace: '화면 개선', depth: 0,
    status: 'completed', completionObserved: true, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messages: [{ id: `${id}-request`, role: 'user', text: '버튼을 파란색으로 바꿔줘' }],
    comprehensionOrigin: { authority: 'background-questionnaire-v1', generation: 'a'.repeat(64) },
    comprehension: { status: 'ready', schemaVersion: 1, packet: {
      schemaVersion: 1, id: 'packet-1', title, summary: '버튼을 파란색으로 변경했습니다. 기존 테마와 통일하기 위해 선택했습니다. 색 대비 검사는 아직 하지 않았습니다.',
      difficulty: 1, difficultyReason: '간단한 색상 변경입니다.', evidence: [{ id: 'e1', label: '완료 답변', detail: '버튼을 파란색으로 변경했습니다.' }],
      questions: [{ id: 'q1', kind: 'comprehension', topics: ['change', 'decision', 'constraint-risk'], prompt: '아직 남아 있는 검증은 무엇인가요?',
        options: [{ id: 'a', label: '색 대비 검사' }, { id: 'b', label: '파란색 적용' }], answerId: 'a', explanation: '색 대비 검사는 아직 진행하지 않았습니다.', evidenceIds: ['e1'],
        variant: { prompt: '완료된 것은 무엇인가요?', options: [{ id: 'a', label: '파란색 적용' }, { id: 'b', label: '색 대비 검사' }], answerId: 'a', explanation: '버튼 색상은 변경했습니다.' } }],
    } },
  };
}

async function waitFor(check, label) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Questionnaire control room timed out: ${label}`);
}

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false,
    webPreferences: { preload: path.join(__dirname, 'interaction-fixture-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const openId = () => js('window.WhiteboxApp.comprehensionPacketController.isOpen() ? window.WhiteboxApp.comprehensionPacketController.getSessionId() : ""');
  const add = async session => {
    await js(`window.interactionTest.addSession(${JSON.stringify(session)}); window.interactionTest.emitSnapshot()`);
  };
  const update = async (id, patch) => {
    await js(`window.interactionTest.updateSession(${JSON.stringify(id)}, ${JSON.stringify(patch)}); window.interactionTest.emitSnapshot()`);
  };
  const close = () => js("document.querySelector('#comprehensionPacketClose').click()");
  await win.loadFile(path.join(rendererRoot, 'index.html'));
  await waitFor(() => js('Boolean(window.WhiteboxApp?.initialized)'), 'initialization');
  await js(`window.WhiteboxI18n.setLocale('ko'); window.WhiteboxTheme.setTheme('dark'); window.WhiteboxApp.state.workspace = ${JSON.stringify('D:\\fixture')}; window.WhiteboxApp.state.workspaceSource = 'all'; window.WhiteboxApp.selectView('all'); window.interactionTest.clearCalls()`);

  const first = task('questionnaire-first', '관제 화면에서 결과 이해하기');
  const second = task('questionnaire-second', '두 번째 작업 이해하기');
  await add({ ...first, comprehension: { status: 'generating', schemaVersion: 1 } });
  await waitFor(() => js("document.querySelector('#questionnaireInboxStatus').textContent.includes('1')"), 'generation status in control room');
  await update(first.id, first);
  await waitFor(async () => (await openId()) === first.id, 'new questionnaire opens over control room');
  assert.equal(await js('window.WhiteboxApp.state.view'), 'all');
  assert.equal(await js("document.querySelector('#ptyFocusSurface').classList.contains('hidden')"), true);
  assert.equal(await js("document.querySelector('#appShell').hasAttribute('inert')"), true);
  assert.equal(await js("document.querySelector('#comprehensionPacketOverlay').parentNode === document.body"), true);
  await js("document.querySelector('#comprehensionPacketQuestionList input[value=\"a\"]').click()");
  await update(first.id, { status: 'running', completionObserved: false, comprehension: null });
  await add(second);
  await waitFor(() => js("document.querySelectorAll('[data-questionnaire-open]').length === 2"), 'multiple completed questionnaires retained');
  assert.equal(await openId(), first.id, 'another completion must not replace the open questionnaire');
  assert.equal(await js("document.querySelector('#comprehensionPacketQuestionList input[value=\"a\"]').checked"), true);
  await close();
  await waitFor(async () => (await openId()) === second.id, 'next pending questionnaire');
  await close();
  await waitFor(async () => !(await openId()), 'return to control room');
  assert.equal(await js("document.querySelector('#appShell').hasAttribute('inert')"), false);
  await js("[...document.querySelectorAll('[data-questionnaire-open]')].find(el => el.textContent.includes('관제 화면')).click()");
  await waitFor(async () => (await openId()) === first.id, 'reopen previous questionnaire after a new turn');
  assert.equal(await js("document.querySelector('#comprehensionPacketQuestionList input[value=\"a\"]').checked"), true, 'answer progress survives reopening');
  await close();
  await js('window.interactionTest.emitSnapshot()');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await openId(), '', 'snapshot refresh must not repeatedly reopen a seen questionnaire');
  await update(second.id, { completedAt: new Date(Date.now() + 10_000).toISOString() });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await openId(), '', 'completion timestamp drift must not create another questionnaire');
  assert.equal(await js("document.querySelectorAll('[data-questionnaire-open]').length"), 2);
  await js("document.querySelector('#sidebarSettingsBtn').click()");
  assert.equal(await js("document.querySelector('#questionnaireInbox').classList.contains('hidden')"), true, 'settings must hide the control room inbox');
  await js("window.WhiteboxApp.selectView('all')");
  assert.equal(await js("document.querySelector('#questionnaireInbox').classList.contains('hidden')"), false, 'returning to control room restores the inbox');
  await update(first.id, { status: 'completed', completionObserved: true, comprehension: first.comprehension });
  await waitFor(() => js("window.WhiteboxApp.state.snapshot.sessions.find(s => s.id === 'questionnaire-first').status === 'completed'"), 'completed focus fixture');
  await js(`window.WhiteboxApp.openResponsibleFocus(${JSON.stringify(first.id)})`);
  await waitFor(() => js("window.WhiteboxApp.comprehensionPacketController.getSurface()?.id === 'ptyFocusSurface'"), 'existing focus surface mounts the same questionnaire');
  assert.equal(await js("document.querySelector('#questionnaireInbox').classList.contains('hidden')"), true);
  await js('window.WhiteboxApp.openComprehensionPacket()');
  await waitFor(async () => (await openId()) === first.id, 'open from existing focus mode');
  assert.equal(await js("document.querySelector('#comprehensionPacketQuestionList input[value=\"a\"]').checked"), true, 'progress is shared between control room and focus mode');
  await close();
  await js("document.querySelector('#ptyFocusBackBtn').click()");
  await waitFor(() => js("!document.querySelector('#questionnaireInbox').classList.contains('hidden')"), 'return from focus mode');
  assert.equal(await js("document.querySelectorAll('#comprehensionPacketOverlay').length <= 1"), true, 'only one questionnaire presentation may be mounted');

  const otherProject = { ...task('questionnaire-other', '다른 프로젝트 결과'), cwd: 'D:\\other-project', workspace: '다른 프로젝트' };
  await add(otherProject);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await openId(), '', 'unselected projects must not interrupt this control room');
  assert.equal(await js("document.querySelector('#questionnaireInboxList').textContent.includes('다른 프로젝트 결과')"), false);

  await js('window.WhiteboxApp.openRunModal()');
  await waitFor(() => js("!document.querySelector('#runModal').classList.contains('hidden')"), 'existing dialog');
  const third = task('questionnaire-third', '입력 창 뒤에 도착한 결과');
  await add(third);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await openId(), '', 'existing dialog must stay in front');
  await js('window.WhiteboxApp.closeRunModal()');
  await waitFor(async () => (await openId()) === third.id, 'questionnaire deferred until dialog closes');

  const artifacts = path.join(root, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  for (const [theme, width, height] of [['dark', 1440, 960], ['light', 420, 780]]) {
    win.setContentSize(width, height);
    await waitFor(() => js(`innerWidth === ${width}`), 'viewport resize');
    await js(`window.WhiteboxTheme.setTheme('${theme}')`);
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const layout = await js(`(() => { const r = document.querySelector('#comprehensionPacketDialog').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight }; })()`);
    assert(layout.left >= 0 && layout.right <= layout.width && layout.top >= 0 && layout.bottom <= layout.height, JSON.stringify(layout));
    fs.writeFileSync(path.join(artifacts, `questionnaire-control-${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
  }
  await close();
  await waitFor(async () => !(await openId()), 'close responsive questionnaire');
  await js("document.querySelector('#questionnaireInbox').scrollIntoView({block:'start'})");
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await js("document.querySelectorAll('.comprehension-packet-overlay:not([hidden])').length"), 0);
  assert.equal(await js("document.querySelector('#questionnaireInbox').getBoundingClientRect().height > 0"), true);
  fs.writeFileSync(path.join(artifacts, 'questionnaire-control-inbox-420.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(1440, 960);
  await waitFor(() => js('innerWidth === 1440'), 'desktop inbox');
  await js("window.WhiteboxTheme.setTheme('dark'); document.querySelector('#questionnaireInbox').scrollIntoView({block:'start'})");
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise(resolve => setTimeout(resolve, 300));
  const darkColors = await js(`(() => {
    const row = document.querySelector('.questionnaire-inbox-item');
    const style = getComputedStyle(row);
    return { background: style.backgroundColor, color: style.color };
  })()`);
  assert.deepStrictEqual(darkColors, { background: 'rgb(23, 23, 25)', color: 'rgb(245, 245, 246)' }, 'inbox follows the selected theme');
  fs.writeFileSync(path.join(artifacts, 'questionnaire-control-inbox-1440.png'), (await win.webContents.capturePage()).toPNG());
  const calls = await js('window.interactionTest.getCalls()');
  assert.equal(calls.some(call => /^(terminalCreate|terminalEnsureAgent|runAgent|retryQuestionnaire)$/.test(call.name)), false,
    'reading questionnaires must not start terminals, AI work, or generation');
  assert.deepStrictEqual(errors, []);
  win.destroy();
  process.stdout.write('Questionnaire control room passed: completion arrival, generation status, multiple results, new-turn retention, shared focus-mode answers, view switching, timestamp deduplication, deferred dialogs, project filtering, responsive layouts, no AI or PTY start.\n');
}

run().then(() => app.quit(), error => { process.stderr.write(`${error.stack}\n`); app.exit(1); });

// Chromium must finish closing its profile before fixture files are removed.
app.once('quit', () => {
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('whitebox-questionnaire-control-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch {}
  }
});
