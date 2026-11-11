'use strict';

const assert = require('assert');
const path = require('path');
const { EventEmitter } = require('events');
const { pathToFileURL } = require('url');
const {
  TrayPopover,
  popoverPosition,
  FRAME_PADDING,
  WINDOW_WIDTH,
  BLUR_REOPEN_GUARD_MS,
} = require('../../src/trayPopover');

let nextContentsId = 1;

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.id = nextContentsId++;
    this.destroyed = false;
    this.messages = [];
  }

  isDestroyed() { return this.destroyed; }
  send(channel, payload) { this.messages.push({ channel, payload }); }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
}

class FakeBrowserWindow extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents();
    this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
    this.visible = false;
    this.destroyed = false;
    this.focused = 0;
    FakeBrowserWindow.instances.push(this);
  }

  loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
  setAlwaysOnTop(...args) { this.alwaysOnTop = args; }
  setVisibleOnAllWorkspaces(...args) { this.visibleOnAllWorkspaces = args; }
  setMenuBarVisibility(value) { this.menuBarVisible = value; }
  setBounds(bounds) { this.bounds = { ...bounds }; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() { this.focused += 1; }
  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    this.webContents.destroyed = true;
    this.emit('closed');
  }
}

const MAC_DISPLAY = { workArea: { x: 0, y: 25, width: 1440, height: 875 }, bounds: { x: 0, y: 0, width: 1440, height: 900 } };
const fakeScreen = {
  getDisplayMatching: () => MAC_DISPLAY,
  getCursorScreenPoint: () => ({ x: 1300, y: 10 }),
};
const htmlPath = path.join(__dirname, '..', '..', 'renderer', 'tray-popover.html');
const trayBounds = { x: 1300, y: 0, width: 24, height: 24 };

function makePopover(overrides = {}) {
  FakeBrowserWindow.instances = [];
  let clock = 1_000_000;
  const calls = { openMain: 0, quit: 0, errors: [] };
  const popover = new TrayPopover({
    BrowserWindow: FakeBrowserWindow,
    screen: fakeScreen,
    preloadPath: '/tmp/preload.js',
    htmlPath,
    getState: () => ({ terminals: 2, runs: 1 }),
    onOpenMain: () => { calls.openMain += 1; },
    onQuit: () => { calls.quit += 1; },
    onError: error => calls.errors.push(error),
    now: () => clock,
    ...overrides,
  });
  return {
    popover,
    calls,
    advance: ms => { clock += ms; },
    window: () => FakeBrowserWindow.instances.at(-1),
    sender: () => ({ sender: { id: FakeBrowserWindow.instances.at(-1).webContents.id } }),
  };
}

