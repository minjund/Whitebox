'use strict';

// Benchmark-only coverage closure. Keep v1 unchanged for reproducible controls.
const { selectHybrid } = require('./terminal-review-hybrid');
function identifiers(text) {
  return new Set((String(text).match(/\b[a-zA-Z_$][\w$]*\b/gu) || [])
    .filter(word => /^[a-z_$]/u.test(word) && (/[a-z][A-Z]|_/u.test(word))));
}
function lineStart(text, position) { return text.lastIndexOf('\n', position - 1) + 1; }
function lineEnd(text, position) { const end = text.indexOf('\n', position); return end < 0 ? text.length : end + 1; }
function bodyEnd(text, open, limit) {
  let depth = 1, quote = '', comment = '', end = open + 1;
  for (; end < text.length && end < limit && depth; end++) {
    const c = text[end], next = text[end + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && next === '/') { comment = ''; end++; } continue; }
    if (quote) { if (c === '\\') end++; else if (c === quote) quote = ''; continue; }
    if (c === '/' && next === '/') { comment = 'line'; end++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; end++; continue; }
    if ('"\'`'.includes(c)) { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
  }
  return { end, complete: depth === 0 };
}

function codeAnchors(records, request) {
  const symbols = identifiers(request);
  const anchors = [];
  const add = (record, start, end, kind, symbol) => anchors.push({ ...record, start, end, text: record.text.slice(start, end), kind, symbol });
  for (const record of records.filter(record => record.role === 'tool')) {
    const text = record.text;
    // Protect direct operations of the requested value, not only its declared
    // type. One line of surrounding context retains conditions and source paths.
    for (const match of text.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\.\s*[a-zA-Z_$][\w$]*\s*\(/gu)) {
      if (!symbols.has(match[1])) continue;
      const start = lineStart(text, match.index), end = lineEnd(text, match.index + match[0].length);
      add(record, lineStart(text, Math.max(0, start - 1)), lineEnd(text, end), 'value-operation', match[1]);
    }
    // A referenced method's body is a semantic unit: local variable names in its
    // return/merge logic need not repeat the method name. Do not let MMR remove
    // that implementation because several signature matches look similar.
    const declarations = /\b(?:public|private|protected|static|function|fn)\s+[^;{}=]{0,180}?\b([a-zA-Z_$][\w$]*)\s*\(/gu;
    for (const match of text.matchAll(declarations)) {
      if (!symbols.has(match[1])) continue;
      const start = lineStart(text, match.index);
      const open = text.indexOf('{', match.index + match[0].length);
      const semicolon = text.indexOf(';', match.index + match[0].length);
      if (open < 0 || semicolon >= 0 && semicolon < open) {
        const end = semicolon >= 0 ? Math.min(semicolon + 1, start + 2400) : lineEnd(text, match.index);
        add(record, start, end, 'declaration', match[1]); continue;
      }
      if (open - start > 1800) continue;
      // Bounded lexical closure handles strings/comments; it is not a complete
      // language parser. Missing bodies are explicitly marked as partial.
      const body = bodyEnd(text, open, start + 3000);
      add(record, start, body.complete ? lineEnd(text, body.end) : lineEnd(text, open), body.complete ? 'definition' : 'partial-definition', match[1]);
    }
    // Python functions need indentation closure rather than braces.
    for (const match of text.matchAll(/^([ \t]*)def\s+([a-zA-Z_][\w]*)\s*\([^\n]*\):[^\n]*\n/gmu)) {
      if (!symbols.has(match[2])) continue;
      let end = match.index + match[0].length;
      while (end < text.length && end - match.index < 3000) {
        const next = lineEnd(text, end), line = text.slice(end, next);
        if (line.trim() && (line.match(/^[ \t]*/u)?.[0].length || 0) <= match[1].length) break;
        end = next;
      }
      add(record, match.index, end, 'definition', match[2]);
    }
  }
  return anchors;
}

function mergeRanges(records, spans) {
  const result = [];
  for (const record of records) {
    const ranges = spans.filter(span => span.id === record.id).sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const span of ranges) {
      if (merged.length && span.start <= merged.at(-1).end) merged.at(-1).end = Math.max(merged.at(-1).end, span.end);
      else merged.push({ start: span.start, end: span.end });
    }
    for (const range of merged) result.push({ ...record, ...range, text: record.text.slice(range.start, range.end) });
  }
  return result;
}

function selectRefined(records, request, options = {}) {
  const base = selectHybrid(records, request, options);
  const anchors = codeAnchors(records, request);
  const mandatory = base.recovered.filter(record => record.mandatory);
  let selected = mergeRanges(records, [...mandatory, ...anchors]);
  const size = spans => spans.reduce((n, span) => n + span.text.length, 0);
  const protectedChars = size(selected), effectiveBudget = Math.max(base.budget, protectedChars);
  for (const candidate of base.recovered.filter(record => !record.mandatory).sort((a, b) => b.score - a.score)) {
    const next = mergeRanges(records, [...selected, candidate]);
    if (size(next) <= effectiveBudget) selected = next;
  }
  const coverage = anchors.map(anchor => ({ id: anchor.id, start: anchor.start, end: anchor.end, kind: anchor.kind, symbol: anchor.symbol,
    retained: selected.some(span => span.id === anchor.id && span.start <= anchor.start && span.end >= anchor.end) }));
  return { ...base, policy: 'v1 + requested-symbol implementation/operation coverage; overlapping spans merged only within the same record', recovered: selected,
    readChars: size(selected), protectedChars, budgetOverflow: Math.max(0, protectedChars - base.budget), coverage,
    partialDefinitions: coverage.filter(item => item.kind === 'partial-definition').length,
    selectedBlocks: selected.length, omittedFromInput: records.filter(record => record.role === 'tool').length - new Set(selected.map(span => span.id)).size };
}

module.exports = { selectRefined, codeAnchors, mergeRanges };
