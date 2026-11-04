'use strict';

// Paired live evaluation using the original six writing fixtures and two
// task-specific cases. Baselines are pinned before modifying the prompt.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { AgentRunner } = require('../src/agentRunner');
const { reviewPrompt, parseReview } = require('../src/terminalReview');
const renderer = require('../renderer/terminal-review-decision');
const sha = value => createHash('sha256').update(value).digest('hex');
const esc = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });

async function main() {
  const root = path.resolve(process.argv[2] || 'artifacts/pyramid-principle-20261104');
  const standalone = process.argv.includes('--standalone');
  const before = require(path.join(root, 'baseline-prompt.js'));
  const beforeRenderer = require(path.join(root, 'baseline-renderer.js'));
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'writing-cases.json'), 'utf8'));
  const flow = JSON.parse(fs.readFileSync(path.join(root, '..', 'specflow-flow-followup-20261104', 'input-records.json'), 'utf8'))[0].task;
  cases.push({ id: 'specflow', title: '스펙 플로우 동작 흐름', request: flow.request, lifecycle: flow.lifecycle, evidence: flow.reviewEvidence });
  cases.push({ id: 'cause-unknown', title: '반복 실패와 미확인 원인', request: '업로드 오류를 고치고 원인을 확인해 줘.', lifecycle: 'completed',
    evidence: 'USER: 업로드 오류를 고치고 원인을 확인해 줘.\nTOOL Test returned: upload attempt 1: HTTP 500; upload attempt 2: HTTP 500; no server stack trace returned.\nASSISTANT: 두 번 모두 500으로 실패했습니다. 코드는 바꾸지 않았습니다. 서버 상세 로그가 없어 원인은 아직 모릅니다.' });
  const jobs = cases.flatMap((item, index) => (index % 2 ? ['after', 'before'] : ['before', 'after']).map(condition => ({ item, condition })));
  const prompts = jobs.map(job => { const observed = job.item.evidence.split('\n').filter(line => line.startsWith('TOOL ')).join('\n'); const prompt = (job.condition === 'before' ? before.reviewPrompt : reviewPrompt)(job.item.evidence, 'ko', job.item.request, job.item.lifecycle, observed); return { ...job, observed, prompt, promptSha256: sha(prompt) }; });
  const manifest = { protocol: standalone
    ? 'Eight paired cases using the same original evidence. Before is the previous production pyramid prompt; its saved actual outputs are reused only when the exact prompt SHA-256 matches. After adds first-reader context, workflow actors/handoffs/output and decision-changing limits in the opening, with limits rendered before details. Same Codex model; two tool-disabled workers. This compares combined product behavior, not human comprehension. Cached and fresh calls are counted separately.'
    : 'Eight paired cases, same Codex model, alternating launch order, concurrency two. The first six evidence fixtures are unchanged from terminal-review-style-evaluation.js. Before is the pinned compact prompt. After adds pyramid ordering, scoped nextAction and compresses repetitive prompt wording. Cached and fresh calls are counted separately. This is a combined product change, not isolated causal attribution or human usability measurement.', model: 'gpt-6.1-sol', cases, prompts };
  const manifestFile = path.join(root, 'manifest.json');
  if (fs.existsSync(manifestFile) && JSON.parse(fs.readFileSync(manifestFile)).prompts.some((value, index) => value.promptSha256 !== prompts[index]?.promptSha256)) throw new Error('Pinned evaluation prompts changed');
  save(manifestFile, manifest);
  let next = 0, failure, reusedOutputs = 0, freshCalls = 0;
  await Promise.all([0, 1].map(async slot => {
    const runner = new AgentRunner({ runsDir: path.join(root, `worker-${slot}`, 'agent-runs') });
    while (!failure && next < prompts.length) {
      const job = prompts[next++]; const file = path.join(root, `${job.item.id}-${job.condition}.json`);
      try {
        if (fs.existsSync(file)) {
          const saved = JSON.parse(fs.readFileSync(file));
          if (saved.valid && saved.promptSha256 === job.promptSha256) { reusedOutputs++; continue; }
          throw new Error('Investigate saved invalid attempt or changed prompt before retrying');
        }
        const calls = []; let parsed, issues;
        for (let attempt = 0; attempt < 2; attempt++) {
          const raw = await runner.generateTerminalReview({ provider: 'codex', model: manifest.model,
            prompt: attempt ? `${job.prompt}\nQUALITY REPAIR: Regenerate from the same original records. Correct these mechanical issues: ${issues.join(', ')}.` : job.prompt });
          freshCalls++;
          calls.push(raw);
          try {
            parsed = parseReview(raw.text, job.item.evidence, 'ko', job.item.request, job.item.lifecycle, '', job.observed).tasks[0];
            issues = [...(parsed?.contentIssues || []), ...(!parsed?.content ? ['missing content'] : []), ...(!parsed?.requestQuote || !parsed?.evidenceQuote ? ['missing request/result citation'] : [])];
          } catch (error) { issues = [error.message]; }
          if (!issues.length) break;
        }
        const valid = issues.length === 0;
        const result = { caseId: job.item.id, condition: job.condition, promptSha256: job.promptSha256, valid, issues, parsed, calls };
        save(file, result); console.log(JSON.stringify({ caseId: job.item.id, condition: job.condition, valid, calls: calls.length }));
        if (!valid) throw new Error(`${job.item.id}-${job.condition}: ${issues.join(', ')}`);
      } catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
  const rows = cases.map(item => ({ ...item, before: JSON.parse(fs.readFileSync(path.join(root, `${item.id}-before.json`))), after: JSON.parse(fs.readFileSync(path.join(root, `${item.id}-after.json`))) }));
  const summary = { pairs: rows.length, validOutputs: rows.filter(row => row.before.valid && row.after.valid).length * 2, reusedOutputs, freshCalls,
    cases: rows.map(row => ({ id: row.id, before: row.before.parsed.content.answer.text, after: row.after.parsed.content.answer.text, nextAction: row.after.parsed.content.nextAction?.text || '' })), limitations: ['One generation per condition; no blind judge or human-reader study.', 'Baseline can already reach the same judgment; this comparison does not assume every case improves.', manifest.protocol] };
  save(path.join(root, 'summary.json'), summary);
  const priority = standalone ? ['specflow', 'autosave', 'conflict', 'cause-unknown'] : ['conflict', 'specflow', 'cause-unknown'];
  const ordered = [...rows].sort((a, b) => (priority.indexOf(a.id) < 0 ? 99 : priority.indexOf(a.id)) - (priority.indexOf(b.id) < 0 ? 99 : priority.indexOf(b.id)));
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>피라미드 원칙 적용 비교</title><style>:root{--wb-muted:#61707b}body{font:15px/1.75 system-ui,sans-serif;max-width:1280px;margin:32px auto;padding:0 24px;color:#21313c;background:#f6f8fa}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{background:white;border:1px solid #dce2e7;border-radius:12px;padding:20px;min-width:0}h1,h2{line-height:1.4}h2{margin-top:38px}h3{font-size:14px;margin:16px 0 7px}p{margin:6px 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}.wb-decision-conclusion p{font-weight:600}.wb-content-source,.wb-content-basis{color:var(--wb-muted);font-size:12px}.wb-content-basis{display:block}.wb-decision-caution{border-left:2px solid #bb8b2b;padding-left:12px}.wb-decision-action{border-left:2px solid #458672;padding-left:12px}summary{cursor:pointer;color:#566c7d}blockquote,pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 ui-monospace,monospace;background:#f1f4f6;padding:12px;margin:10px 0}ul{padding-left:20px}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style><h1>피라미드 원칙 적용 전후</h1><p>결론 → 결정적 근거 → 필요한 다음 행동. 기존 6개 평가 기록과 스펙 플로우·원인 미확인 사례를 같은 모델로 비교했습니다. 첫 문장의 판단과 근거를 보는 화면이며, 사람의 이해도를 측정한 실험은 아닙니다.</p><p><a href="#conflict">한글 CSV 실패</a> · <a href="#specflow">스펙 플로우</a> · <a href="#cause-unknown">원인 미확인</a></p>${ordered.map(row => { const options = { t: value => value, esc, taskKey: row.id }; return `<article id="${esc(row.id)}"><h2>${esc(row.title)}</h2><p>${esc(row.request)}</p><div class="pair"><section class="card"><h3>직전 짧은 형식</h3>${beforeRenderer.render(row.before.parsed, options)}</section><section class="card"><h3>피라미드 원칙 적용</h3>${renderer.render(row.after.parsed, options)}</section></div><details><summary>평가에 사용한 동일 원문</summary><pre>${esc(row.evidence)}</pre></details></article>`; }).join('')}</html>`;
  fs.writeFileSync(path.join(root, 'comparison.html'), html, { mode: 0o600 });
  if (standalone) {
    fs.writeFileSync(path.join(root, 'comparison.html'), html
      .replace(/피라미드 원칙 적용 비교/gu, '원문 없이 이해하는 분석 비교')
      .replace(/피라미드 원칙 적용 전후/gu, '원문 없이 이해하고 판단할 수 있도록')
      .replace('결론 → 결정적 근거 → 필요한 다음 행동.', '무엇이 어떻게 동작하는지와 판단을 바꾸는 제한을 먼저 보여줍니다.')
      .replace(/직전 짧은 형식/gu, '직전 피라미드 형식')
      .replace(/피라미드 원칙 적용<\/h3>/gu, '맥락·역할·제한을 보완한 결과</h3>'), { mode: 0o600 });
  }
  console.log(JSON.stringify({ complete: true, pairs: rows.length, comparison: path.join(root, 'comparison.html') }));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
