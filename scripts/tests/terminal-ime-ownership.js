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
      for (const late of [false, true]) {
        await prepare();
        // Real composition starts with Process; keyup clears _keyDownSeen.
        key('Process', 229);
        start(term); update(term, '한'); end(term, '한');
        term.textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Process', keyCode: 229, bubbles: true }));
        if (late) await new Promise(resolve => setTimeout(resolve, 0));
        input('한'); await delay();
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

    await prepare();
    start(term); update(term, '한글'); await delay();
    const state = snapshot();
    result.preeditWidth = state.preedit.width;
    result.gridWidth = term._core.unicodeService.getStringCellWidth('한글')
      * term.element.querySelector('.xterm-screen').clientWidth / term.cols;
    end(term, '한글'); await delay();

    // Disposing the add-on alone must restore xterm, not leave a native-input
    // interceptor or a deferred send attached to an otherwise live terminal.
    const host = document.createElement('div'); document.body.appendChild(host);
    const disposable = new Terminal({ cols: 80, rows: 10 }); disposable.open(host);
    const helper = disposable._core._compositionHelper;
    const originals = [helper.compositionstart, helper._finalizeComposition, helper.keydown, disposable._core._inputEvent];
    const addon = WhiteboxTerminalIme.createAddon(); disposable.loadAddon(addon);
    const disposedWrites = []; disposable.onData(data => disposedWrites.push(data));
    start(disposable); update(disposable, '취소'); end(disposable, '취소');
    addon.dispose(); await delay();
    result.disposal = {
      restored: [helper.compositionstart, helper._finalizeComposition, helper.keydown, disposable._core._inputEvent]
        .every((method, index) => method === originals[index]),
      writes: disposedWrites.join(''), overlays: host.querySelectorAll('.whitebox-ime-view').length,
    };
    disposable.dispose(); host.remove(); term.focus();
    return result;
  });
  assert.deepEqual({ ...result, preeditWidth: undefined, gridWidth: undefined }, {
    processBeforeComposition: '한', midlineDigit: '2', cancelReplacement: '',
    nativeCommit: ['한', '한', '한', '한'],
    identicalNewNativeText: '한한', processWithKeypress: '2',
    orcaWindowsTrace: '가\r나',
    metaDuringPreedit: { writes: '', visible: true }, metaFinal: '한',
    composingBackspace: { writes: '', visible: true }, backspaceFinal: '하',
    disposal: { restored: true, writes: '', overlays: 0 },
    preeditWidth: undefined, gridWidth: undefined,
  });
  assert(Math.abs(result.preeditWidth - result.gridWidth) < 1,
    `Preedit must occupy the committed terminal cells: ${JSON.stringify(result)}`);
  return result;
};
