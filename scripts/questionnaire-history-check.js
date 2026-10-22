'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-quiz-history-'));
app.setPath('userData', temporary);
app.disableHardwareAcceleration();

function task(turn) {
  return { id: 'quiz-history', title: '설문지 기록', provider: 'codex', cwd: 'D:\\fixture', workspace: '화면 개선',
    messages: [{ id: `user-${turn}`, role: 'user', text: '버튼을 파란색으로 바꿔줘' }],
    status: 'completed', completionObserved: true, completedAt: `2026-10-16T0${turn}:00:00.000Z`,
    comprehensionOrigin: { authority: 'background-questionnaire-v1', generation: String(turn).repeat(64) },
    comprehension: { status: 'ready', schemaVersion: 1, packet: {
      schemaVersion: 1, id: 'reused-packet-id', title: `${turn}번째 설문지`, summary: '버튼을 파란색으로 변경했습니다. 색 대비 검사는 남아 있습니다.',
      difficulty: 1, difficultyReason: '단일 변경', evidence: [{ id: 'e1', label: '완료 답변', detail: '색 대비 검사는 남았습니다.' }],
      questions: [{ id: 'q1', kind: 'comprehension', topics: ['change', 'decision', 'constraint-risk'], prompt: '남은 검증은 무엇인가요?',
        options: [{ id: 'a', label: '색 대비 검사' }, { id: 'b', label: '버튼 변경' }], answerId: 'a', explanation: '색 대비 검사가 남아 있습니다.', evidenceIds: ['e1'] }],
    } } };
}

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1280, height: 900, show: false,
    webPreferences: { preload: path.join(__dirname, 'interaction-fixture-preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  async function waitFor(code) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await js(code)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(`Timed out: ${code}\n${errors.join('\n')}`);
  }
  const update = patch => js(`window.interactionTest.updateSession('quiz-history', ${JSON.stringify(patch)}); window.interactionTest.emitSnapshot()`);
  const close = async () => { await js("document.querySelector('#comprehensionPacketClose').click()"); await waitFor('!window.WhiteboxApp.comprehensionPacketController.isOpen()'); };
  const openHistory = async title => {
    await js("document.querySelector('.comprehension-packet-archive summary').click()");
    await js(`[...document.querySelectorAll('.comprehension-packet-archive-item')].find(button => button.textContent.includes(${JSON.stringify(title)})).click()`);
    await waitFor('window.WhiteboxApp.comprehensionPacketController.isOpen()');
  };
  const answer = async id => {
    await js(`document.querySelector('[data-comprehension-answer-kind="initial"][data-comprehension-option-id="${id}"]').click()`);
    await js("document.querySelector('#comprehensionPacketSubmit').click()");
  };
  const start = async current => {
    await waitFor('Boolean(window.WhiteboxApp?.initialized)');
    await js("window.WhiteboxI18n.setLocale('ko'); window.WhiteboxTheme.setTheme('dark'); window.WhiteboxApp.state.workspace='D:\\\\fixture'; window.WhiteboxApp.state.workspaceSource='all'; window.WhiteboxApp.selectView('all')");
    await js(`window.interactionTest.addSession(${JSON.stringify(current)}); window.interactionTest.emitSnapshot()`);
    await waitFor("window.WhiteboxApp.state.snapshot.sessions.some(session => session.id === 'quiz-history')");
    await js("window.WhiteboxApp.openResponsibleFocus('quiz-history')");
    await waitFor("Boolean(document.querySelector('#comprehensionPacketBadge'))");
  };
  try {
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await start(task(1));
    await waitFor('window.WhiteboxApp.comprehensionPacketController.isOpen()');
    await answer('b');
    await close();
    await update({ status: 'running', completionObserved: false, comprehension: null });
    await waitFor("document.querySelector('.comprehension-packet-archive summary')?.textContent.includes('1') && !document.querySelector('#comprehensionPacketOverlay')");
    await update(task(2));
    await waitFor('window.WhiteboxApp.comprehensionPacketController.isOpen()');
    await answer('a');
    await close();
    assert((await js("document.querySelector('#comprehensionPacketBadge > span').textContent")).includes('1개 설문지'));
    await openHistory('1번째');
    assert.equal(await js('window.WhiteboxApp.comprehensionPacketController.getProgress().answers.q1'), 'b');
    await update(task(3));
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await js('window.WhiteboxApp.comprehensionPacketController.getProgress().answers.q1'), 'b', 'arrival must not replace the quiz being reviewed');
    await js("document.querySelector('[data-comprehension-answer-kind=initial][data-comprehension-option-id=a]').click(); document.querySelector('[data-comprehension-retry]').click()");
    await close();
    assert.equal(await js('window.WhiteboxApp.comprehensionPacketController.isOpen()'), false, 'closing history must not open a deferred arrival');
    assert.equal(await js("document.querySelectorAll('.comprehension-packet-archive-item').length"), 3);
    await openHistory('2번째');
    assert.equal(await js('window.WhiteboxApp.comprehensionPacketController.getProgress().score'), '1/1');
    await close();
    const running = { ...task(4), status: 'running', completionObserved: false, comprehension: null };
    await update(running);
    await waitFor("!document.querySelector('#comprehensionPacketOverlay')");
    await win.reload();
    await start(running);
    assert.equal(await js("document.querySelectorAll('.comprehension-packet-archive-item').length"), 3, 'history survives renderer restart');
    await openHistory('1번째');
    assert.equal(await js('window.WhiteboxApp.comprehensionPacketController.getProgress().score'), '1/1', 'retry progress survives restart');
    await close();
    // Restore previously generated backend records that this renderer never saw.
    const imported = task(5);
    await js(`(() => {
      const session = ${JSON.stringify(imported)};
      const api = window.WhiteboxComprehensionPacket;
      localStorage.setItem(api.progressStorageKey(session, session.comprehension.packet), JSON.stringify({
        schemaVersion: 1, sessionId: session.id, packetId: session.comprehension.packet.id,
        packetFingerprint: api.packetContentFingerprint(session.comprehension.packet), completionGeneration: session.completedAt,
        autoPresented: true, submitted: true, answers: { q1: 'a' }, excluded: []
      }));
    })()`);
    await update({ ...running, comprehensionHistory: [{ generation: imported.comprehensionOrigin.generation,
      packet: imported.comprehension.packet }] });
    await waitFor("document.querySelectorAll('.comprehension-packet-archive-item').length === 4");
    await update({ ...task(6), comprehension: { schemaVersion: 1, status: 'failed', failureReason: 'timeout' } });
    await waitFor("document.querySelector('#comprehensionPacketBadge > span').textContent.includes('만들지 못')");
    assert.equal(await js("document.querySelector('#comprehensionPacketBadge > button').textContent"), '다시 만들기');
    await openHistory('5번째');
    assert.equal(await js('window.WhiteboxApp.comprehensionPacketController.getProgress().score'), '1/1', 'legacy backend history reconnects uniquely matching saved answers');
    await close();
    await update(running);
    const artifacts = path.join(root, 'artifacts/questionnaire-history');
    fs.mkdirSync(artifacts, { recursive: true });
    for (const [theme, width, height] of [['dark', 1280, 900], ['light', 420, 780]]) {
      win.setContentSize(width, height);
      await waitFor(`innerWidth === ${width}`);
      await js(`window.WhiteboxTheme.setTheme('${theme}'); document.querySelector('.comprehension-packet-archive').open = true`);
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      assert(await js(`(() => { const r = document.querySelector('.comprehension-packet-archive-list').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`), 'history must fit the viewport');
      fs.writeFileSync(path.join(artifacts, `${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(errors, []);
    console.log('Questionnaire history passed: retained turns, debt totals, isolated answers, new arrivals, restart, backend recovery, failed generation, desktop/mobile layout.');
  } finally { win.destroy(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  app.exit(process.exitCode || 0);
  fs.rmSync(temporary, { recursive: true, force: true });
});
