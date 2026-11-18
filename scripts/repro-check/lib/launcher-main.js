'use strict';
// repro-check launcher.
// Loads the target Whitebox's own, unmodified main.js, but keeps the test
// window invisible: no activation, no focus, no notifications, no mouse input,
// no Dock icon. The user's live Whitebox must not notice the test app.
const path = require('path');
const electron = require('electron');
const { app, BrowserWindow, Notification } = electron;
const root = process.env.REPRO_APP_ROOT;
if (!root) { console.error('REPRO_APP_ROOT missing'); process.exit(2); }
if (process.env.WHITEBOX_TEST_INSTANCE !== '1') { console.error('WHITEBOX_TEST_INSTANCE must be 1'); process.exit(2); }

const proto = BrowserWindow.prototype;
const quiet = win => {
  try { win.setOpacity(0); } catch {}
  try { win.setIgnoreMouseEvents(true); } catch {}
  try { win.setFocusable(false); } catch {}
};
const originalShowInactive = proto.showInactive;
proto.show = function show() { quiet(this); return originalShowInactive.call(this); };
proto.showInactive = function showInactive() { quiet(this); return originalShowInactive.call(this); };
proto.focus = function focus() {};
proto.moveTop = function moveTop() {};
app.focus = function focus() {};
if (Notification) Notification.prototype.show = function show() {};
app.whenReady().then(() => { try { app.dock?.hide(); } catch {} });

require(path.join(root, 'main.js'));
