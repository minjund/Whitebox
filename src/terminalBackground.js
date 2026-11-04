'use strict';

const path = require('path');
const short = (value, limit = 100) => String(value || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit);
const timestamp = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

// Reuse the worker's parsed execution/agent lifecycle. Bind it to the native
// log already proven to belong to this exact live AI process, never to cwd,
// title, newest history, or a screen claim that something is still running.
function conversationBackground(native, child, snapshot, now) {
  const age = now - Date.parse(snapshot?.generatedAt);
  if (!native?.available || !native.source?.file || !(age >= 0 && age < 15000)) return [];
  const matches = (snapshot.sessions || []).filter(session => session.provider === child.provider && session.file === native.source.file);
  if (matches.length !== 1) return [];
  const start = Date.parse(child.startedAt);
  if (!Number.isFinite(start)) return [];
  const owned = item => Number.isFinite(Date.parse(item.startedAt)) && Date.parse(item.startedAt) >= start - 2000;
  const jobs = new Map();
  for (const item of matches[0].executions || []) {
    if (item.mode !== 'background' || item.status !== 'running' || !owned(item)) continue;
    const id = `execution:${item.backgroundId || item.id}`;
    // Parsers fall back to the raw command as a label. Do not expose command
    // arguments, output or prompts through a compact sidebar observation.
    const commandLabel = short(String(item.command || '').trim().split(/\r?\n/u)[0], 1200);
    const candidate = short(item.label);
    const fromCommand = commandLabel && commandLabel.startsWith(candidate.replace(/…$/u, ''));
    const label = candidate && !fromCommand ? candidate : short(item.runtime || '명령창');
    jobs.set(id, { id, kind: 'command', label: label || '명령창', state: 'running', startedAt: timestamp(item.startedAt) });
  }
  for (const item of matches[0].collaboration?.spawns || []) {
    if (!['running', 'waiting'].includes(item.status) || !owned(item)) continue;
    const id = `agent:${item.childId || item.agentPath || item.callId}`;
    jobs.set(id, { id, kind: 'agent', label: short(item.taskName || item.agentName || '도움 AI'), state: item.status, startedAt: timestamp(item.startedAt) });
  }
  return [...jobs.values()];
}

// POSIX shell jobs have their own process groups. Group pipelines once and
// exclude both the shell and its current foreground job. Never infer a job
// from a stale screen, a zombie/stopped process, or another terminal's tree.
function shellBackground(rows, shell) {
  if (!shell || !(shell.foreground > 0)) return [];
  const groups = new Map();
  for (const row of rows) {
    if (!row.ancestorPids?.includes(shell.pid) || !(row.pgid > 0) || row.pgid === shell.pgid
      || row.pgid === shell.foreground || /^[TZ]/u.test(row.stat || '')) continue;
    const prior = groups.get(row.pgid);
    if (!prior || row.pid === row.pgid) groups.set(row.pgid, row);
  }
  return [...groups].map(([pgid, row]) => ({ id: `process-group:${pgid}`, kind: 'command',
    label: short(path.basename(row.name || '명령창')), state: 'running', startedAt: timestamp(row.startedAt) }));
}

module.exports = { conversationBackground, shellBackground };
