'use strict';
// Live phone viewers of Whitebox terminals (whitebox phone / connect over SSH).
// Size follows herdr-core (crates/herdr-core/src/viewers.rs): the most
// recently active viewer that types sets the terminal size. Attaching,
// typing, resizing or focusing makes a viewer active; observers never type or
// resize. The desktop pane is a viewer too. When the last phone leaves, the
// terminal returns to the desktop pane's size.
const { EventEmitter } = require('events');

// A viewer that falls this far behind gets a fresh paint instead of the backlog.
const MAX_BACKLOG = 4 * 1024 * 1024;
const MAX_REPLAY = 512 * 1024;

function dimension(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

// The current screen as ANSI, at the size the program now draws at: the
// session's raw output replayed through a headless emulator.
async function paintScreen(replay, from, to) {
  const { Terminal } = require('@xterm/headless');
  const { SerializeAddon } = require('@xterm/addon-serialize');
  const terminal = new Terminal({ cols: from.cols, rows: from.rows, scrollback: 1000, allowProposedApi: true });
  const serializer = new SerializeAddon();
  terminal.loadAddon(serializer);
  const text = String(replay || '');
  await new Promise(resolve => terminal.write(text.length > MAX_REPLAY ? text.slice(-MAX_REPLAY) : text, resolve));
  if (to.cols !== from.cols || to.rows !== from.rows) terminal.resize(to.cols, to.rows);
  const screen = serializer.serialize({ scrollback: 200 });
  terminal.dispose();
  // Reset the viewer's screen and modes first, then draw.
  return `\x1b[!p\x1b[H\x1b[2J\x1b[3J${screen}`;
}

class TerminalViewers extends EventEmitter {
  constructor({ manager, paint = paintScreen } = {}) {
    super();
    this.manager = manager;
    this.paint = paint;
    this.entries = new Map();
    this.clock = 0;
    this.keys = 0;
  }

  tick() { this.clock += 1; return this.clock; }

  // True while a phone is attached to this terminal.
  watched(id) { return Boolean(this.entries.get(id)?.phones.size); }

  leader(entry) {
    let best = entry.desk ? { kind: 'desk', cols: entry.desk.cols, rows: entry.desk.rows, at: entry.desk.at } : null;
    for (const viewer of entry.phones.values()) {
      if (viewer.observe) continue;
      if (!best || viewer.at > best.at) best = { kind: 'phone', cols: viewer.cols, rows: viewer.rows, at: viewer.at, viewer };
    }
    return best;
  }

  async apply(id) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const leader = this.leader(entry);
    if (!leader) return null;
    const phone = leader.kind === 'phone';
    let result = { ok: true, cols: leader.cols, rows: leader.rows };
    if (!entry.applied || entry.applied.cols !== leader.cols || entry.applied.rows !== leader.rows) {
      entry.applied = { cols: leader.cols, rows: leader.rows };
      result = await this.manager().resize(id, leader.cols, leader.rows);
    }
    if (entry.phone !== phone || entry.reported !== entry.phones.size) {
      entry.phone = phone;
      entry.reported = entry.phones.size;
      this.emit('change', { id, phone, watching: entry.phones.size, cols: leader.cols, rows: leader.rows });
    }
    if (!entry.phones.size) this.entries.delete(id);
    return result;
  }

  // The desktop pane fitted its grid. A real change of size counts as
  // activity, as a resize does for any herdr viewer.
  async deskResize(id, cols, rows) {
    const entry = this.entries.get(id);
    if (!entry) return this.manager().resize(id, cols, rows);
    const changed = !entry.desk || entry.desk.cols !== cols || entry.desk.rows !== rows;
    entry.desk = { cols, rows, at: changed ? this.tick() : entry.desk.at };
    await this.apply(id);
    return { ok: true, cols, rows };
  }

  // Typing, clicking or pasting in the desktop pane takes the size back.
  async deskActive(id) {
    const entry = this.entries.get(id);
    if (!entry || !entry.desk) return false;
    entry.desk.at = this.tick();
    await this.apply(id);
    return true;
  }

  async attach(id, { cols, rows, observe = false, send }) {
    const live = await this.manager().get(id, true);
    if (!live || live.status !== 'running') throw new Error('This terminal is not running.');
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { desk: { cols: live.cols, rows: live.rows, at: 0 }, phones: new Map(), applied: { cols: live.cols, rows: live.rows }, phone: false, reported: 0 };
      this.entries.set(id, entry);
    }
    const viewer = {
      key: ++this.keys, id, observe: Boolean(observe), send,
      cols: dimension(cols, 80, 2, 500), rows: dimension(rows, 24, 1, 200),
      at: observe ? 0 : this.tick(), sequence: live.outputSequence, ready: false, held: [], stale: false,
    };
    entry.phones.set(viewer.key, viewer);
    const size = await this.apply(id) || { cols: live.cols, rows: live.rows };
    await this.repaint(viewer, live, size);
    return viewer;
  }

  // First paint, or a fresh one after the viewer fell behind.
  async repaint(viewer, live = null, size = null) {
    viewer.ready = false;
    const current = live || await this.manager().get(viewer.id, true);
    if (!current) return this.end(viewer.id, 'This terminal was closed.');
    const target = size || this.entries.get(viewer.id)?.applied || { cols: current.cols, rows: current.rows };
    const screen = await this.paint(current.replay, { cols: current.cols, rows: current.rows }, target);
    viewer.sequence = current.outputSequence;
    viewer.stale = false;
    viewer.send({ type: 'paint', data: screen, cols: target.cols, rows: target.rows });
    viewer.ready = true;
    for (const held of viewer.held.splice(0)) this.deliver(viewer, held);
  }

  deliver(viewer, payload) {
    if (viewer.stale || payload.outputSequence <= viewer.sequence) return;
    viewer.sequence = payload.outputSequence;
    if (viewer.send({ type: 'output', data: payload.data }) === false) viewer.stale = true;
  }

  // Terminal output from the host: fan out to every phone on that terminal.
  data(payload) {
    const entry = this.entries.get(payload?.id);
    if (!entry) return;
    for (const viewer of entry.phones.values()) {
      if (!viewer.ready) viewer.held.push(payload);
      else this.deliver(viewer, payload);
    }
  }

  // The socket drained after the viewer fell behind: send the screen again.
  drained(viewer) {
    if (viewer.stale && this.entries.get(viewer.id)?.phones.has(viewer.key)) return this.repaint(viewer);
    return null;
  }

  backlog() { return MAX_BACKLOG; }

  async input(viewer, data) {
    if (viewer.observe || !this.entries.get(viewer.id)?.phones.has(viewer.key)) return false;
    viewer.at = this.tick();
    await this.apply(viewer.id);
    await this.manager().write(viewer.id, data);
    return true;
  }

  async resize(viewer, cols, rows) {
    viewer.cols = dimension(cols, viewer.cols, 2, 500);
    viewer.rows = dimension(rows, viewer.rows, 1, 200);
    if (viewer.observe || !this.entries.get(viewer.id)?.phones.has(viewer.key)) return;
    viewer.at = this.tick();
    await this.apply(viewer.id);
  }

  async focus(viewer) {
    if (viewer.observe || !this.entries.get(viewer.id)?.phones.has(viewer.key)) return;
    viewer.at = this.tick();
    await this.apply(viewer.id);
  }

  async detach(viewer) {
    const entry = this.entries.get(viewer.id);
    if (!entry || !entry.phones.delete(viewer.key)) return;
    await this.apply(viewer.id);
  }

  // The terminal ended or was removed: tell its phones and forget it.
  end(id, reason = 'This terminal ended.') {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    for (const viewer of entry.phones.values()) viewer.send({ type: 'end', reason });
    this.emit('change', { id, phone: false, watching: 0 });
  }

  state(payload) {
    const session = payload?.session;
    if (!session?.id || !this.entries.has(session.id)) return;
    if (payload.change === 'removed' || (session.status && session.status !== 'running')) this.end(session.id);
  }
}

module.exports = { TerminalViewers, paintScreen, MAX_BACKLOG };
