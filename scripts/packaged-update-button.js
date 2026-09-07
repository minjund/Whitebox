'use strict';

// Test-side debugger driver. No test endpoint or updater override is shipped.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function openInspectedApp(executable, args, env) {
  env = { ...env };
  delete env.WHITEBOX_DEMO_CAPTURE;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, ['--inspect=127.0.0.1:0', ...args], {
    env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Packaged app debugger did not start: ' + stderr)), 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-20000);
      const match = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Packaged app exited: ' + code + ' ' + stderr)); });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error || message.result?.exceptionDetails) request.reject(new Error(JSON.stringify(message) + '\nExpression: ' + request.expression));
    else request.resolve(message.result?.result?.value);
  });
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Debugger evaluation timed out')); }, 30000);
    pending.set(id, { resolve, reject, timer, expression });
    // Inspector awaitPromise holds only a weak reference. Keep executeJavaScript
    // promises alive in the main context until the next sequential evaluation.
    const retainedExpression = `globalThis.__whiteboxPackagedEvaluation = (${expression})`;
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: retainedExpression, awaitPromise: true, returnByValue: true } }));
  });
  // Electron replaces its bootstrap V8 context during startup.
  await new Promise(resolve => setTimeout(resolve, 2000));
  return { child, evaluate, close: () => socket.close(), diagnostics: () => stderr };
}

async function clickPackagedUpdate(driver, installer, version, options = {}) {
  const { evaluate } = driver;
  const bytes = fs.readFileSync(installer);
  const name = path.basename(installer);
  const asset = { name, size: bytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'),
    state: 'uploaded', browser_download_url: `https://github.com/minjund/Whitebox/releases/download/v${version}/${name}` };
  const release = { tag_name: 'v' + version, draft: false, prerelease: false,
    html_url: `https://github.com/minjund/Whitebox/releases/tag/v${version}`, assets: [asset] };
  const deadline = Date.now() + 60000;
  while (!await evaluate(`Boolean(process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html')))`)) {
    if (Date.now() >= deadline) throw new Error('Packaged renderer did not open');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  // Replace only the external HTTP boundary. Production release selection,
  // streaming download, hash verification, IPC, workload shutdown and helpers run.
  await evaluate(`(() => {
    const req = process.mainModule.require.bind(process.mainModule);
    const originalFetch = globalThis.fetch;
    const asset = ${JSON.stringify(asset)};
    globalThis.fetch = async (url, init) => {
      if (String(url) === 'https://api.github.com/repos/minjund/Whitebox/releases/latest') return new Response(JSON.stringify(${JSON.stringify(release)}), {headers:{'content-type':'application/json'}});
      if (String(url) === asset.browser_download_url) return new Response(req('node:stream').Readable.toWeb(req('node:fs').createReadStream(${JSON.stringify(installer)})), {headers:{'content-length':String(asset.size)}});
      return originalFetch(url, init);
    };
    const Manager = req('./src/updateManager').UpdateManager;
    const check = Manager.prototype.check;
    Manager.prototype.check = async function(...args) {
      // A startup check may already be using the live release channel. Let it
      // finish before the explicit button check uses the candidate fixture.
      if (this.checkPromise) await this.checkPromise;
      this.currentVersion = '0.0.0'; this.fetch = globalThis.fetch;
      return check.apply(this,args);
    };
    return true;
  })()`);
  const renderer = code => evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html')).webContents.executeJavaScript(${JSON.stringify(code)},true)`);
  while (!await renderer(`document.querySelector('#currentVersion')?.textContent.trim() === ${JSON.stringify(version)}`)) {
    if (Date.now() >= deadline) throw new Error('Packaged renderer bootstrap did not finish');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await renderer(`document.querySelector('#sidebarSettingsBtn').click(); true`);
  // Native .click() is ignored while the startup check disables this button.
  // Wait for the same enabled state a person needs, then click exactly once.
  while (!await renderer(`!document.querySelector('#checkUpdateBtn').disabled`)) {
    if (Date.now() >= deadline) throw new Error('Startup update check did not settle: ' + await renderer(`document.querySelector('#updateError').textContent`));
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await renderer(`document.querySelector('#checkUpdateBtn').click(); true`);
  while (!await renderer(`!document.querySelector('#installUpdateBtn').classList.contains('hidden') && !document.querySelector('#installUpdateBtn').disabled`)) {
    if (Date.now() >= deadline) throw new Error('Packaged update button did not become available: ' + await renderer(`JSON.stringify({error:document.querySelector('#updateError').textContent,checkDisabled:document.querySelector('#checkUpdateBtn').disabled})`));
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (options.beforeClick) await options.beforeClick({ evaluate, renderer });
  if (options.retryAfterFailure) {
    await evaluate(`(() => {
      const Host = process.mainModule.require('./src/terminalHost').TerminalHostClient;
      const shutdown = Host.prototype.shutdownForUpdate;
      Host.prototype.shutdownForUpdate = function(...args) {
        Host.prototype.shutdownForUpdate = shutdown;
        return Promise.reject(new Error('update-button-fixture: shutdown failure'));
      };
      return true;
    })()`);
    await renderer(`document.querySelector('#installUpdateBtn').click(); true`);
    const retryDeadline = Date.now() + 90000;
    while (!await renderer(`document.querySelector('#updateError').textContent.includes('update-button-fixture') && !document.querySelector('#installUpdateBtn').disabled`)) {
      if (Date.now() >= retryDeadline) throw new Error('Failed install did not expose a persistent error and retry button: ' + driver.diagnostics());
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await new Promise(resolve => setTimeout(resolve, 3600));
    assert.equal(await renderer(`document.querySelector('#updateError').textContent.includes('update-button-fixture')`), true);
    console.log('PASS packaged button failure remains visible after toast expiry; retry enabled');
  }
  await renderer(`document.querySelector('#installUpdateBtn').click(); true`);
  return { renderer, asset };
}

module.exports = { openInspectedApp, clickPackagedUpdate };
