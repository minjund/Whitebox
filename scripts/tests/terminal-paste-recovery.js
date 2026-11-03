'use strict';
const assert = require('node:assert/strict');

module.exports = async function checkPasteRecovery(evaluate, debuggerSession) {
  const results = [];
  for (const contextMenu of [false, true]) for (const activeComposition of [false, true]) for (const history of [false, true]) {
    await evaluate(async ({ contextMenu, history }) => {
      await reset(term); term.focus(); writes.length = 0;
      if (history) {
        await outputTo(term, Array.from({ length: 40 }, (_, i) => `paste-history-${i}\r\n`).join(''));
        term.scrollToTop();
      }
      window.pasteEvents = [];
      window.recordPasteEvent = event => { if (event.target === term.textarea) pasteEvents.push({ type: event.type, data: event.data, inputType: event.inputType, isComposing: event.isComposing }); };
      for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) {
        document.addEventListener(type, recordPasteEvent, true);
      }
      if (contextMenu) {
        const canvas = term.renderer.getCanvas(), bounds = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: bounds.left + 30, clientY: bounds.top + 20 }));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }, { contextMenu, history });
    if (activeComposition) await debuggerSession.sendCommand('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
    await evaluate(() => {
      const data = new DataTransfer(); data.setData('text/plain', '붙여넣은 본문\n');
      term.textarea.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    const input = await evaluate(() => {
      const rect = term.textarea.getBoundingClientRect();
      const screen = term.renderer.getCanvas().getBoundingClientRect();
      return { width: rect.width, height: rect.height, position: term.textarea.style.position,
        zIndex: term.textarea.style.zIndex, focused: document.activeElement === term.textarea,
        insideViewport: rect.left >= screen.left - 1 && rect.right <= screen.right + 1 && rect.top >= screen.top - 1 && rect.bottom <= screen.bottom + 1 };
    });
    await debuggerSession.sendCommand('Input.imeSetComposition', { text: 'ㅇ', selectionStart: 1, selectionEnd: 1 });
    await debuggerSession.sendCommand('Input.imeSetComposition', { text: '이', selectionStart: 1, selectionEnd: 1 });
    await debuggerSession.sendCommand('Input.insertText', { text: '이게 한글 입력' });
    const result = await evaluate(async () => {
      await delay();
      for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) document.removeEventListener(type, recordPasteEvent, true);
      return { text: writes.join(''), events: pasteEvents };
    });
    results.push({ contextMenu, activeComposition, history, input, ...result });
    assert(input.focused && input.insideViewport && input.width > 0 && input.height > 0 && input.position === 'absolute' && Number(input.zIndex || 0) >= 0,
      `Paste must restore a usable native input anchor before typing: ${JSON.stringify({ contextMenu, activeComposition, history, input })}`);
    assert.equal(result.text, (activeComposition ? '한' : '') + '붙여넣은 본문\r이게 한글 입력');
  }
  const nativeReplacement = await evaluate(async () => {
    await reset(term); term.focus(); writes.length = 0; term.paste('본문');
    term.textarea.value = '한글';
    term.textarea.dispatchEvent(new InputEvent('input', { data: '한글', inputType: 'insertReplacementText', bubbles: true }));
    await delay(); return writes.join('');
  });
  assert.equal(nativeReplacement, '본문한글', 'Native replacement commits after paste must not be silently discarded');
  const shortcutResults = [];
  for (const modifier of ['metaKey', 'ctrlKey']) {
    await evaluate(async () => {
      await reset(term); term.focus(); writes.length = 0;
      window.clipboardReads = 0;
      window.originalClipboardRead = Object.getOwnPropertyDescriptor(navigator.clipboard, 'readText');
      Object.defineProperty(navigator.clipboard, 'readText', { configurable: true, value: async () => { clipboardReads++; return '단축키 붙여넣기'; } });
    });
    try {
      await debuggerSession.sendCommand('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
      const shortcut = await evaluate(async modifier => {
        const event = new KeyboardEvent('keydown', { key: 'Process', code: 'KeyV', keyCode: 229, isComposing: true, [modifier]: true, bubbles: true, cancelable: true });
        term.textarea.dispatchEvent(event);
        await delay(); return { prevented: event.defaultPrevented, reads: clipboardReads, text: writes.join('') };
      }, modifier);
      shortcutResults.push({ modifier, ...shortcut });
      assert.deepEqual(shortcut, { prevented: true, reads: 1, text: '한단축키 붙여넣기' }, 'Paste shortcut must run once even when the native IME reports Process/229: ' + JSON.stringify(shortcutResults));
      await debuggerSession.sendCommand('Input.imeSetComposition', { text: '글', selectionStart: 1, selectionEnd: 1 });
      await debuggerSession.sendCommand('Input.insertText', { text: '글' });
      const finalText = await evaluate(async () => { await delay(); return writes.join(''); });
      assert.equal(finalText, '한단축키 붙여넣기글');
    } finally {
      await evaluate(() => { if (originalClipboardRead) Object.defineProperty(navigator.clipboard, 'readText', originalClipboardRead); else delete navigator.clipboard.readText; });
    }
  }
  const switched = await evaluate(async () => {
    await reset(term); term.focus(); writes.length = 0;
    const previous = Object.getOwnPropertyDescriptor(navigator.clipboard, 'readText');
    const otherInput = document.createElement('textarea'); document.body.appendChild(otherInput);
    let resolvePaste;
    Object.defineProperty(navigator.clipboard, 'readText', { configurable: true, value: () => new Promise(resolve => { resolvePaste = resolve; }) });
    try {
      term.textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', metaKey: true, bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!resolvePaste) throw Error('Clipboard request never started');
      otherInput.focus(); resolvePaste('늦게 도착한 본문'); await delay();
      return { text: writes.join(''), focusPreserved: document.activeElement === otherInput };
    } finally {
      if (previous) Object.defineProperty(navigator.clipboard, 'readText', previous); else delete navigator.clipboard.readText;
      otherInput.remove(); term.focus();
    }
  });
  assert.deepEqual(switched, { text: '', focusPreserved: true }, 'A late clipboard response must not take input ownership back from another pane');
  results.push({ shortcutResults, switched, nativeReplacement });
  return results;
};
