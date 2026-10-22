'use strict';
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

function bounded(text, limit) {
  text = String(text || '').trim();
  if (text.length <= limit) return text;
  const marker = '\n[omitted: evidence exceeds budget; do not assume omitted content is safe]\n';
  if (limit <= marker.length) return marker.trim().slice(0, Math.max(0, limit));
  const head = Math.floor((limit - marker.length) / 4);
  return text.slice(0, head) + marker + text.slice(-(limit - marker.length - head));
}
function answerText(source) {
  const native = String(source).match(/ASSISTANT(?: \((?:completed answer|current report)\))?:\s*\n?([\s\S]*)/u);
  if (native) return native[1].trim();
  const lines = String(source).split('\n');
  const index = lines.findLastIndex(line => /^\s*[•⏺]\s+\S/u.test(line));
  if (index < 0) return '';
  return lines.slice(index).join('\n').split(/\n\s*(?:[─━-]*\s*Worked for|[✻✽✶✢✳✺✼*]\s+.*\bfor\s+\d)/u)[0].replace(/^\s*[•⏺]\s+/u, '').trim();
}
function isSocialRecord(request, source, changes) {
  // Never skip acknowledgements ("yes", "ok", "네"): they may authorize work.
  const text = String(request).trim().replace(/[!.?~。！？，,\s]+$/gu, '').toLowerCase();
  if (!/^(?:ㅎㅇ|안녕|안녕하세요|고마워|고마워요|감사합니다|hi|hello|hey|thanks|thank you|你好|您好|谢谢)$/u.test(text)) return false;
  const answer = answerText(source);
  if (!answer || answer.length > 240 || changes?.changed) return false;
  if (/^\s*[•⏺]\s*(?:Ran|Read|Wrote|Edited|Updated|Bash|Write|Edit)\b/imu.test(source)) return false;
  if (/수정|변경|삭제|실행|배포|완료|edited|modified|deleted|executed|deployed|changed|修改|删除|执行|部署/iu.test(answer)) return false;
  return /ㅎㅇ|안녕|반가|도와|천만|별말|고마|감사|hello|\bhi\b|hey|welcome|help|thanks|你好|您好|不客气|谢谢/iu.test(answer);
}
async function gitSnapshot(cwd) {
  if (!cwd) return null;
  try {
    const options = { cwd, timeout: 1500, maxBuffer: 65536, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' } };
    const { stdout: head } = await run('git', ['rev-parse', '--verify', 'HEAD'], options);
    const { stdout: patch } = await run('git', ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=2', 'HEAD', '--'], options);
    const { stdout: status } = await run('git', ['status', '--porcelain', '--untracked-files=normal'], options);
    return { head: head.trim(), patch, status };
  } catch { return null; }
}
function changedEvidence(before, after) {
  if (!before || !after) return { changed: false, text: 'No before/after file evidence available. Do not claim files were inspected or unchanged.' };
  const changed = before.patch !== after.patch || before.status !== after.status || before.head !== after.head;
  if (!changed) return { changed: false, text: 'No change observed in tracked Git diff/status between two snapshots. Untracked file contents and reverted intermediate edits are not inspected. This does not verify runtime behavior.' };
  const sections = patch => new Map(patch.split(/(?=^diff --git )/mu).filter(Boolean).map(block => [block.split('\n')[0], block]));
  const a = sections(before.patch), b = sections(after.patch);
  const keys = [...new Set([...a.keys(), ...b.keys()])].filter(key => a.get(key) !== b.get(key));
  const entries = keys.slice(0, 4).map(key => `${key}\nBEFORE:\n${bounded(a.get(key) || '(no diff)', 900)}\nAFTER:\n${bounded(b.get(key) || '(no diff)', 1400)}`);
  return { changed, text: bounded(`Observed snapshots of the same working directory; other terminals may have contributed. Snapshots alone cannot attribute changes to this AI; correlate matching tool records. Only tracked diff changes are shown; untracked file contents are NOT inspected. HEAD changed: ${before.head !== after.head}. Changed diff sections: ${keys.length}.\n${entries.join('\n')}\nSTATUS BEFORE:\n${bounded(before.status, 400)}\nSTATUS AFTER:\n${bounded(after.status, 400)}`, 5000) };
}
module.exports = { bounded, answerText, isSocialRecord, gitSnapshot, changedEvidence };
