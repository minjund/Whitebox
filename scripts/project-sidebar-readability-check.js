'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const exerciseProjectSidebar = require('./tests/project-sidebar-interactions');
const exerciseSidebarFolders = require('./tests/sidebar-folder-tree');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-sidebar-readability-'));
app.setPath('userData', userData);
app.disableHardwareAcceleration();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.join(root, 'artifacts', 'sidebar-readability');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 960, show: false,
    webPreferences: { preload: path.join(__dirname, 'interaction-fixture-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, offscreen: true },
  });
  try {
    await win.loadFile(path.join(root, 'renderer', 'index.html'));
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (await win.webContents.executeJavaScript('Boolean(window.WhiteboxApp?.initialized)')) break;
      if (attempt === 149) throw new Error('renderer initialization timed out');
      await wait(80);
    }
    await win.webContents.executeJavaScript("window.WhiteboxI18n.setLocale('ko')");
    const report = await exerciseProjectSidebar(win);
    report.folders = await exerciseSidebarFolders(win);
    await win.reload();
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (await win.webContents.executeJavaScript('Boolean(window.WhiteboxApp?.initialized)')) break;
      if (attempt === 149) throw new Error('folder persistence reload timed out');
      await wait(80);
    }
    report.folders.reload = await win.webContents.executeJavaScript(`(() => {
      const list = document.querySelector('#projectSidebarList');
      const parent = window.WhiteboxApp.state.sidebarTree.folders.find(item => item.name === '기능 개발 <draft>');
      const node = [...list.querySelectorAll('[data-sidebar-folder-id]')].find(item => item.dataset.sidebarFolderId === parent?.id);
      const children = node?.closest('.sidebar-tree-folder').querySelector('.sidebar-tree-children');
      return Boolean(children && !children.hidden && children.querySelector('[data-sidebar-folder-id]') && children.querySelector('[data-sidebar-session-id]'));
    })()`);
    if (!report.folders.reload) throw new Error('mixed folder/session tree did not survive renderer reload');
    fs.mkdirSync(output, { recursive: true });
    const capture = async (name) => {
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
      win.webContents.invalidate(); await wait(200);
      fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };
    await capture('sidebar-dark');
    await win.webContents.executeJavaScript("window.WhiteboxTheme.setTheme('light')");
    await capture('sidebar-light');
    report.folderDialog = {};
    for (const theme of ['dark', 'light']) {
      await win.webContents.executeJavaScript(`window.WhiteboxTheme.setTheme(${JSON.stringify(theme)});document.querySelector('[data-tree-create]').click()`);
      const contrast = await win.webContents.executeJavaScript(`(() => {
        const dialog = document.querySelector('#sidebarTreeDialog'), style = getComputedStyle(dialog.querySelector('button[type=submit]'));
        const luminance = color => { const rgb=color.match(/[\\d.]+/g).slice(0,3).map(n=>{const v=Number(n)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722; };
        const a=luminance(style.color), b=luminance(style.backgroundColor);
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      })()`);
      if (contrast < 4.5) throw new Error('Folder dialog submit contrast below 4.5: ' + theme + ' ' + contrast);
      report.folderDialog[theme] = { contrast };
      await capture('folder-dialog-' + theme);
      await win.webContents.executeJavaScript("document.querySelector('#sidebarTreeDialog [data-tree-dialog=cancel]').click()");
    }
    report.stress = await win.webContents.executeJavaScript(`(() => {
      const app = window.WhiteboxApp;
      const original = app.state.workspaces;
      app.state.workspaces = [...original, ...Array.from({ length: 32 }, (_, i) => ({ path: 'D:/sidebar-fixture/' + i, name: 'Project ' + i + ' / 긴 프로젝트 이름 읽기 테스트' }))];
      app.renderWorkspaces();
      const list = document.querySelector('#projectSidebarList');
      const title = list.querySelector('strong');
      const result = { verticalScroll: list.scrollHeight > list.clientHeight, noHorizontalOverflow: list.scrollWidth <= list.clientWidth + 1, titleSize: getComputedStyle(title).fontSize };
      app.state.workspaces = original; app.renderWorkspaces();
      return result;
    })()`);
    if (!report.stress.verticalScroll || !report.stress.noHorizontalOverflow || report.stress.titleSize !== '14px') throw new Error('layout failure: ' + JSON.stringify(report.stress));
    for (const locale of ['en', 'zh-CN', 'ko']) {
      await win.webContents.executeJavaScript(`window.WhiteboxI18n.setLocale(${JSON.stringify(locale)})`);
      const text = await win.webContents.executeJavaScript("document.querySelector('#sidebarProjects').textContent");
      if (text.includes('studio.sidebar.')) throw new Error('missing translation: ' + locale);
    }
    await win.webContents.executeJavaScript("window.WhiteboxTheme.setTheme('dark')");
    win.setContentSize(1024, 720); await wait(150); await capture('sidebar-compact');
    report.removal = await win.webContents.executeJavaScript(`(async () => {
      const list = document.querySelector('#projectSidebarList');
      const group = list.querySelector('[data-remove-workspace]').closest('.project-sidebar-project');
      const path = group.querySelector('[data-remove-workspace]').dataset.removeWorkspace;
      group.querySelector('[data-sidebar-project-menu]').click();
      document.querySelector('[data-sidebar-menu-action="remove"]').click();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (!window.WhiteboxApp.state.workspaces.some(item => item.path === path)) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return { called: window.interactionTest.getCalls().some(call => call.name === 'removeWorkspace' && call.args[0] === path), removed: !window.WhiteboxApp.state.workspaces.some(item => item.path === path) };
    })()`);
    if (!report.removal.called || !report.removal.removed) throw new Error('menu removal failed: ' + JSON.stringify(report.removal));
    process.stdout.write(JSON.stringify({ ok: true, ...report, screenshots: output }, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1;
  } finally {
    win.destroy(); app.exit(process.exitCode || 0);
  }
});
app.on('quit', () => {
  const relative = path.relative(os.tmpdir(), userData);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  }
});
