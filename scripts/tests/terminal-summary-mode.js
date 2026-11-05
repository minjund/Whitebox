'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TerminalCollaboration } = require('../../src/terminalCollaboration');

function createFixture({ manager, profile, root }) {
  const processes = new Map();
  let failure = false;
  const controller = new TerminalCollaboration({ directory: path.join(profile, 'summary-control'), manager: () => Object.assign(manager, { rawWriteDeliverySupported: () => true }), enableControl: false,
    completion: { observe: async () => ({ available: false }) },
    monitor: { scan: () => ({ available: true, processes: [...processes].map(([id, pid]) => ({ pid, ancestorPids: [manager.get(id)?.pid], provider: 'codex' })) }) },
    activity: { observe: async (members, frames) => new Map(members.map(member => {
      const text = frames.get(member.id)?.text || '';
      return [member.id, { provider: processes.has(member.id) ? 'codex' : '', providerPid: processes.get(member.id) || 0,
        state: text.includes('Would you like') ? 'waiting' : text.includes('esc to interrupt') ? 'working' : 'idle' }];
    })) },
  });
  return {
    controller, processes,
    setFailure(value) { failure = value; },
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
      return { state: jobs.length ? 'ready' : 'watching', provider: 'codex', providerPid: processes.get(payload.id),
        result: { tasks: jobs.map(job => ({ taskId: job.id, analysisId: job.id, request: job.request,
          observedAt: new Date(job.finishedAt || Date.now()).toISOString(), actual: `요약: ${job.request}`, explanation: 'Fixture summary of the matching real PTY reply.' })) } };
    },
    async launch(id, waitFor) {
      const quote = value => "'" + value.replace(/'/gu, process.platform === 'win32' ? "''" : "'\"'\"'") + "'";
      const script = path.join(root, 'scripts/fixtures/summary-chat-provider.cjs');
      // Electron is a GUI subsystem executable on Windows. PowerShell does not
      // attach its Node-mode stdin to ConPTY; use the console Node from npm.
      const node = process.platform === 'win32'
        ? process.env.npm_node_execpath || require('node:child_process').execFileSync('where.exe', ['node'], { encoding: 'utf8' }).trim().split(/\r?\n/u)[0]
        : process.execPath;
      assert(fs.statSync(node).isFile(), 'fixture needs an actual Node executable');
      const command = process.platform === 'win32'
        ? `& ${quote(node)} ${quote(script)}`
        : ` ELECTRON_RUN_AS_NODE=1 ${quote(node)} ${quote(script)}`;
      await manager.command(id, command);
      await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(id)}).includes('SUMMARY_READY')`, 'fixture provider startup');
      const replay = manager.get(id, true).replay;
      const pid = Number(replay.match(/SUMMARY_READY (\d+)/u)?.[1]); assert(pid);
      processes.set(id, pid);
    },
  };
}

async function run({ evaluate, waitFor, manager, win, fixture, profile }) {
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const summary = () => evaluate('document.querySelector("#terminalWorkspace").classList.contains("summary-mode")');
  const send = text => evaluate(`document.querySelector('#wbSummaryInput').value=${JSON.stringify(text)}; document.querySelector('#wbSummaryInput').dispatchEvent(new Event('input')); document.querySelector('#wbSummaryForm').requestSubmit()`);
  const capture = () => evaluate('WhiteboxWorkspace.captureReviews(true)');
  const id = await evaluate('WhiteboxWorkspace.getState().activeId');
  assert(await evaluate('document.querySelector("[data-workspace-mode=summary]").disabled'), 'plain shell has no summary mode');
  await fixture.launch(id, waitFor); await capture();
  await waitFor('!document.querySelector("[data-workspace-mode=summary]").disabled', 'AI enables summary mode');
  const before = manager.get(id);
  await evaluate('document.querySelector("#wbAutoReview").checked=false; document.querySelector("#wbAutoReview").dispatchEvent(new Event("change"))');
  await click('[data-workspace-mode=summary]'); assert(await summary());
  assert(await evaluate('getComputedStyle(document.querySelector("#wbCanvas")).display === "none" && getComputedStyle(document.querySelector("#wbReview")).display === "none"'));
  await send('한글 SUMMARY_HOLD');
  await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(id)}).includes('esc to interrupt')`, 'chat delivered to real PTY');
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
  await fixture.launch(other, waitFor); await capture(); await click('[data-workspace-mode=summary]');
  await evaluate('document.querySelector("#wbSummaryInput").value="draft two"; document.querySelector("#wbSummaryInput").dispatchEvent(new Event("input"))');
  await click(`.wb-instance[data-instance="${id}"]`);
  assert(await summary()); assert.equal(await evaluate('document.querySelector("#wbSummaryInput").value'), 'draft one');
  await click('[data-workspace-mode=terminal]'); await capture(); assert.equal(await summary(), false);
  await click(`.wb-instance[data-instance="${other}"]`); assert(await summary());
  assert.equal(await evaluate('document.querySelector("#wbSummaryInput").value'), 'draft two');
  await click(`.wb-instance[data-instance="${id}"]`); assert.equal(await summary(), false, 'each terminal remembers its mode');
  await click('[data-workspace-mode=summary]');
  await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload summary chat'); await capture();
  await waitFor('document.querySelector("#terminalWorkspace").classList.contains("summary-mode")', 'mode restored');
  assert.equal(await evaluate('document.querySelector("#wbSummaryInput").value'), 'draft one');
  assert.equal(manager.get(id).pid, before.pid); assert.equal(manager.get(id).creationId, before.creationId);
  // Render both themes and a narrow viewport, including the IME-preserving composer.
  for (const theme of ['dark', 'light']) {
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(profile, `summary-${theme}.png`), (await win.webContents.capturePage()).toPNG());
  }
  win.setContentSize(640, 780);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  assert(await evaluate('(() => { const a=document.querySelector("[data-workspace-mode=terminal]").getBoundingClientRect(),b=document.querySelector("[data-workspace-mode=summary]").getBoundingClientRect();return a.right<=b.left&&b.right<=innerWidth;})()'), 'mode labels have separate hit targets');
  assert(await evaluate('(() => { const r=document.querySelector("#wbSummaryInput").getBoundingClientRect();return r.width>150&&r.right<=innerWidth; })()'));
  win.setContentSize(1450, 900);
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
  console.log('PASS summary mode real PTY: shell disabled, hidden terminal chat/replies, editable/cancellable queue, inline approval, per-terminal draft/mode/history, reload/no replay, failure fallback, AI exit, themes and 640px composer');
  console.log(`Screenshots: ${profile}/summary-{dark,light}.png`);
}
module.exports = { createFixture, run };
