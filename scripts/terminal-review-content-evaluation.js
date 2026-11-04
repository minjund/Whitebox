'use strict';

// Live production-prompt check against saved records. This tests formatting,
// evidence attribution and displayed content, not human reading performance.
const fs = require('node:fs');
const path = require('node:path');
const { AgentRunner } = require('../src/agentRunner');
const { reviewPrompt, parseReview } = require('../src/terminalReview');
const { evidenceFor } = require('../src/terminalReviewContent');
const { render } = require('../renderer/terminal-review-decision');

async function main() {
  const [input, destination, indices = '11,34,37,56,60'] = process.argv.slice(2);
  if (!input || !destination) throw new Error('Expected input-records.json output-directory [one-based-indices]');
  const records = JSON.parse(fs.readFileSync(input, 'utf8'));
  const output = path.resolve(destination); fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const runner = new AgentRunner({ runsDir: path.join(output, 'runtime', 'agent-runs') });
  const summary = [];
  for (const index of indices.split(',').map(Number)) {
    const original = records[index - 1]?.task;
    if (!original) throw new Error(`No case ${index}`);
    const file = path.join(output, `${String(index).padStart(3, '0')}.json`);
    if (fs.existsSync(file)) { const saved = JSON.parse(fs.readFileSync(file)); if (saved.valid) { summary.push(saved.summary); continue; } throw new Error('Preserve and investigate the failed attempt before retrying'); }
    const evidence = evidenceFor(original);
    const current = `${original.reviewEvidence}\nCURRENT TOOL RECORDS:\n${evidence.observed}\nRECORDED AUTHORED CHANGES (reported fragments, not independent file reads):\n${evidence.authored}`;
    const prior = JSON.stringify(original.reviewContext || {});
    const prompt = reviewPrompt(`${current}\nPRIOR CONTEXT (not current execution):\n${prior}`, 'ko', original.request, original.lifecycle || 'completed', evidence.observed, true);
    const calls = []; let parsed, issues = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await runner.generateTerminalReview({ provider: 'codex', model: 'gpt-6.1-sol',
        prompt: attempt ? `${prompt}\nQUALITY REPAIR: Return a complete task with valid content. Mechanical issues: ${issues.join(', ')}.` : prompt });
      calls.push(result);
      try {
        parsed = parseReview(result.text, current, 'ko', original.request, original.lifecycle || 'completed', prior, evidence.observed, evidence.authored).tasks[0];
        issues = [...(parsed?.contentIssues || []), ...(!parsed?.content ? ['missing content'] : parsed.content.version !== 2 ? ['missing compact content'] : []), ...(!parsed?.content?.handoff ? ['missing handoff'] : []), ...(!parsed?.requestQuote || !parsed?.evidenceQuote ? ['missing current request/result quote'] : [])];
      } catch (error) { issues = [error.message]; }
      if (!issues.length) break;
    }
    const valid = issues.length === 0;
    const esc = value => String(value).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const displayed = valid ? render(parsed, { t: value => value, esc, taskKey: original.taskId }).replace(/<details[\s\S]*?<\/details>/gu, '') : '';
    const item = { index, title: original.summary || original.request, valid, calls: calls.length,
      contentChars: parsed?.content ? JSON.stringify(parsed.content).length : 0, visibleDeliverables: parsed?.content?.deliverables.length || 0 };
    fs.writeFileSync(file, JSON.stringify({ valid, summary: item, issues, parsed, displayed, calls }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(item)); summary.push(item);
    if (!valid) throw new Error(`Live production prompt failed case ${index}: ${issues.join(', ')}`);
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ protocol: 'Production reviewPrompt + parseReview + default renderer; five historical cases; no original task execution or human usability measurement.', cases: summary }, null, 2), { mode: 0o600 });
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
