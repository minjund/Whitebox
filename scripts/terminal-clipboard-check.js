'use strict';

// Real Electron clipboard + xterm integration, with an isolated profile and
// a captured terminalWrite boundary (no commands reach a user's live shell).
const { app, BrowserWindow, clipboard } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-clipboard-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const savedClipboard = clipboard.availableFormats().map(format => [format, clipboard.readBuffer(format)]);
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', event => {
    if (event.level === 'error' || event.level >= 3) process.stderr.write(String(event.message) + '\n');
  });
  const evaluate = async code => {
    const result = await win.webContents.executeJavaScript(`(async () => { try { return { value: await (${code}) }; } catch (error) { return { error: error.stack }; } })()`, true);
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  try {
    const files = ['node_modules/@xterm/xterm/lib/xterm.js', 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
      'renderer/comprehension-output-filter.js', 'renderer/terminal-ime.js', 'renderer/terminal-workbench.js'];
    const html = path.join(profile, 'fixture.html');
    fs.writeFileSync(html, '<div id="terminalRuntimeMount"></div>' + files.map(file =>
      `<script src="${pathToFileURL(path.join(root, file)).href}"></script>`).join(''));
    await win.loadFile(html);
    // Chromium clipboard access requires the same focused document as a real
    // keyboard shortcut. A hidden renderer cannot exercise that browser API.
    win.show();
    win.focus();
    win.webContents.focus();
    await new Promise(resolve => setTimeout(resolve, 200));
    await evaluate(`(async () => {
      window.writes = []; window.errors = [];
      window.WhiteboxI18n = { t: key => key };
      window.WhiteboxRendererUtils = { reportRecoverableError: (label, error) => errors.push(label + ': ' + error.message) };
      window.whitebox = {
        terminalGet: async () => ({ replay: '', status: 'running' }),
        terminalResize: async () => {},
        terminalWrite: async (id, data) => { writes.push(data); return { ok: true, deliveryState: 'accepted' }; }
      };
      const session = { id: 'clipboard-test', type: 'agent', backend: 'direct', status: 'running',
        comprehensionContractInjected: true, initialPromptFingerprintVersion: 'raw-v1',
        initialPromptFingerprint: 'a'.repeat(64) };
      window.testState = { sessions: [session], terminals: new Map(), selectedId: session.id };
      const workbench = WhiteboxTerminalWorkbench({
        $: selector => document.querySelector(selector), state: testState,
        notice: message => errors.push(message), xtermOptions: () => ({ cols: 100, rows: 24 }),
      });
      window.entry = await workbench.ensureSessionTerminal(session);
      window.term = entry.terminal;
      term.focus();
      window.key = (key, extra = {}) => {
        term.textarea.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra }));
        term.textarea.dispatchEvent(new KeyboardEvent('keyup', { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra }));
      };
      await new Promise(resolve => term.write('한글😀'.repeat(3000), resolve));
      term.selectAll();
      window.expectedCopy = term.getSelection();
      key('c');
    })()`);
    const waitFor = async expression => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Timed out: ' + expression + ' errors=' + JSON.stringify(await evaluate('errors')));
    };
    const copied = await evaluate('expectedCopy');
    await waitFor('errors.length === 0');
    assert(copied.length > 8000);
    for (let attempt = 0; attempt < 100 && clipboard.readText() !== copied; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(clipboard.readText() === copied, 'Selection was truncated or not copied; ' + JSON.stringify({expectedLength: copied.length, actualLength: clipboard.readText().length, formats: clipboard.availableFormats(), renderer: await evaluate('({errors, focused: document.hasFocus(), selected: term.hasSelection()})')}));
    clipboard.writeText('첫 줄😀\n둘째 줄');
    await evaluate(`(async () => {
      term.clearSelection();
      await new Promise(resolve => term.write('\x1b[?2004h', resolve));
      key('v');
    })()`);
    await waitFor('writes.length === 1');
    assert.deepEqual(await evaluate('writes'), ['\x1b[200~첫 줄😀\r둘째 줄\x1b[201~']);
    await evaluate(`key('V', { shiftKey: true })`);
    await waitFor('writes.length === 2');
    await evaluate(`key('Insert', { ctrlKey: false, shiftKey: true })`);
    await waitFor('writes.length === 3');
    assert.equal((await evaluate('writes')).every(value => value === '\x1b[200~첫 줄😀\r둘째 줄\x1b[201~'), true);
    await evaluate(`key('c', { keyCode: 67, which: 67 })`);
    await waitFor('writes.length === 4');
    assert.equal((await evaluate('writes'))[3], '\x03');
    const display = await evaluate(`(async () => {
      term.clear();
      const data = entry.acceptOutput({ data: 'BEFORE<whitebox-comprehension-packet version="1">{broken}</whitebox-comprehension-packet>AFTER' });
      await new Promise(resolve => term.write(data, resolve));
      return Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i).translateToString()).join('\\n');
    })()`);
    assert(display.includes('BEFOREAFTER'));
    assert(!display.includes('whitebox-comprehension-packet'));
    assert.deepEqual(await evaluate('errors'), []);
    process.stdout.write('PASS: real Electron/xterm full selection, Ctrl+V, Ctrl+Shift+V, Shift+Insert, bracketed multiline paste, Ctrl+C interrupt, owned packet display.\n');
  } finally {
    win.destroy();
    clipboard.clear();
    for (const [format, data] of savedClipboard) clipboard.writeBuffer(format, data);
  }
}).then(() => app.exit(0)).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });

app.on('quit', () => {
  // The only recursive target is the unique temporary directory created above.
  if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('whitebox-clipboard-')) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
});
