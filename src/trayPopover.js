'use strict';

const { pathToFileURL } = require('url');

// The visible card is CARD_WIDTH wide; the transparent frame around it leaves
// room for the CSS shadow because transparent windows draw no native shadow on
// every platform.
const CARD_WIDTH = 340;
const FRAME_PADDING = 12;
const WINDOW_WIDTH = CARD_WIDTH + FRAME_PADDING * 2;
const DEFAULT_HEIGHT = 420;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 720;
const EDGE_MARGIN = 6;
const TRAY_GAP = 2;
// A click on the tray icon while the popover is open first blurs (and hides)
// the popover; the click that follows must not reopen it.
const BLUR_REOPEN_GUARD_MS = 300;
const REVEAL_FALLBACK_MS = 600;

function popoverError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validRect(value) {
  if (!value || typeof value !== 'object') return null;
  const rect = {
    x: Number(value.x),
    y: Number(value.y),
    width: Number(value.width),
    height: Number(value.height),
  };
  if (!Object.values(rect).every(Number.isFinite)) return null;
  return rect;
}

// Places the window next to the tray icon: below it when the icon sits in the
// upper half of its display (macOS menu bar, top taskbars), otherwise above it
// (Windows bottom taskbar). Without usable tray bounds it anchors to `point`.
function popoverPosition({ trayBounds, point, workArea, width, height }) {
  const area = validRect(workArea);
  if (!area) throw popoverError('TRAY_POPOVER_NO_WORK_AREA', 'A display work area is required.');
  const tray = validRect(trayBounds);
  const anchor = tray && tray.width > 0 && tray.height > 0
    ? tray
    : { x: Number(point && point.x) || area.x + area.width, y: Number(point && point.y) || area.y, width: 0, height: 0 };
  const centerX = anchor.x + anchor.width / 2;
  const centerY = anchor.y + anchor.height / 2;
  const below = centerY < area.y + area.height / 2;
  const minX = area.x + EDGE_MARGIN - FRAME_PADDING;
  const maxX = area.x + area.width - width - EDGE_MARGIN + FRAME_PADDING;
  // Vertically the card may touch the work area edge: on macOS that edge is
  // the bottom of the menu bar the icon sits in.
  const minY = area.y - FRAME_PADDING;
  const maxY = area.y + area.height - height + FRAME_PADDING;
  const rawX = centerX - width / 2;
  const rawY = below
    ? anchor.y + anchor.height + TRAY_GAP - FRAME_PADDING
    : anchor.y - height - TRAY_GAP + FRAME_PADDING;
  return {
    x: Math.round(Math.min(Math.max(rawX, minX), Math.max(minX, maxX))),
    y: Math.round(Math.min(Math.max(rawY, minY), Math.max(minY, maxY))),
    placement: below ? 'below' : 'above',
  };
}

class TrayPopover {
  constructor(options = {}) {
    if (typeof options.BrowserWindow !== 'function') throw new TypeError('BrowserWindow is required.');
    if (!options.screen || typeof options.screen.getDisplayMatching !== 'function') throw new TypeError('screen is required.');
    if (!options.preloadPath || !options.htmlPath) throw new TypeError('preloadPath and htmlPath are required.');
    if (typeof options.getState !== 'function') throw new TypeError('getState is required.');
    this.BrowserWindow = options.BrowserWindow;
    this.screen = options.screen;
    this.preloadPath = options.preloadPath;
    this.htmlPath = options.htmlPath;
    this.allowedUrl = pathToFileURL(options.htmlPath).href;
    this.getState = options.getState;
    this.onOpenMain = typeof options.onOpenMain === 'function' ? options.onOpenMain : () => {};
    this.onQuit = typeof options.onQuit === 'function' ? options.onQuit : () => {};
    this.onError = typeof options.onError === 'function' ? options.onError : () => {};
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.window = null;
    this.ready = false;
    this.height = DEFAULT_HEIGHT;
    this.anchor = null;
    this.hiddenByBlurAt = 0;
    this.refreshQueued = false;
    this.pendingReveal = false;
    this.revealTimer = null;
    this.disposed = false;
  }

