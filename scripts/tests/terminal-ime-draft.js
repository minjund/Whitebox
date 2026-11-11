'use strict';
const assert = require('node:assert/strict');

// The IME textarea value is reported as the terminal's input draft, and any
// draft holds Summary sends as queued. Line-clearing keys, a new line editor
// and a reset must leave it empty; line edits must keep it aligned.
module.exports = async function checkImeDraft(evaluate) {
  const result = await evaluate(async () => {
    const out = {};
    const key = (keyName, code, keyCode, extra = {}) => {
      const event = new KeyboardEvent('keydown', { key: keyName, code, keyCode, which: keyCode, bubbles: true, cancelable: true, ...extra });
      term.textarea.dispatchEvent(event);
      return event;
    };
    const commit = text => {
      const value = term.textarea.value, at = term.textarea.selectionStart, tail = value.slice(term.textarea.selectionEnd);
      start(term);
      update(term, text, value.slice(0, at) + text + tail);
      term.textarea.setSelectionRange(at + text.length, at + text.length);
      end(term, text);
    };
    const draft = () => term.textarea.value;
    const typed = async text => { await reset(term); writes.length = 0; term.focus(); commit(text); await delay(); };

    for (const [name, code, keyCode] of [['u', 'KeyU', 85], ['c', 'KeyC', 67]]) {
      await typed('안녕하세요');
      const before = draft();
      key(name, code, keyCode, { ctrlKey: true });
      const after = draft(); await delay();
      out[`ctrl${name.toUpperCase()}`] = { before, after, writes: writes.join('') };
    }

    await typed('안녕 하세요');
    key('w', 'KeyW', 87, { ctrlKey: true }); const word = draft();
    key('Backspace', 'Backspace', 8); const backspace = draft();
    key('ArrowLeft', 'ArrowLeft', 37); key('Delete', 'Delete', 46); const deleted = draft();
    key('a', 'KeyA', 65, { ctrlKey: true }); key('k', 'KeyK', 75, { ctrlKey: true }); const killed = draft();
    out.edits = { word, backspace, deleted, killed };

    await typed('정정');
    key('Escape', 'Escape', 27); const oneEscape = draft();
    key('Escape', 'Escape', 27); const twoEscapes = draft();
    await typed('줄');
    key('Enter', 'Enter', 13, { shiftKey: true }); const shiftEnter = draft();
    key('Enter', 'Enter', 13); const enter = draft();
    out.keys = { oneEscape, twoEscapes, shiftEnter, enter };

    // An AI CLI exits and the shell prompt takes the line back in one batch.
    await reset(term); writes.length = 0; term.focus();
    await outputTo(term, '\x1b[?2004h$ '); await delay();
    commit('남은 초안'); await delay();
    await outputTo(term, '\x1b[?2004h'); await delay(); const editorOn = draft();
    await outputTo(term, 'bye\r\n\x1b[?2004l\x1b[?2004h$ '); await delay(); const editorCycled = draft();
    commit('다시'); await delay(); const afterCycle = { draft: draft(), writes: writes.join('') };
    term.reset(); const afterReset = draft();
    out.lineEditor = { editorOn, editorCycled, afterCycle, afterReset };

    // A composition in progress is never cleared by output.
    await reset(term); writes.length = 0; term.focus();
    await outputTo(term, '\x1b[?2004h'); await delay();
    await outputTo(term, '\x1b[?2004l'); start(term); update(term, '한');
    await outputTo(term, '\x1b[?2004h'); await delay();
    const composingDraft = draft();
    end(term, '한'); await delay();
    out.composing = { draft: composingDraft, writes: writes.join('') };
    return out;
  });
  for (const name of ['ctrlU', 'ctrlC']) {
    assert.equal(result[name].before, '안녕하세요');
    assert.equal(result[name].after, '', `${name} clears the reported input draft`);
  }
  assert.equal(result.ctrlU.writes, '안녕하세요\x15', 'Ctrl+U still reaches the PTY');
  assert.equal(result.ctrlC.writes, '안녕하세요\x03', 'Ctrl+C still reaches the PTY');
  assert.deepEqual(result.edits, { word: '안녕 ', backspace: '안녕', deleted: '안', killed: '' });
  assert.deepEqual(result.keys, { oneEscape: '정정', twoEscapes: '', shiftEnter: '줄', enter: '' });
  assert.deepEqual(result.lineEditor, { editorOn: '남은 초안', editorCycled: '', afterCycle: { draft: '다시', writes: '남은 초안다시' }, afterReset: '' });
  assert.deepEqual(result.composing, { draft: '한', writes: '한' });
  return result;
};
