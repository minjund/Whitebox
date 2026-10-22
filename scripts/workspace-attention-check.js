'use strict';

// Exercise the 2.0 renderer, real PTYs, popup windows, and production main handlers.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { TerminalManager } = require('../src/terminalManager');
const { AttentionPopupManager } = require('../src/attentionPopupManager');
const { AttentionPopupPreferenceStore } = require('../src/attentionPopupPreferenceStore');
const { attentionProject } = require('../src/attentionProject');
const root = path.resolve(__dirname, '..');
const fixtureRoot = require('./workspace-attention-runner').ownedRoot(process.env.WHITEBOX_ATTENTION_TEST_ROOT,
  process.env.WHITEBOX_ATTENTION_TEST_TOKEN, process.ppid);
const profile = path.join(fixtureRoot, 'profile');
fs.mkdirSync(profile);
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const productionFunction = name => {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, name);
  return match[0];
};
const prompt = '\x1b[2J\x1b[H Edited src/popup-fixture.js (+1 -0)\r\nWould you like to make the following edits?\r\n1. Yes, proceed (y)\r\n2. Yes, and don\'t ask again for these files (a)\r\n3. No, and tell Codex what to do differently (esc)';
const waitFor = async (check, label) => {
  for (let n = 0; n < 180; n++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  let win, popups;
  const manager = new TerminalManager({ storeFile: path.join(profile, 'terminals.json') });
  const preference = new AttentionPopupPreferenceStore(path.join(profile, 'attention.json'));
  const errors = [], resolutions = [];
  let lastPrompts = [];
  const deadline = setTimeout(() => { console.error('Workspace attention E2E timed out'); app.exit(1); }, 60000);
  try {
    const sandbox = {
      require: createRequire(path.join(root, 'main.js')), crypto: require('node:crypto'),
      appLocale: 'ko', lastSnapshot: { sessions: [] }, terminalManager: manager,
      terminalAttentionPrompts: new Map(), terminalAttentionDismissals: new Map(),
      attentionProject, listWorkspaces: () => [{ path: profile, name: 'Popup fixture' }],
      providerList: () => [{ id: 'codex', label: 'Codex' }], isProviderVisible: () => true,
      popupSessionCopy: () => { throw new Error('Workspace shell must not use a bridge session'); },
      reconcileAttentionActivations: () => popups.reconcile('terminal', [...sandbox.terminalAttentionPrompts.values()]),
      publishTerminalPromptResolution: value => { resolutions.push(value); win.webContents.send('agents:terminal-prompt-resolved', value); },
    };
    vm.createContext(sandbox);
    vm.runInContext(['popupText', 'popupProviderLabel', 'terminalPromptKey', 'terminalPromptDismissalKey',
      'isWorkspaceAttentionTerminal', 'normalizeTerminalAttentionPrompts', 'syncTerminalAttentionPrompts',
      'respondToTerminalAttention'].map(productionFunction).join('\n'), sandbox);
    popups = new AttentionPopupManager({ BrowserWindow, screen,
      preloadPath: path.join(root, 'attention-popup-preload.js'), htmlPath: path.join(root, 'renderer/attention-popup.html'),
      enabled: true, onDecide: (...args) => sandbox.respondToTerminalAttention(...args),
      onOpenMain: (_request, callback) => { win.webContents.send('agents:attention-requested', { ...callback.context, event: 'terminal' }); return { ok: true }; },
      onError: error => errors.push(error.message),
    });
    for (const [channel, method] of Object.entries({ ready: 'handleReady', resize: 'handleResize', decide: 'handleDecide', dismiss: 'handleDismiss', 'open-main': 'handleOpenMain' })) {
      ipcMain.handle(`attention-popup:${channel}`, (event, payload) => popups[method](event, payload));
    }
    ipcMain.handle('app:bootstrap', () => ({ versions: { app: '2.0.0' }, platform: { id: process.platform, localShell: process.platform === 'win32' ? 'powershell' : 'shell' }, workspaces: [], terminalWorkspace: { defaultCwd: profile }, attentionPopups: preference.snapshot() }));
    for (const name of ['app:set-locale', 'app:set-theme-appearance', 'app:renderer-ready', 'app:notify-attention-prompt', 'app:ack-attention-activation']) ipcMain.handle(name, () => ({ ok: true }));
    ipcMain.handle('app:sync-attention-prompts', (_event, value) => { lastPrompts = value; return sandbox.syncTerminalAttentionPrompts(value); });
    ipcMain.handle('app:set-attention-popups', (_event, value) => { const saved = preference.save(value); popups.setEnabled(saved.enabled); return saved; });
    ipcMain.handle('terminals:review-models', () => ({ claude: [], codex: [] }));
    ipcMain.handle('terminals:review', () => ({ state: 'shell' }));
    ipcMain.handle('terminals:collaboration', () => ({ jobs: [], connected: [] }));
    ipcMain.handle('wsl:list-distros', () => []);
    ipcMain.handle('agents:snapshot', () => ({ sessions: [] }));
    for (const op of ['list', 'create', 'write', 'resize', 'close', 'reconnect']) ipcMain.handle(`terminals:${op}`, (_event, ...args) => manager[op](...args));
    ipcMain.handle('terminals:get', (_event, id) => manager.get(id, true));
    win = new BrowserWindow({ width: 1450, height: 900, show: false, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, backgroundThrottling: false } });
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    manager.on('data', payload => { if (!win.isDestroyed()) win.webContents.send('terminals:data', payload); });
    manager.on('state', payload => { if (!win.isDestroyed()) win.webContents.send('terminals:state', payload); });
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await waitFor(() => evaluate('Boolean(window.WhiteboxWorkspace)'), 'workspace ready');
    const first = manager.list()[0];
    await evaluate('WhiteboxWorkspace.createTerminal("row")');
    const second = manager.list().find(item => item.id !== first.id);
    const fixture = path.join(profile, 'approval.cjs');
    fs.writeFileSync(fixture, `process.stdin.setRawMode(true); process.stdin.resume(); process.stdout.write(${JSON.stringify(prompt)}); process.stdin.once('data', data => { process.stdout.write('\\x1b[2J\\x1b[HAPPROVAL_RECEIVED:' + data.toString('hex') + '\\r\\n'); process.stdin.setRawMode(false); process.exit(0); });`);
    const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
    await manager.write(first.id, `node ${quote(fixture)}\r`);
    await waitFor(() => [...popups.windows.values()].some(entry => entry.ready && entry.presented), 'background shell approval popup');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().activeId'), second.id, 'automatic popup must not switch the selected terminal');
    const entry = [...popups.windows.values()][0];
    const bounds = entry.window.getBounds(), area = screen.getPrimaryDisplay().workArea;
    assert.ok(bounds.x > area.x + area.width / 2 && bounds.y > area.y + area.height / 2, 'bottom-right placement');
    assert.equal(lastPrompts[0].sessionId, first.id, 'ordinary shell without monitor snapshot is scanned');
    const request = [...sandbox.terminalAttentionPrompts.values()][0];
    assert.equal(sandbox.normalizeTerminalAttentionPrompts([{ ...lastPrompts[0], pid: first.pid + 1 }]).size, 0, 'stale process identity rejected');
    assert.equal(sandbox.normalizeTerminalAttentionPrompts([{ ...lastPrompts[0], creationId: 'workspace:old' }]).size, 0, 'stale creation identity rejected');
    await assert.rejects(sandbox.respondToTerminalAttention(request, { action: 'choice', choiceId: 'proceed' }, { context: { ...request.context, pid: first.pid + 1 } }), /연결/);
    sandbox.syncTerminalAttentionPrompts(lastPrompts);
    await waitFor(() => [...popups.windows.values()].some(row => row.ready && row.presented), 'restored popup');
    // Click the actual popup button, then inspect the byte read by the PTY fixture.
    const current = [...popups.windows.values()][0];
    await current.window.webContents.executeJavaScript(`document.querySelector('.terminal-actions .popup-button').click()`, true);
    await waitFor(() => manager.get(first.id, true).replay.includes('APPROVAL_RECEIVED:79'), 'approval byte delivered');
    await waitFor(() => resolutions.length === 1 && popups.windows.size === 0, 'resolved popup removed');
    assert.equal(manager.get(second.id, true).replay.includes('APPROVAL_RECEIVED'), false, 'other shell untouched');
    await evaluate('WhiteboxTerminal.refreshPendingPrompts()');
    await waitFor(() => lastPrompts.length === 0, 'cleared screen no longer detected');
    sandbox.syncTerminalAttentionPrompts([{ ...lastPrompts[0], ...{
      sessionId: first.id, creationId: first.creationId, pid: first.pid, fingerprint: request.context.fingerprint,
      target: { id: first.id, terminalId: first.id, kind: 'terminal' }, choices: request.choices,
    } }]);
    const stale = [...sandbox.terminalAttentionPrompts.values()][0];
    await assert.rejects(sandbox.respondToTerminalAttention(stale, { action: 'choice', choiceId: 'proceed' }, { context: stale.context }), /바뀌었거나/);
    await evaluate(`document.querySelector('[data-action="settings"]').click()`);
    const artifacts = path.join(root, 'artifacts');
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'workspace-attention-settings.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('#wbAttentionEnabled').click()`);
    await waitFor(() => preference.snapshot().enabled === false, 'popup setting saved');
    await win.reload();
    await waitFor(() => evaluate('Boolean(window.WhiteboxWorkspace)'), 'reloaded workspace');
    assert.equal(await evaluate('document.querySelector("#wbAttentionEnabled").checked'), false);
    win.webContents.send('agents:attention-requested', { terminalId: first.id, sessionId: first.id, event: 'terminal' });
    await waitFor(() => evaluate(`WhiteboxWorkspace.getState().activeId === ${JSON.stringify(first.id)}`), 'popup navigation selects exact terminal');
    assert.deepEqual(errors, []);
    console.log('PASS: workspace shell → bottom-right popup → exact PTY response; stale identity/output rejected; cleared prompts removed; settings persist; exact terminal navigation');
  } catch (error) { console.error(error.stack, errors); process.exitCode = 1; }
  finally {
    popups?.dispose();
    await manager.dispose();
    win?.destroy();
    // The Node parent removes and verifies this profile after Electron exits,
    // when Chromium has released its Windows file handles.
    clearTimeout(deadline);
    app.exit(process.exitCode || 0);
  }
}).catch(error => { console.error(error); app.exit(1); });
