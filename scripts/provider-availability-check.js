'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-provider-availability-'));
app.setPath('userData', userData);
app.on('window-all-closed', () => {});
app.once('quit', () => {
  const target = path.resolve(userData);
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('whitebox-provider-availability-')) {
    try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
  }
});

async function waitFor(win, expression, message) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(message);
}

app.whenReady().then(async () => {
  try {
    for (const mode of ['ready', 'missing', 'partial', 'unchecked']) {
      const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 820,
        webPreferences: {
          preload: path.join(__dirname, 'interaction-fixture-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          backgroundThrottling: false,
          additionalArguments: [`--whitebox-availability=${mode}`],
        },
      });
      try {
        await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
        await waitFor(win, 'Boolean(window.WhiteboxApp?.initialized)', `${mode}: initialization failed`);
        const startup = await win.webContents.executeJavaScript(`(() => {
          const app = window.WhiteboxApp;
          app.state.workspace = 'D:\\\\fixture';
          app.selectView('all');
          app.openRunModal();
          return {
            available: Boolean(app.state.availability.codex),
            probes: window.interactionTest.getCalls().filter(call => call.name === 'probeProviders').length,
            helpVisible: getComputedStyle(document.querySelector('#runProviderHelp')).display !== 'none',
            submitDisabled: document.querySelector('#runForm button[type="submit"]').disabled,
          };
        })()`);
        assert.deepEqual(startup, {
          available: mode !== 'missing',
          probes: ['partial', 'unchecked'].includes(mode) ? 1 : 0,
          helpVisible: mode === 'missing',
          submitDisabled: mode === 'missing',
        }, `${mode}: installation state was incorrect`);
        if (mode !== 'unchecked') continue;

        await win.webContents.executeJavaScript(`document.querySelector('#runPrompt').value = '연결 상태가 바뀌어도 유지할 초안'`);
        const checkAvailability = async (availability, connected, trigger = '#probeBtn') => {
          await win.webContents.executeJavaScript(`(async () => {
            window.interactionTest.clearCalls();
            await window.interactionTest.setProviderAvailability(${JSON.stringify(availability)});
            document.querySelector(${JSON.stringify(trigger)}).click();
          })()`);
          await waitFor(win, `window.interactionTest.getCalls().some(call => call.name === 'probeProviders')
            && Object.entries(${JSON.stringify(availability)}).every(([id, value]) => window.WhiteboxApp.state.availability[id] === value)`, 'Connection recheck did not finish');
          const form = await win.webContents.executeJavaScript(`({
            helpVisible: getComputedStyle(document.querySelector('#runProviderHelp')).display !== 'none',
            submitDisabled: document.querySelector('#runForm button[type="submit"]').disabled,
            codexDisabled: document.querySelector('[data-run-provider="codex"]').disabled,
            selected: window.WhiteboxApp.state.runProvider,
            draft: document.querySelector('#runPrompt').value,
          })`);
          assert.equal(form.helpVisible, !connected, 'Stale installation help');
          assert.equal(form.submitDisabled, !connected, 'Stale submit availability');
          assert.equal(form.codexDisabled, !connected, 'Stale provider picker');
          assert.equal(form.draft, '연결 상태가 바뀌어도 유지할 초안', 'Draft was changed');
          if (connected) assert.equal(form.selected, 'codex', 'Available selection was changed');
        };
        const missing = { claude: '', codex: '', gpt: '', gemini: '', grok: '' };
        await checkAvailability(missing, false);
        await checkAvailability({ ...missing, codex: '/fixture/codex' }, true);
        await checkAvailability({ ...missing, claude: '/fixture/claude', codex: '/fixture/codex' }, true);
        await checkAvailability(missing, false);
        await checkAvailability({ ...missing, codex: '/fixture/codex' }, true, '[data-provider-recheck]');
      } finally {
        win.destroy();
      }
    }
    process.stdout.write('PASS provider availability: ready, missing, partial and unchecked startup; both recheck controls; selection and draft preservation\n');
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    app.exit(process.exitCode || 0);
  }
});
