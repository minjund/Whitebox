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
  const evaluate = (expression, { awaitPromise = true } = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Debugger evaluation timed out')); }, 30000);
    pending.set(id, { resolve, reject, timer, expression });
    // Inspector awaitPromise holds only a weak reference. Keep executeJavaScript
    // promises alive in the main context until the next sequential evaluation.
    const retainedExpression = awaitPromise
      ? `globalThis.__whiteboxPackagedEvaluation = Promise.resolve((0, eval)(${JSON.stringify(expression)}))`
      : expression;
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: retainedExpression, awaitPromise, returnByValue: true } }));
  });
  const driver = { child, evaluate, close: () => socket.close(), diagnostics: () => stderr };
  try {
    await waitForPackagedRenderer(driver);
    return driver;
  } catch (error) {
    socket.close();
    child.kill();
    throw error;
  }
}

async function waitForPackagedRenderer(driver, { timeoutMs = 60000, pollMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  // Electron replaces its bootstrap V8 context. A read-only synchronous probe
  // must not create an Inspector promise in that temporary context. Only an
  // actual application window satisfies readiness; transport errors fail.
  while (!await driver.evaluate(`Boolean(typeof process !== 'undefined' && process.mainModule?.require('electron').BrowserWindow?.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html')))`, { awaitPromise: false })) {
    if (Date.now() >= deadline) throw new Error('Packaged renderer did not open');
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

async function clickPackagedUpdate(driver, installer, version, options = {}) {
  const { evaluate } = driver;
  let terminalPid = 0;
  const bytes = fs.readFileSync(installer);
  const name = path.basename(installer);
  const asset = { name, size: bytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'),
    state: 'uploaded', browser_download_url: `https://github.com/minjund/Whitebox/releases/download/v${version}/${name}` };
  const release = { tag_name: 'v' + version, draft: false, prerelease: false,
    html_url: `https://github.com/minjund/Whitebox/releases/tag/v${version}`, assets: [asset] };
  const deadline = Date.now() + 60000;
  await waitForPackagedRenderer(driver);
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
  while (!await renderer(`document.querySelector('#currentVersion')?.textContent.trim() === ${JSON.stringify(options.currentVersion || version)}`)) {
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
  if (options.holdIncompleteHookRequest !== false) {
    await evaluate(`(async () => {
      const req=process.mainModule.require.bind(process.mainModule);
      const identity=JSON.parse(req('fs').readFileSync(req('path').join(req('electron').app.getPath('userData'),'attention-hook-runtime.json'),'utf8'));
      const socket=req('net').createConnection(identity.port, identity.host);
      globalThis.__whiteboxIncompleteHookSocket=socket;
      socket.on('error',()=>{});
      await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
      socket.write('POST '+identity.path+' HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nContent-Length: 100\\r\\n\\r\\n{');
      await new Promise(resolve=>setTimeout(resolve,100));
      if(socket.destroyed) throw new Error('Incomplete-hook fixture closed before the update');
      return true;
    })()`);
    console.log('PASS incomplete hook request held open before actual packaged update');
  }
  if (options.retryAfterFailure) {
    await evaluate(`(() => {
      const dialog = process.mainModule.require('electron').dialog;
      const showMessageBox = dialog.showMessageBox;
      globalThis.__whiteboxForceDialogResponses = [];
      dialog.showMessageBox = async function(...args) {
        const options = args.at(-1);
        if (options.buttons?.some(button => /강제|Force-stop|强制/.test(button))) {
          const response = globalThis.__whiteboxForceDialogResponses.length ? 1 : 0;
          globalThis.__whiteboxForceDialogResponses.push(response);
          if (options.defaultId !== 0 || options.cancelId !== 0) throw new Error('Force update must default to cancel');
          return { response };
        }
        if (options.buttons?.some(button => /^(업데이트하고 다시 시작|Update and restart|更新并重新启动)$/.test(button))) {
          return { response: 1 };
        }
        return showMessageBox.apply(this, args);
      };
      const Host = process.mainModule.require('./src/terminalHost').TerminalHostClient;
      const shutdown = Host.prototype.shutdownForUpdate;
      let failures = 0;
      Host.prototype.shutdownForUpdate = async function(...args) {
        if (!args[2]?.force && failures++ < ${options.forceRetry === true ? 2 : 1}) {
          await this.listFresh();
          throw new Error('update-button-fixture: shutdown failure');
        }
        Host.prototype.shutdownForUpdate = shutdown;
        return shutdown.apply(this, args);
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
  if (options.forceRetry === true) {
    assert.equal(options.retryAfterFailure, true, 'Force retry must first exercise cancellation');
    const type = await evaluate(`process.platform === 'win32' ? 'cmd' : 'shell'`);
    const cwd = await evaluate(`process.mainModule.require('electron').app.getPath('userData')`);
    let terminal = await renderer(`window.whitebox.terminalCreate(${JSON.stringify({ type, cwd })})`);
    const pidDeadline = Date.now() + 10000;
    while (!Number.isSafeInteger(Number(terminal.pid)) || Number(terminal.pid) <= 0) {
      if (Date.now() >= pidDeadline) throw new Error('Packaged force-update PTY PID was not ready');
      await new Promise(resolve => setTimeout(resolve, 100));
      terminal = await renderer(`window.whitebox.terminalGet(${JSON.stringify(terminal.id)})`);
    }
    terminalPid = Number(terminal.pid);
    assert(Number.isSafeInteger(terminalPid) && terminalPid > 0, 'Packaged force update requires a live app-owned PTY');
  }
  await renderer(`document.querySelector('#installUpdateBtn').click(); true`);
  return { renderer, asset, terminalPid };
}

module.exports = { openInspectedApp, clickPackagedUpdate, waitForPackagedRenderer };
