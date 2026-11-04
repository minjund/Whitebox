'use strict';

const { bounded } = require('./terminalReviewBudget');
const path = require('node:path');

// A narrow exception to metadata-only tool inputs: record the authored fragment
// of a structured document/code edit, never shell commands or arbitrary args.
// This is a submitted change paired with an acknowledgement, not a file read.
function proposedChange(name, input) {
  if (!/^(?:Write|Edit)$/u.test(name)) return null;
  try { if (typeof input === 'string') input = JSON.parse(input); } catch { return null; }
  const file = input?.file_path;
  if (typeof file !== 'string' || file.length > 800 || !/\.(?:md|mdx|java|js|ts|tsx|jsx|py|go|rs)$/iu.test(file)
    || /(?:^|[/\\])(?:\.ssh|\.aws|\.env|secrets?|credentials?)(?:[/\\.]|$)/iu.test(file)) return null;
  let after = name === 'Write' ? input.content : input.new_string;
  let before = name === 'Edit' ? input.old_string : '';
  if (typeof after !== 'string' || typeof before !== 'string' || after.length + before.length > 200000) return null;
  const text = before + '\n' + after;
  // Omit a fragment rather than rewriting a credential and calling it exact.
  if (/-----BEGIN [\w ]*PRIVATE KEY-----|\bBearer\s+[\w.-]{12,}|\b[\w]*(?:password|passwd|api[_-]?key|access[_-]?token|secret)[\w]*[ \t]*[:=][ \t]*["']?[^\s"'`,;}${]{3,}/iu.test(text)) return null;
  let example;
  if (name === 'Edit' && !/\.mdx?$/iu.test(file)) {
    const lines = after.split('\n');
    for (let i = 1; i + 1 < lines.length; i++) {
      if (lines[i] || !lines[i - 1].trim() || !lines[i + 1].trim()) continue;
      const prior = lines[i - 1] + '\n' + lines[i + 1];
      if (prior.length <= 600 && before.includes(prior)) { example = { before: prior, after: lines[i - 1] + '\n\n' + lines[i + 1] }; break; }
    }
  }
  const sections = name === 'Write' ? after.split(/(?=^## )/gmu).map((body, index) => ({ body, index,
    score: /현재|이어|다음|\b(?:resume|current|next)\b/iu.test(body.split('\n')[0]) ? 4 : /상태|검증|healthy|health/iu.test(body.split('\n')[0]) ? 2 : 0 }))
    .filter(item => item.score && item.body.length <= 1200).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3).sort((a, b) => a.index - b.index).map(item => item.body) : [];
  if (name === 'Edit') {
    if (before === after) return null;
    let prefix = 0, suffix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    const changedLines = value => {
      const start = value.lastIndexOf('\n', Math.max(0, prefix - 2)) + 1;
      const next = value.indexOf('\n', value.length - suffix + 1);
      return value.slice(start, next < 0 ? value.length : next);
    };
    before = changedLines(before); after = changedLines(after);
  }
  return { path: file, kind: name === 'Edit' ? 'edit' : 'write',
    before: bounded(before, 500), after: bounded(after, 1000),
    outline: (after.match(/^#{1,4}[ \t]+[^\n]+/gmu) || []).slice(0, 20).map(line => line.slice(0, 160)),
    ...(example ? { example } : {}), ...(sections.length ? { sections } : {}),
    partial: before.length > 500 || after.length > 1000 };
}

function acknowledgeChange(proposal, output, error) {
  if (!proposal || error === true || typeof output !== 'string') return null;
  if (!/updated successfully|(?:created|written) successfully|successfully (?:wrote|written)|wrote\s+\d+|successfully created/iu.test(output)
    || /\b(?:failed|error|denied)\b/iu.test(output)) return null;
  return { ...proposal, acknowledgement: bounded(output, 300) };
}

function artifactText(changes = [], max = 3600) {
  if (!Array.isArray(changes)) return '';
  changes = changes.filter(change => change && typeof change.path === 'string' && typeof change.after === 'string' && typeof change.acknowledgement === 'string');
  let left = max;
  const examplePaths = new Set();
  const selected = (changes.length <= 8 ? changes : [...changes.slice(0, 2), ...changes.slice(-6)]).filter(change => {
    if (!change.example) return true;
    if (examplePaths.has(change.path)) return false;
    examplePaths.add(change.path); return true;
  });
  const weight = selected.reduce((n, change) => n + (change.example ? 2 : 1), 0);
  return selected.map(change => {
    if (left < 200) return '';
    const outline = Array.isArray(change.outline) ? change.outline.filter(line => typeof line === 'string').slice(0, 20).join('\n') : '';
    const cap = Math.min(left, Math.floor((max - selected.length * 2) * (change.example ? 2 : 1) / weight));
    const head = `RECORDED ${change.kind}: ${path.basename(change.path).slice(0, 100)}\n`;
    const tail = `\nACK excerpt: ${change.acknowledgement.slice(-70)}\nPartial authored fragment; not a full-file read.`;
    const room = Math.max(0, cap - head.length - tail.length);
    const sections = Array.isArray(change.sections) ? change.sections.filter(value => typeof value === 'string').slice(0, 3).join('\n\n') : '';
    const headings = outline ? `HEADINGS (intervening text omitted):\n${bounded(outline, sections ? 850 : Math.min(1800, Math.floor(room * 0.65)))}\n` : '';
    const example = change.example && typeof change.example.after === 'string' && typeof change.example.before === 'string' ? change.example : null;
    const after = headings + (sections ? `AUTHORED SECTIONS:\n${sections}\n` : '') + `AFTER:\n${example ? example.after : sections ? change.after.slice(0, 180) : change.after}`;
    const prior = example ? example.before : change.before;
    const before = prior && !outline && after.length + prior.length + 9 <= room ? `\nBEFORE:\n${prior}` : '';
    const result = head + bounded(after + before, room) + tail; left -= result.length;
    return result;
  }).filter(Boolean).join('\n\n');
}

function continuationCommands(authored) {
  const commands = [];
  for (const section of String(authored || '').split(/(?=^#{1,4} )/gmu)) {
    if (!/다음|재개|이어|\b(?:resume|next)\b/iu.test(section.split('\n')[0])) continue;
    const blocks = [...section.matchAll(/^```(?:bash|sh|shell|powershell|sql)\s*\n([\s\S]*?)^```/gmu)]
      .map(match => match[1].trim()).filter(value => value && !value.includes('[omitted') && value.length <= 1200);
    if (blocks.length) commands.push(blocks.at(-1));
  }
  return [...new Set(commands)];
}

function spacingExamples(authored) {
  return [...String(authored || '').matchAll(/RECORDED edit: [^\n]+\.(?:java|js|ts|tsx|jsx|py|go|rs)\n([\s\S]*?)(?=\nRECORDED |$)/gu)]
    .map(match => match[1].match(/AFTER:\n([\s\S]*?)(?:\nBEFORE:|\nACK excerpt:)/u)?.[1].trim())
    .filter(value => value && value.length <= 650 && /\n[ \t]*\n/u.test(value) && !value.includes('[omitted'));
}

module.exports = { proposedChange, acknowledgeChange, artifactText, continuationCommands, spacingExamples };
