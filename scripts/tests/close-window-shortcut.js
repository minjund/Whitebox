'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { applicationMenuTemplate, closeFocusedWindow } = require('../../src/appMenu');
const { createWorkbench } = require('./terminal-interactions');

function menuItems(template) {
  const items = [];
  const walk = list => { for (const item of list || []) { items.push(item); walk(Array.isArray(item.submenu) ? item.submenu : []); } };
  walk(template);
  return items;
}

function registerCloseWindowShortcutTests({ test, root }) {
  test('macOS application menu closes the focused window with Cmd+W; Windows and Linux get no new shortcut', () => {
    const closed = [];
    const template = applicationMenuTemplate({ platform: 'darwin', closeLabel: '창 닫기', closeWindow: win => closed.push(win) });
    const items = menuItems(template);
    const close = items.filter(item => /W$/u.test(String(item.accelerator || '')));
    assert.equal(close.length, 1, 'exactly one Cmd+W item');
    assert.equal(close[0].accelerator, 'Command+W', 'macOS only: never CommandOrControl/Ctrl+W');
    assert.equal(close[0].label, '창 닫기');
    // Electron's own menus stay (Cmd+Q, copy/paste, minimize).
    assert.deepEqual(template.filter(item => item.role).map(item => item.role), ['appMenu', 'editMenu', 'viewMenu', 'windowMenu']);
    const focused = { id: 'focused' };
    close[0].click(close[0], focused);
    assert.deepEqual(closed, [focused]);
    for (const platform of ['win32', 'linux']) {
      assert.equal(applicationMenuTemplate({ platform, closeLabel: 'x', closeWindow() {} }), null, `${platform} keeps its current menu`);
    }
    const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.match(main, /applicationMenuTemplate\(\{ platform: process\.platform/u);
    assert.match(main, /app\.whenReady\(\)\.then\(async \(\) => \{\n  installApplicationMenu\(\);/u);
  });

  test('Cmd+W runs the window close path: popups dismiss themselves, other windows close as with their close button', () => {
    const calls = [];
    const win = { close: () => calls.push('close'), isDestroyed: () => false };
    assert.equal(closeFocusedWindow(win, { dismissPopup: () => false }), true);
    assert.deepEqual(calls, ['close']);
    assert.equal(closeFocusedWindow(win, { dismissPopup: target => { calls.push(target === win ? 'popup' : 'other'); return true; } }), true);
    assert.deepEqual(calls, ['close', 'popup'], 'a popup is never closed raw');
    assert.equal(closeFocusedWindow({ close: () => calls.push('dead'), isDestroyed: () => true }), false);
    assert.equal(closeFocusedWindow(null), false);
    assert.deepEqual(calls, ['close', 'popup']);
  });

  test('macOS Cmd+W in a focused terminal reaches the menu, not the PTY; Ctrl+W stays a terminal key', async () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const session = { id: `terminal:cmd-w-${platform}`, type: 'agent', status: 'running' };
      const { workbench, terminalInstances } = createWorkbench(root, { session, platform });
      await workbench.ensureSessionTerminal(session);
      const terminal = terminalInstances[0];
      const key = overrides => {
        const event = { type: 'keydown', key: 'w', code: 'KeyW', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
          preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides };
        return [terminal.keyEventHandler(event), event];
      };
      const [metaAccepted, metaEvent] = key({ metaKey: true });
      if (platform === 'darwin') {
        assert.equal(metaAccepted, false, 'Cmd+W must not be encoded for the PTY');
        assert.equal(Boolean(metaEvent.prevented || metaEvent.stopped), false, 'the menu accelerator must still see Cmd+W');
      } else {
        assert.equal(metaAccepted, true, `${platform} keeps its current Meta+W handling`);
      }
      const [ctrlAccepted, ctrlEvent] = key({ ctrlKey: true });
      assert.equal(ctrlAccepted, true, `${platform}: Ctrl+W still deletes a word in the terminal`);
      assert.equal(Boolean(ctrlEvent.prevented), false);
    }
  });
}

module.exports = { registerCloseWindowShortcutTests };
