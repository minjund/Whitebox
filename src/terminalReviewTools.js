'use strict';

// Keep bounded metadata and result excerpts, not raw commands, patches, fetched
// pages or hidden reasoning. Command hints are static labels, not execution proof.
const { bounded } = require('./terminalReviewBudget');
const short = (value, size = 220) => String(value || '').replace(/\s+/gu, ' ').trim().slice(0, size);
function commandHints(name, input) {
  if (!/^(?:Bash|exec_command|shell_command|shell)$/iu.test(name)) return [];
  try { if (typeof input === 'string') input = JSON.parse(input); } catch { return []; }
  const command = typeof input?.command === 'string' ? input.command : typeof input?.cmd === 'string' ? input.cmd : '';
  // Never copy arguments (which may include credentials) into a hint. A label
  // only says the submitted command text mentions an operation, not that it ran.
  return [...new Set(command.match(/\bgit\s+(?:restore|reset|revert|clean|status|diff|switch|checkout)\b|\b(?:rm|tar|cp|mv|mkdir)\b/gu) || [])].map(value => value.replace(/\s+/gu, ' ')).slice(0, 10);
}
function priority(item) {
  if (item.status === 'error') return 4;
  if (/^(?:Write|Edit|MultiEdit|apply_patch)$/iu.test(item.name)
    || item.commandHints?.some(hint => /^(?:git (?:restore|reset|revert|clean)|rm|tar|cp|mv)$/u.test(hint))) return 3;
  if (item.commandHints?.length || /fetch|search/iu.test(item.name)) return 2;
  return 0;
}
function select(items, limit) {
  if (items.length <= limit) return items;
  // Reserve both ends for context; fill the rest with mutations, errors and
  // checks before routine reads. Emit in original order, with omissions counted.
  const indices = new Set([0, 1, items.length - 2, items.length - 1]);
  const ranked = items.map((item, index) => ({ index, rank: priority(item) })).sort((a, b) => b.rank - a.rank || b.index - a.index);
  for (const item of ranked) { if (indices.size >= limit) break; indices.add(item.index); }
  return [...indices].sort((a, b) => a - b).map(index => items[index]);
}
function target(input) {
  try {
    if (typeof input === 'string') input = JSON.parse(input);
    const url = new URL(input?.url || input?.action?.url);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    return short(`${url.origin}${url.pathname}`, 180);
  } catch { return ''; }
}
function excerpt(value) {
  const text = Array.isArray(value) ? value.filter(item => item?.type === 'text').map(item => item.text).join(' ') : typeof value === 'string' ? value : '';
  return bounded(text.replace(/\s+/gu, ' '), 400);
}
function literalOperation(name, input) {
  if (!/^(?:Bash|exec_command|shell_command)$/iu.test(name)) return undefined;
  try { if (typeof input === 'string') input = JSON.parse(input); } catch { return undefined; }
  const command = input?.command || input?.cmd || '';
  if (/[\n\r;$`|&<>]/u.test(command)) return undefined;
  const tokens = command.match(/"[^"\\]*"|'[^']*'|[^\s"']+/gu) || [];
  if (command.replace(/"[^"\\]*"|'[^']*'|[^\s"']+/gu, '').trim() || command.includes('\\')) return undefined;
  const args = tokens.map(value => /^["']/u.test(value) ? value.slice(1, -1) : value);
  if (args[0] !== 'mv') return undefined;
  if (args[1] === '--') args.splice(1, 1);
  if (args.length !== 3 || args.slice(1).some(value => value.startsWith('-') || /[*?\[\]~]/u.test(value))) return undefined;
  return { kind: 'rename', from: args[1], to: args[2] };
}

function addCall(state, id, name, input) {
  if (!id || !state.requestId || state.complete) return;
  state.tools ||= [];
  if (state.tools.some(item => item.id === id)) return;
  state.tools.push({ id: short(id, 200), name: short(name, 64) || 'tool', target: target(input), commandHints: commandHints(name, input), status: 'called', excerpt: '', operation: literalOperation(name, input) });
  if (state.tools.length > 32) { state.tools = select(state.tools, 32); state.toolsOmitted = (state.toolsOmitted || 0) + 1; }
}
function addResult(state, id, output, error) {
  if (state.complete) return;
  const item = state.tools?.find(item => item.id === id);
  if (!item) return; // An unmatched result cannot belong to this request.
  item.status = error === true ? 'error' : 'returned';
  if (typeof error === 'boolean') item.reportedError = error;
  item.excerpt = excerpt(output);
  const code = typeof output === 'string' ? output.match(/(?:Process exited with code|Exit code:)\s*(-?\d+)/u) : null;
  if (code) item.exitCode = Number(code[1]);
  // A returned result is not automatically a successful action.
}
function toolEvidence(state) {
  return { source: 'session', items: (state.tools || []).map(({ id, ...item }) => ({ ...item })), omitted: state.toolsOmitted || 0 };
}
function screenTools(evidence) {
  const lines = String(evidence || '').split('\n');
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*[⏺•]\s*(Fetch|WebFetch|WebSearch|Bash|Read|Write|Edit)\((.*)\)\s*$/u);
    if (!match) continue;
    const next = lines.slice(i + 1, i + 4).join(' ');
    const received = next.match(/Received\s+[^\n]*?\((?:\d{3}[^)]*)\)/iu)?.[0];
    const failed = /(?:Error:|Failed:)/u.test(next);
    items.push({ name: match[1], target: target({ url: match[2] }), status: failed ? 'error' : received ? 'returned' : 'called', excerpt: received ? short(received) : '' });
  }
  return { source: 'screen', items: items.slice(-12), omitted: Math.max(0, items.length - 12) };
}
function compactTools(evidence) {
  const items = evidence?.items || [];
  const selected = select(items, 12);
  // Separate budget: long answers must never push tool metadata out of input.
  return JSON.stringify({ source: evidence?.source || 'unavailable', retained: selected.length,
    omitted: (evidence?.omitted || 0) + items.length - selected.length,
    items: selected.map(item => ({ name: short(item.name, 64), target: short(item.target, 140), status: item.status,
      reportedError: item.reportedError, commandHints: item.commandHints?.slice(0, 10),
      excerpt: bounded(item.excerpt, priority(item) >= 2 ? 320 : 160) })) });
}
module.exports = { addCall, addResult, toolEvidence, screenTools, compactTools };