const tests = [
  {
    name: 'Tray popover opens below a macOS menu bar icon, centered and inside the work area',
    run() {
      const height = 400;
      const position = popoverPosition({ trayBounds, workArea: MAC_DISPLAY.workArea, width: WINDOW_WIDTH, height });
      assert.strictEqual(position.placement, 'below');
      assert.strictEqual(position.y, 24 + 2 - FRAME_PADDING);
      // Centered on the icon would overflow the right edge, so it is clamped.
      assert.ok(position.x + WINDOW_WIDTH - FRAME_PADDING <= 1440);
      assert.ok(position.x < 1300);
    },
  },
  {
    name: 'Tray popover opens above a Windows bottom taskbar icon',
    run() {
      const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
      const icon = { x: 1700, y: 1048, width: 24, height: 24 };
      const height = 300;
      const position = popoverPosition({ trayBounds: icon, workArea, width: WINDOW_WIDTH, height });
      assert.strictEqual(position.placement, 'above');
      assert.ok(position.y + height - FRAME_PADDING <= 1040);
      assert.strictEqual(position.x, Math.round(1712 - WINDOW_WIDTH / 2));
    },
  },
  {
    name: 'Tray popover falls back to the click point when tray bounds are empty',
    run() {
      const position = popoverPosition({
        trayBounds: { x: 0, y: 0, width: 0, height: 0 },
        point: { x: 700, y: 5 },
        workArea: MAC_DISPLAY.workArea,
        width: WINDOW_WIDTH,
        height: 300,
      });
      assert.strictEqual(position.placement, 'below');
      assert.strictEqual(position.x, Math.round(700 - WINDOW_WIDTH / 2));
    },
  },
  {
    name: 'Tray popover stays hidden until its renderer is ready and reports a height',
    async run() {
      const { popover, window, sender } = makePopover();
      assert.strictEqual(popover.toggle({ trayBounds }), true);
      const win = window();
      assert.strictEqual(win.options.frame, false);
      assert.strictEqual(win.options.webPreferences.sandbox, true);
      assert.strictEqual(win.options.webPreferences.contextIsolation, true);
      assert.strictEqual(win.visible, false);
      const state = popover.handleReady(sender());
      assert.deepStrictEqual(state, { terminals: 2, runs: 1 });
      assert.strictEqual(win.visible, false);
      popover.handleResize(sender(), { height: 300 });
      assert.strictEqual(win.visible, true);
      assert.strictEqual(win.focused, 1);
      assert.strictEqual(win.bounds.height, 300 + FRAME_PADDING * 2);
      popover.dispose();
    },
  },
  {
    name: 'Tray popover reveals after a timeout when the renderer never reports a height',
    async run() {
      const { popover, window, sender } = makePopover();
      popover.toggle({ trayBounds });
      popover.handleReady(sender());
      await new Promise(resolve => setTimeout(resolve, 700));
      assert.strictEqual(window().visible, true);
      popover.dispose();
    },
  },
  {
    name: 'Tray popover blur hides it and the same tray click does not reopen it',
    run() {
      const { popover, window, sender, advance } = makePopover();
      popover.toggle({ trayBounds });
      popover.handleReady(sender());
      popover.handleResize(sender(), { height: 300 });
      const win = window();
      win.emit('blur');
      assert.strictEqual(win.visible, false);
      assert.ok(win.webContents.messages.some(message => message.channel === 'tray-popover:hidden'));
      popover.toggle({ trayBounds });
      assert.strictEqual(win.visible, false, 'click right after blur must not reopen');
      advance(BLUR_REOPEN_GUARD_MS + 1);
      popover.toggle({ trayBounds });
      assert.strictEqual(win.visible, true);
      assert.strictEqual(FakeBrowserWindow.instances.length, 1, 'the window is reused');
      assert.ok(win.webContents.messages.some(message => message.channel === 'tray-popover:state'));
      popover.toggle({ trayBounds });
      assert.strictEqual(win.visible, false, 'a second click closes it');
      popover.dispose();
    },
  },
  {
    name: 'Tray popover rejects IPC from other windows',
    run() {
      const { popover, calls } = makePopover();
      popover.toggle({ trayBounds });
      assert.throws(() => popover.handleQuit({ sender: { id: -1 } }), error => error.code === 'TRAY_POPOVER_UNTRUSTED_SENDER');
      assert.throws(() => popover.handleOpenMain({}), error => error.code === 'TRAY_POPOVER_UNTRUSTED_SENDER');
      assert.strictEqual(calls.quit, 0);
      assert.strictEqual(calls.openMain, 0);
      popover.dispose();
    },
  },
  {
    name: 'Tray popover open and quit actions hide it before calling back',
    run() {
      const { popover, calls, window, sender } = makePopover();
      popover.toggle({ trayBounds });
      popover.handleReady(sender());
      popover.handleResize(sender(), { height: 300 });
      popover.handleOpenMain(sender());
      assert.strictEqual(window().visible, false);
      assert.strictEqual(calls.openMain, 1);
      popover.handleQuit(sender());
      assert.strictEqual(calls.quit, 1);
      popover.dispose();
    },
  },
  {
    name: 'Tray popover release drops its window so all-windows-closed can fire, then rebuilds on demand',
    run() {
      const { popover, window } = makePopover();
      popover.toggle({ trayBounds });
      const first = window();
      popover.release();
      assert.strictEqual(first.destroyed, true);
      assert.strictEqual(popover.isAlive(), false);
      popover.toggle({ trayBounds });
      assert.notStrictEqual(window(), first);
      popover.dispose();
      assert.strictEqual(window().destroyed, true);
      assert.strictEqual(popover.toggle({ trayBounds }), false, 'a disposed popover reports failure');
    },
  },
  {
    name: 'Tray popover refresh sends state only while visible and coalesces bursts',
    async run() {
      const { popover, window, sender } = makePopover();
      popover.toggle({ trayBounds });
      popover.handleReady(sender());
      popover.refresh();
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(window().webContents.messages.filter(message => message.channel === 'tray-popover:state').length, 0);
      popover.handleResize(sender(), { height: 300 });
      popover.refresh();
      popover.refresh();
      popover.refresh();
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(window().webContents.messages.filter(message => message.channel === 'tray-popover:state').length, 1);
      popover.dispose();
    },
  },
  {
    name: 'Tray popover reports failure when its window cannot be created',
    run() {
      class BrokenWindow { constructor() { throw new Error('no window'); } }
      const { popover, calls } = makePopover({ BrowserWindow: BrokenWindow });
      assert.strictEqual(popover.toggle({ trayBounds }), false);
      assert.strictEqual(calls.errors.length, 1);
    },
  },
  {
    name: 'Tray popover window only navigates to its own page',
    run() {
      const { popover, window } = makePopover();
      popover.toggle({ trayBounds });
      let prevented = false;
      window().webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://example.com/');
      assert.strictEqual(prevented, true);
      prevented = false;
      window().webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, pathToFileURL(htmlPath).href);
      assert.strictEqual(prevented, false);
      popover.dispose();
    },
  },
];

module.exports = { registerTrayPopoverTests: context => {
  for (const item of tests) context.test(item.name, item.run);
} };
