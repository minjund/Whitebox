'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TerminalCollaboration } = require('../../src/terminalCollaboration');

function createFixture({ manager, profile, root }) {
  const processes = new Map();
  const providers = new Map();
  const capturedReplies = new Set();
  let failure = false, delayed = false, content = null, retainedFailure = false, retryCalls = 0;
  const controller = new TerminalCollaboration({ directory: path.join(profile, 'summary-control'), manager: () => Object.assign(manager, { rawWriteDeliverySupported: () => true }), enableControl: false,
    completion: { observe: async () => ({ available: false }) },
    monitor: { scan: () => ({ available: true, processes: [...processes].map(([id, pid]) => ({ pid, ancestorPids: [manager.get(id)?.pid], provider: providers.get(id) || 'codex' })) }) },
    activity: { observe: async (members, frames) => new Map(members.map(member => {
      const text = frames.get(member.id)?.text || '';
      return [member.id, { provider: processes.has(member.id) ? providers.get(member.id) || 'codex' : '', providerPid: processes.get(member.id) || 0,
        state: text.includes('Would you like') ? 'waiting' : text.includes('esc to interrupt') ? 'working' : 'idle' }];
    })) },
  });
  return {
    controller, processes, capturedReplies,
    setFailure(value) { failure = value; },
    setDelayed(value) { delayed = value; },
    setContent(value) { content = value; },
    setRetainedFailure(value) { retainedFailure = value; },
    get retryCalls() { return retryCalls; },
    async collaboration(payload) {
      if (payload.operation === 'summary-send') return controller.summarySend(payload);
      if (payload.operation === 'summary-respond') return controller.summaryRespond(payload);
      return controller.sync(payload);
    },
    review(payload) {
      if (payload.historyContent) return { entries: [] };
      if (payload.enabled === false) return { state: 'paused', provider: 'codex' };
      if (failure) return { state: 'error', provider: 'codex', message: 'fixture summary failed' };
      const jobs = [...controller.jobs.values()].filter(job => job.targetId === payload.id && job.state === 'completed');
      const latest = jobs.at(-1);
      if (payload.reanalyze && retainedFailure) { retainedFailure = false; retryCalls++; }
      if (latest && payload.submission?.id === latest.id) capturedReplies.add(latest.id);
      return { state: retainedFailure ? 'error' : delayed ? 'reviewing' : jobs.length ? 'ready' : 'watching', provider: providers.get(payload.id) || 'codex', providerPid: processes.get(payload.id),
        message: retainedFailure ? 'fixture final analysis failed' : '',
        failure: retainedFailure && latest ? { taskId: latest.id, retainedAnalysisId: latest.id, retainedLifecycle: 'in-progress', kind: 'updated-evidence' } : null,
        preview: latest ? { taskId: latest.id, submissionId: latest.id, request: latest.request, lifecycle: 'completed' } : null,
        result: { tasks: delayed ? [] : jobs.map(job => ({ taskId: job.id, analysisId: job.id, submissionId: job.id, lifecycle: 'completed', analysisLifecycle: retainedFailure && job === latest ? 'in-progress' : 'completed', request: job.request,
          observedAt: new Date(job.finishedAt || Date.now()).toISOString(), actual: `요약: ${job.request}`, explanation: 'Fixture summary of the matching real PTY reply.',
          ...(job === latest && content ? { content } : {}) })) } };
    },
    async launch(id, waitFor, provider = 'codex') {
      const quote = value => "'" + value.replace(/'/gu, process.platform === 'win32' ? "''" : "'\"'\"'") + "'";
      const script = path.join(root, 'scripts/fixtures/summary-chat-provider.cjs');
      // Electron is a GUI subsystem executable on Windows. PowerShell does not
      // attach its Node-mode stdin to ConPTY; use the console Node from npm.
      const node = process.platform === 'win32'
        ? process.env.npm_node_execpath || require('node:child_process').execFileSync('where.exe', ['node'], { encoding: 'utf8' }).trim().split(/\r?\n/u)[0]
        : process.execPath;
      assert(fs.statSync(node).isFile(), 'fixture needs an actual Node executable');
      const command = process.platform === 'win32'
        ? `& ${quote(node)} ${quote(script)} ${provider}`
        : ` ELECTRON_RUN_AS_NODE=1 ${quote(node)} ${quote(script)} ${provider}`;
      await manager.command(id, command);
      await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(id)}).includes('SUMMARY_READY')`, 'fixture provider startup');
      const replay = manager.get(id, true).replay;
      const pid = Number(replay.match(/SUMMARY_READY (\d+)/u)?.[1]); assert(pid);
      processes.set(id, pid);
      providers.set(id, provider);
    },
  };
}

async function run({ evaluate, waitFor, manager, win, fixture, profile, clipboard }) {
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const summary = () => evaluate('document.querySelector("#terminalWorkspace").classList.contains("summary-mode")');
  const send = text => evaluate(`document.querySelector('#wbSummaryInput').value=${JSON.stringify(text)}; document.querySelector('#wbSummaryInput').dispatchEvent(new Event('input')); document.querySelector('#wbSummarySend').click()`);
  const capture = () => evaluate('WhiteboxWorkspace.captureReviews(true)');
  const id = await evaluate('WhiteboxWorkspace.getState().activeId');
  assert(await evaluate('document.querySelector("[data-workspace-mode=summary]").disabled'), 'plain shell has no summary mode');
  await fixture.launch(id, waitFor); await capture();
  await require('./summary-chat-races').run(evaluate);
  await waitFor('!document.querySelector("[data-workspace-mode=summary]").disabled', 'AI enables summary mode');
  const before = manager.get(id);
  await evaluate('document.querySelector("#wbAutoReview").checked=false; document.querySelector("#wbAutoReview").dispatchEvent(new Event("change"))');
  assert(await evaluate('Boolean(document.querySelector(".wb-mode-switch .ui-segc"))'), 'actual affectUI mode control mounted');
  await evaluate('document.querySelector("[data-workspace-mode=terminal]").focus()');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await waitFor('document.querySelector("#terminalWorkspace").classList.contains("summary-mode")', 'keyboard mode toggle');
  assert(await summary());
  assert(await evaluate('document.querySelector("#wbSummarySend").classList.contains("ui-buttonc")'), 'actual affectUI send button mounted');
  assert(await evaluate('getComputedStyle(document.querySelector("#wbCanvas")).display === "none" && getComputedStyle(document.querySelector("#wbReview")).display === "none"'));
  await send('한글 SUMMARY_HOLD');
  await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(id)}).includes('esc to interrupt')`, 'chat delivered to real PTY');
  await waitFor('Boolean(document.querySelector("#wbSummaryThinking .ui-tlc"))', 'actual affectUI working loader');
  assert(await evaluate('document.querySelector("[data-summary-step=reply]").dataset.state !== "done"'), 'active AI reply is never marked complete');
  await send('QUEUED_EDIT');
  await waitFor('Boolean(document.querySelector("[data-summary-edit]"))', 'busy message queued');
  await click('[data-summary-edit]');
  assert.equal(await evaluate('document.querySelector("#wbSummaryInput").value'), 'QUEUED_EDIT');
  await send('QUEUED_CANCEL'); await click('[data-summary-cancel]');
  await send('QUEUED_SENT');
  await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(id)}).includes('SUMMARY_REPLY QUEUED_SENT')`, 'queued message delivered after previous turn');
  await capture();
  await waitFor('document.querySelector("#wbSummaryMessages").textContent.includes("요약: QUEUED_SENT")', 'matching answer summary displayed');
  assert(await summary(), 'answer arrival retains summary mode');
  await waitFor('document.querySelector("#wbSummaryReviewState").dataset.state === "done"', 'completed review status');
  await click('.wb-summary-answer:last-child [data-summary-copy]');
  await waitFor('Boolean(document.querySelector("#wbSummaryNotice").textContent)', 'summary copy receipt');
  assert(clipboard().includes('요약: QUEUED_SENT'), 'copy contains the displayed answer');
  assert(!clipboard().includes('View original reply'), 'copy excludes action labels');
  await click('.wb-summary-answer:last-child [data-summary-terminal]');
  assert.equal(await summary(), false, 'original reply action reveals existing terminal');
  assert.equal(manager.get(id).pid, before.pid);
  await click('[data-workspace-mode=summary]');
  assert(await evaluate('(() => {const nodes=[...document.querySelectorAll("#wbSummaryMessages article")];const i=nodes.findIndex(n=>n.classList.contains("wb-summary-user")&&n.textContent.includes("QUEUED_SENT"));return i>=0&&nodes[i+1].classList.contains("wb-summary-answer")&&nodes[i+1].textContent.includes("QUEUED_SENT");})()'), 'answers remain next to their matching requests');
  await send('REPEAT'); await send('REPEAT');
  await waitFor('document.querySelectorAll(".wb-summary-answer").length >= 4', 'two identical requests retain separate matching summaries');
  assert.equal([...fixture.controller.jobs.values()].filter(job=>job.request==='REPEAT'&&job.state==='completed').length, 2);
  await send('PERMISSION');
  await waitFor('Boolean(document.querySelector("[data-summary-choice=proceed]"))', 'approval card from actual PTY');
  assert(await evaluate('document.querySelector(".wb-summary-prompt pre").textContent.includes("Would you like to make the following edits?")'));
  await click('[data-summary-choice=proceed]');
  await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(id)}).includes('SUMMARY_REPLY PERMISSION')`, 'approval sent to same real PTY');
  await capture();
  assert(await summary());
  await evaluate('document.querySelector("#wbSummaryInput").value="draft one"; document.querySelector("#wbSummaryInput").dispatchEvent(new Event("input"))');
  await evaluate('WhiteboxWorkspace.createTerminal("")');
  const other = await evaluate('WhiteboxWorkspace.getState().activeId');
  assert.equal(await summary(), false, 'new shell remains in terminal mode');
  await fixture.launch(other, waitFor, 'claude'); await capture(); await click('[data-workspace-mode=summary]');
  // Both providers must deliver the next request while model summaries are
  // deliberately withheld. The prior reply is captured before that write.
  for (const [target, provider] of [[other, 'claude'], [id, 'codex']]) {
    await click(`.wb-instance[data-instance="${target}"]`);
    fixture.setDelayed(true);
    await send(`SUMMARY_HOLD_GAME_${provider}`);
    await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(target)}).includes('esc to interrupt')`, `${provider} working`);
    await waitFor('!document.querySelector("#wbSummaryGame").hidden', 'game invitation while summarizing');
    if (provider === 'claude') {
      await click('[data-game-open]');
      assert.equal(await evaluate('document.activeElement.classList.contains("wb-2048-board")'), true);
      const cells = await evaluate('[...document.querySelectorAll(".wb-2048-cell")].map(cell=>cell.textContent)');
      assert.equal(cells.filter(Boolean).length, 2);
      await evaluate('document.querySelector(".wb-2048-board").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true,cancelable:true}))');
      assert.equal(await evaluate('document.querySelector("#wbSummaryInput").value'), '', 'game keys never type into composer');
    }
    await send(`AFTER_SUMMARY_${provider}`);
    await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(target)}).includes('SUMMARY_REPLY AFTER_SUMMARY_${provider}')`, `${provider} queue advances without summary`);
    const held = [...fixture.controller.jobs.values()].find(job => job.request === `SUMMARY_HOLD_GAME_${provider}`);
    assert(fixture.capturedReplies.has(held.id), 'completed reply was captured before next delivery');
    fixture.setDelayed(false); await capture();
    await waitFor(`document.querySelector('#wbSummaryMessages').textContent.includes('요약: AFTER_SUMMARY_${provider}')`, 'delayed summary catches up');
    if (provider === 'claude') {
      assert.equal(await evaluate('document.querySelector(".wb-2048-panel").hidden'), false, 'completion keeps game open');
      await waitFor('document.querySelector("#wbSummaryGame").dataset.waiting === "false"', 'completed summary updates open game');
    }
  }
  await evaluate('document.querySelector("#wbSummaryInput").value="draft one"; document.querySelector("#wbSummaryInput").dispatchEvent(new Event("input"))');
  await click(`.wb-instance[data-instance="${other}"]`);
  await evaluate('document.querySelector("#wbSummaryInput").value="draft two"; document.querySelector("#wbSummaryInput").dispatchEvent(new Event("input"))');
  await click(`.wb-instance[data-instance="${id}"]`);
  assert(await summary()); assert.equal(await evaluate('document.querySelector("#wbSummaryInput").value'), 'draft one');
  await click('[data-workspace-mode=terminal]'); await capture(); assert.equal(await summary(), false);
  await click(`.wb-instance[data-instance="${other}"]`); assert(await summary());
  assert.equal(await evaluate('document.querySelector("#wbSummaryInput").value'), 'draft two');
  await click(`.wb-instance[data-instance="${id}"]`); assert.equal(await summary(), false, 'each terminal remembers its mode');
  await click('[data-workspace-mode=summary]');
  await evaluate('WhiteboxI18n.setLocale("ko")');
  await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload summary chat'); await capture();
  await waitFor('document.querySelector("#terminalWorkspace").classList.contains("summary-mode")', 'mode restored');
  assert.equal(await evaluate('document.querySelector("#wbSummaryInput").value'), 'draft one');
  assert.equal(manager.get(id).pid, before.pid); assert.equal(manager.get(id).creationId, before.creationId);
  await click(`.wb-instance[data-instance="${other}"]`);
  assert.equal(await evaluate('document.querySelector(".wb-2048-panel").hidden'), false, 'game survives terminal switch and reload');
  fixture.setContent({ version: 2, subject: { text: '요약 화면과 다음 요청', basis: 'reported' },
    answer: { text: '답변을 읽고, 같은 대화에서 다음 요청을 이어갈 수 있어요.', basis: 'reported' },
    details: [{ text: '터미널과 요약을 전환해도 같은 AI 세션을 유지합니다.', basis: 'reported' },
      { text: '완료된 답변의 기록을 보존한 뒤 다음 요청을 전달하며, 요약 중에는 오른쪽에서 2048을 즐길 수 있습니다.', basis: 'reported' }],
    limitations: [], deliverables: [], nextAction: { text: '요약을 확인하거나 원래 답변을 열어 보고, 필요한 다음 요청을 입력하세요.', basis: 'reported' } });
  await evaluate('document.querySelector("#wbSummaryInput").value=""; document.querySelector("#wbSummaryInput").dispatchEvent(new Event("input"))');
  await send('요약 화면에서 다음 요청은 어떻게 이어가면 돼?');
  await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(other)}).includes('SUMMARY_REPLY 요약 화면에서')`, 'presentation turn delivered through real PTY');
  await capture();
  await waitFor('Boolean(document.querySelector(".wb-summary-answer:last-child .wb-answer-content"))', 'structured answer rendered');
  win.setContentSize(1450, 1000);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await evaluate('(() => {const list=document.querySelector("#wbSummaryMessages"),user=[...document.querySelectorAll(".wb-summary-user")].at(-1);list.scrollTop+=user.getBoundingClientRect().top-list.getBoundingClientRect().top-28})()');
  // Render both themes and a narrow viewport, including the IME-preserving composer.
  for (const theme of ['dark', 'light']) {
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await evaluate('new Promise(resolve=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),650))');
    fs.writeFileSync(path.join(profile, `summary-${theme}.png`), (await win.webContents.capturePage()).toPNG());
  }
  const jobsBeforeRetry = fixture.controller.jobs.size;
  const boardBeforeRetry = await evaluate('[...document.querySelectorAll(".wb-2048-cell")].map(cell=>cell.textContent).join()');
  fixture.setRetainedFailure(true); await capture();
  assert(await summary(), 'a failed final analysis retains the readable summary mode');
  assert(await evaluate('document.querySelector("#wbSummaryStateTitle").textContent.includes("최종 분석을 완료하지 못했습니다")'));
  assert(await evaluate('document.querySelector("[data-retained-analysis]").textContent.includes("작업 중 작성된 분석은 보존")'));
  assert.equal(await evaluate('document.querySelector("#wbSummaryReviewState").dataset.state'), 'working', 'previous partial analysis is not final completion');
  await evaluate('document.querySelector("#wbSummaryInput").value="유지할 초안"; document.querySelector("#wbSummaryInput").dispatchEvent(new Event("input"))');
  await click('[data-summary-retry]');
  await waitFor('!document.querySelector("[data-retained-analysis]")', 'successful retry clears the warning');
  assert.equal(fixture.retryCalls, 1, 'explicit retry is generated once');
  assert.equal(fixture.controller.jobs.size, jobsBeforeRetry, 'review retry never resends the terminal request');
  assert.equal(await evaluate('document.querySelector("#wbSummaryInput").value'), '유지할 초안');
  assert.equal(await evaluate('[...document.querySelectorAll(".wb-2048-cell")].map(cell=>cell.textContent).join()'), boardBeforeRetry, 'review failure and retry preserve the game');
  await evaluate('document.querySelector("#wbSummaryInput").value=""; document.querySelector("#wbSummaryInput").dispatchEvent(new Event("input"))');
  win.setContentSize(640, 780);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  assert(await evaluate('(() => { const a=document.querySelector("[data-workspace-mode=terminal]").getBoundingClientRect(),b=document.querySelector("[data-workspace-mode=summary]").getBoundingClientRect();return a.right<=b.left&&b.right<=innerWidth;})()'), 'mode labels have separate hit targets');
  assert(await evaluate('(() => { const r=document.querySelector("#wbSummaryInput").getBoundingClientRect();return r.width>150&&r.right<=innerWidth; })()'));
  for (const width of [360, 1000]) {
    win.setContentSize(width, 780);
    await evaluate('document.querySelector(".wb-summary-body").scrollTop=0; new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `${width}px has no horizontal overflow`);
    const box = await evaluate('(() => { const r=document.querySelector("#wbSummaryForm").getBoundingClientRect();return {width:r.width,bottom:r.bottom,right:r.right,innerWidth,innerHeight,rows:getComputedStyle(document.querySelector(".wb-summary-body")).gridTemplateRows}; })()');
    assert(box.width > 150 && box.bottom <= box.innerHeight && box.right <= box.innerWidth, `${width}px composer remains visible: ${JSON.stringify(box)}`);
    if (width === 360) {
      await click('.wb-topbar [data-action=toggle-sidebar]');
      assert(await evaluate('getComputedStyle(document.querySelector(".wb-sidebar")).display !== "none"'), 'compact sidebar can be opened');
      assert.equal(await evaluate('document.activeElement.id'), 'wbProjectSearch');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await waitFor('!document.querySelector("#terminalWorkspace").classList.contains("summary-sidebar-open")', 'Escape closes compact sidebar');
      await click('.wb-topbar [data-action=toggle-sidebar]'); await click('.wb-summary-nav-close');
      assert(await evaluate('!document.querySelector("#terminalWorkspace").classList.contains("summary-sidebar-open")'), 'close control dismisses compact sidebar');
      fs.writeFileSync(path.join(profile, 'summary-narrow.png'), (await win.webContents.capturePage()).toPNG());
    }
  }
  win.setContentSize(1450, 900);
  await click(`.wb-instance[data-instance="${id}"]`);
  const writes = [...fixture.controller.jobs.values()].length;
  fixture.setFailure(true); await capture();
  await waitFor('!document.querySelector("#terminalWorkspace").classList.contains("summary-mode")', 'summary failure shows original terminal');
  assert.equal([...fixture.controller.jobs.values()].length, writes, 'failure does not resend requests');
  fixture.setFailure(false); await capture(); await click('[data-workspace-mode=summary]');
  await send('SUMMARY_HOLD_BEFORE_RELOAD');
  await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(id)}).includes('esc to interrupt')`, 'hold before reload');
  await send('NEVER_AUTO_REPLAY');
  await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload queued draft'); await capture();
  assert.equal([...fixture.controller.jobs.values()].filter(job=>job.request==='NEVER_AUTO_REPLAY').length, 0, 'restart never replays queued input');
  assert(await evaluate('document.querySelector("#wbSummaryMessages").textContent.includes("NEVER_AUTO_REPLAY")'));
  fixture.processes.delete(id); await manager.write(id, '\x03'); await capture();
  await waitFor('document.querySelector("[data-workspace-mode=summary]").disabled', 'AI exit disables summary');
  assert.equal(await summary(), false);
  console.log('PASS summary mode real PTY: affectUI keyboard mode/send/copy/original/loader, truthful completion states, queued edits/approval, per-terminal persistence, 2048, no replay, and 360/640/1000px composer/navigation');
  console.log(`Screenshots: ${profile}/summary-{dark,light}.png`);
}
module.exports = { createFixture, run };
