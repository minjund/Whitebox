'use strict';
const assert = require('node:assert/strict');
// The Summary composer re-renders on the workspace observation ticks. A stale
// or briefly missing AI observation must not disable the focused textarea:
// Chromium then ends the Korean composition and drops keys until the next tick.
exports.run = async (evaluate, win) => {
  await evaluate(`(() => {
    const root = document.createElement('div');
    root.id = 'summaryComposerImeFixture';
    root.append(document.querySelector('.wb-mode-switch').cloneNode(true), document.querySelector('#wbSummary').cloneNode(true), document.querySelector('#wbCanvas').cloneNode(false));
    document.body.append(root);
    const member = { creationId: 'epoch', pid: 100, providerPid: 101, provider: 'codex', ready: true, observedAt: Date.now() };
    const chat = WhiteboxSummaryChat({ root, t: text => text, esc: text => String(text),
      activeId: () => 'ime', session: () => ({ status: 'running', creationId: 'epoch', pid: 100 }), member: () => member,
      tasks: () => [], snapshot: () => ({ text: '' }), review: () => ({ state: 'reviewing' }), label: () => 'ime', groupId: () => 'group',
      save: () => {}, refresh: async () => {}, reveal: () => {}, report: () => {}, submitted: () => {},
      captureReply: async () => true, api: { terminalCollaboration: async () => ({ deferred: true }) } });
    chat.setMode('summary');
    const input = root.querySelector('#wbSummaryInput');
    window.__summaryComposerIme = { root, chat, member, input, events: [] };
    for (const type of ['compositionend', 'blur']) input.addEventListener(type, event => window.__summaryComposerIme.events.push(type + ':' + (event.data || '')));
    input.focus();
    return document.activeElement === input;
  })()`);
  win.webContents.debugger.attach('1.3');
  let during;
  try {
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
    // A delayed observation sync makes the AI briefly ineligible to send.
    during = await evaluate(`(() => { const s = window.__summaryComposerIme;
      s.member.observedAt = Date.now() - 6000; s.chat.render();
      const result = { disabled: s.input.disabled, focused: document.activeElement === s.input, sendDisabled: document.querySelector('#summaryComposerImeFixture #wbSummarySend').disabled, events: [...s.events] };
      s.member.observedAt = Date.now(); s.chat.render(); return result; })()`);
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '한글', selectionStart: 2, selectionEnd: 2 });
    await win.webContents.debugger.sendCommand('Input.insertText', { text: '한글' });
  } finally { win.webContents.debugger.detach(); }
  const after = await evaluate(`(() => { const s = window.__summaryComposerIme;
    const result = { value: s.input.value, draft: s.chat.serialize()[0]?.draft, events: [...s.events] };
    s.input.value = ''; s.input.dispatchEvent(new Event('input')); s.input.focus(); return result; })()`);
  // macOS 2-Set order: a 229 keydown before each composition step and the
  // period committed together with the syllable it ended, then Enter. The
  // queued request is exactly what was typed; the control-character strip on
  // send keeps Hangul syllables and both jamo blocks.
  win.webContents.debugger.attach('1.3');
  let typed;
  try {
    const send = (method, params) => win.webContents.debugger.sendCommand(method, params);
    const jamo = async (key, code, text) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
      await send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    };
    await jamo('ㄴ', 'KeyS', 'ㄴ'); await jamo('ㅔ', 'KeyP', '네'); await send('Input.insertText', { text: '네' });
    await jamo('ㄷ', 'KeyE', 'ㄷ'); await jamo('ㅏ', 'KeyK', '다'); await jamo('.', 'Period', '다');
    await send('Input.insertText', { text: '다.' });
    await jamo('ㅋ', 'KeyZ', 'ㅋ'); await send('Input.insertText', { text: 'ㅋ' });
    typed = await evaluate(`(() => document.querySelector('#summaryComposerImeFixture #wbSummaryInput').value)()`);
    for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  } finally { win.webContents.debugger.detach(); }
  const sent = await evaluate(`(async () => { const s = window.__summaryComposerIme;
    await new Promise(resolve => setTimeout(resolve, 50));
    s.input.value = '한\u3131\u0007\u1112\u1161\u11ab\u001b.'; s.root.querySelector('#wbSummaryForm, form').requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 50));
    const result = { messages: s.chat.serialize()[0]?.messages.map(message => message.text), value: s.input.value };
    s.root.remove(); s.chat.forget?.('ime'); delete window.__summaryComposerIme; return result; })()`);
  // The AI is still known, so sending stays available; the request waits in
  // the queue until the AI is observed again.
  assert.deepEqual(during, { disabled: false, focused: true, sendDisabled: false, events: [] },
    'a stale observation keeps the focused composer editable mid-composition and still accepts a queued send: ' + JSON.stringify(during));
  assert.equal(after.value, '한글', 'Korean composition continues across the stale observation');
  assert.equal(after.draft, '한글');
  assert.deepEqual(after.events, ['compositionend:한글'], JSON.stringify(after));
  console.log('PASS summary composer keeps focus and Korean composition while AI observation is briefly stale');
  assert.equal(typed, '네다.ㅋ', 'macOS-order composition fills the composer exactly');
  assert.deepEqual(sent, { messages: ['네다.ㅋ', '한\u3131\u1112\u1161\u11ab.'], value: '' }, JSON.stringify(sent));
  console.log('PASS summary composer queues macOS-order Korean exactly; the send strip keeps Hangul and jamo');
};
