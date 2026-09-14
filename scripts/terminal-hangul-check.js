'use strict';

// Real Ghostty rendering, Chromium composition and Windows ConPTY checks.
// No OS clipboard or physical keyboard/IME automation is involved.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const workspace = path.resolve(__dirname, '..');
const root = process.env.WHITEBOX_GHOSTTY_APP_ROOT || workspace;
const variant = process.env.WHITEBOX_GHOSTTY_APP_ROOT ? 'packaged' : 'source';
const output = path.join(workspace, 'artifacts', 'terminal-hangul', variant);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-hangul-'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.on('quit', () => {
  if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('whitebox-hangul-')) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
});

const checks = [];
const findings = [];
const pass = description => { checks.push(description); console.log('PASS: ' + description); };
app.whenReady().then(async () => {
  let win;
  let pty;
  const deadline = setTimeout(() => { pty?.kill(); console.error('Hangul check timed out'); app.exit(1); }, 90_000);
  try {
    win = new BrowserWindow({ width: 1180, height: 760, show: false,
      webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const csp = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8').match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
    const url = file => pathToFileURL(path.join(root, file)).href;
    const html = path.join(profile, 'fixture.html');
    fs.writeFileSync(html, '<!doctype html><meta charset="utf-8">' + csp
      + `<link rel="stylesheet" href="${url('renderer/styles-terminal-engine.css')}">`
      + '<style>body{margin:24px;background:#161b22;color:#e6edf3;font:16px sans-serif}#terminalRuntimeMount{height:650px;width:1100px}</style>'
      + '<p id="case">Whitebox · 한글 표시 검증</p><div id="terminalRuntimeMount"></div>'
      + ['renderer/terminal-engine.js', 'renderer/terminal-ime.js', 'renderer/terminal-workbench.js'].map(file => `<script src="${url(file)}"></script>`).join(''));
    await win.loadFile(html);
    const evaluate = async (fn, ...args) => {
      const result = await win.webContents.executeJavaScript(`(async () => { try { return { value: await (${fn})(...${JSON.stringify(args)}) }; } catch (error) { return { error: error.stack }; } })()`, true);
      if (result.error) throw new Error(result.error);
      return result.value;
    };
    await evaluate(async () => {
      window.writes = [];
      window.WhiteboxI18n = { t: key => key };
      window.WhiteboxRendererUtils = { reportRecoverableError: (_label, error) => { throw error; } };
      window.whitebox = { terminalGet: async () => ({ replay: '', status: 'running' }), terminalResize: async () => {},
        terminalWrite: async (_id, data) => { writes.push(data); return { deliveryState: 'accepted' }; } };
      const state = { terminals: new Map(), sessions: [], selectedId: 'hangul', platform: { id: 'win32' } };
      const workbench = WhiteboxTerminalWorkbench({ $: selector => document.querySelector(selector), state,
        notice: error => { throw new Error(error); }, xtermOptions: () => ({ cols: 77, rows: 24, scrollback: 3000,
          fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "D2Coding", monospace', fontSize: 17,
          theme: { background: '#161b22', foreground: '#e6edf3', cursor: '#ffcc00' } }) });
      window.term = (await workbench.ensureSessionTerminal({ id: 'hangul', type: 'agent', provider: 'codex' })).terminal;
      window.write = data => new Promise(resolve => term.write(data, resolve));
      window.delay = () => new Promise(resolve => setTimeout(resolve, 50));
      // Preserve printed spaces, skip unused cells and wide-cell continuations.
      window.glyphs = () => {
        const buffer = term.buffer.active;
        let text = '';
        for (let row = 0; row < buffer.length; row += 1) {
          const line = buffer.getLine(row);
          for (let col = 0; col < term.cols; col += 1) text += line?.getCell(col)?.getChars() || '';
        }
        return text;
      };
    });

    const syllables = Array.from({ length: 11172 }, (_, index) => String.fromCodePoint(0xac00 + index)).join('');
    const exhaustive = await evaluate(async text => {
      term.reset(); await write(text);
      let invalidWidths = 0;
      const buffer = term.buffer.active;
      for (let row = 0; row <= buffer.baseY + buffer.cursorY; row += 1) {
        const line = buffer.getLine(row);
        for (let col = 0; col < term.cols; col += 1) {
          const cell = line.getCell(col);
          if (cell.getChars() && cell.getWidth() !== 2) invalidWidths += 1;
        }
      }
      return { text: glyphs(), invalidWidths, scrollback: buffer.baseY };
    }, syllables);
    assert.equal(exhaustive.text, syllables, 'A Hangul syllable was lost or changed');
    assert.equal(exhaustive.invalidWidths, 0);
    assert(exhaustive.scrollback > 200);
    pass('All 11,172 modern Hangul syllables survive odd-width wrapping and scrollback, each occupying two cells');

    const samples = [
      '가나다라마바사아자차카타파하',
      '값이 읽고 앉아 닭과 삶을 읊다 꽃잎 괜찮습니다 뾰족 꽉 뚫다',
      'ㄱㄲㄳㄴㄵㄶㄷㄸㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅃㅄㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ',
      '한글 각 값 꽃 뚫'.normalize('NFD'),
      '한글 ABC 123 😀 👩‍💻 e\u0301 C:\\작업\\한글 파일.txt 끝',
    ];
    for (const size of [1, 2, 3, 4, 7, 11]) {
      const text = samples.join(' | ');
      const actual = await evaluate(async (text, size) => {
        term.reset();
        const bytes = new TextEncoder().encode(text);
        for (let offset = 0; offset < bytes.length; offset += size) term.write(bytes.slice(offset, offset + size));
        await delay();
        return glyphs();
      }, text, size);
      assert.equal(actual, text, `UTF-8 ${size}-byte chunks corrupted text`);
    }
    pass('Six UTF-8 chunk sizes, including single bytes, preserve 받침/겹받침, compatibility jamo, NFD Hangul, emoji and mixed paths');

    const longText = '한글 줄바꿈 테스트 값이 정확히 보입니다 ABC123😀 '.repeat(60);
    const resized = await evaluate(async text => {
      term.reset(); await write(text);
      const states = [];
      for (const [cols, rows] of [[31, 18], [120, 30], [19, 12], [77, 24]]) {
        term.resize(cols, rows); await delay();
        states.push({ cols, rows, text: glyphs() });
      }
      term.selectAll();
      return { states, selected: term.getSelection().replace(/\r?\n/g, '') };
    }, longText);
    for (const state of resized.states) assert(state.text === longText,
      `Resize to ${state.cols}x${state.rows} changed text: expected=${longText.length}, actual=${state.text.length}, tail=${state.text.slice(-80)}`);
    pass('Long mixed Korean text survives four narrow/wide resizes without losing displayed text');
    if (resized.selected !== longText) {
      const finding = { case: 'full-scrollback selection', expectedLength: longText.length, actualLength: resized.selected.length,
        message: 'Selection drops printed spaces at visual line ends',
        nonWhitespacePreserved: resized.selected.replace(/\s/g, '') === longText.replace(/\s/g, '') };
      findings.push(finding);
      console.error('FAIL: ' + JSON.stringify(finding));
    } else pass('Full-scrollback selection preserves printed spaces');

    const redraw = await evaluate(async () => {
      term.reset();
      await write('가나다라마바사\r\n값이 정확합니다');
      await write('\x1b[1;3H\x1b[31m꽃\x1b[0m');
      const normal = term.buffer.active.getLine(0).translateToString(true);
      await write('\x1b[?1049h\x1b[H대체 화면 한글😀\x1b[?2026h\r\n조합 중 출력\x1b[?2026l');
      const alternate = glyphs();
      await write('\x1b[?1049l');
      return { normal, alternate, restored: term.buffer.active.getLine(0).translateToString(true) };
    });
    assert.equal(redraw.normal, '가꽃다라마바사');
    assert.equal(redraw.restored, redraw.normal);
    assert.equal(redraw.alternate, '대체 화면 한글😀조합 중 출력');
    pass('ANSI cursor overwrite, colored Hangul, synchronized TUI redraw and alternate-screen restoration preserve complete cells');

    for (const light of [false, true]) {
      await evaluate(async (light, samples) => {
        term.reset(); term.resize(90, 24);
        term.options.fontSize = light ? 19 : 17;
        term.options.theme = light ? { background: '#f8fafc', foreground: '#17202a', cursor: '#6254d9' }
          : { background: '#161b22', foreground: '#e6edf3', cursor: '#ffcc00' };
        document.querySelector('#case').textContent = `Whitebox Ghostty · 한글 표시 · ${light ? '밝은 테마 19px' : '어두운 테마 17px'}`;
        await write(['완성형 / 받침 / 자모 / 분해형 / 혼합 문자', ...samples,
          '오른쪽 경계: ' + '가나다라마바사아자차카타파하'.repeat(4),
          '\x1b[31m빨강 한글\x1b[0m  \x1b[32m초록 한글\x1b[0m  \x1b[34m파랑 한글\x1b[0m'].join('\r\n'));
        await delay();
      }, light, samples);
      fs.writeFileSync(path.join(output, light ? 'hangul-light.png' : 'hangul-dark.png'), (await win.webContents.capturePage()).toPNG());
    }
    pass('Captured actual Ghostty Canvas output at 17px/dark and 19px/light for visual inspection');

    if (process.platform === 'win32') {
      await evaluate(async () => { term.reset(); term.resize(90, 24); term.textarea.value = ''; writes.length = 0; term.focus(); });
      const expected = '한글 입력 값이 읽고 앉아 꽃잎 ABC123 😀 끝';
      const script = "$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::WriteLine('WB_READY'); $value=[Console]::ReadLine(); [Console]::WriteLine('WB_BEGIN'); [Console]::WriteLine($value); [Console]::WriteLine('WB_END')";
      const nodePty = require(path.join(root, 'node_modules/node-pty'));
      pty = nodePty.spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { cols: 90, rows: 24, cwd: profile, env: { ...process.env }, useConpty: true });
      let outputQueue = Promise.resolve();
      const subscription = pty.onData(data => { outputQueue = outputQueue.then(() => evaluate(async data => { await write(data); }, data)); });
      const exited = new Promise(resolve => pty.onExit(resolve));
      const waitFor = async marker => {
        const until = Date.now() + 15000;
        while (Date.now() < until) {
          await outputQueue;
          if ((await evaluate(() => glyphs())).includes(marker)) return;
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        throw new Error('PowerShell output did not contain ' + marker);
      };
      await waitFor('WB_READY');
      win.webContents.debugger.attach('1.3');
      // Focus/terminal capability replies are separate from user composition.
      await evaluate(async () => { term.focus(); await delay(); writes.length = 0; });
      for (const char of expected) {
        if (/[가-힣]/.test(char)) {
          await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: char, selectionStart: char.length, selectionEnd: char.length });
        }
        await win.webContents.debugger.sendCommand('Input.insertText', { text: char });
      }
      for (const type of ['keyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',
        { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      const input = await evaluate(async () => { await delay(); return writes.splice(0).join(''); });
      // ConPTY requests DEC focus reporting; the first CDP input may focus the
      // offscreen renderer. Keep those reports on the PTY wire, while checking
      // user text independently of the requested terminal protocol prefix.
      const userInput = input.replace(/^(?:\x1b\[[IO])+/, '');
      if (userInput !== input) assert.equal(await evaluate(() => term.wasmTerm.hasFocusEvents()), true);
      assert.equal(userInput, expected + '\r', 'Chromium composition corrupted terminal input');
      pty.write(input);
      await waitFor('WB_END');
      let exitTimer;
      const exit = await Promise.race([exited, new Promise((_, reject) => { exitTimer = setTimeout(() => reject(new Error('PowerShell exit timed out')), 5000); })]);
      clearTimeout(exitTimer);
      assert.equal(exit.exitCode, 0);
      subscription.dispose(); await outputQueue; pty = null;
      const actual = await evaluate(() => glyphs());
      assert.equal(actual.split('WB_BEGIN')[1]?.split('WB_END')[0], expected, 'ConPTY round-trip corrupted Korean text');
      win.webContents.debugger.detach();
      fs.writeFileSync(path.join(output, 'hangul-powershell.png'), (await win.webContents.capturePage()).toPNG());
      pass('Chromium Korean composition → input queue → real PowerShell/ConPTY → Ghostty returns the exact mixed Korean text and exits successfully');
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ variant, root, checks, findings,
      nativeWindowsImeTested: false, nativeMacImeTested: false, platform: process.platform, timestamp: new Date().toISOString() }, null, 2));
    if (findings.length) process.exitCode = 1;
  } catch (error) {
    if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline); pty?.kill(); win?.destroy(); app.exit(process.exitCode || 0);
  }
});
