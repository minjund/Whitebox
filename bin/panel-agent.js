#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const safeId = value => /^[a-zA-Z0-9:._-]{1,200}$/u.test(value || '');
async function main(argv = process.argv.slice(2), directory = __dirname) {
  const [sourceId, op, target, ...rest] = argv;
  if (!safeId(sourceId)) throw new Error('Use the exact terminal ID from Whitebox panel membership.');
  const access = JSON.parse(fs.readFileSync(path.join(directory, `${Buffer.from(sourceId).toString('base64url')}.access.json`), 'utf8'));
  if (op !== 'wait' && (access.state === 'interrupted' || !access.updatedAt || Date.now() - access.updatedAt > 30000)) throw new Error('Whitebox panel roster is stale or disconnected. Open Whitebox to refresh panel membership.');
  if (op === 'list') return { scope: 'whitebox-panel', self: sourceId, groupId: access.groupId, panelName: access.groupName, terminals: access.members.filter(member => member.id !== sourceId) };
  if (op === 'wait') {
    if (!safeId(target)) throw new Error('Invalid job ID');
    const deadline = Date.now() + Math.max(0, Math.min(60, Number(rest[0]) || 0)) * 1000;
    let job;
    do {
      try { job = JSON.parse(fs.readFileSync(path.join(directory, `${target}.job.json`), 'utf8')); } catch { job = { state: 'queued', id: target }; }
      if (job.sourceId && (job.sourceId !== sourceId || job.groupId !== access.groupId)) throw new Error('This job belongs to a different terminal.');
      if (['completed', 'failed', 'interrupted'].includes(job.state)) break;
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 400));
    } while (true);
    return { id: job.id, state: job.state, targetId: job.targetId, answer: job.answer, error: job.error };
  }
  if (!['ask', 'new'].includes(op)) throw new Error('Usage: <terminal ID> list | ask <target ID> "request" | wait <job ID> [seconds <= 60] | new <claude|codex>');
  const id = randomUUID();
  const matches = access.members.filter(member => member.id !== sourceId && (member.id === target || (['claude', 'codex'].includes(target) && member.provider === target)));
  if (op === 'ask' && matches.length !== 1) throw new Error(matches.length ? 'Multiple terminals match. Choose the exact terminal ID from list.' : 'No matching live AI in this Whitebox panel. Run list to refresh panel membership.');
  const selected = op === 'ask' ? matches[0] : null;
  const request = { id, operation: op, sourceId, groupId: access.groupId, token: access.token, targetId: selected?.id || target, targetCreationId: selected?.creationId, targetProviderPid: selected?.providerPid, targetProvider: selected?.provider, provider: target, message: rest.join(' ') };
  if (op === 'ask' && (!access.members.some(member => member.id === request.targetId && member.id !== sourceId) || !request.message.trim())) throw new Error('Choose one other terminal from list and provide a request.');
  if (request.message.length > 8000) throw new Error('Request must be at most 8000 characters');
  if (op === 'new' && !['claude', 'codex'].includes(target)) throw new Error('Choose claude or codex');
  const file = path.join(directory, `${id}.request.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(request), { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file);
  return { id, state: 'queued', next: `wait ${id} 60` };
}
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
module.exports = { main };
