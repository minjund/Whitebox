'use strict';

// Opt-in live paired evaluation. Inputs and baseline prompts are frozen before
// editing the production prompt. Never resume the user's session or enable tools.
// node scripts/terminal-review-decision-evaluation.js <artifact-directory>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { questionnaireCommand } = require('../src/questionnaireCommand');
const { reviewPrompt, parseReview } = require('../src/terminalReview');
const { repairPrompt } = require('../src/terminalReviewDecision');
const directory = path.resolve(process.argv[2] || 'artifacts/terminal-review-decision-20261102');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function generate(prompt, provider, model) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-decision-eval-'));
  const command = questionnaireCommand(provider, cwd, model, process.platform, true);
  const start = Date.now();
  let stdout = '', stderr = '', timeout = false;
  try {
    const exit = await new Promise((resolve, reject) => {
      const child = spawn(command.command, command.args, { cwd, detached: process.platform !== 'win32',
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: ['pipe', 'pipe', 'pipe'] });
      const kill = signal => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); } catch {} };
      let hardKill;
      const timer = setTimeout(() => { timeout = true; kill('SIGTERM'); hardKill = setTimeout(() => kill('SIGKILL'), 3000); }, 150000);
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.stdin.on('error', () => {});
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', (code, signal) => { clearTimeout(timer); clearTimeout(hardKill); resolve({ code, signal }); });
      child.stdin.end(prompt);
    });
    const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const final = events.findLast(event => event.type === 'result');
    const toolCalls = events.flatMap(event => event.message?.content || []).filter(item => item.type === 'tool_use').length;
    const actualModel = events.find(event => event.type === 'system' && event.subtype === 'init')?.model;
    const result = { ...exit, timeout, actualModel, toolCalls, durationMs: Date.now() - start,
      usage: final?.usage || null, text: final?.result || '', error: final?.is_error ? final.result : '', stderr: stderr.slice(-2000) };
    assert(!timeout && exit.code === 0 && !final?.is_error && toolCalls === 0 && result.text, JSON.stringify(result));
    return result;
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

async function main() {
  const baseline = read('baseline.json'), historical = read('historical-taken-codes.json');
  const provider = historical.analysisProvider, model = historical.analysisModel;
  assert.equal(provider, 'claude'); // Same provider/model as the selected real review.
  const manifest = { createdAt: new Date().toISOString(), provider, model, repeats: 2,
    cli: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), baselineCommit: baseline.sourceCommit,
    evidencePolicy: 'Identical frozen evidence per pair; no later conversation turns or current code added; no tools or user-session persistence',
    prompts: baseline.cases.map(item => {
      const before = baseline.prompts.find(value => value.id === item.id);
      assert.equal(hash(before.text), before.sha256);
      const after = reviewPrompt(item.evidence, 'ko', item.request, item.lifecycle);
      return { id: item.id, evidenceSha256: hash(item.evidence), before, after: { text: after, sha256: hash(after) } };
    }) };
  if (fs.existsSync(path.join(directory, 'manifest.json'))) {
    const previous = read('manifest.json');
    assert.deepEqual(previous.prompts, manifest.prompts, 'Cannot resume with different prompts or evidence');
    assert.equal(previous.provider, provider); assert.equal(previous.model, model);
  } else save('manifest.json', manifest);
  for (const item of baseline.cases) for (let repeat = 1; repeat <= manifest.repeats; repeat++) {
    // Alternate execution order to avoid always generating the candidate last.
    for (const variant of repeat % 2 ? ['before', 'after'] : ['after', 'before']) {
      const file = `${item.id}-${repeat}-${variant}.json`;
      const prompt = manifest.prompts.find(value => value.id === item.id)[variant].text;
      if (fs.existsSync(path.join(directory, file))) {
        assert.equal(read(file).promptSha256, hash(prompt), 'Saved output belongs to different inputs');
        continue;
      }
      const calls = [await generate(prompt, provider, model)];
      let parsed = parseReview(calls[0].text, item.evidence, 'ko', item.request, item.lifecycle);
      if (parsed.tasks[0]?.decisionIssues.length) {
        calls.push(await generate(repairPrompt(prompt, parsed.tasks[0].decisionIssues), provider, model));
        parsed = parseReview(calls.at(-1).text, item.evidence, 'ko', item.request, item.lifecycle);
      }
      save(file, { id: item.id, repeat, variant, promptSha256: hash(prompt), calls, parsed });
      console.log(JSON.stringify({ id: item.id, repeat, variant, calls: calls.length,
        model: calls.at(-1).actualModel, decisionIssues: parsed.tasks[0]?.decisionIssues }));
    }
  }
  render(baseline, manifest, historical);
}

