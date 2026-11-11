'use strict';
const assert = require('node:assert/strict');

// Chromium-generated (CDP) key and composition orders that macOS 2-Set Korean
// produces: a 229 keydown before each composition step, a syllable committed
// together with the period that ended it, a period keydown that reaches the
// page after the commit, and a jamo keydown with its physical keyCode. Each
// must reach terminalWrite as exactly the typed Korean and punctuation; no
// syllable may be dropped or replaced by '.'. Not native macOS IME evidence.
module.exports = async function checkImeMacOrder(evaluate, debug) {
  const send = (method, params) => debug.sendCommand(method, params);
  const key = (type, keyName, code, keyCode, extra = {}) => send('Input.dispatchKeyEvent', {
    type, key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, ...extra });
  const compose = text => send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  const commit = text => send('Input.insertText', { text });
  const jamo = async (keyName, code, text) => { await key('rawKeyDown', keyName, code, 229); await compose(text); };
  const scenarios = {
    // 다 + '.' committed together (IME commit carries the punctuation).
    commitWithPeriod: { expected: '합니다.', run: async () => {
      await jamo('ㅎ', 'KeyG', 'ㅎ'); await jamo('ㅏ', 'KeyK', '하'); await jamo('ㅂ', 'KeyQ', '합'); await commit('합');
      await jamo('ㄴ', 'KeyS', 'ㄴ'); await jamo('ㅣ', 'KeyL', '니'); await commit('니');
      await jamo('ㄷ', 'KeyE', 'ㄷ'); await jamo('ㅏ', 'KeyK', '다'); await key('rawKeyDown', '.', 'Period', 229); await commit('다.');
    } },
    // The IME commits the syllable, then the period arrives as its own text.
    periodAfterCommit: { expected: '한.', run: async () => {
      await jamo('ㅎ', 'KeyG', 'ㅎ'); await jamo('ㅏ', 'KeyK', '하'); await jamo('ㄴ', 'KeyS', '한');
      await key('rawKeyDown', '.', 'Period', 229); await commit('한'); await commit('.');
    } },
    // A period keydown with its own keyCode after the commit (no 229 marker).
    periodKeyAfterCommit: { expected: '한.', run: async () => {
      await jamo('ㅎ', 'KeyG', 'ㅎ'); await jamo('ㅏ', 'KeyK', '한'); await commit('한');
      await key('keyDown', '.', 'Period', 190, { text: '.', unmodifiedText: '.' }); await key('keyUp', '.', 'Period', 190);
    } },
    // A period keydown that reaches the page while the composition is open.
    periodKeyWhileComposing: { expected: '한.', run: async () => {
      await jamo('ㅎ', 'KeyG', 'ㅎ'); await jamo('ㅏ', 'KeyK', '한');
      await key('keyDown', '.', 'Period', 190, { text: '.', unmodifiedText: '.' }); await commit('한');
    } },
    // After an input-source switch the first jamo carries its physical keyCode.
    physicalJamoKey: { expected: '한글.', run: async () => {
      await key('rawKeyDown', 'ㅎ', 'KeyG', 71); await compose('ㅎ'); await jamo('ㅏ', 'KeyK', '하'); await jamo('ㄴ', 'KeyS', '한');
      await jamo('ㄱ', 'KeyR', '한ㄱ'); await commit('한'); await compose('ㄱ'); await jamo('ㅡ', 'KeyM', '그'); await jamo('ㄹ', 'KeyF', '글');
      await key('rawKeyDown', '.', 'Period', 229); await commit('글.');
    } },
    // Shift for a double consonant (ㅆ) while composing, then Space and '.'.
    shiftedJamoThenSpace: { expected: '있다 .', run: async () => {
      await jamo('ㅇ', 'KeyD', 'ㅇ'); await jamo('ㅣ', 'KeyL', '이');
      await key('rawKeyDown', 'Shift', 'ShiftLeft', 16, { modifiers: 8 }); await jamo('ㅆ', 'KeyT', '있'); await key('keyUp', 'Shift', 'ShiftLeft', 16);
      await commit('있'); await jamo('ㄷ', 'KeyE', 'ㄷ'); await jamo('ㅏ', 'KeyK', '다'); await key('rawKeyDown', ' ', 'Space', 229); await commit('다 ');
      await key('keyDown', '.', 'Period', 190, { text: '.', unmodifiedText: '.' });
    } },
  };
  const results = {};
  for (const [name, { expected, run }] of Object.entries(scenarios)) {
    await evaluate(async () => { await reset(term); writes.length = 0; term.focus(); });
    await run();
    // A key Ghostty encodes itself never enters the browser draft; compare what
    // reached the PTY, which is what the terminal program displays.
    results[name] = await evaluate(async () => { await delay(); return { writes: writes.join(''), visible: snapshot().visible }; });
    assert.deepEqual(results[name], { writes: expected, visible: false }, `${name}: ${JSON.stringify(results[name])}`);
  }
  return results;
};
