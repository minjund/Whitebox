'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const workspace = path.resolve(__dirname, '..');
const root = process.env.WHITEBOX_GHOSTTY_APP_ROOT || workspace;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-ghostty-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.on('quit', () => {
  if (path.dirname(path.resolve(profile)) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('whitebox-ghostty-')) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
});

app.whenReady().then(async () => {
  let win;
  let pty;
  const deadline = setTimeout(() => { console.error('Ghostty check timed out'); app.exit(1); }, 60_000);
  try {
    win = new BrowserWindow({ width: 1000, height: 600, show: false,
      webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    win.webContents.on('console-message', event => {
      if (event.level === 'error') errors.push(event.message);
    });
    const csp = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8').match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
    const files = ['renderer/terminal-engine.js',
      'renderer/terminal-ime.js', 'renderer/terminal-workbench.js', 'renderer/terminal-events.js'];
    const html = path.join(profile, 'fixture.html');
    const url = file => pathToFileURL(path.join(root, file)).href;
    fs.writeFileSync(html, '<!doctype html><meta charset="utf-8">' + csp
      + `<link rel="stylesheet" href="${url('renderer/styles-terminal-engine.css')}">`
      + '<div id="terminalRuntimeMount" style="height:450px;width:920px"></div>'
      + files.map(file => `<script src="${url(file)}"></script>`).join(''));
    await win.loadFile(html);
    const evaluate = async (fn, ...args) => {
      const result = await win.webContents.executeJavaScript(`(async () => { try { return { value: await (${fn})(...${JSON.stringify(args)}) }; } catch (error) { return { error: error.stack }; } })()`, true);
      if (result.error) throw new Error(result.error);
      return result.value;
    };
    const engine = await evaluate(async () => {
      window.writes = [];
      window.WhiteboxI18n = { t: key => key };
      window.WhiteboxRendererUtils = { reportRecoverableError: (_label, error) => { throw error; } };
      window.whitebox = { terminalGet: async () => ({ replay: '', outputSequence: 0 }), terminalResize: async () => {},
        terminalWrite: async (_id, data) => { writes.push(data); return { deliveryState: 'accepted' }; } };
      window.testState = { terminals: new Map(), sessions: [], selectedId: 'test', platform: { id: 'win32' } };
      window.workbench = WhiteboxTerminalWorkbench({ $: selector => document.querySelector(selector), state: testState,
        notice: error => { throw new Error(error); }, xtermOptions: () => ({ cols: 80, rows: 20, scrollback: 200,
          fontFamily: 'Consolas, monospace', fontSize: 15, theme: { background: '#112233', foreground: '#ddeeff', cursor: '#ffcc00' } }) });
      window.entry = await workbench.ensureSessionTerminal({ id: 'test', type: 'agent', provider: 'codex' });
      window.term = entry.terminal;
      window.write = data => new Promise(resolve => term.write(data, resolve));
      window.delay = () => new Promise(resolve => setTimeout(resolve, 60));
      window.contents = () => Array.from({ length: term.buffer.active.length }, (_, y) => term.buffer.active.getLine(y)?.translateToString(true) || '').join('\n');
      return { name: WhiteboxTerminalEngine.name, wasm: Boolean(term.wasmTerm), canvas: Boolean(term.renderer.getCanvas()),
        xtermLoaded: typeof window.Terminal !== 'undefined' };
    });
    assert.deepEqual(engine, { name: 'ghostty', wasm: true, canvas: true, xtermLoaded: false });
    console.log('PASS: bundled Ghostty WASM loads under the production CSP with no xterm runtime');

    const vt = await evaluate(async () => {
      await write('한글😀 ABC\x1b[31m RED\x1b[0m');
      const unicode = contents();
      const before = term.buffer.active.getLine(0).getCell(0).getFgColor();
      term.options.theme = { background: '#f3f0ea', foreground: '#26221f', cursor: '#6254d9' };
      await write('\r\nTHEME');
      const color = term.buffer.active.getLine(1).getCell(0).getFgColor();
      await write('\x1b[?1049hALT');
      const alternate = term.buffer.active.type;
      await write('\x1b[?1049l');
      await write('\x1b[6n');
      await delay();
      return { unicode, before, color, alternate, normal: term.buffer.active.type, restored: contents(), responses: writes.join('') };
    });
    assert.match(vt.unicode, /한글😀 ABC RED/);
    assert.equal(vt.color, 0x26221f);
    assert.equal(vt.alternate, 'alternate');
    assert.equal(vt.normal, 'normal');
    assert.match(vt.restored, /한글😀 ABC RED/);
    assert.match(vt.responses, /\x1b\[\d+;\d+R/);
    console.log('PASS: Unicode, ANSI, theme changes, alternate screen and terminal replies');

    const scroll = await evaluate(async () => {
      term.reset();
      await write(Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\r\n'));
      const base = term.buffer.active.baseY;
      term.scrollToLine(12);
      const anchor = term.buffer.active.viewportY;
      await write('\r\nnew-output');
      const retained = term.buffer.active.viewportY;
      term.scrollToBottom();
      term.selectAll();
      const selected = term.getSelection();
      term.reset();
      await write('after-reset');
      term.selectAll();
      return { base, anchor, retained, selected, reset: term.getSelection(), resetBase: term.buffer.active.baseY };
    });
    assert(scroll.base > 50);
    assert.equal(scroll.anchor, 12);
    assert.equal(scroll.retained, 12);
    assert.match(scroll.selected, /line-0/);
    assert.match(scroll.reset, /after-reset/);
    assert.doesNotMatch(scroll.reset, /line-99/);
    assert.equal(scroll.resetBase, 0);
    console.log('PASS: scrollback retention, selection and reset without stale WASM references');

    const selection = await evaluate(async () => {
      term.reset(); await write('한글 😀  \r\n   \r\nnext');
      term.selectLines(0, 2);
      const forward = term.getSelection();
      const native = term.backend.selectionManager.getSelection();
      term.setSelection({ col: 3, absoluteRow: 2 }, { col: 0, absoluteRow: 0 });
      const reverse = term.getSelection();
      term.select(4, 0, 4);
      const partial = term.getSelection();
      term.clearSelection();
      return { forward, native, reverse, partial, cleared: term.getSelection() };
    });
    assert.deepEqual(selection, { forward: '한글 😀  \n   \nnext', native: '한글 😀  \n   \nnext',
      reverse: '한글 😀  \n   \nnext', partial: ' 😀 ', cleared: '' });
    console.log('PASS: forward, reverse, partial and native selection preserve printed spaces, blank lines and wide Unicode');

    const ime = await evaluate(async () => {
      term.reset(); term.clearSelection(); term.focus(); writes.length = 0;
      const compose = (type, data) => term.textarea.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }));
      term.textarea.value = '';
      compose('compositionstart', '');
      term.textarea.value = '한'; compose('compositionupdate', '한');
      const preeditSent = writes.join('');
      const visible = term.element.querySelector('.whitebox-ime-view').style.display !== 'none';
      compose('compositionend', '한');
      term.textarea.dispatchEvent(new InputEvent('input', { data: '한', inputType: 'insertText', bubbles: true }));
      await delay();
      const committed = writes.join('');
      term.textarea.value = ''; writes.length = 0;
      compose('compositionstart', '');
      term.textarea.value = '취소'; compose('compositionupdate', '취소');
      term.textarea.value = ''; compose('compositionend', '');
      await delay();
      return { preeditSent, visible, committed, cancelled: writes.join(''), focused: document.activeElement === term.textarea };
    });
    assert.deepEqual(ime, { preeditSent: '', visible: true, committed: '한', cancelled: '', focused: true });
    console.log('PASS: Korean preedit, exactly-once commit, cancellation and textarea focus');

    const hidden = await evaluate(async () => {
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 0;
      try {
        await write('\r\nhidden-output');
        return contents().includes('hidden-output');
      } finally { window.requestAnimationFrame = raf; }
    });
    assert.equal(hidden, true);
    assert.deepEqual(errors, []);
    console.log('PASS: write completion does not depend on animation frames');
    const disposed = await evaluate(async () => {
      const host = document.createElement('div'); document.body.appendChild(host);
      const temporary = new WhiteboxTerminalEngine.Terminal(); temporary.open(host);
      const completion = new Promise(resolve => temporary.write('accepted', () => temporary.write('late replay chunk', resolve)));
      temporary.dispose();
      await completion;
      const cleaned = host.children.length === 0;
      host.remove();
      return cleaned;
    });
    assert.equal(disposed, true);
    console.log('PASS: disposal releases the surface and completes in-flight replay callbacks');

    const keyboard = await evaluate(async () => {
      term.reset(); writes.length = 0;
      const key = (key, code, modifiers = {}) => term.textarea.dispatchEvent(new KeyboardEvent('keydown',
        { key, code, bubbles: true, cancelable: true, ...modifiers }));
      key('a', 'KeyA'); key('Tab', 'Tab', { shiftKey: true }); key('c', 'KeyC', { ctrlKey: true });
      await delay();
      return writes.splice(0).join('');
    });
    assert.equal(keyboard, 'a\x1b[Z\x03');
    const mouse = await evaluate(async () => {
      await write('\x1b[?1000h\x1b[?1006h');
      writes.length = 0;
      const canvas = term.renderer.getCanvas();
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, clientX: rect.left + 12,
        clientY: rect.top + 12, bubbles: true, cancelable: true }));
      await delay();
      const result = writes.splice(0).join('');
      await write('\x1b[?1000l\x1b[?1006l');
      return result;
    });
    assert.match(mouse, /\x1b\[<64;\d+;\d+M/);
    console.log('PASS: native key encoding, Shift+Tab, Ctrl+C and SGR mouse wheel');

    await evaluate(async () => { term.reset(); await write(''); writes.length = 0; });
    const nodePty = require(path.join(root, 'node_modules/node-pty'));
    pty = nodePty.spawn(process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
      process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : [],
      { cols: 80, rows: 20, cwd: profile, env: { ...process.env }, useConpty: process.platform === 'win32' });
    let outputQueue = Promise.resolve();
    const outputSubscription = pty.onData(data => {
      outputQueue = outputQueue.then(() => evaluate(async value => { await write(value); }, data));
    });
    const ptyExit = new Promise(resolve => pty.onExit(resolve));
    const command = process.platform === 'win32'
      ? "[Console]::WriteLine(('WHITEBOX_'+'GHOSTTY_'+(6*7)))"
      : "printf 'WHITEBOX_%s_%s\\n' GHOSTTY 42";
    const input = await evaluate(async command => {
      term.paste(command);
      term.input('\r', true);
      await delay();
      return writes.splice(0).join('');
    }, command);
    pty.write(input);
    const until = Date.now() + 15000;
    let executed = false;
    while (Date.now() < until) {
      await outputQueue;
      if (await evaluate(() => contents().includes('WHITEBOX_GHOSTTY_42'))) { executed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(executed, 'The real shell did not produce the computed marker through Ghostty');
    pty.resize(94, 26);
    await evaluate(async () => { term.resize(94, 26); await delay(); });
    pty.write('exit\r');
    await Promise.race([ptyExit, new Promise((_, reject) => setTimeout(() => reject(new Error('PTY exit timed out')), 5000))]);
    outputSubscription.dispose();
    await outputQueue;
    pty = null;
    assert.deepEqual(errors, []);
    console.log(`PASS: real ${process.platform === 'win32' ? 'Windows PowerShell/ConPTY' : 'POSIX PTY'} input, computed output, resize and confirmed exit`);
    const output = path.join(workspace, 'artifacts', 'ghostty-terminal');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'terminal.png'), (await win.webContents.capturePage()).toPNG());
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    pty?.kill();
    win?.destroy();
    app.exit(process.exitCode || 0);
  }
});
