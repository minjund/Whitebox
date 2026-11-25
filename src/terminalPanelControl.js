'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { scanProcesses } = require('./processMonitor');
const { main: localRequest } = require('../bin/panel-agent');
const REMOTE_KEYS = Object.freeze({ enter: '\r', esc: '\x1b', tab: '\t', 'shift-tab': '\x1b[Z', up: '\x1b[A', down: '\x1b[B',
  right: '\x1b[C', left: '\x1b[D', backspace: '\x7f', 'ctrl-c': '\x03' });
class TerminalPanelControl {
  constructor(collaboration) { this.owner = collaboration; this.pending = new Map(); }
  async start() {
    if (this.starting) return this.starting;
    this.starting = this.listen();
    try { return await this.starting; } catch (error) { this.starting = null; throw error; }
  }
  async listen() {
    const id = randomUUID();
    this.endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\whitebox-panel-${id}` : path.join(os.tmpdir(), `wb-panel-${id}.sock`);
    this.token = randomUUID();
    this.server = net.createServer(socket => {
      socket.setEncoding('utf8'); socket.setTimeout(10000, () => socket.destroy());
      let buffer = '', received = false;
      socket.on('error', () => {});
      socket.on('data', chunk => {
        if (received) return;
        buffer += chunk;
        if (buffer.length > 32000) return socket.destroy();
        if (!buffer.includes('\n')) return;
        received = true;
        const reply = frame => socket.end(JSON.stringify(frame) + '\n');
        let request;
        try { request = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))); if (request.token !== this.token) throw new Error('Panel control authentication failed'); }
        catch (error) { reply({ ok: false, error: error.message }); return; }
        // A live phone view keeps its connection open: screen out, keys in.
        if (request.method === 'remote.attach') { this.stream(socket, request, buffer.slice(buffer.indexOf('\n') + 1)); return; }
        this.owner.serialize(() => this.handle(request.method, request.params || {}))
          .then(result => reply({ id: request.id, ok: true, result }), error => reply({ id: request.id, ok: false, error: error.message }));
      });
    });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.endpoint, resolve); });
    if (process.platform !== 'win32') fs.chmodSync(this.endpoint, 0o600);
    this.server.unref();
    this.owner.write(path.join(this.owner.directory, 'control.json'), { endpoint: this.endpoint, token: this.token, protocol: 1 });
  }
  async source(params) {
    const c = this.owner;
    const all = [...c.groups.values()].flatMap(group => group.members.map(member => ({ group, member })));
    const matches = all.filter(({ member }) => params.sourceId ? member.id === params.sourceId : (params.ancestorPids || []).includes(member.pid));
    if (matches.length !== 1) throw new Error('Run whitebox inside a panel terminal, or select an exact --source terminal ID.');
    const { group, member } = matches[0], live = await c.manager().get(member.id, false);
    if (!live || live.creationId !== member.creationId || live.pid !== member.pid || live.status !== 'running') throw new Error('Source terminal session changed');
    if (!c.updatedAt || c.now() - c.updatedAt > 10000) throw new Error('Panel membership is stale. Wait for Whitebox to refresh.');
    return { group, member };
  }
  // Phone access (whitebox phone / whitebox connect over SSH). The person who
  // owns this Mac account works every panel like a keyboard, so it is not tied
  // to a source terminal. The CLI refuses to run inside a Whitebox terminal.
  remotePanels() {
    const c = this.owner;
    if (!c.updatedAt || c.now() - c.updatedAt > 30000) throw new Error('Whitebox screen is not ready. Check that the app is open.');
    return [...c.groups.values()];
  }
  async remoteMember(params) {
    const c = this.owner;
    const found = this.remotePanels().flatMap(group => group.members.map(member => ({ group, member }))).filter(({ member }) => member.id === params.surface_id);
    if (found.length !== 1) throw new Error('Choose a running terminal ID from the list.');
    const { group, member } = found[0], live = await c.manager().get(member.id, false);
    if (!live || live.creationId !== member.creationId || live.pid !== member.pid || live.status !== 'running') throw new Error('Terminal session changed; open the list again.');
    return { group, member, live };
  }
  // A live view of one terminal, as herdr's terminal.attach: the current
  // screen first, then its raw output. Keys, size and focus come back as
  // JSON lines; the size follows the most recently active viewer.
  async stream(socket, request, rest) {
    socket.setTimeout(0);
    const viewers = this.owner.viewers, params = request.params || {};
    const write = frame => { if (!socket.destroyed) socket.write(JSON.stringify(frame) + '\n'); };
    let viewer = null, closed = false, queue = Promise.resolve(), buffer = rest;
    socket.on('close', () => { closed = true; if (viewer) viewers.detach(viewer).catch(() => {}); });
    try {
      if (!viewers) throw new Error('Live terminals are not available in this Whitebox.');
      const { group, member } = await this.owner.serialize(() => this.remoteMember(params));
      write({ id: request.id, ok: true, result: { surface_id: member.id, panel: group.name, title: member.title, provider: member.provider || '', observe: Boolean(params.observe) } });
      viewer = await viewers.attach(member.id, { cols: params.cols, rows: params.rows, observe: Boolean(params.observe),
        send: frame => { write(frame); return socket.writableLength < viewers.backlog(); } });
      if (closed) { await viewers.detach(viewer); return; }
    } catch (error) {
      if (viewer) write({ type: 'end', reason: error.message });
      else write({ id: request.id, ok: false, error: error.message });
      socket.end(); return;
    }
    const line = text => {
      let message; try { message = JSON.parse(text); } catch { return; }
      if (message?.type === 'input' && typeof message.data === 'string' && message.data.length <= 65536) queue = queue.then(() => viewers.input(viewer, message.data)).catch(() => {});
      else if (message?.type === 'resize') queue = queue.then(() => viewers.resize(viewer, message.cols, message.rows)).catch(() => {});
      else if (message?.type === 'focus') queue = queue.then(() => viewers.focus(viewer)).catch(() => {});
      else if (message?.type === 'detach') socket.end();
    };
    const take = () => {
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) { line(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
      if (buffer.length > 1024 * 1024) socket.destroy();
    };
    socket.on('data', chunk => { buffer += chunk; take(); });
    socket.on('drain', () => { Promise.resolve(viewers.drained(viewer)).catch(() => {}); });
    take();
  }
  async remote(method, params) {
    const c = this.owner;
    const panels = this.remotePanels();
    if (method === 'remote.list') return { panels: panels.map(group => ({ id: group.id, name: group.name,
      terminals: group.surfaces.map(surface => {
        const member = group.members.find(item => item.id === surface.id);
        return { id: surface.id, title: surface.title, running: Boolean(member), provider: member?.provider || '',
          state: member ? member.activity?.state || 'unknown' : surface.status, ready: Boolean(member?.ready),
          watching: Boolean(member && c.viewers?.watched(member.id)) };
      }) })) };
    const { group, member, live } = await this.remoteMember(params);
    const frame = c.frames.get(member.id), current = frame && frame.creationId === live.creationId ? frame : null;
    if (method === 'remote.read') {
      const lines = Math.max(1, Math.min(2000, Number(params.lines) || 200));
      return { surface_id: member.id, panel: group.name, title: member.title, provider: member.provider || '', state: member.activity?.state || 'unknown',
        // The screen holds blank rows below the cursor; the last lines are the last written ones.
        text: current ? current.text.replace(/\s+$/u, '').split('\n').slice(-lines).join('\n') : '', capturedAt: current?.at || null,
        current: Boolean(current && current.outputSequence === live.outputSequence) };
    }
    let data;
    if (method === 'remote.send') {
      const text = String(params.text ?? '').replace(/\r\n?/gu, '\n'), submit = params.submit !== false;
      if (text.length > 8000 || /[\x00-\x08\x0b-\x1f\x7f]/u.test(text) || !text && !submit) throw new Error('Invalid terminal text');
      // An AI CLI always takes a paste; a shell only when it enabled bracketed paste.
      const paste = Boolean(member.provider || current?.bracketedPaste);
      if (!paste && /[\n\t]/u.test(text)) throw new Error('This terminal takes one line at a time.');
      data = (text ? paste ? `\x1b[200~${text}\x1b[201~` : text : '') + (submit ? '\r' : '');
    } else if (method === 'remote.key') {
      const key = String(params.key || '');
      data = REMOTE_KEYS[key] || (/^[a-zA-Z0-9]$/u.test(key) ? key : '');
      if (!data) throw new Error(`Unknown key: ${key}`);
    } else throw new Error('Unknown remote method');
    await c.manager().write(member.id, data, { deliveryId: `remote:${randomUUID()}` });
    return { surface_id: member.id, ok: true };
  }
  async handle(method, params) {
    if (/^remote\./u.test(method)) return this.remote(method, params);
    const c = this.owner, { group, member } = await this.source(params);
    if (method === 'system.identify') return { workspace_id: group.id, surface_id: member.id, panelName: group.name };
    if (method === 'surface.list') return { workspace_id: group.id, surface_id: member.id,
      surfaces: group.surfaces.map(surface => ({ ...surface, ...group.members.find(item => item.id === surface.id) })) };
    if (method === 'surface.close') {
      // Closing a pane is explicit and must also work after its process exited.
      // Live members still define source authority; renderer-owned surfaces
      // retain the exact identity of stopped or already-removed panes.
      const matches = group.surfaces.filter(item => item.id === params.surface_id);
      if (matches.length !== 1) throw new Error('Choose an exact surface ID from whitebox list-panels in this panel.');
      const target = matches[0];
      if (target.id === member.id) throw new Error('Run close-terminal from another terminal; the invoking terminal cannot close itself.');
      const manager = c.manager(), live = await manager.get(target.id, false);
      const stopped = live && !live.pid && ['stopped', 'exited', 'failed'].includes(live.status)
        && !live.terminationPending && !live.terminationUncertain;
      if (live && (live.creationId !== target.creationId || (live.pid !== target.pid && !stopped))) throw new Error('Target terminal session changed; refresh the panel first.');
      if (live) await manager.close(target.id);
      if (await manager.get(target.id, false)) throw new Error('Terminal removal was not confirmed; the pane was not closed.');
      // The host emits removal for live sessions. Also notify for a stale pane
      // whose host record was removed before this command was available.
      await c.onTerminalClosed({ ...target, pid: null, status: 'exited' });
      group.members = group.members.filter(item => item.id !== target.id);
      group.surfaces = group.surfaces.filter(item => item.id !== target.id);
      c.frames.delete(target.id); this.pending.delete(target.id);
      c.connected.delete(target.id); c.accessSnapshots.delete(target.id);
      await fs.promises.rm(c.file(target.id, 'access'), { force: true });
      for (const job of c.jobs.values()) if (job.targetId === target.id && ['queued', 'starting', 'sending', 'running'].includes(job.state)) {
        Object.assign(job, { state: 'interrupted', error: 'Target terminal was closed.', finishedAt: c.now() }); c.save(job);
      }
      return { workspace_id: group.id, surface_id: target.id, closed: true };
    }
    if (method === 'job.read') return localRequest([member.id, 'wait', params.jobId, '0'], c.directory);
    if (method === 'surface.create') {
      const count = params.count ?? 1;
      if (!['codex', 'claude'].includes(params.provider) || !Number.isInteger(count) || count < 1 || count > 8) throw new Error('Choose codex or claude and a count from 1 to 8.');
      const pending = [...c.jobs.values()].filter(job => job.groupId === group.id && job.operation === 'new' && ['queued', 'starting'].includes(job.state) && !group.members.some(item => item.id === job.targetId)).length;
      if (group.members.length + pending + count > 64) throw new Error('This panel supports at most 64 terminals.');
      const jobs = [];
      for (let index = 0; index < count; index++) {
        const job = await localRequest([member.id, 'new', params.provider], c.directory);
        await c.poll();
        const current = c.jobs.get(job.id);
        jobs.push({ id: current.id, state: current.state, terminal: current.terminal, error: current.error });
        if (current.state === 'failed' || current.state === 'interrupted') break;
      }
      return { workspace_id: group.id, jobs, next: 'Wait for each creation job, then list-panels and check ready before ask.' };
    }
    const targetId = params.surface_id || member.id;
    const matches = group.members.filter(item => item.id === targetId || (['claude', 'codex'].includes(targetId) && item.provider === targetId && item.id !== member.id));
    if (matches.length !== 1) throw new Error('Choose an exact surface ID from whitebox list-panels in this panel.');
    const target = matches[0];
    if (method === 'surface.read_text') {
      const live = await c.manager().get(target.id, false), frame = c.frames.get(target.id);
      if (!live || live.creationId !== target.creationId || live.pid !== target.pid || !frame || frame.creationId !== live.creationId || c.now() - frame.at > 10000) throw new Error('Screen is not current. Retry after the next frame.');
      const lines = Math.max(1, Math.min(2000, Number(params.lines) || 200));
      return { surface_id: target.id, text: frame.text.split('\n').slice(-lines).join('\n'), outputSequence: frame.outputSequence, capturedAt: frame.at, current: frame.outputSequence === live.outputSequence };
    }
    if (!target.provider && ['surface.send_text', 'surface.send_key'].includes(method)) {
      const live = await c.manager().get(target.id, false), frame = c.frames.get(target.id);
      if (!live || live.creationId !== target.creationId || live.pid !== target.pid || live.status !== 'running'
        || !frame || frame.creationId !== live.creationId || frame.outputSequence !== live.outputSequence || c.now() - frame.at > 10000) throw new Error('Terminal state changed; retry after the next frame.');
      if (require('./terminalReview').exactProcess(live, await scanProcesses(c.monitor))) throw new Error('An AI started in this terminal; refresh the panel first.');
      if (frame.inputDraft) throw new Error('Terminal has an input draft');
      if (!c.manager().rawWriteDeliverySupported?.()) throw new Error('Terminal host does not support guarded writes');
      let data;
      if (method === 'surface.send_text') {
        const text = String(params.text || '');
        if (!text || text.length > 8000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) throw new Error('Invalid terminal text');
        const submit = /[\r\n]$/u.test(text), body = text.replace(/[\r\n]+$/u, '');
        // Old Bash/readline and cmd do not enable bracketed paste. Match the
        // current emulator mode; never turn a multiline paste into keystrokes
        // that could execute its individual lines on an unsupported shell.
        if (!frame.bracketedPaste && /[\r\n\t]/u.test(body)) throw new Error('This terminal requires bracketed paste for multiline or tabbed text');
        data = frame.bracketedPaste ? `\x1b[200~${body}\x1b[201~${submit ? '\r' : ''}` : `${body}${submit ? '\r' : ''}`;
        this.pending.delete(target.id);
        await c.manager().write(target.id, data, { deliveryId: `panel-shell:${randomUUID()}`, expectedOutputSequence: frame.outputSequence });
        if (!submit) this.pending.set(target.id, { text: body, creationId: live.creationId, sourceId: member.id, groupId: group.id });
        return { surface_id: target.id, submitted: submit };
      }
      const pending = this.pending.get(target.id);
      if (params.key !== 'enter' || !pending || pending.sourceId !== member.id || pending.groupId !== group.id || pending.creationId !== live.creationId) throw new Error('No pending whitebox send');
      this.pending.delete(target.id);
      await c.manager().write(target.id, '\r', { deliveryId: `panel-shell-enter:${randomUUID()}`, expectedOutputSequence: frame.outputSequence });
      return { surface_id: target.id, submitted: true };
    }
    if (method === 'surface.ask' || (method === 'surface.send_text' && /[\r\n]$/u.test(params.text || ''))) {
      const job = await localRequest([member.id, 'ask', target.id, String(params.text || '').replace(/[\r\n]+$/u, '')], c.directory);
      await c.poll(); return { ...job, state: c.jobs.get(job.id).state, error: c.jobs.get(job.id).error };
    }
    if (method === 'surface.send_text') {
      const text = String(params.text || '');
      if (!text || text.length > 8000 || /[\x00-\x08\x0b-\x1f\x7f]/u.test(text)) throw new Error('Invalid terminal text');
      const before = await c.target(group.id, target.id);
      // Same draft/idle/native-state checks as an atomic submit; paste only.
      await c.send(group.id, target.id, text, `panel-paste:${randomUUID()}`, null, false);
      this.pending.set(target.id, { text, creationId: before.live.creationId, providerPid: before.child.pid, sourceId: member.id, groupId: group.id });
      return { surface_id: target.id, submitted: false };
    }
    if (method === 'surface.send_key') {
      if (params.key !== 'enter') throw new Error('Only enter after a whitebox send is supported.');
      const pending = this.pending.get(target.id), current = await c.target(group.id, target.id);
      if (!pending || pending.sourceId !== member.id || pending.groupId !== group.id || pending.creationId !== current.live.creationId || pending.providerPid !== current.child.pid) throw new Error('No matching pending whitebox send');
      // Do not compare the screen with the pending text: CLIs collapse
      // multi-line pastes (e.g. "[Pasted text +N lines]"), which made every
      // multi-line orchestration send look edited and withheld Enter.
      const native = await c.completion.observe(current.child);
      if (native.available && native.state === 'working') throw new Error('Target is working');
      this.pending.delete(target.id);
      await c.manager().write(target.id, '\r', { deliveryId: `panel-enter:${randomUUID()}`, expectedOutputSequence: current.frame.outputSequence });
      return { surface_id: target.id, submitted: true };
    }
    throw new Error('Unknown panel control method');
  }
  async close() {
    if (!this.server) return;
    await new Promise(resolve => this.server.close(resolve));
    try { const file = path.join(this.owner.directory, 'control.json'); if (JSON.parse(fs.readFileSync(file)).token === this.token) fs.rmSync(file); } catch {}
  }
}
module.exports = { TerminalPanelControl, REMOTE_KEYS };
