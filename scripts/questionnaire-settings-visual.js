'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { QuestionnairePreferenceStore } = require('../src/questionnairePreferenceStore');

const root = path.resolve(__dirname, '..');
const rendererRoot = path.resolve(process.env.WHITEBOX_QUESTIONNAIRE_RENDERER_DIR || path.join(root, 'renderer'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-questionnaire-ui-'));
const preferenceFile = path.join(temporary, 'questionnaire-preference.json');
app.setPath('userData', temporary);
app.commandLine.appendSwitch('disable-gpu');
process.env.WHITEBOX_QUESTIONNAIRE_SETUP_TEST = '1';
ipcMain.handle('fixture:questionnaire-preference', () => new QuestionnairePreferenceStore(preferenceFile).load());
ipcMain.handle('fixture:set-questionnaire-preference', (_event, value) => new QuestionnairePreferenceStore(preferenceFile).save(value));

async function waitFor(check, label) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Questionnaire UI timed out: ${label}`);
}

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1280, height: 920, show: false,
    webPreferences: { preload: path.join(__dirname, 'interaction-fixture-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const visible = () => js("!document.querySelector('#questionnaireSetupModal').classList.contains('hidden')");
  const load = async () => {
    await win.loadFile(path.join(rendererRoot, 'index.html'));
    await waitFor(() => js('Boolean(window.WhiteboxApp?.initialized)'), 'initialization');
  };
  await load();
  assert.equal(await visible(), true, 'first launch must ask');
  assert.equal(fs.existsSync(preferenceFile), false, 'opening must not count as consent');
  assert.equal(await js('window.WhiteboxApp.state.questionnaire.enabled'), false);
  assert.equal(await js('document.activeElement.id'), 'questionnaireSetupTitle');
  assert.equal(await js("document.querySelector('#appShell').hasAttribute('inert')"), true);
  await js("document.querySelector('#questionnaireEnableBtn').focus()");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await waitFor(() => js("document.activeElement.id === 'questionnaireSkipBtn'"), 'keyboard focus stays in dialog');

  const artifacts = path.join(root, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  for (const theme of ['dark', 'light']) {
    for (const locale of ['ko', 'en', 'zh-CN']) {
      for (const width of [1280, 420]) {
        win.setContentSize(width, width === 420 ? 780 : 920);
        await waitFor(() => js(`innerWidth === ${width}`), 'resize');
        await js(`window.WhiteboxI18n.setLocale('${locale}'); window.WhiteboxTheme.setTheme('${theme}')`);
        const layout = await js(`(() => {
          const panel = document.querySelector('.questionnaire-setup-panel');
          const rect = panel.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            width: innerWidth, height: innerHeight, overflow: panel.scrollWidth > panel.clientWidth + 1,
            missing: [...panel.querySelectorAll('[data-i18n]')].some(el => el.textContent === el.dataset.i18n) };
        })()`);
        assert(layout.left >= 0 && layout.right <= layout.width && layout.top >= 0 && layout.bottom <= layout.height,
          `Dialog outside viewport: ${JSON.stringify(layout)}`);
        assert.equal(layout.overflow, false);
        assert.equal(layout.missing, false);
        await js("document.querySelector('#questionnaireEnableBtn').scrollIntoView({ block: 'nearest' })");
        assert.equal(await js(`(() => { const r = document.querySelector('#questionnaireEnableBtn').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`), true);
        if (locale === 'ko') {
          await js("document.querySelector('.questionnaire-setup-panel').scrollTop = 0; document.activeElement.blur()");
          await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          fs.writeFileSync(path.join(artifacts, `questionnaire-setup-${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
        }
      }
    }
  }

  await js("window.interactionTest.configure({ failures: { setQuestionnairePreference: 1 } }); document.querySelector('#questionnaireEnableBtn').click()");
  await waitFor(() => js("!document.querySelector('#questionnaireSetupError').classList.contains('hidden') && !document.querySelector('#questionnaireEnableBtn').disabled"), 'failed save');
  assert.equal(await visible(), true);
  assert.equal(await js('window.WhiteboxApp.state.questionnaire.enabled'), false);
  assert.equal(fs.existsSync(preferenceFile), false);
  await js("document.querySelector('#questionnaireSkipBtn').click()");
  await waitFor(async () => !(await visible()), 'keep off');
  assert.deepStrictEqual(new QuestionnairePreferenceStore(preferenceFile).load(), { configured: true, enabled: false });
  assert.equal(await js("document.querySelector('#appShell').hasAttribute('inert')"), false);
  await load();
  assert.equal(await visible(), false, 'saved opt-out must not ask again');

  await js("document.querySelector('#sidebarSettingsBtn').click(); document.querySelector('#questionnaireEnabled').click()");
  await waitFor(() => js('window.WhiteboxApp.state.questionnaire.enabled === true && !document.querySelector("#questionnaireEnabled").disabled'), 'enable from settings');
  assert.deepStrictEqual(new QuestionnairePreferenceStore(preferenceFile).load(), { configured: true, enabled: true });
  await load();
  assert.equal(await visible(), false, 'saved opt-in must not ask again');
  assert.equal(await js('window.WhiteboxApp.state.questionnaire.enabled'), true);
  await js("document.querySelector('#sidebarSettingsBtn').click(); document.querySelector('#questionnaireEnabled').click()");
  await waitFor(() => js('window.WhiteboxApp.state.questionnaire.enabled === false && !document.querySelector("#questionnaireEnabled").disabled'), 'disable from settings');

  // Keep the established profile, removing only the newly introduced preference.
  fs.unlinkSync(preferenceFile);
  await load();
  assert.equal(await visible(), true, 'existing installs without a preference must ask');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(async () => !(await visible()), 'escape keeps off');
  assert.deepStrictEqual(new QuestionnairePreferenceStore(preferenceFile).load(), { configured: true, enabled: false });

  fs.unlinkSync(preferenceFile);
  await load();
  await js("document.querySelector('#questionnaireEnableBtn').click()");
  await waitFor(async () => !(await visible()), 'explicit opt-in');
  assert.deepStrictEqual(new QuestionnairePreferenceStore(preferenceFile).load(), { configured: true, enabled: true });
  win.destroy();
  process.stdout.write('Questionnaire setup passed: first launch, existing unconfigured profile, opt-in/out persistence, save failure, settings, keyboard, 12 locale/theme/size layouts.\n');
}

run().then(() => app.quit(), error => {
  process.stderr.write(`${error.stack}\n`);
  app.exit(1);
});

// Chromium must finish closing its profile before fixture files are removed.
app.once('quit', () => {
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('whitebox-questionnaire-ui-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch {}
  }
});
