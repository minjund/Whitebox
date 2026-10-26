'use strict';

const fs = require('fs/promises');
const { createHash } = require('crypto');
const { bounded } = require('./terminalReviewBudget');
const hash = value => createHash('sha256').update(value).digest('hex');
const important = /삭제|제거|되돌|복구|실패|금지|하지\s*마|유지|대체|검사|검증|확인|사용처|변경|usage|dependency|rollback|revert|remov|delet|fail|recover|constraint|must|never|test|scope/iu;

function evidenceExcerpt(value, limit) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  const ranges = [[0, 120], [text.length - 200, text.length]];
  const severe = /삭제|제거|되돌|복구|실패|대체하지|미확인|사용처|검증|검사|확인|rollback|revert|remov|delet|fail|recover|unverified|unresolved|not found/giu;
  let match, count = 0;
  while ((match = severe.exec(text)) && count++ < 6) ranges.push([Math.max(0, match.index - 120), Math.min(text.length, match.index + 300)]);
  if (!count) return bounded(text, limit);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    if (merged.length && range[0] <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], range[1]);
    else merged.push(range);
  }
  return bounded(merged.map(([start, end]) => text.slice(start, end)).join('\n[omitted original range]\n'), limit);
}

// Only public conversation content; never reasoning, tool arguments or arbitrary files.
function publicRecord(row, provider) {
  const event = provider === 'codex' ? row.payload || {} : row.message || {};
  const content = value => typeof value === 'string' ? value : Array.isArray(value)
    ? value.filter(item => ['text', 'input_text', 'output_text', 'tool_result'].includes(item?.type))
      .map(item => item.type === 'tool_result' ? content(item.content) : item.text || '').join('\n') : '';
  if (provider === 'claude') {
    if (row.isSidechain || row.isMeta || !['user', 'assistant'].includes(row.type)) return null;
    const tool = Array.isArray(event.content) && event.content.some(item => item?.type === 'tool_result');
    return { role: tool ? 'tool' : row.type, text: content(event.content) };
  }
  if (row.type === 'event_msg' && event.type === 'task_complete') return { role: 'assistant', text: content(event.last_agent_message) };
  if (row.type === 'event_msg' && event.type === 'user_message') return { role: 'user', text: content(event.message) };
  if (row.type !== 'response_item') return null;
  if (['function_call_output', 'custom_tool_call_output'].includes(event.type)) return { role: 'tool', text: content(event.output) };
  if (event.type === 'message' && (event.role === 'user' || event.role === 'assistant' && ['commentary', 'final'].includes(event.channel))) return { role: event.role, text: content(event.content) };
  return null;
}

class ReviewEvidenceIndex {
  constructor() { this.sources = new Map(); this.serial = 0; }
  reset(file) { this.sources.delete(file); }
  add(file, stat, provider, sessionId, requestId, row, start, bytes) {
    if (!requestId || provider === 'claude' && row.sessionId !== sessionId) return;
    const record = publicRecord(row, provider);
    if (!record?.text.trim()) return;
    let source = this.sources.get(file);
    if (!source || source.ino !== stat.ino) {
      source = { ino: stat.ino, records: [], omitted: 0 }; this.sources.set(file, source);
      if (this.sources.size > 64) this.sources.delete(this.sources.keys().next().value);
    }
    // Offsets and hashes refer to immutable bytes already consumed by logState.
    const id = `e${++this.serial}`;
    source.records.push({ id, requestId, provider, sessionId, role: record.role, start, length: bytes.length,
      digest: hash(bytes), signalDigest: hash(record.role + ':' + record.text.replace(/\s+/gu, ' ').trim()), critical: important.test(record.text), excerpt: evidenceExcerpt(record.text, important.test(record.text) ? 1600 : 500) });
    if (source.records.length > 4096) { source.records.shift(); source.omitted++; }
  }
  manifest(file, requestId) {
    const source = this.sources.get(file);
    if (!source) return { requestId, records: [], omitted: 0 };
    const current = source.records.filter(item => item.requestId === requestId);
    return { requestId, fingerprint: hash([...new Set(current.filter(item => item.critical).map(item => item.signalDigest))].join(':')), records: current.map(({ start, length, digest, signalDigest, ...record }) => record), omitted: source.omitted };
  }
  async retrieve(file, requestId, ids, budget = 8000) {
    const source = this.sources.get(file);
    const results = [];
    for (const id of [...new Set(ids)].slice(0, 4)) {
      const record = source?.records.find(item => item.id === id && item.requestId === requestId);
      if (!record) { results.push({ id, status: 'out-of-scope' }); continue; }
      if (record.length > 2 * 1024 * 1024 || budget < 1) { results.push({ id, status: 'limit' }); continue; }
      let handle;
      try {
        handle = await fs.open(file, 'r');
        const before = await handle.stat();
        if (before.ino !== source.ino || before.size < record.start + record.length) throw new Error('changed');
        const bytes = Buffer.alloc(record.length);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, record.start);
        if (bytesRead !== bytes.length || hash(bytes) !== record.digest) throw new Error('changed');
        const row = JSON.parse(bytes.toString('utf8'));
        const text = publicRecord(row, record.provider)?.text || '';
        const excerpt = evidenceExcerpt(text, Math.min(budget, 4000)); budget -= excerpt.length;
        results.push({ id, requestId, role: record.role, status: 'available', text: excerpt, truncated: text.length > excerpt.length });
      } catch (error) { results.push({ id, status: error.code === 'ENOENT' ? 'expired' : 'changed-or-unreadable' }); }
      finally { await handle?.close(); }
    }
    return results;
  }
  async prepare(file, requestId) {
    const manifest = this.manifest(file, requestId);
    const ranked = [...manifest.records].sort((a, b) => Number(b.critical) - Number(a.critical));
    const selected = ranked.slice(0, 4);
    const recovered = await this.retrieve(file, requestId, selected.map(item => item.id));
    return { ...manifest, records: ranked.slice(0, 64).map(item => ({ id: item.id, role: item.role, critical: item.critical })),
      recovered, omittedFromInput: Math.max(0, manifest.records.length - selected.length), readCount: selected.length,
      manifestOmitted: Math.max(0, manifest.records.length - 64),
      readChars: recovered.reduce((sum, item) => sum + (item.text?.length || 0), 0) };
  }
}

module.exports = { ReviewEvidenceIndex, publicRecord, important };
