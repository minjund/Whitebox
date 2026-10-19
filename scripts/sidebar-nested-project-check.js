'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-nested-project-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1360, height: 800, show: false,
    webPreferences: { preload: path.join(__dirname, 'interaction-fixture-preload.js'), sandbox: false, backgroundThrottling: false } });
  let code = 0;
  try {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await win.webContents.executeJavaScript('Boolean(window.WhiteboxApp?.initialized)')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const a = window.WhiteboxApp;
      const check = (value, message) => { if (!value) throw new Error(message); };
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const list = document.querySelector('#projectSidebarList');
      const row = path => [...list.querySelectorAll('.project-sidebar-item')].find(node => node.dataset.workspace === path);
      const key = value => value.replace(/\\\\/g, '/').toLowerCase();
      const press = (node, key) => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      for (const parent of ['/work/project', 'C:/work/project']) {
        const child = parent + '/Whitebox';
        const grandchild = child + '/tools';
        a.state.workspaces = [{ path: parent, name: 'project' }];
        a.state.snapshot = { ...a.state.snapshot, sessions: [], tmux: { distros: [] } };
        a.state.sidebarTerminalEntries = [];
        a.state.sidebarExpandedProjects = new Set();
        a.state.workspace = parent;
        a.state.sidebarProjectSearch = '';
        a.renderWorkspaces();
        window.interactionTest.setAddedWorkspaceResponse({ canceled: false, alreadyAdded: false,
          workspaces: [...a.state.workspaces, { path: child, name: 'Whitebox' }], selected: { path: child } });
        document.querySelector('#sidebarNewProjectBtn').click();
        for (let attempt = 0; attempt < 100 && a.state.workspace !== child; attempt++) await frame();
        check(a.state.workspace === child, 'Added folder was not selected');
        const group = row(child)?.closest('.project-sidebar-project');
        check(group?.parentElement.closest('.project-sidebar-project') === row(parent)?.closest('.project-sidebar-project'), 'Added folder escaped its parent');
        check(!row(child).closest('[hidden]'), 'Parent did not expand after adding folder');
        check(row(child).getAttribute('aria-level') === '2', 'Wrong child depth');
        check(row(child).getBoundingClientRect().left > row(parent).getBoundingClientRect().left, 'Child has no indentation');
        row(child).focus(); press(row(child), 'ArrowLeft'); await frame();
        check(document.activeElement === row(parent), 'Left arrow did not focus parent');
        press(row(parent), 'ArrowLeft'); await frame();
        check(row(child).closest('[hidden]'), 'Parent collapse did not hide child');
        check(row(parent).tabIndex === 0, 'Collapsed selection left no visible tab stop');
        press(row(parent), 'ArrowRight'); await frame();
        press(row(parent), 'ArrowRight'); await frame();
        check(document.activeElement === row(child), 'Right arrow did not enter child');
        a.state.workspaces.push({ path: grandchild, name: 'tools' });
        a.state.sidebarExpandedProjects.add(key(child));
        a.renderWorkspaces();
        check(row(grandchild).getAttribute('aria-level') === '3', 'Nearest parent depth is wrong');
        const search = document.querySelector('#sidebarProjectSearch');
        search.value = 'tools'; search.dispatchEvent(new Event('input', { bubbles: true })); await frame();
        check(row(parent) && row(child) && row(grandchild) && !row(grandchild).closest('[hidden]'), 'Search lost ancestor context');
        search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); await frame();
        a.renderWorkspaces();
        check(list.querySelectorAll('[data-sidebar-project-key="' + key(child) + '"]').length === 1, 'Refresh duplicated child project');
      }
      return 'Nested project addition, indentation, keyboard, collapse, search and refresh checks passed';
    })()`));
  } catch (error) {
    console.error(error);
    code = 1;
  } finally {
    win.destroy();
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(code);
  }
});
