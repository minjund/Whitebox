'use strict';

const assert = require('node:assert/strict');

// Event-order regressions against the installed xterm, through the workbench's
// terminalWrite queue. These are synthetic DOM traces, not native OS evidence.
module.exports = async function checkImeOwnership(evaluate) {
  const result = await evaluate(async () => {
    const result = {};
    const key = (key, keyCode, extra = {}) => term.textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key, keyCode, which: keyCode, bubbles: true, cancelable: true, ...extra,
    }));
    const input = (data, inputType = 'insertText') => term.textarea.dispatchEvent(new InputEvent('input', {
      data, inputType, bubbles: true, composed: true,
    }));
    const prepare = async () => { await reset(term); term.focus(); writes.length = 0; };

    // A Process key queues upstream's textarea-diff timer before composition
    // begins. It must not resend a syllable after that composition has ended.
    await prepare();
    key('Process', 229);
    start(term); update(term, '한'); end(term, '한');
    await delay();
    result.processBeforeComposition = writes.join('');

    // The helper textarea retains the existing line in screen-reader mode.
    // A punctuation edit is the inserted character, never the entire suffix.
    await prepare();
    term.textarea.value = '가다😀끝'; term.textarea.setSelectionRange(1, 1);
    key('Process', 229);
    term.textarea.value = '가2다😀끝'; term.textarea.setSelectionRange(2, 2);
    input('2'); await delay();
    result.midlineDigit = writes.join('');

    await prepare();
    term.textarea.value = '가다😀끝'; term.textarea.setSelectionRange(1, 2);
    key('Process', 229);
    start(term); update(term, '나', '가나😀끝');
    update(term, '', '가😀끝'); end(term, '');
    input(null, 'deleteCompositionText'); await delay();
    result.cancelReplacement = writes.join('');

    // Native insertText can arrive before or just after the deferred commit.
    // Exercise both accessibility modes, which take different xterm paths.
    result.nativeCommit = [];
    for (const screenReaderMode of [true, false]) {
      term.options.screenReaderMode = screenReaderMode;
      for (const inputType of ['insertText', 'insertReplacementText', 'insertFromComposition']) for (const late of [false, true]) {
        await prepare();
        // Real composition starts with Process; keyup clears _keyDownSeen.
        key('Process', 229);
        start(term); update(term, '한'); end(term, '한');
        term.textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Process', keyCode: 229, bubbles: true }));
        if (late) await new Promise(resolve => setTimeout(resolve, 0));
        input('한', inputType); await delay();
        result.nativeCommit.push(writes.join(''));
      }
    }
    term.options.screenReaderMode = true;

    await prepare();
    start(term); update(term, '한'); end(term, '한');
    await new Promise(resolve => setTimeout(resolve, 0));
    term.textarea.value = '한한'; term.textarea.setSelectionRange(2, 2);
    input('한'); await delay();
    result.identicalNewNativeText = writes.join('');

    await prepare();
    key('Process', 229);
    term.textarea.dispatchEvent(new KeyboardEvent('keypress', {
      key: '2', keyCode: 50, which: 50, charCode: 50, bubbles: true, cancelable: true,
    }));
    term.textarea.value = '2'; input('2'); await delay();
    result.processWithKeypress = writes.join('');

    // Replay the event order recorded by Orca on Windows 11 / Microsoft
    // Korean, including its third compositionupdate before physical Enter:
    // https://github.com/stablyai/orca/blob/f7719ad37e7b3dd3b83b56af156ecfaed741951b/src/renderer/src/components/terminal-pane/terminal-ime-xterm-korean-enter-commit-order.test.ts
    await prepare();
    for (const [lead, jamo, syllable] of [['KeyR', 'ㄱ', '가'], ['KeyS', 'ㄴ', '나']]) {
      key('Process', 229, { code: lead }); start(term);
      for (const [index, text] of [jamo, syllable, syllable].entries()) {
        if (index === 1) key('Process', 229, { code: 'KeyK', isComposing: true });
        update(term, text); input(text, 'insertCompositionText');
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      end(term, syllable); await new Promise(resolve => setTimeout(resolve, 0));
      if (syllable === '가') {
        term.textarea.value = '';
        key('Enter', 13, { code: 'Enter', isComposing: false });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    await delay(); result.orcaWindowsTrace = writes.join('');

    await prepare();
    start(term); update(term, 'ㅎ');
    key('Meta', 91, { metaKey: true }); await delay();
    result.metaDuringPreedit = { writes: writes.join(''), visible: snapshot().visible };
    update(term, '한'); end(term, '한'); await delay();
    result.metaFinal = writes.join('');

    await prepare();
    start(term); update(term, '한');
    key('Backspace', 8, { isComposing: true });
    update(term, '하'); await delay();
    result.composingBackspace = { writes: writes.join(''), visible: snapshot().visible };
    end(term, '하'); await delay();
    result.backspaceFinal = writes.join('');

    // A paste is an explicit input boundary. The marked syllable must commit
    // before clipboard bytes, and its browser selection must not survive into
    // the next Korean composition (including a pending deferred commit).
    result.afterPaste = [];
    for (const deferred of [false, true]) {
      await prepare();
      start(term); update(term, '한');
      if (deferred) end(term, '한');
      term.paste('바꿈(이후 감사·결과가 저장값과 일치하도록)');
      const shadow = { value: term.textarea.value, start: term.textarea.selectionStart, end: term.textarea.selectionEnd };
      start(term); update(term, '이'); end(term, '이');
      start(term); update(term, '게', '이게'); end(term, '게');
      await delay();
      result.afterPaste.push({ text: writes.join(''), shadow, focused: document.activeElement === term.textarea, visible: snapshot().visible });
    }

    await prepare();
    term.textarea.value = '복사했던 이전 문장😀'; term.textarea.select();
    term.paste('복사한 본문\n');
    result.selectedShadowAfterPaste = { value: term.textarea.value, start: term.textarea.selectionStart, end: term.textarea.selectionEnd };
    start(term); update(term, '저'); end(term, '저');
    start(term); update(term, '장', '저장'); end(term, '장');
    await delay();
    result.selectionPasteText = writes.join('');

    await prepare();
    term.textarea.blur();
    term.paste('background paste');
    result.backgroundPasteStealsFocus = document.activeElement === term.textarea;

    await prepare();
    result.nativeJamoKeyDefaults = [];
    for (const [character, keyCode, code] of [['ㅇ', 68, 'KeyD'], ['ㅣ', 76, 'KeyL']]) {
      const event = new KeyboardEvent('keydown', { key: character, keyCode, code, isComposing: false, bubbles: true, cancelable: true });
      term.textarea.dispatchEvent(event);
      result.nativeJamoKeyDefaults.push(event.defaultPrevented);
      if (character === 'ㅇ') start(term);
      update(term, character === 'ㅇ' ? 'ㅇ' : '이');
    }
    result.jamoPreeditWrites = writes.join('');
    end(term, '이'); await delay();
    result.nativeJamoCommit = writes.join('');

    await prepare();
    start(term); update(term, '한글'); await delay();
    const state = snapshot();
    result.preeditWidth = state.preedit.width;
    result.gridWidth = term.measureTextCells('한글')
      * term.element.querySelector('.xterm-screen').clientWidth / term.cols;
    end(term, '한글'); await delay();

    // Disposing the add-on alone must restore Ghostty, not leave a native-input
    // interceptor or a deferred send attached to an otherwise live terminal.
    const host = document.createElement('div'); document.body.appendChild(host);
    const disposable = new WhiteboxTerminalEngine.Terminal({ cols: 80, rows: 10 }); disposable.open(host);
    const addon = WhiteboxTerminalIme.createAddon(); disposable.loadAddon(addon);
    const disposedWrites = []; disposable.onData(data => disposedWrites.push(data));
    start(disposable); update(disposable, '취소'); end(disposable, '취소');
    addon.dispose(); await delay();
    const beforeKey = disposedWrites.join('');
    disposable.textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }));
    result.disposal = { restored: disposedWrites.join('') === 'a',
      writes: beforeKey, overlays: host.querySelectorAll('.whitebox-ime-view').length };
    disposable.dispose(); host.remove(); term.focus();
    return result;
  });
  assert.deepEqual({ ...result, preeditWidth: undefined, gridWidth: undefined }, {
    processBeforeComposition: '한', midlineDigit: '2', cancelReplacement: '',
    nativeCommit: Array(12).fill('한'),
    identicalNewNativeText: '한한', processWithKeypress: '2',
    orcaWindowsTrace: '가\r나',
    metaDuringPreedit: { writes: '', visible: true }, metaFinal: '한',
    composingBackspace: { writes: '', visible: true }, backspaceFinal: '하',
    afterPaste: [false, true].map(() => ({ text: '한바꿈(이후 감사·결과가 저장값과 일치하도록)이게', shadow: { value: '', start: 0, end: 0 }, focused: true, visible: false })),
    selectedShadowAfterPaste: { value: '', start: 0, end: 0 },
    selectionPasteText: '복사한 본문\r저장', backgroundPasteStealsFocus: false,
    nativeJamoKeyDefaults: [false, false], jamoPreeditWrites: '', nativeJamoCommit: '이',
    disposal: { restored: true, writes: '', overlays: 0 },
    preeditWidth: undefined, gridWidth: undefined,
  });
  assert(Math.abs(result.preeditWidth - result.gridWidth) < 1,
    `Preedit must occupy the committed terminal cells: ${JSON.stringify(result)}`);
  return result;
};
