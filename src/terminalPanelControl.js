'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { main: localRequest } = require('../bin/panel-agent');
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
  async handle(method, params) {
    const c = this.owner, { group, member } = await this.source(params);
    if (method === 'system.identify') return { workspace_id: group.id, surface_id: member.id, panelName: group.name };
    if (method === 'surface.list') return { workspace_id: group.id, surface_id: member.id, surfaces: group.members };
    if (method === 'job.read') return localRequest([member.id, 'wait', params.jobId, '0'], c.directory);
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
      if (require('./terminalReview').exactProcess(live, c.monitor.scan())) throw new Error('An AI started in this terminal; refresh the panel first.');
      if (frame.inputDraft) throw new Error('Terminal has an input draft');
      if (!c.manager().rawWriteDeliverySupported?.()) throw new Error('Terminal host does not support guarded writes');
      let data;
      if (method === 'surface.send_text') {
        const text = String(params.text || '');
        if (!text || text.length > 8000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) throw new Error('Invalid terminal text');
        const submit = /[\r\n]$/u.test(text), body = text.replace(/[\r\n]+$/u, '');
        data = `\x1b[200~${body}\x1b[201~${submit ? '\r' : ''}`;
        this.pending.delete(target.id);
        await c.manager().write(target.id, data, { deliveryId: `panel-shell:${randomUUID()}`, expectedOutputSequence: frame.outputSequence });
        if (!submit) this.pending.set(target.id, { text: body, creationId: live.creationId, sourceId: member.id, groupId: group.id });
        return { surface_id: target.id, submitted: submit };
      }
      const pending = this.pending.get(target.id);
      if (params.key !== 'enter' || !pending || pending.sourceId !== member.id || pending.groupId !== group.id || pending.creationId !== live.creationId || !frame.text.trimEnd().endsWith(pending.text)) throw new Error('No unchanged pending whitebox send');
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
      const { submittedPrompt } = require('./terminalReviewTurns');
      // Never submit text subsequently edited by a user.
      const draft = submittedPrompt(current.frame.readinessText ?? current.frame.text);
      if (current.frame.inputDraft || draft.trim() !== pending.text.trim()) throw new Error('Terminal draft changed; Enter was not sent.');
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
module.exports = { TerminalPanelControl };
