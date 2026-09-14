'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { bindWindowNavigation } = require('../src/windowNavigation');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-navigation-back-'));
app.setPath('userData', userData);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const windows = [];

function createWindow(preload, sandbox) {
  const win = new BrowserWindow({
    width: 1440, height: 960, show: false,
    webPreferences: { preload, sandbox, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  bindWindowNavigation(win);
  windows.push(win);
  return win;
}

async function waitFor(win, expression) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await wait(40);
  }
  const detail = await win.webContents.executeJavaScript(`JSON.stringify({
    errors: window.navigationErrors,
    view: window.WhiteboxApp?.state.view,
    buttons: ['backToProjectsBtn', 'ptyFocusBackBtn', 'closeDrawerBtn', 'cancelRunBtn', 'cancelTmuxCreateBtn'].map(id => {
      const el = document.getElementById(id);
      return { id, disabled: el?.disabled, rects: el?.getClientRects().length,
        inactive: el?.closest('[inert], [hidden], [aria-hidden="true"]')?.id,
        visibility: el && getComputedStyle(el).visibility };
    }),
  })`);
  throw new Error(`Navigation assertion timed out: ${expression}\n${detail}`);
}

function nativeBack(win) {
  win.emit('app-command', {}, 'browser-backward');
}

function altLeft(win) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['alt'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left', modifiers: ['alt'] });
}

app.whenReady().then(async () => {
  try {
    // Exercise the shipped sandboxed preload, including listener disposal.
    const bridge = createWindow(path.join(__dirname, '..', 'preload.js'), true);
    await bridge.loadURL('data:text/html,<html><body>Navigation bridge</body></html>');
    await bridge.webContents.executeJavaScript(`
      window.backCount = 0;
      window.unsubscribeBack = window.whitebox.onNavigateBack(() => { window.backCount += 1; });
      true;
    `);
    nativeBack(bridge);
    await waitFor(bridge, 'window.backCount === 1');
    bridge.emit('app-command', {}, 'browser-forward');
    await bridge.webContents.executeJavaScript('window.unsubscribeBack()');
    nativeBack(bridge);
    await wait(100);
    assert.equal(await bridge.webContents.executeJavaScript('window.backCount'), 1);

    const win = createWindow(path.join(__dirname, 'interaction-fixture-preload.js'), false);
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await waitFor(win, 'Boolean(window.WhiteboxApp?.initialized)');
    await win.webContents.executeJavaScript(`
      window.navigationErrors = [];
      window.addEventListener('error', event => navigationErrors.push(event.message));
      window.addEventListener('unhandledrejection', event => navigationErrors.push(String(event.reason)));
      window.WhiteboxApp.state.workspace = 'D:\\\\fixture';
      window.WhiteboxApp.selectView('all');
      window.WhiteboxApp.renderWorkspaces();
    `);
    const url = win.webContents.getURL();
    nativeBack(win);
    await wait(100);
    assert.equal(await win.webContents.executeJavaScript('window.WhiteboxApp.state.view'), 'all');

    await win.webContents.executeJavaScript("window.WhiteboxApp.selectViewFromUser('settings')");
    nativeBack(win);
    await waitFor(win, "window.WhiteboxApp.state.view === 'all'");

    await win.webContents.executeJavaScript("window.WhiteboxApp.selectViewFromUser('active')");
    altLeft(win);
    await waitFor(win, "window.WhiteboxApp.state.view === 'all'");

    // Native mouse command closes only the nested conversation; the next
    // shortcut returns from focus to the original control-room project.
    await win.webContents.executeJavaScript("window.WhiteboxApp.openDrawer('fixture-root')");
    await waitFor(win, "window.WhiteboxApp.state.ptyFocusSessionId === 'fixture-root'");
    await win.webContents.executeJavaScript("window.WhiteboxApp.openSubagentConversation('fixture-child', { presentation: 'modal' })");
    await waitFor(win, "document.querySelector('#detailDrawer').classList.contains('open')");
    nativeBack(win);
    await waitFor(win, "!document.querySelector('#detailDrawer').classList.contains('open')");
    assert.equal(await win.webContents.executeJavaScript('window.WhiteboxApp.state.ptyFocusSessionId'), 'fixture-root');
    altLeft(win);
    await waitFor(win, '!window.WhiteboxApp.state.ptyFocusSessionId');
    assert.equal(await win.webContents.executeJavaScript('window.WhiteboxApp.state.workspace'), 'D:\\fixture');

    // Browser keys work inside inputs. Ordinary editing, extra modifiers,
    // IME composition and held-key repeats must not navigate away.
    await win.webContents.executeJavaScript(`(() => {
      const app = window.WhiteboxApp;
      app.selectViewFromUser('active');
      const input = document.querySelector('#searchInput');
      input.focus();
      input.value = '초안';
      for (const options of [
        { key: 'Backspace' }, { key: 'ArrowLeft' },
        { key: 'ArrowLeft', altKey: true, shiftKey: true },
        { key: 'ArrowLeft', altKey: true, ctrlKey: true },
        { key: 'ArrowLeft', altKey: true, isComposing: true },
        { key: 'ArrowLeft', altKey: true, repeat: true },
      ]) input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options }));
    })()`);
    assert.equal(await win.webContents.executeJavaScript('window.WhiteboxApp.state.view'), 'active');
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#searchInput').value"), '초안');
    await win.webContents.executeJavaScript(`document.querySelector('#searchInput').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'BrowserBack', bubbles: true, cancelable: true })
    )`);
    await waitFor(win, "window.WhiteboxApp.state.view === 'all'");

    await win.webContents.executeJavaScript(`
      window.WhiteboxApp.selectViewFromUser('settings');
      window.WhiteboxApp.openShortcutHelp();
    `);
    nativeBack(win);
    await waitFor(win, "document.querySelector('#shortcutHelpModal').classList.contains('hidden')");
    assert.equal(await win.webContents.executeJavaScript('window.WhiteboxApp.state.view'), 'settings');
    nativeBack(win);
    await waitFor(win, "window.WhiteboxApp.state.view === 'all'");

    // The macOS shortcut is platform-scoped (synthetic input on this host).
    await win.webContents.executeJavaScript(`
      window.WhiteboxApp.selectViewFromUser('settings');
      window.WhiteboxApp.state.platform = 'darwin';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '[', metaKey: true, bubbles: true, cancelable: true }));
    `);
    await waitFor(win, "window.WhiteboxApp.state.view === 'all'");
    assert.equal(win.webContents.getURL(), url, 'Back must not reload or leave the app document');
    assert.deepEqual(await win.webContents.executeJavaScript('window.navigationErrors'), []);
    process.stdout.write('PASS: native back IPC, preload disposal, Alt+Left, BrowserBack, nested surfaces, editing/IME/repeat guards, macOS shortcut and root no-op.\n');
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  } finally {
    for (const win of windows) if (!win.isDestroyed()) win.destroy();
    app.exit(process.exitCode || 0);
  }
});

app.once('quit', () => {
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
});
