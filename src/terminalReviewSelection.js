'use strict';

// Request-scoped extractive ranking, promoted from the paired model benchmark.
function tokens(text) {
  text = String(text).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const words = text.match(/[a-z_][a-z_0-9]*|\d+(?:\.\d+)*|[가-힣]+/gu) || [];
  const result = [];
  for (const word of words) {
    if (/^[가-힣]+$/u.test(word)) {
      result.push(word);
      for (let i = 0; i + 1 < word.length; i++) result.push(word.slice(i, i + 2));
    } else result.push(word);
  }
  return result;
}

function blocks(record, max = 1000) {
  const result = [];
  let start = 0;
  while (start < record.text.length) {
    let end = Math.min(record.text.length, start + max);
    if (end < record.text.length) {
      const paragraph = record.text.lastIndexOf('\n\n', end);
      const line = record.text.lastIndexOf('\n', end);
      if (paragraph > start + max / 3) end = paragraph + 2;
      else if (line > start + max / 3) end = line + 1;
    }
    const text = record.text.slice(start, end);
    result.push({ ...record, text, start, end, blockId: `${record.id}:${start}-${end}` });
    start = end;
  }
  return result;
}

// A finite heuristic, not a guarantee that every material fact can be detected.
// Numeric *conditions* are protected, not every source-code line number.
const failure = /\b(?:FAIL(?:ED|URE)?|ERROR|unverified|unresolved)\b|Exit code:\s*[1-9]|실패|미확인|불일치|통과하지|성공하지/iu;
const condition = /금지|하지\s*마|설명만|수정하지|삭제하지|do not|must not|never|최대\s*\d|최소\s*\d|\d+(?:\.\d+)?\s*(?:ms|초|분|MB|GB|%|개 이하|개 이상)|(?:limit|threshold|version|commit|run[-_ ]?id)\s*[:=]|\bv\d+\.\d+/iu;
function similarity(a, b) {
  let sum = 0;
  for (const [key, value] of a.vector) sum += value * (b.vector.get(key) || 0);
  return a.norm && b.norm ? sum / (a.norm * b.norm) : 0;
}

function selectHybrid(records, request, { budget = 8000, lambda = 0.7, searchContext = '' } = {}) {
  if (!Number.isSafeInteger(budget) || budget < 0 || lambda < 0 || lambda > 1) throw new Error('Invalid selection options');
  const requestIds = new Set(records.map(record => record.requestId));
  if (requestIds.size > 1) throw new Error('Mixed request scope');
  // User requests and the final answer are supplied unchanged by the common
  // production envelope, outside this 8k recovered-tool budget in both arms.
  const toolRecords = records.filter(record => record.role === 'tool');
  const candidates = toolRecords.flatMap(record => blocks(record));
  const query = new Set(tokens(request));
  // Assistant text expands search terms only. It cannot establish truth, scope
  // or authorization; the unchanged envelope still identifies it as a claim.
  const secondary = new Set(tokens(searchContext));
  const df = new Map();
  for (const block of candidates) {
    block.terms = new Map();
    for (const word of tokens(block.text)) block.terms.set(word, (block.terms.get(word) || 0) + 1);
    block.length = [...block.terms.values()].reduce((n, value) => n + value, 0);
    for (const word of block.terms.keys()) df.set(word, (df.get(word) || 0) + 1);
  }
  const count = candidates.length;
  const average = candidates.reduce((n, block) => n + block.length, 0) / (count || 1) || 1;
  let maxScore = 0;
  for (const block of candidates) {
    block.score = 0; block.vector = new Map();
    for (const [word, frequency] of block.terms) {
      const idf = Math.log(1 + (count - df.get(word) + 0.5) / (df.get(word) + 0.5));
      block.vector.set(word, (1 + Math.log(frequency)) * idf);
      const weight = query.has(word) ? 1 : secondary.has(word) ? 0.25 : 0;
      if (weight) block.score += weight * idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * block.length / average));
    }
    block.norm = Math.sqrt([...block.vector.values()].reduce((n, value) => n + value * value, 0));
    maxScore = Math.max(maxScore, block.score);
    block.mandatory = failure.test(block.text) || condition.test(block.text);
  }
  const selected = [], seen = new Set();
  let used = 0;
  const add = block => {
    // Exact duplicates only, within a role and request. Similar opposites are
    // never merged; mandatory conflicting results survive MMR.
    const key = `${block.role}:${block.requestId}:${block.text}`;
    if (seen.has(key)) return;
    seen.add(key); selected.push(block); used += block.text.length;
  };
  for (const block of candidates.filter(block => block.mandatory)) add(block);
  const mandatoryChars = used;
  // Expand explicitly if mandatory evidence alone overflows. Report this as a
  // budget exception rather than quietly dropping the failure/constraint.
  const effectiveBudget = Math.max(budget, mandatoryChars);
  // Compression adds no value to already-small tool evidence and lexical
  // overlap may be zero across Korean questions and English source code.
  const shortInput = toolRecords.reduce((n, record) => n + record.text.length, 0) <= budget;
  const remaining = candidates.filter(block => !block.mandatory);
  if (shortInput) for (const block of remaining.splice(0)) add(block);
  while (remaining.length) {
    let best = -1, bestValue = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const block = remaining[i];
      if (!block.score || used + block.text.length > effectiveBudget) continue;
      const redundancy = selected.reduce((n, item) => Math.max(n, similarity(block, item)), 0);
      const value = lambda * block.score / (maxScore || 1) - (1 - lambda) * redundancy;
      if (value > bestValue) { best = i; bestValue = value; }
    }
    if (best < 0 || bestValue <= 0) break;
    add(remaining.splice(best, 1)[0]);
  }
  const order = new Map(records.map((record, index) => [record.id, index]));
  selected.sort((a, b) => order.get(a.id) - order.get(b.id) || a.start - b.start);
  return { recovered: selected.map(({ id, role, requestId, status, start, end, text, mandatory, score }) => ({ id, role, requestId, status, start, end, text, mandatory, score })),
    policy: 'exact request/answer shared; tool blocks: mandatory + BM25 + TF-IDF cosine MMR',
    budget, mandatoryChars, budgetOverflow: Math.max(0, mandatoryChars - budget), readChars: used,
    candidateBlocks: count, selectedBlocks: selected.length, readCount: toolRecords.length,
    omittedFromInput: candidates.length - selected.length };
}

module.exports = { selectHybrid, blocks, tokens };