  report(error, phase) {
    try { this.onError(error, { phase }); } catch {}
  }

  isAlive() {
    return Boolean(this.window && (typeof this.window.isDestroyed !== 'function' || !this.window.isDestroyed()));
  }

  isVisible() {
    return this.isAlive() && typeof this.window.isVisible === 'function' && this.window.isVisible();
  }

  isSender(event) {
    return Boolean(this.isAlive() && event && event.sender && this.window.webContents
      && event.sender.id === this.window.webContents.id);
  }

  requireSender(event) {
    if (!this.isSender(event)) throw popoverError('TRAY_POPOVER_UNTRUSTED_SENDER', 'Tray popover request came from an unexpected window.');
  }

  createWindow() {
    const win = new this.BrowserWindow({
      width: WINDOW_WIDTH,
      height: this.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
      },
    });
    this.window = win;
    this.ready = false;
    if (typeof win.setAlwaysOnTop === 'function') win.setAlwaysOnTop(true, 'pop-up-menu');
    if (typeof win.setVisibleOnAllWorkspaces === 'function') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (typeof win.setMenuBarVisibility === 'function') win.setMenuBarVisibility(false);
    const contents = win.webContents;
    if (contents && typeof contents.setWindowOpenHandler === 'function') contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    if (contents && typeof contents.on === 'function') {
      contents.on('will-navigate', (event, url) => {
        if (url !== this.allowedUrl && event && typeof event.preventDefault === 'function') event.preventDefault();
      });
      contents.on('render-process-gone', (_event, details) => {
        this.report(popoverError('TRAY_POPOVER_RENDERER_GONE', `Tray popover renderer exited: ${details && details.reason || 'unknown'}`), 'renderer-gone');
        this.discardWindow();
      });
    }
    if (typeof win.on === 'function') {
      win.on('blur', () => {
        if (!this.isVisible()) return;
        this.hiddenByBlurAt = this.now();
        this.hide();
      });
      win.on('closed', () => {
        if (this.window === win) {
          this.window = null;
          this.ready = false;
        }
      });
    }
    try {
      const load = win.loadFile(this.htmlPath);
      if (load && typeof load.catch === 'function') {
        load.catch(error => {
          this.report(error, 'load-file');
          this.discardWindow();
        });
      }
    } catch (error) {
      this.discardWindow();
      throw error;
    }
    return win;
  }

  discardWindow() {
    const win = this.window;
    this.window = null;
    this.ready = false;
    if (!win) return;
    try {
      if (typeof win.isDestroyed !== 'function' || !win.isDestroyed()) win.destroy();
    } catch (error) { this.report(error, 'destroy-window'); }
  }

  // Returns false when the popover could not be shown so the caller can fall
  // back to the native tray menu.
  toggle(anchor = {}) {
    if (this.disposed) return false;
    if (this.isVisible()) {
      this.hide();
      return true;
    }
    if (this.now() - this.hiddenByBlurAt < BLUR_REOPEN_GUARD_MS) return true;
    return this.show(anchor);
  }

  show(anchor = {}) {
    if (this.disposed) return false;
    this.anchor = { trayBounds: validRect(anchor.trayBounds), point: anchor.point || null };
    try {
      if (!this.isAlive()) this.createWindow();
      this.position();
      if (this.ready) {
        this.sendState();
        this.reveal();
      }
      // Before the first ready signal the window stays hidden; handleReady
      // reveals it once the renderer has painted real content.
      this.pendingReveal = !this.ready;
      return true;
    } catch (error) {
      this.report(error, 'show');
      this.discardWindow();
      return false;
    }
  }

  reveal() {
    if (!this.isAlive()) return;
    this.window.show();
    if (typeof this.window.focus === 'function') this.window.focus();
  }

  hide() {
    this.pendingReveal = false;
    clearTimeout(this.revealTimer);
    this.revealTimer = null;
    if (!this.isAlive()) return;
    try {
      if (typeof this.window.isVisible !== 'function' || this.window.isVisible()) this.window.hide();
      this.send('tray-popover:hidden', {});
    } catch (error) { this.report(error, 'hide'); }
  }

  position() {
    if (!this.isAlive()) return;
    const anchor = this.anchor || {};
    const reference = anchor.trayBounds && anchor.trayBounds.width > 0
      ? anchor.trayBounds
      : { ...(anchor.point || this.cursorPoint()), width: 1, height: 1 };
    const display = this.screen.getDisplayMatching(reference);
    const workArea = display && (display.workArea || display.bounds);
    const point = anchor.point || this.cursorPoint();
    const { x, y } = popoverPosition({ trayBounds: anchor.trayBounds, point, workArea, width: WINDOW_WIDTH, height: this.height });
    this.window.setBounds({ x, y, width: WINDOW_WIDTH, height: this.height });
  }

  cursorPoint() {
    try {
      return typeof this.screen.getCursorScreenPoint === 'function' ? this.screen.getCursorScreenPoint() : { x: 0, y: 0 };
    } catch {
      return { x: 0, y: 0 };
    }
  }

  send(channel, payload) {
    if (!this.isAlive() || !this.window.webContents) return;
    const contents = this.window.webContents;
    if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return;
    try { contents.send(channel, payload); } catch (error) { this.report(error, 'send'); }
  }

  state() {
    try {
      return this.getState();
    } catch (error) {
      this.report(error, 'state');
      return null;
    }
  }

  sendState() {
    const state = this.state();
    if (state) this.send('tray-popover:state', state);
  }

  // Coalesces bursts of terminal and run changes into one update, and only
  // while the popover is on screen.
  refresh() {
    if (this.disposed || this.refreshQueued || !this.isVisible() || !this.ready) return;
    this.refreshQueued = true;
    setImmediate(() => {
      this.refreshQueued = false;
      if (this.isVisible() && this.ready) this.sendState();
    });
  }

  handleReady(event) {
    this.requireSender(event);
    this.ready = true;
    // The renderer reports its measured height right after rendering this
    // state, and that resize reveals the window at its final size. The timer
    // only covers a renderer that never reports.
    if (this.pendingReveal) {
      clearTimeout(this.revealTimer);
      this.revealTimer = setTimeout(() => this.flushReveal(), REVEAL_FALLBACK_MS);
    }
    return this.state();
  }

  flushReveal() {
    clearTimeout(this.revealTimer);
    this.revealTimer = null;
    if (!this.pendingReveal) return;
    this.pendingReveal = false;
    this.reveal();
  }

  handleResize(event, payload) {
    this.requireSender(event);
    const requested = Math.round(Number(payload && payload.height));
    if (!Number.isFinite(requested)) return { height: this.height };
    const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, requested + FRAME_PADDING * 2));
    if (next !== this.height) {
      this.height = next;
      this.position();
    }
    if (this.pendingReveal && this.ready) this.flushReveal();
    return { height: this.height };
  }

  handleOpenMain(event) {
    this.requireSender(event);
    this.hide();
    this.onOpenMain();
    return { ok: true };
  }

  handleQuit(event) {
    this.requireSender(event);
    this.hide();
    this.onQuit();
    return { ok: true };
  }

  handleDismiss(event) {
    this.requireSender(event);
    this.hide();
    return { ok: true };
  }

  // Drops the window but keeps the popover usable; the next show() builds a
  // new one. A hidden window still counts as open, so it must not outlive the
  // main window or Electron never reports that all windows closed.
  release() {
    this.pendingReveal = false;
    clearTimeout(this.revealTimer);
    this.revealTimer = null;
    this.discardWindow();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.revealTimer);
    this.discardWindow();
  }
}

module.exports = {
  TrayPopover,
  popoverPosition,
  CARD_WIDTH,
  FRAME_PADDING,
  WINDOW_WIDTH,
  BLUR_REOPEN_GUARD_MS,
};
