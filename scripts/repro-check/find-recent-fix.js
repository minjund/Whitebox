#!/usr/bin/env node
'use strict';
// repro-check: 최근 "불만 → AI가 고쳤다" 쌍을 Claude 대화 기록에서 찾는다(읽기만).
// 쓰는 법: node scripts/repro-check/find-recent-fix.js [--days 3] [--top 5]
const fs = require('fs');
const os = require('os');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const DAYS = arg('--days', 3);
const TOP = arg('--top', 5);
const since = Date.now() - DAYS * 86400e3;

const COMPLAIN = /(버그|고쳐\s?줘|수정해\s?줘|수정해|안\s?떠|안\s?뜨|안\s?닫|안\s?열|안\s?보여|깨져|사라졌|없어졌|멈춰|먹통|오류|에러)/;
const CLAIM = /(고쳤|수정했|고쳐\s?놓|고쳐\s?두|해결했|반영했|바로잡)/;

const text = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter(x => x && x.type === 'text' && typeof x.text === 'string').map(x => x.text).join('\n') : '';
const isHuman = c => !(Array.isArray(c) && c.some(x => x && x.type === 'tool_result'));

const roots = fs.readdirSync(os.homedir()).filter(d => /^\.claude(-[\w-]+)?$/.test(d)).map(d => path.join(os.homedir(), d, 'projects'));
const files = [];
for (const r of roots) {
  let dirs = [];
  try { dirs = fs.readdirSync(r); } catch { continue; }
  for (const d of dirs) {
    if (!/Whitebox/i.test(d) || /-runs-|repro/i.test(d)) continue;
    let fl = [];
    try { fl = fs.readdirSync(path.join(r, d)); } catch { continue; }
    for (const f of fl) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(r, d, f);
      try { if (fs.statSync(p).mtimeMs >= since) files.push(p); } catch {}
    }
  }
}

const out = [];
const seen = new Set();
for (const f of files) {
  let lines;
  try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch { continue; }
  let complaint = null;
  for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.isSidechain) continue;
    const ts = Date.parse(o.timestamp || '');
    const c = o.message && o.message.content;
    if (o.type === 'user' && !o.isMeta && isHuman(c)) {
      const t = text(c).trim();
      if (!t || t.startsWith('<') || t.startsWith('Caveat:') || t.includes('This session is being continued') || t.includes('repro-check')) continue;
      if (COMPLAIN.test(t)) complaint = { t, ts, cwd: o.cwd, branch: o.gitBranch };
    } else if (o.type === 'assistant' && complaint) {
      const t = text(c).trim();
      if (t && CLAIM.test(t) && ts >= since) {
        const key = f + complaint.ts;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ claimAt: new Date(ts).toISOString(), complaintAt: new Date(complaint.ts).toISOString(),
            cwd: complaint.cwd, branch: complaint.branch, file: f,
            complaint: complaint.t.slice(0, 400), claim: t.slice(0, 400) });
        }
        complaint = null;
      }
    }
  }
}
out.sort((a, b) => b.claimAt.localeCompare(a.claimAt));
let installed = null;
try {
  const plist = fs.readFileSync('/Applications/Whitebox.app/Contents/Info.plist', 'utf8');
  installed = (plist.match(/CFBundleShortVersionString<\/key>\s*<string>([^<]+)/) || [])[1] || null;
} catch {}
console.log(JSON.stringify({ installedVersion: installed, days: DAYS, candidates: out.slice(0, TOP) }, null, 1));
