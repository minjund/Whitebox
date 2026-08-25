'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-popup-settings-'));
app.setPath('userData', temporaryUserData);
app.commandLine.appendSwitch('disable-gpu');

function waitFor(check, label, timeoutMs = 12_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const value = await check();
        if (value) { resolve(value); return; }
      } catch (error) { reject(error); return; }
      if (Date.now() - startedAt >= timeoutMs) { reject(new Error(`Attention popup settings visual timed out: ${label}`)); return; }
      setTimeout(poll, 40);
    };
    poll();
  });
}

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1280,
    height: 920,
    show: false,
    backgroundColor: '#050506',
    webPreferences: {
      preload: path.join(root, 'scripts', 'interaction-fixture-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) process.stderr.write(`[renderer] ${message}\n`);
  });
  await win.loadFile(path.join(root, 'renderer', 'index.html'));
  win.show();
  await waitFor(() => win.webContents.executeJavaScript('Boolean(window.WhiteboxApp?.initialized)', true), 'renderer initialization');
  await win.webContents.executeJavaScript("document.querySelector('#sidebarSettingsBtn').click()", true);
  await waitFor(() => win.webContents.executeJavaScript("!document.querySelector('#settingsSection').classList.contains('hidden')", true), 'settings view');
  const versionState = await win.webContents.executeJavaScript(`(() => {
    const route = document.querySelector('.version-route');
    const bounds = route.getBoundingClientRect();
    const style = getComputedStyle(route);
    return {
      currentVersion: document.querySelector('#currentVersion').textContent,
      display: style.display,
      visibility: style.visibility,
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };
  })()`, true);
  assert.equal(versionState.currentVersion, '1.5.1');
  assert.notEqual(versionState.display, 'none');
  assert.equal(versionState.visibility, 'visible');
  assert.ok(versionState.width > 0 && versionState.height > 0, `Settings version route was not laid out: ${JSON.stringify(versionState)}`);
  win.setContentSize(420, 780);
  await waitFor(() => win.webContents.executeJavaScript('window.innerWidth === 420', true), 'compact settings width');
  const compactVersionState = await win.webContents.executeJavaScript(`(() => {
    const route = document.querySelector('.version-route');
    const bounds = route.getBoundingClientRect();
    return {
      visible: route.getClientRects().length > 0 && getComputedStyle(route).display !== 'none',
      left: Math.round(bounds.left),
      right: Math.round(bounds.right),
      viewportWidth: window.innerWidth,
    };
  })()`, true);
  assert.equal(compactVersionState.visible, true);
  assert.ok(compactVersionState.left >= 0 && compactVersionState.right <= compactVersionState.viewportWidth,
    `Compact settings version route overflowed the viewport: ${JSON.stringify(compactVersionState)}`);
  win.setContentSize(1280, 920);
  await waitFor(() => win.webContents.executeJavaScript('window.innerWidth === 1280', true), 'desktop settings width');
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('#attentionPopupEnabled').checked", true), true);
  await win.webContents.executeJavaScript("document.querySelector('#attentionPopupEnabled').click()", true);
  await waitFor(() => win.webContents.executeJavaScript("!document.querySelector('#attentionPopupEnabled').checked && !document.querySelector('#attentionPopupEnabled').disabled", true), 'disable preference');
  await win.webContents.executeJavaScript("document.querySelector('#attentionPopupEnabled').click()", true);
  await waitFor(() => win.webContents.executeJavaScript("document.querySelector('#attentionPopupEnabled').checked && !document.querySelector('#attentionPopupEnabled').disabled", true), 'enable preference');
  const calls = await win.webContents.executeJavaScript('window.interactionTest.getCalls()', true);
  assert.ok(calls.some(call => call.name === 'setAttentionPopups' && call.args[0]?.enabled === false));
  assert.ok(calls.some(call => call.name === 'setAttentionPopups' && call.args[0]?.enabled === true));
  const enabledState = await win.webContents.executeJavaScript(`(() => ({
    checked: document.querySelector('#attentionPopupEnabled').checked,
    disabled: document.querySelector('#attentionPopupEnabled').disabled,
    card: document.querySelector('#attentionPopupSettingsCard').dataset.enabled,
    status: document.querySelector('#attentionPopupStatus').textContent,
  }))()`, true);
  assert.deepStrictEqual(enabledState, {
    checked: true,
    disabled: false,
    card: 'true',
    status: 'On · requests appear at the bottom right',
  });
  await new Promise(resolve => setTimeout(resolve, 650));
  const bounds = await win.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('#attentionPopupSettingsCard').getBoundingClientRect();
    return { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  })()`, true);
  const artifactDirectory = path.join(root, 'artifacts');
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const screenshot = path.join(artifactDirectory, 'attention-popup-settings.png');
  fs.writeFileSync(screenshot, (await win.webContents.capturePage(bounds)).toPNG());
  win.close();
  return screenshot;
}

run().then(screenshot => {
  process.stdout.write(`Attention popup settings visual passed: ${screenshot}\n`);
  app.quit();
}, error => {
  process.stderr.write(`${error.stack}\n`);
  app.exit(1);
}).finally(() => {
  try { fs.rmSync(temporaryUserData, { recursive: true, force: true }); } catch {}
});
