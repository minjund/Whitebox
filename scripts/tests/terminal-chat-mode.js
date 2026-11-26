'use strict';
// Chat panes in the real renderer: a real PTY runs a fixture AI, delivery goes
// through the real TerminalCollaboration backend, and the transcript the pane
// reads is built from the jobs that backend actually delivered.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TerminalCollaboration } = require('../../src/terminalCollaboration');
const { providerActivity } = require('../../src/terminalActivity');
// A value placed inside JavaScript sent to the renderer: JSON with the
// characters that can end a script or a line escaped (see background-runtime-check.js).
function lit(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('JavaScript 리터럴로 직렬화할 수 없는 값입니다.');
  return serialized.replace(/[<>/\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function createFixture({ manager, profile, root }) {
  const processes = new Map();
  const providers = new Map();
  const controller = new TerminalCollaboration({ directory: path.join(profile, 'chat-control'), manager: () => Object.assign(manager, { rawWriteDeliverySupported: () => true }), enableControl: false,
    completion: { observe: async () => ({ available: false }) },
    monitor: { scan: () => ({ available: true, processes: [...processes].map(([id, pid]) => ({ pid, ancestorPids: [manager.get(id)?.pid], provider: providers.get(id) || 'codex' })) }) },
    activity: { observe: async (members, frames) => new Map(members.map(member => {
      const text = frames.get(member.id)?.text || '';
      return [member.id, { provider: processes.has(member.id) ? providers.get(member.id) || 'codex' : '', providerPid: processes.get(member.id) || 0,
        state: providerActivity({ text }) }];
    })) },
  });
  let conversationReads = 0, longHistory = false;
  return {
    controller, processes,
    get conversationReads() { return conversationReads; },
    get longHistory() { return longHistory; },
    set longHistory(value) { longHistory = value === true; },
    async collaboration(payload) {
      if (payload.operation === 'chat-send') return controller.chatSend(payload);
      if (payload.operation === 'chat-respond') return controller.chatRespond(payload);
      return controller.sync(payload);
    },
    review(payload) {
      if (payload.historyContent) return { entries: [] };
      return { state: 'watching', provider: providers.get(payload.id) || 'codex', providerPid: processes.get(payload.id) };
    },
    // The transcript of this terminal: a greeting, then each delivered request
    // with a tool call and a Markdown answer once the fixture finished it.
    conversation(payload) {
      conversationReads++;
      if (!processes.has(payload.id)) return { available: false, reason: 'provider' };
      const jobs = [...controller.jobs.values()].filter(job => job.targetId === payload.id && job.operation === 'chat');
      const messages = [{ id: 'hello', role: 'assistant', text: '안녕하세요. **FIXTURE_HELLO** 입니다.\n\n- 첫째 항목\n- `code` 항목', timestamp: new Date(0).toISOString() }];
      // A history taller than the pane, for the scroll position on switching.
      if (longHistory) for (let i = 1; i <= 40; i++) messages.push({ id: `long-${i}`, role: 'assistant', text: `LONG_${i}\n\n긴 대화의 ${i}번째 답입니다.`, timestamp: new Date(0).toISOString() });
      for (const job of jobs) {
        const at = new Date(job.sentAt || Date.now()).toISOString();
        messages.push({ id: `${job.id}:u`, role: 'user', text: `<system-reminder>hidden</system-reminder>${job.request}`.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gu, ''), timestamp: at });
        if (['completed'].includes(job.state)) {
          messages.push({ id: `${job.id}:t`, role: 'tool', type: 'tool', title: 'Bash', text: `echo ${job.request}`, timestamp: at });
          messages.push({ id: `${job.id}:a`, role: 'assistant', text: `답: ${job.request}\n\n\`\`\`\nCODE_${job.request}\n\`\`\``, timestamp: at });
        }
      }
      const revision = lit([longHistory, ...jobs.map(job => [job.id, job.state])]);
      if (payload.revision === revision) return { available: true, provider: providers.get(payload.id), providerPid: processes.get(payload.id), revision, unchanged: true, working: false };
      return { available: true, provider: providers.get(payload.id), providerPid: processes.get(payload.id), revision, truncated: false, working: false, messages };
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
      await waitFor(`WhiteboxTerminal.readTerminal(${lit(id)}).includes('SUMMARY_READY')`, 'fixture provider startup');
      const replay = manager.get(id, true).replay;
      const pid = Number(replay.match(/SUMMARY_READY (\d+)/u)?.[1]); assert(pid);
      processes.set(id, pid);
      providers.set(id, provider);
    },
  };
}

async function run({ evaluate, waitFor, manager, win, fixture }) {
  const id = await evaluate('WhiteboxWorkspace.getState().activeId');
  const pane = `#wbCanvas .wb-pane[data-terminal-id=${lit(id)}]`;
  const q = selector => lit(selector);
  const type = text => evaluate(`(() => { const input = document.querySelector(${q(`${pane} .wb-chat textarea`)}); input.focus(); input.value = ${lit(text)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  const log = () => evaluate(`document.querySelector(${q(`${pane} .wb-chat-log`)})?.textContent || ''`);

  assert.equal(await evaluate('document.querySelector("[data-workspace-mode=chat]").disabled'), true, 'a plain shell cannot be shown as chat');
  assert.equal(await evaluate(`document.querySelector(${q(`${pane} [data-chat-terminal]`)}).hidden`), true, 'the pane chat button is hidden for a plain shell');
  assert.equal(await evaluate('Boolean(document.querySelector("#wbSummary"))'), false, 'the Summary view is gone');
  await fixture.launch(id, waitFor);
  await waitFor('!document.querySelector("[data-workspace-mode=chat]").disabled', 'an AI terminal enables the chat view');
  await waitFor(`!document.querySelector(${q(`${pane} [data-chat-terminal]`)}).hidden`, 'the pane chat button appears for the AI terminal');
  assert(await evaluate('Boolean(document.querySelector(".wb-mode-switch .ui-segc"))'), 'actual affectUI mode control mounted');
  const sizeBefore = (({ cols, rows }) => ({ cols, rows }))(manager.get(id));

  await evaluate('document.querySelector("[data-workspace-mode=chat]").click()');
  await waitFor(`document.querySelector(${q(pane)}).classList.contains('is-chat') && !document.querySelector(${q(`${pane} .wb-chat`)}).hidden`, 'the switch turns the AI pane into a chat');
  await waitFor(`(document.querySelector(${q(`${pane} .wb-chat-log`)})?.textContent || '').includes('FIXTURE_HELLO')`, 'the transcript is shown as chat');
  assert(await evaluate(`Boolean(document.querySelector(${q(`${pane} .wb-chat-text strong`)})) && Boolean(document.querySelector(${q(`${pane} .wb-chat-text li code`)}))`), 'assistant Markdown renders bold, lists and inline code');
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector("#wbCanvas")).display'), 'none', 'the chat lives inside the split canvas');
  await waitFor(`document.activeElement === document.querySelector(${q(`${pane} .wb-chat textarea`)})`, 'switching to chat focuses its input');
  assert.equal(await evaluate('document.querySelector("[data-workspace-mode=chat]").getAttribute("aria-pressed")'), 'true');

  await type('CHAT_PING');
  await waitFor(`WhiteboxTerminal.readTerminal(${lit(id)}).includes('SUMMARY_REPLY CHAT_PING')`, 'a chat message is delivered to the real PTY and answered');
  await waitFor(`(document.querySelector(${q(`${pane} .wb-chat-log`)})?.textContent || '').includes('CODE_CHAT_PING') && !document.querySelector(${q(`${pane} .is-pending`)})`, 'the answer arrives from the transcript and the sent message leaves the queue');
  // Paseo-style turn: the finished turn's work folds into one summary row above its answer.
  const summaryRow = `${pane} .wb-chat-work.is-turn [data-chat-toggle]`;
  await waitFor(`/명령 1개 실행|Commands run: 1|运行了 1 条命令/u.test(document.querySelector(${q(summaryRow)})?.textContent || '')`, 'the turn work folds into one summary row');
  assert.equal(await evaluate(`document.querySelector(${q(`${pane} .wb-chat-rail`)})`), null, 'the folded work stays closed');
  assert(await evaluate(`Boolean(document.querySelector(${q(`${pane} .wb-chat-footer [data-chat-copy]`)}))`), 'the answer has a copy button');
  await evaluate(`[...document.querySelectorAll(${q(summaryRow)})].at(-1).click()`);
  await waitFor(`(document.querySelector(${q(`${pane} .wb-chat-rail`)})?.textContent || '').includes('echo CHAT_PING')`, 'opening the summary shows the tool call and its command');
  assert.doesNotMatch(await log(), /hidden/u, 'injected reminders are not shown');

  // A second message while the AI works goes in at once; the AI takes it at its next gap.
  await type('CHAT_HOLD');
  await waitFor(`WhiteboxTerminal.readTerminal(${lit(id)}).includes('› CHAT_HOLD')`, 'first message reaches the PTY');
  await type('CHAT_NEXT');
  await waitFor(`WhiteboxTerminal.readTerminal(${lit(id)}).includes('CHAT_NEXT')`, 'a message typed while the AI works is typed into it at once', 5000);
  await waitFor(`WhiteboxTerminal.readTerminal(${lit(id)}).includes('SUMMARY_REPLY CHAT_NEXT')`, 'and is answered', 15000);

  // "Stop and send" (Ctrl/Cmd+Enter): one Escape ends the running turn, then the message goes in.
  await type('CHAT_HOLD_AGAIN');
  await waitFor(`WhiteboxTerminal.readTerminal(${lit(id)}).includes('› CHAT_HOLD_AGAIN')`, 'a long turn is running');
  await evaluate(`(() => { const input = document.querySelector(${q(`${pane} .wb-chat textarea`)}); input.focus(); input.value = 'CHAT_FORCE';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); })()`);
  await waitFor(`WhiteboxTerminal.readTerminal(${lit(id)}).includes('SUMMARY_REPLY CHAT_FORCE')`, 'stop and send delivers the message', 15000);
  assert(manager.get(id, true).replay.includes('FIXTURE_INTERRUPTED'), 'the running turn was stopped first');
  assert(!manager.get(id, true).replay.includes('SUMMARY_REPLY CHAT_HOLD_AGAIN'), 'the stopped turn never finished');

  // "/" lists the AI's commands and skills; Enter picks one into the input.
  const input = `document.querySelector(${q(`${pane} .wb-chat textarea`)})`;
  await evaluate(`(() => { const box = ${input}; box.focus(); box.value = '/comp'; box.setSelectionRange(5, 5); box.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(`!document.querySelector(${q(`${pane} .wb-chat-slash`)}).hidden && (document.querySelector(${q(`${pane} .wb-chat-slash`)}).textContent || '').includes('/compact')`, 'typing "/" lists the commands');
  await evaluate(`${input}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
  assert.equal(await evaluate(`${input}.value`), '/compact ', 'Enter picks the command instead of sending');
  assert.equal(await evaluate(`document.querySelector(${q(`${pane} .wb-chat-slash`)}).hidden`), true, 'the list closes after a pick');
  await evaluate(`${input}.value = ''; true`);

  // Messenger layout: the AI's answer is a bubble on the left under its name.
  assert.equal(await evaluate(`document.querySelector(${q(`${pane} .wb-chat-ai .wb-chat-sender`)})?.textContent`), 'Codex', 'the answer bubble names its AI');
  assert(await evaluate(`(() => { const log = document.querySelector(${q(`${pane} .wb-chat-log`)}).getBoundingClientRect(); const ai = document.querySelector(${q(`${pane} .wb-chat-ai-bubble`)}).getBoundingClientRect(); const me = [...document.querySelectorAll(${q(`${pane} .wb-chat-msg.is-user .wb-chat-bubble`)})].at(-1).getBoundingClientRect(); return ai.left - log.left < 40 && log.right - me.right < 40; })()`), 'the AI bubble sits on the left and mine on the right');

  // A question in the terminal is answered there.
  await type('CHAT_PERMISSION');
  await waitFor(`!document.querySelector(${q(`${pane} .wb-chat-notice`)}).hidden`, 'an open terminal question shows a notice in the chat');
  await evaluate(`document.querySelector(${q(`${pane} [data-chat-terminal-view]`)}).click()`);
  await waitFor(`!document.querySelector(${q(pane)}).classList.contains('is-chat')`, '"터미널로 보기" returns that pane to the terminal');
  await manager.write(id, 'y');
  await waitFor(`WhiteboxTerminal.readTerminal(${lit(id)}).includes('SUMMARY_REPLY CHAT_PERMISSION')`, 'the question answered in the terminal');

  assert.deepEqual((({ cols, rows }) => ({ cols, rows }))(manager.get(id)), sizeBefore, 'the PTY keeps its size while shown as chat');

  // The pane button toggles one pane; the chosen view survives a reload.
  await evaluate(`document.querySelector(${q(`${pane} [data-chat-terminal]`)}).click()`);
  await waitFor(`document.querySelector(${q(pane)}).classList.contains('is-chat')`, 'the pane button turns one pane into a chat');
  await win.reload();
  await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload with a chat pane');
  await waitFor(`document.querySelector(${q(pane)})?.classList.contains('is-chat')`, 'the chat view is kept for the same terminal after reload', 15000);
  // Switching to chat opens at the latest message, even after reading higher up.
  fixture.longHistory = true;
  const chatLog = `document.querySelector(${q(`${pane} .wb-chat-log`)})`;
  const atEnd = `(${chatLog}.scrollHeight > ${chatLog}.clientHeight * 2 && ${chatLog}.scrollHeight - ${chatLog}.scrollTop - ${chatLog}.clientHeight < 4)`;
  await waitFor(`(${chatLog}?.textContent || '').includes('LONG_40') && ${atEnd}`, 'a longer transcript keeps the chat at the latest message', 15000);
  await evaluate(`${chatLog}.scrollTop = 0; ${chatLog}.dispatchEvent(new Event('scroll')); true`);
  await evaluate(`document.querySelector(${q(`${pane} [data-chat-terminal]`)}).click()`);
  await waitFor(`!document.querySelector(${q(pane)}).classList.contains('is-chat')`, 'back to the terminal');
  await evaluate(`document.querySelector(${q(`${pane} [data-chat-terminal]`)}).click()`);
  await waitFor(`document.querySelector(${q(pane)}).classList.contains('is-chat') && ${atEnd}`, 'switching to chat shows the latest message at the bottom');
  console.log('PASS chat pane: switching to chat opens at the latest message');

  await evaluate(`document.querySelector(${q(`${pane} [data-chat-terminal]`)}).click()`);
  await waitFor(`!document.querySelector(${q(pane)}).classList.contains('is-chat') && document.querySelector(${q(`${pane} .wb-chat`)}).hidden`, 'the pane button returns it to the terminal');
  assert(fixture.conversationReads > 0);
  console.log('PASS chat pane: switch and pane toggle, transcript bubbles with Markdown and folded tools, guarded delivery to the real PTY (mid-turn, stop and send), / command list, messenger bubbles, terminal questions, unchanged PTY size, reload persistence');
  // Under npm stdout is a pipe (asynchronous); let the line reach it before the caller exits the app.
  await new Promise(resolve => process.stdout.write('', resolve));
}

module.exports = { createFixture, run };
