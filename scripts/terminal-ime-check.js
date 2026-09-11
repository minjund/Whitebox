'use strict';

// Real Chromium/xterm DOM and CDP composition tests, with the app's input queue
// captured at terminalWrite. This is not a native Windows IME keyboard test.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-ime-'));
const output = path.join(root, 'artifacts', 'terminal-ime');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const checks = [];
const deadline = setTimeout(() => { process.stderr.write('FAIL: IME test timed out\n'); app.exit(1); }, 60_000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1000, height: 640, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
  try {
    const files = ['node_modules/@xterm/xterm/lib/xterm.js', 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
      'renderer/terminal-ime.js', 'renderer/terminal-workbench.js', 'renderer/terminal-events.js'];
    const html = path.join(profile, 'fixture.html');
    fs.writeFileSync(html, '<!doctype html><meta charset="utf-8">'
      + `<link rel="stylesheet" href="${pathToFileURL(path.join(root, 'node_modules/@xterm/xterm/css/xterm.css')).href}">`
      + '<style>body{background:#202126;color:#fff;font:15px sans-serif;margin:24px}.terminal-screen,#baseline{width:900px;height:225px}.xterm{padding:8px}.xterm-screen{background:#112233}</style>'
      + '<p>Default xterm</p><div id="baseline"></div><p>Whitebox IME overlay</p><div id="terminalRuntimeMount"></div>'
      + files.map(file => `<script src="${pathToFileURL(path.join(root, file)).href}"></script>`).join(''));
    await win.loadFile(html);
    await evaluate(async () => {
      window.writes = []; window.baselineWrites = []; window.errors = [];
      window.WhiteboxI18n = { t: key => key };
      window.WhiteboxRendererUtils = { reportRecoverableError: (label, error) => errors.push(label + ': ' + error.message) };
      window.whitebox = {
        terminalGet: async () => ({ replay: '', status: 'running' }),
        terminalResize: async () => {},
        terminalWrite: async (_id, data) => { writes.push(data); return { deliveryState: 'accepted' }; },
        onTerminalData: handler => { window.receiveOutput = handler; },
        onTerminalState() {}, onTerminalError() {},
      };
      const session = { id: 'ime-test', type: 'agent', provider: 'codex', status: 'running' };
      window.testState = { sessions: [session], terminals: new Map(), selectedId: session.id, platform: { id: 'win32' } };
      const options = { cols: 80, rows: 10, screenReaderMode: true, cursorStyle: 'bar',
        fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "D2Coding", monospace',
        fontSize: 15, lineHeight: 1.28, theme: { background: '#112233', foreground: '#ddeeff', cursor: '#ffcc00' } };
      const workbench = WhiteboxTerminalWorkbench({
        $: selector => document.querySelector(selector), state: testState,
        notice: message => errors.push(message), xtermOptions: () => options,
      });
      window.entry = await workbench.ensureSessionTerminal(session);
      WhiteboxTerminalEvents({ state: testState, currentSession: () => session,
        fitEntry() {}, refreshSessions() {}, notice: message => errors.push(message) });
      window.term = entry.terminal;
      window.baseline = new Terminal(options);
      baseline.open(document.querySelector('#baseline'));
      baseline.onData(data => baselineWrites.push(data));
      window.delay = () => new Promise(resolve => setTimeout(resolve, 60));
      window.outputTo = (target, data) => new Promise(resolve => target.write(data, resolve));
      window.composition = (target, type, data = '') => target.textarea.dispatchEvent(
        new CompositionEvent(type, { data, bubbles: true }));
      window.start = target => { target.focus(); composition(target, 'compositionstart'); };
      window.update = (target, data, value = data) => {
        target.textarea.value = value;
        target.textarea.setSelectionRange(value.length, value.length);
        composition(target, 'compositionupdate', data);
      };
      window.end = (target, data) => composition(target, 'compositionend', data);
      window.reset = async target => {
        target.reset(); target.textarea.value = '';
        await outputTo(target, '\x1b[2J\x1b[H');
        await delay();
      };
      window.snapshot = () => {
        const overlay = term.element.querySelector('.whitebox-ime-view');
        const preedit = overlay.querySelector('.whitebox-ime-preedit');
        const tail = overlay.querySelector('.whitebox-ime-tail');
        const screen = term.element.querySelector('.xterm-screen');
        const bounds = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
        return { visible: overlay.style.display !== 'none', text: preedit.textContent, tail: tail.textContent,
          overlay: bounds(overlay), preedit: bounds(preedit), tailBounds: bounds(tail), screen: bounds(screen),
          input: bounds(term.textarea), color: getComputedStyle(overlay).color, background: getComputedStyle(overlay).backgroundColor,
          tailDisplay: tail.style.display, nativeVisibility: getComputedStyle(term.element.querySelector('.composition-view')).visibility,
          buffer: term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY).translateToString(true) };
      };
      await delay();
    });

    const midline = await evaluate(async () => {
      for (const target of [baseline, term]) {
        await reset(target);
        await outputTo(target, '가다  END\x1b[3G');
        start(target); update(target, '나'); await delay();
      }
      return snapshot();
    });
    assert.equal(midline.text, '나');
    assert.equal(midline.visible, true);
    assert(midline.tail.startsWith('다  END'));
    assert(midline.tailBounds.left >= midline.preedit.right - 1, 'Existing row overlaps preedit');
    assert.equal(midline.buffer, '가다  END', 'Uncommitted input mutated terminal buffer');
    assert.equal(midline.background, 'rgb(17, 34, 51)');
    assert.equal(midline.nativeVisibility, 'hidden');
    assert.deepEqual(await evaluate(() => writes), []);
    await new Promise(resolve => setTimeout(resolve, 100));
    fs.writeFileSync(path.join(output, 'midline.png'), (await win.webContents.capturePage()).toPNG());
    checks.push('midline preedit preserves CJK tail/spaces, theme and buffer; no uncommitted bytes');

    const emptyUpdate = await evaluate(async () => {
      composition(term, 'compositionupdate', ''); await delay();
      const hidden = !snapshot().visible;
      update(term, '나'); await delay();
      return { hidden, resumed: snapshot().visible, writes };
    });
    assert.equal(emptyUpdate.hidden, true);
    assert.equal(emptyUpdate.resumed, true);
    assert.deepEqual(emptyUpdate.writes, []);
    checks.push('empty preedit hides immediately and later update resumes without sending input');

    const repaint = await evaluate(async () => {
      await outputTo(term, '\x1b[s\x1b[3G뒤  NEW\x1b[u');
      term.refresh(0, term.rows - 1);
      await delay(); return snapshot();
    });
    assert.equal(repaint.visible, true);
    assert(repaint.tail.startsWith('뒤  NEW'));
    checks.push('TUI output and full refresh update the visible tail while composing');

    const colored = await evaluate(async () => {
      await outputTo(term, '\x1b[s\x1b[3G\x1b[38;2;12;34;56m色\x1b[0m\x1b[u');
      await delay();
      const span = term.element.querySelector('.whitebox-ime-tail span');
      return { text: span.textContent, color: getComputedStyle(span).color };
    });
    assert.deepEqual(colored, { text: '色', color: 'rgb(12, 34, 56)' });
    checks.push('repaint preserves existing CJK cell color');

    const edge = await evaluate(async () => {
      end(term, '나'); await delay(); await reset(term);
      await outputTo(term, '\x1b[80G'); start(term); update(term, '한');
      await delay(); return snapshot();
    });
    assert(edge.input.right <= edge.screen.right + 1, 'IME candidate anchor escapes right edge');
    assert(edge.overlay.right <= edge.screen.right + 1);
    assert(edge.preedit.left >= edge.overlay.left - 1, 'Half of the final syllable is clipped');
    assert.equal(edge.tailDisplay, 'none');
    const narrow = await evaluate(async () => {
      term.resize(12, 10); await delay(); return snapshot();
    });
    assert(narrow.input.right <= narrow.screen.right + 1);
    checks.push('right-edge composition and resize keep candidate anchor inside terminal');

    const commits = await evaluate(async () => {
      end(term, '한'); end(baseline, '나'); await delay();
      term.resize(80, 10);
      for (const target of [baseline, term]) {
        await reset(target);
        if (target === baseline) baselineWrites.length = 0; else writes.length = 0;
        let value = '';
        for (const syllable of ['가', '나', '다', '라']) {
          start(target); value += syllable; update(target, syllable, value);
          await delay(); end(target, syllable);
          // The next composition starts before the previous zero-delay commit.
        }
        await delay();
      }
      return { baseline: baselineWrites.join(''), patched: writes.join(''), visible: snapshot().visible };
    });
    assert.equal(commits.baseline, '가나다라');
    assert.equal(commits.patched, commits.baseline);
    assert.equal(commits.visible, false);
    checks.push('rapid adjacent Hangul composition commits exactly 가나다라, same as stock xterm');

    // A busy renderer can deliver several syllables and Enter before xterm's
    // zero-delay composition timers run. Do not yield between these events.
    const burst = await evaluate(async () => {
      const result = {};
      for (const target of [baseline, term]) {
        await reset(target);
        const captured = target === baseline ? baselineWrites : writes;
        captured.length = 0;
        let value = '';
        for (const syllable of ['알', '겠', '습', '니', '다']) {
          start(target);
          value += syllable;
          update(target, syllable, value);
          end(target, syllable);
        }
        target.textarea.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
        }));
        target.textarea.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Enter', keyCode: 13, which: 13, bubbles: true,
        }));
        await delay();
        result[target === baseline ? 'baseline' : 'patched'] = captured.join('');
      }
      return result;
    });
    assert.equal(burst.patched, '알겠습니다\r', JSON.stringify(burst));
    checks.push('back-to-back Hangul commits followed immediately by Enter preserve every syllable exactly once');

    const transitions = await evaluate(async () => {
      await reset(term); writes.length = 0;
      start(term); update(term, '각');
      // Browser composition events precede the final textarea mutation. An
      // ending consonant moves to the following syllable: trust the value at
      // the next start, not the stale compositionend payload.
      end(term, '각'); term.textarea.value = '가';
      start(term); update(term, '나', '가나');
      await delay();
      const duringNext = writes.join('');
      end(term, '나');
      start(term); update(term, '취소', '가나취소');
      update(term, '', '가나'); end(term, '');
      await delay();
      const afterCancel = writes.join('');

      await reset(term); writes.length = 0;
      start(term); update(term, '한'); end(term, '한');
      term.textarea.value = '한2';
      await delay();
      const trailingDigit = writes.join('');

      await reset(term); writes.length = 0;
      start(term); update(term, '한'); update(term, '하');
      term.textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
      end(term, '하');
      await delay();
      const immediateEnter = writes.join('');

      await reset(term); writes.length = 0;
      start(term); update(term, '글'); end(term, '글'); term.blur();
      await delay();
      const blurCommit = writes.join('');
      return { duringNext, afterCancel, trailingDigit, immediateEnter, blurCommit };
    });
    assert.deepEqual(transitions, {
      duringNext: '가', afterCancel: '가나', trailingDigit: '한2', immediateEnter: '하\r', blurCommit: '글',
    });
    checks.push('받침 transfer uses corrected textarea text and never sends the next uncommitted syllable');
    checks.push('cancellation, trailing digit, preedit deletion, immediate Enter and blur preserve exact input');

    const midlineBurst = await evaluate(async () => {
      await reset(term); writes.length = 0;
      term.textarea.value = '가다😀끝';
      term.textarea.setSelectionRange(1, 2);
      start(term); update(term, '각', '가각😀끝');
      end(term, '각');
      // Replace the selection, then move 받침 into the next syllable before
      // any commit timer runs. The unchanged suffix contains a surrogate pair.
      term.textarea.value = '가가😀끝';
      term.textarea.setSelectionRange(2, 2);
      start(term); update(term, '나', '가가나😀끝');
      term.textarea.setSelectionRange(3, 3);
      term.textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
      end(term, '나');
      await delay();
      return { writes: writes.join(''), visible: snapshot().visible };
    });
    assert.deepEqual(midlineBurst, { writes: '가나\r', visible: false });
    checks.push('midline replacement, rapid 받침 transfer and immediate Enter exclude the existing Unicode suffix');

    // Chromium generates the browser composition events here. This exercises
    // xterm + the workbench input queue without hand-editing the helper value.
    await evaluate(async () => { await reset(term); writes.length = 0; term.focus(); });
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
    const composing = await evaluate(async () => { await delay(); return { state: snapshot(), writes }; });
    assert.equal(composing.state.text, '한');
    assert.equal(composing.state.visible, true);
    assert.deepEqual(composing.writes, []);
    await win.webContents.debugger.sendCommand('Input.insertText', { text: '한' });
    const cdp = await evaluate(async () => { await delay(); return { writes, visible: snapshot().visible }; });
    assert.equal(cdp.writes.join(''), '한');
    assert.equal(cdp.visible, false);
    await evaluate(async () => { await reset(term); writes.length = 0; term.focus(); });
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '취소', selectionStart: 2, selectionEnd: 2 });
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    const cancelled = await evaluate(async () => { await delay(); return { writes, visible: snapshot().visible }; });
    assert.deepEqual(cancelled.writes, []);
    assert.equal(cancelled.visible, false);

    const cdpKey = async (key, code) => {
      for (const type of ['keyDown', 'keyUp']) {
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type, key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
        });
      }
    };
    const cdpCommit = async text => {
      await win.webContents.debugger.sendCommand('Input.imeSetComposition', {
        text, selectionStart: text.length, selectionEnd: text.length,
      });
      await win.webContents.debugger.sendCommand('Input.insertText', { text });
      await evaluate(async () => { await delay(); });
    };
    const cdpMidline = [];
    for (const scenario of [
      { text: '가다끝', leftCount: 1, caret: 2 },
      { text: '가다끝', leftCount: 2, caret: 1 },
      { text: '가다끝', leftCount: 3, caret: 0 },
      { text: '가다😀끝', leftCount: 2, caret: 2 },
    ]) {
      const { text, leftCount, caret } = scenario;
      await evaluate(async () => { await reset(term); writes.length = 0; term.focus(); });
      await cdpCommit(text);
      for (let i = 0; i < leftCount; i += 1) await cdpKey('ArrowLeft', 37);
      const before = await evaluate(async (text, leftCount) => {
        await delay();
        // Model the TUI echo and cursor position after its left-arrow input.
        await outputTo(term, text + '\x1b[2D'.repeat(leftCount));
        return { value: term.textarea.value, caret: term.textarea.selectionStart, writes: writes.join('') };
      }, text, leftCount);
      assert.deepEqual(before, { value: text, caret, writes: text + '\x1b[D'.repeat(leftCount) });
      await cdpCommit('나');
      const after = await evaluate(() => ({ value: term.textarea.value, writes: writes.join(''), visible: snapshot().visible }));
      assert.equal(after.value, text.slice(0, caret) + '나' + text.slice(caret));
      assert.equal(after.writes, before.writes + '나', 'Midline IME must send the new syllable, not the old final syllable');
      assert.equal(after.visible, false);
      await cdpCommit('라');
      await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '취소', selectionStart: 2, selectionEnd: 2 });
      await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
      const resumed = await evaluate(async () => { await delay(); return { value: term.textarea.value, writes: writes.join('') }; });
      assert.equal(resumed.value, text.slice(0, caret) + '나라' + text.slice(caret));
      assert.equal(resumed.writes, before.writes + '나라', 'Repeated midline input and cancellation must not resend the suffix');
      cdpMidline.push({ scenario, before, after, resumed });
    }
    checks.push('Chromium arrow navigation, repeated Korean insertion and cancellation preserve CJK/emoji suffixes at midline and line start');
    win.webContents.debugger.detach();
    checks.push('Chromium CDP ㅎ→한 composition emits no preedit and exactly one 한 commit through terminalWrite');
    checks.push('Chromium composition cancellation emits no text and clears overlay');

    const enter = await evaluate(async () => {
      await reset(term); writes.length = 0;
      start(term); update(term, '한'); await delay(); end(term, '한'); await delay();
      term.textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      term.textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      await delay(); return writes.join('');
    });
    assert.equal(enter, '한\r');
    checks.push('committed Korean followed by Enter reaches terminalWrite in order, exactly once');

    const outputBurst = await evaluate(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (const target of [baseline, term]) {
        await reset(target);
        // A real full-screen TUI initializes xterm's visible cursor this way.
        await outputTo(target, '\x1b[?1049h\x1b[5;4H\x1b[?25h');
      }
      await delay();
      const positions = { baseline: [], patched: [] };
      const subscriptions = [baseline, term].map((target, index) => target.onRender(() => {
        if (target.element.querySelector('.xterm-cursor')) {
          positions[index ? 'patched' : 'baseline'].push([target.buffer.active.cursorX, target.buffer.active.cursorY]);
        }
      }));
      writes.length = 0;
      start(term); update(term, '한');
      for (let index = 0; index < 6; index += 1) {
        // Codex/ConPTY can close the synchronized frame at a drawing cursor,
        // then restore the input cursor in another fragment ~16ms later.
        const draw = `\x1b[?2026h\x1b[?25l\x1b[2;20Hframe ${index}\x1b[?25h\x1b[0 q\x1b[?2026l`;
        baseline.write(draw); receiveOutput({ id: entry.host.dataset.terminalScreen, data: draw });
        await wait(index === 3 ? 216 : 16);
        const restore = '\x1b[?25l\x1b[2;20Hdrawn  \x1b[5;4H\x1b[?25h';
        baseline.write(restore); receiveOutput({ id: entry.host.dataset.terminalScreen, data: restore });
        await wait(80);
      }
      const preedit = snapshot();
      end(term, '한'); await delay();
      subscriptions.forEach(subscription => subscription.dispose());
      return { positions, preeditVisible: preedit.visible, input: writes.join(''),
        baselineLine: baseline.buffer.active.getLine(1).translateToString(true),
        patchedLine: term.buffer.active.getLine(1).translateToString(true) };
    });
    assert(outputBurst.positions.baseline.some(([x, y]) => x !== 3 || y !== 4), 'Control did not reproduce the transient drawing cursor');
    assert(outputBurst.positions.patched.length > 0, 'Patched terminal did not paint a visible cursor');
    assert(outputBurst.positions.patched.every(([x, y]) => x === 3 && y === 4), 'A drawing cursor was painted before the delayed input-cursor restore');
    assert.equal(outputBurst.patchedLine, outputBurst.baselineLine);
    assert.equal(outputBurst.preeditVisible, true);
    assert.equal(outputBurst.input, '한');
    checks.push('Windows Codex redraw and delayed cursor restore paint together while Korean composition commits exactly once');

    const lifecycle = await evaluate(async () => {
      await reset(term); start(term); update(term, '가'); await delay();
      term.blur(); await delay(); const blurred = snapshot().visible;
      end(term, '가'); await delay();
      term.focus(); start(term); update(term, '나');
      const native = term.element.querySelector('.composition-view');
      term.dispose(); await delay();
      return { blurred, overlays: document.querySelectorAll('.whitebox-ime-view').length, nativeVisibility: native.style.visibility, errors };
    });
    assert.equal(lifecycle.blurred, false);
    assert.equal(lifecycle.overlays, 0);
    assert.equal(lifecycle.nativeVisibility, '');
    assert.deepEqual(lifecycle.errors, []);
    checks.push('blur hides preedit; disposal removes overlay, subscriptions and pending refresh');
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, midline, edge, commits, burst, transitions, midlineBurst, cdp, cdpMidline, outputBurst, nativeWindowsImeTested: false }, null, 2));
    checks.forEach(check => process.stdout.write(`PASS: ${check}\n`));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    throw error;
  } finally {
    win.destroy(); clearTimeout(deadline);
  }
}).then(() => app.exit(0)).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });

app.on('quit', () => {
  if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('whitebox-ime-')) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
});