function render(baseline, manifest, historical) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const decision = task => `<h3>${esc(task.decision?.conclusion || task.actual)}</h3><ul>${(task.decision?.reasons || []).map(item => `<li>${esc(item.text)}</li>`).join('')}</ul>${task.decision?.caution ? `<p>주의: ${esc(task.decision.caution)}</p>` : ''}${task.decision?.action.text ? `<p><b>${esc(task.decision.action.text)}</b> ${esc(task.decision.action.why)}</p>` : ''}${(task.decision?.alternatives || []).map(item => `<p><b>${esc(item.option)}</b>: ${esc(item.tradeoff)}<br>선택 조건: ${esc(item.when)}</p>`).join('')}`;
  let content = `<h1>Whitebox 분석 프롬프트 비교</h1><p>${esc(manifest.provider)} / ${esc(manifest.model)} · ${esc(manifest.cli)} · 사례당 각 2회</p><p>같은 기록을 넣고 기존·개선 프롬프트를 교차 순서로 호출했습니다. 원래 세션의 이후 대화와 현재 코드는 입력에 넣지 않았습니다. 소규모 비교이며 일반적인 품질 향상률을 뜻하지 않습니다.</p><details><summary>앱에 저장돼 있던 takenCodes 분석</summary>${decision({ decision: historical.decision })}</details>`;
  if (fs.existsSync(path.join(directory, 'assessment.json'))) {
    const audit = read('assessment.json');
    content += `<h2>확인한 변화</h2><table><thead><tr><th>항목</th><th>기존</th><th>개선</th></tr></thead><tbody>${audit.metrics.map(row => `<tr><td>${esc(row.item)}</td><td>${esc(row.before)}</td><td>${esc(row.after)}</td></tr>`).join('')}</tbody></table><p>${esc(audit.interpretation)}</p><p>${esc(audit.limitations)}</p><p>${esc(audit.developmentTrials)}</p>`;
  }
  const results = [];
  for (const item of baseline.cases) {
    content += `<section><h2>${esc(item.title)}</h2><p>${esc(item.request)}</p>`;
    for (let repeat = 1; repeat <= manifest.repeats; repeat++) {
      content += `<h3>실행 ${repeat}</h3><div class="pair">`;
      for (const variant of ['before', 'after']) {
        const result = read(`${item.id}-${repeat}-${variant}.json`); results.push(result);
        const task = result.parsed.tasks[0];
        content += `<article><h2>${variant === 'before' ? '기존 프롬프트' : '개선 프롬프트'}</h2>${decision(task)}<small>실제 모델: ${esc(result.calls.at(-1).actualModel)} · 호출 ${result.calls.length}회 · ${esc(task.decision?.complexity)} · 형식 오류 ${task.decisionIssues.length}개</small><details><summary>JSON과 사용량</summary><pre>${esc(JSON.stringify({ task, calls: result.calls.map(({ text, stderr, ...rest }) => rest) }, null, 2))}</pre></details></article>`;
      }
      content += '</div>';
    }
    content += '</section>';
  }
  save('summary.json', { pairs: results.length / 2, generations: results.length, calls: results.reduce((sum, item) => sum + item.calls.length, 0),
    validDecisions: results.filter(item => item.parsed.tasks[0]?.decision).length, actualModels: [...new Set(results.flatMap(item => item.calls.map(call => call.actualModel)))], toolCalls: results.reduce((sum, item) => sum + item.calls.reduce((n, call) => n + call.toolCalls, 0), 0) });
  fs.writeFileSync(path.join(directory, 'report.html'), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whitebox 분석 비교</title><style>body{max-width:1200px;margin:36px auto;padding:0 22px;font:15px/1.75 system-ui;color:#24352c;background:#f5f7f4}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}article,section>details,body>details{background:#fff;border:1px solid #d7ded6;border-radius:10px;padding:20px}section{margin-top:32px}h1,h2,h3{line-height:1.5}article h2{font-size:14px;color:#45694e}article h3{font-size:18px}small{color:#58645b}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}@media(max-width:720px){.pair{grid-template-columns:1fr}}</style>${content}</html>`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { render };
