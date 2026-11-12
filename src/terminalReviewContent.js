'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { artifactText, continuationCommands, spacingExamples } = require('./terminalReviewArtifacts');

const contentInstructions = `Return content:{"version":2,"shape":"draft|change|answer|review|decision|general","answer":{"text":"actual answer","basis":"observed|reported|inference|unknown","quote":"exact evidence substring"},"details":[{"text":"essential mechanism or reason","basis":"observed|reported|inference|unknown","quote":"exact evidence substring"}],"limitations":[{"text":"material uncertainty","quote":"exact evidence substring or empty"}],"nextAction":null,"deliverables":[{"label":"output name","kind":"command|text|path|url","value":"exact output","basis":"observed|reported","quote":"exact evidence containing value"}],"background":[],"handoff":{"kind":"verify|decide|continue|finish|reply","temporal":{"text":"time or later change","basis":"reported","quote":"exact evidence"},"priority":{"text":"first need and why","basis":"inference","quote":"exact evidence"},"prompt":{"text":"suggested next request","basis":"inference","quote":"exact evidence"}}}.
SHAPE (what the user wanted): draft=prose for others to read/send; answer states the draft's own message to its reader, never that it was written/saved; details=2 more key points; limitations=open promises/placeholders in it. change=code/config edits. answer=explanation. review=findings: up to 4 details, worst first, each with location and severity:"high|medium|low". decision=asks the user to choose (handoff decide). general=else. FIXED SHAPE overrides.
PYRAMID: Judgment → decisive reasons → necessary action. Failed required tests mean incomplete work. Explain the actual result or system behavior, never merely that the assistant finished explaining.
STANDALONE: No conversation/project knowledge assumed. Name target and purpose; explain jargon, commands, labels like F1 and referents from source-backed context. Name missing facts.
LIMIT FIRST: In answer itself, pair the result with the loss, exception or verification boundary that changes the user's judgment. Possible lost edits outrank 'autosave added / tests passed'. An explained workflow with an untried central stage must say upfront that this stage is unverified in use. Narrow checks do not prove complete real-world operation. Details/limitations add specifics, never a buried reversal of the opening.
WORKFLOW: Input → processing → human answer/approval → resumption → finish and output meaning. Preserve automatic/manual boundaries, conditions and human handoff; omit peripheral history.
CONCISE: Use short plain sentences. No repetition, filler or generic caveats. Simple changes/relays need no details. Aim for 3-5 short sentences, 180-350 Korean chars; hard total 560 across answer+details+limitations+nextAction. Answer <=220; 0-2 details <=140 each; 0-2 limitations <=140 each. Cut peripheral detail, never decisive evidence or uncertainty.
HANDOFF: Always supply handoff for fresh analysis. temporal is null or a claim <=140 for recorded-time/later changes/current unknowns. Only supplied same-target later records supersede earlier advice; dates alone prove nothing. Never infer today's installed state or borrow another project's result. priority is ALWAYS a claim <=140: one need plus why, or why finish needs no request. Tie it to the user's goal; if a prominent failure is not first, explain why without inventing its cause. prompt is a natural next request <=240: target, action, observable result; basis=inference, exact supporting quote, never execution authority. kind=verify/decide/continue/reply requires prompt; finish requires prompt=null. Each non-null temporal/priority/prompt is {text,basis,quote}. decide: name the question and options in words; invent no preference. Diagnose one decision-changing unknown; never rebuild unverified work or repeat completed checks. Temporal+priority+prompt <=360; nextAction=null. No invented follow-up for completed explanations/greetings.
DECISION: Preserve actual options, optional/required and proposed/current behavior. Name work, not counts. Give source-backed usage examples.
OUTPUTS: Status/path/test totals are not content. Summarize actual added rules with ONE short applied example; do not repeat long policy paragraphs as deliverables. Distinguish user wishes and pre-edit reads from acknowledged changes. Guides need prerequisites → sequence → expected outcome → resume point; retain the actual next command when explaining how to continue. Use recorded bodies/diffs/authored fragments; request missing indexed records. Never invent missing body. A failure elsewhere does not prove these edits failed. 0-8 exact outputs <=8000 chars, quotes <=10000. Requested commands remain visible, exempt from prose limits. background: 0-8 claims <=1600 chars, usually empty; no core content/limits hidden.
PROVENANCE: Each non-unknown claim needs an exact quote supporting ALL its facts; expand the excerpt or split the claim. observed requires a quote in OBSERVED TOOL EXCERPTS; it means output was recorded, not all assertions are verified. Assistant explanations/code/claimed tests are reported. Mixed observed+reported facts use reported. Unsupported reasoning, including suggested diagnostics, is inference with explicit conditions; unknown has an empty quote. Keep failures and uncertainty visible. Page metadata proves no body; process exit proves no window closure. Shortened excerpts prove no full-source absence. Separate errors from claims. Omit unrelated warnings.
SELF-CHECK: Can a new reader understand the answer, its limit and next decision without the transcript? Resolve contradictions from original records. Optional subject:{text,basis,quote}, <=100 chars, names the task goal when the title is raw markup or vague. For commands superseded by supplied later evidence set usage:"historical" and usageNote:{text,basis,quote}, <=140, citing why. Never relabel old commands as current or silently rewrite their bytes. Other commands are recorded-time instructions, not proof of present applicability.`;


const SHAPES = ['draft', 'change', 'answer', 'review', 'decision', 'general'];

function evidenceFor(task) {
  const { changes, ...metadata } = task.toolEvidence || {};
  const authored = artifactText(changes);
  const observed = (task.toolEvidence?.items || []).filter(item => ['returned', 'error'].includes(item.status) && typeof item.excerpt === 'string').map(item => item.excerpt).join('\n');
  // Render original strings as strings, not JSON-escaped quotations. This keeps
  // literal newlines/quotes citable without reconstructing or changing facts.
  const updates = (task.assistantUpdates?.items || []).filter(item => typeof item === 'string').join('\n\n');
  const prior = (task.reviewContext?.items || []).map(item => `EARLIER USER:\n${item.request || ''}\nEARLIER ASSISTANT:\n${item.answer || ''}`).join('\n\n');
  const conditions = (task.reviewContext?.conditions || []).map(item => item.original || '').join('\n\n');
  return {
    source: [task.reviewEvidence || '', observed, JSON.stringify(metadata),
      `RECORDED AUTHORED CHANGES (reported fragments, not independent file reads):\n${authored}`,
      `CURRENT ASSISTANT UPDATES (reported, not tool results):\n${updates}`,
      `PRIOR CONTEXT (not current execution):\n${prior}\n${conditions}`].join('\n'),
    observed, authored,
  };
}

function assessContent(value, { source = '', observed = '', authored = '', request = '' } = {}) {
  if (value === undefined) return { content: null, issues: [] }; // Legacy analyses remain readable, explicitly attributed.
  const issues = [];
  // Titles and recommended priorities may cite the user's stated goal. This is
  // scope evidence only; it never enters the observed tool-result channel.
  const citationSource = `${source}\nORIGINAL REQUEST (scope only):\n${request}`;
  const field = (input, name, max, required = true) => {
    if (typeof input !== 'string' || (required && !input.trim()) || input.length > max) issues.push(name);
    return typeof input === 'string' ? input.trim() : '';
  };
  if (!value || ![1, 2].includes(value.version) || typeof value !== 'object' || Array.isArray(value)) return { content: null, issues: ['content version'] };
  const compact = value.version === 2;
  const quote = (input, name, required, omissionLimit = false) => {
    const result = field(input, `${name} quote`, 10000, required);
    const exact = sourceExcerpt(result, citationSource);
    if (result && (!exact || !omissionLimit && /^\[omitted[: ]/iu.test(result))) issues.push(`${name} unsupported quote`);
    return exact || result;
  };
  const claim = (item, name, max) => {
    const text = field(item?.text, `${name} text`, max);
    const basis = item?.basis;
    if (!['observed', 'reported', 'inference', 'unknown'].includes(basis)) issues.push(`${name} basis`);
    const cited = quote(item?.quote, name, basis !== 'unknown');
    if (basis === 'observed' && (!cited || !sourceExcerpt(cited, observed))) issues.push(`${name} observed attribution`);
    return { text, basis, quote: cited };
  };
  const list = (input, name, max) => {
    if (!Array.isArray(input) || input.length > max) issues.push(name);
    return Array.isArray(input) ? input.slice(0, max) : [];
  };
  // An unknown shape is the default summary, never a reason to retry.
  const shape = compact && SHAPES.includes(value.shape) ? value.shape : 'general';
  const findings = shape === 'review';
  const answer = claim(value.answer, 'answer', compact ? 220 : 1000);
  const subject = compact && value.subject != null ? claim(value.subject, 'subject', 100) : null;
  if (/^(?:질문(?:에|에는)\s*(?:직접\s*)?답(?:했|변했)|(?:설명|안내|요청한 작업)(?:은|는|이)?\s*(?:완료|끝)|(?:설명 대신.*)?요청을 충족|the (?:assistant|answer) (?:answered|fulfilled))/iu.test(answer.text)) issues.push('answer is only a verdict');
  const details = list(value.details, 'details', compact ? findings ? 4 : 2 : 8).map((item, index) => ({ ...claim(item, `detail ${index}`, compact ? 140 : 1600),
    // A finding's severity is optional; an unknown value is dropped, never retried.
    ...(findings && ['high', 'medium', 'low'].includes(item?.severity) ? { severity: item.severity } : {}) }));
  const limitations = list(value.limitations, 'limitations', compact ? 2 : 6).map((item, index) => ({
    text: field(item?.text, `limitation ${index}`, compact ? 140 : 600), quote: quote(item?.quote, `limitation ${index}`, false, true),
  }));
  const background = compact ? list(value.background ?? [], 'background', 8).map((item, index) => claim(item, `background ${index}`, 1600)) : [];
  const nextAction = compact && value.nextAction != null ? claim(value.nextAction, 'next action', 140) : null;
  let handoff = null;
  if (compact && value.handoff != null) {
    const item = value.handoff;
    if (!['verify', 'decide', 'continue', 'finish', 'reply'].includes(item.kind)) issues.push('handoff kind');
    const temporal = item.temporal == null ? null : claim(item.temporal, 'handoff temporal', 140);
    if (item.priority == null) issues.push('handoff priority must be a non-null {text,basis,quote}, even for finish: explain why no request is needed');
    const priority = claim(item.priority, 'handoff priority', 140);
    const prompt = item.prompt == null ? null : claim(item.prompt, 'handoff prompt', 240);
    if (item.kind !== 'finish' && !prompt) issues.push('handoff request missing');
    if (item.kind === 'finish' && prompt) issues.push('finished work must not manufacture a request');
    if (prompt && prompt.basis !== 'inference') issues.push('handoff prompt is a suggestion, not execution evidence');
    if ([temporal?.text || '', priority.text, prompt?.text || ''].join('').length > 360) issues.push('handoff length');
    if (nextAction) issues.push('use handoff instead of a duplicate next action');
    handoff = { kind: item.kind, temporal, priority, prompt };
  }
  if (compact && [answer.text, ...details.map(item => item.text), ...limitations.map(item => item.text), nextAction?.text || ''].join('').length > (findings ? 840 : 560)) issues.push('compact explanation length');
  const deliverables = list(value.deliverables, 'deliverables', 8).map((item, index) => {
    const name = `deliverable ${index}`;
    const label = field(item?.label, `${name} label`, 200);
    const requestedOutput = field(item?.value, `${name} value`, 8000);
    const cited = quote(item?.quote, name, true);
    const output = sourceExcerpt(requestedOutput, cited);
    if (!['command', 'text', 'path', 'url'].includes(item?.kind)) issues.push(`${name} kind`);
    if (!['observed', 'reported'].includes(item?.basis)) issues.push(`${name} basis`);
    if (!output || output.length > 8000) {
      issues.push(`${name} invented output`);
      issues.push('copy each command from one contiguous source block; do not join separate fenced blocks');
    }
    if (item?.basis === 'observed' && !sourceExcerpt(cited, observed)) issues.push(`${name} observed attribution`);
    if (item?.kind === 'url') {
      try { if (!['https:', 'http:'].includes(new URL(output).protocol)) issues.push(`${name} unsafe URL`); }
      catch { issues.push(`${name} unsafe URL`); }
    }
    if (item?.usage !== undefined && (item.kind !== 'command' || !['recorded', 'historical'].includes(item.usage))) issues.push(`${name} usage`);
    const usageNote = item?.usageNote == null ? null : claim(item.usageNote, `${name} usage note`, 140);
    if (item?.usage === 'historical' && !usageNote) issues.push(`${name} historical command needs a sourced usage note`);
    if (usageNote && item.kind !== 'command') issues.push(`${name} usage note is command-only`);
    return { label, kind: item?.kind, value: output, basis: item?.basis, quote: cited,
      ...(item?.usage !== undefined ? { usage: item.usage } : {}), ...(usageNote ? { usageNote } : {}) };
  });
  const texts = [answer.text, ...details.map(item => item.text), ...(nextAction ? [nextAction.text] : [])];
  if (new Set(texts).size !== texts.length) issues.push('repeated content');
  // Require some actual authored content on the default screen when it exists.
  // Exact overlap is a mechanical coverage check, not semantic fact checking.
  // Only authored documents must surface verbatim. For code edits the
  // explanation is the content; requiring a quoted code line failed coding
  // summaries even when they were accurate.
  const documents = authored.split(/(?=^RECORDED (?:edit|write): )/mu)
    .filter(block => /^RECORDED (?:edit|write): [^\n]*\.mdx?\s*$/iu.test(block.split('\n')[0])).join('\n');
  const bodyLines = documents.split(/\n/u).filter(line => line.length >= 16 && !/^(?:RECORDED |ACK excerpt:|Partial |\[omitted)/u.test(line));
  const coversBody = [answer, ...details, ...deliverables].some(item => item.quote?.length >= 16
    && bodyLines.some(line => item.quote.includes(line) || line.includes(item.quote)));
  if (bodyLines.length && !coversBody) issues.push('authored content omitted from default explanation');
  const resumeCommands = continuationCommands(authored);
  if (resumeCommands.length && !resumeCommands.some(command => deliverables.some(item => item.kind === 'command' && item.value.includes(command)))) {
    issues.push(`include this recorded resume command as a visible literal output, copied without changes: ${resumeCommands[0]}`);
  }
  const examples = /예시|빈\s*(?:행|줄)|example|blank\s*line/iu.test(request) ? spacingExamples(authored) : [];
  if (examples.length && !examples.some(example => deliverables.some(item => item.value.includes(example)))) issues.push(`include one actual applied spacing example as a visible literal output: ${examples[0]}`);
  if (issues.length) return { content: null, issues: [...new Set(issues)] };
  const visible = [answer, handoff?.temporal, handoff?.priority, handoff?.prompt, ...limitations, ...details, nextAction].filter(Boolean).map(item => item.text);
  const bare = compact ? unexplainedLabels(visible, source) : [];
  return { content: { version: value.version, ...(compact ? { shape } : {}), answer, details, limitations, deliverables, ...(compact ? { background, nextAction, ...(subject ? { subject } : {}), ...(handoff ? { handoff } : {}) } : {}) }, issues: [],
    advisories: bare.length ? [`explain each conversation label at its first visible use, e.g. "F1(코드 포맷 도구 선택)", or replace it with words: ${bare.join(', ')}`] : [] };
}

// Labels a conversation assigns (F1, E3~E11) are opaque to a reader who never
// saw the transcript. Well-known product/technical names are not such labels.
const KNOWN_LABELS = new Set(['S3', 'EC2', 'M1', 'M2', 'M3', 'M4', 'M5', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'L1', 'L2', 'L3', 'G1', 'A4', 'P50', 'P90', 'P95', 'P99', 'IE11', 'F5', 'F11', 'F12']);
const LABEL = /(?<![A-Za-z0-9_./-])([A-Z]{1,2})(\d{1,3})(?:\s*[~–-]\s*\1?\d{1,3})?(?![A-Za-z0-9_])/gu;
function unexplainedLabels(texts, source) {
  const seen = new Set(), bare = [];
  for (const text of texts) {
    for (const match of text.matchAll(LABEL)) {
      const label = `${match[1]}${match[2]}`;
      if (seen.has(label) || KNOWN_LABELS.has(label) || !source.includes(label)) continue;
      seen.add(label);
      const before = text.slice(0, match.index), after = text.slice(match.index + match[0].length);
      const glossed = /^\s*(?:[(（]\s*[^)）\s]|[:：]\s*\S)/u.test(after) || /[^\s(（]\s*[(（]\s*$/u.test(before);
      if (!glossed) bare.push(match[0].replace(/\s+/gu, ''));
    }
  }
  return bare;
}

// Models often normalize indentation/blank lines when quoting terminal output.
// Recover the EXACT original bytes, including shell line continuations, instead
// of displaying a rewritten command. No word, punctuation or ordering change is
// allowed. Ambiguous matches with different original bytes are rejected.
function sourceExcerpt(wanted, source) {
  if (!wanted || typeof source !== 'string') return '';
  if (source.includes(wanted)) return wanted;
  const query = wanted.replace(/\s+/gu, ' ').trim();
  if (!query) return '';
  const pieces = [...source.matchAll(/\s+|\S+/gu)];
  const starts = [], ends = []; let normalized = '';
  for (const item of pieces) {
    const value = /^\s/u.test(item[0]) ? ' ' : item[0];
    for (let index = 0; index < value.length; index++) {
      starts.push(item.index + (value === ' ' ? 0 : index));
      ends.push(item.index + (value === ' ' ? item[0].length : index + 1));
    }
    normalized += value;
  }
  let match = '', offset = normalized.indexOf(query);
  while (offset >= 0) {
    const exact = source.slice(starts[offset], ends[offset + query.length - 1]);
    if (exact.length > 10000 || match && match !== exact) return '';
    match = exact; offset = normalized.indexOf(query, offset + 1);
  }
  return match;
}

// A sidecar adds explanations without rewriting live sessions or Chromium's
// database. Match the original analysis AND evidence; never reuse after reanalysis.
function contentIdentity(task) {
  return { taskId: task.taskId || '', analysisId: task.analysisId || '', request: task.request || '', evidenceDigest: task.evidenceDigest || '' };
}
function historyContent(file) {
  if (!file) return [];
  try {
    const target = path.join(path.dirname(file), 'terminal-review-content-backfill.json');
    if (fs.statSync(target).size > 32 * 1024 * 1024) return [];
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 2000) return [];
    return data.entries.flatMap(item => {
      if (!item || typeof item.sessionId !== 'string' || !item.identity?.request || !item.identity?.taskId) return [];
      const parsed = assessContent(item.content, { ...item.evidence, request: item.identity.request });
      return parsed.content ? [{ sessionId: item.sessionId, creationId: item.creationId || '', identity: item.identity,
        content: parsed.content, generatedAt: item.generatedAt, usage: item.usage ?? null }] : [];
    });
  } catch { return []; } // No sidecar is normal; corrupt additions cannot replace originals.
}

// A reply that ends by asking the user to pick among listed options must show
// the question and every option verbatim. These come from the reply itself,
// never from the model, so a short summary cannot drop or reword a choice.
const OPTION = /^\s*(?:[-*•]\s*)?(?:\*\*)?(?:\(([A-Za-z0-9])\)|([A-Za-z0-9])[.)]|([①-⑩]))(?:\*\*)?\s+(\S[\s\S]*)$/u;
const plain = value => value.replace(/\*\*|__|`/gu, '').replace(/^\s*(?:#{1,6}\s+|[-*•>]\s+)/u, '').replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '').trim();
// Options listed first and asked about last: a numbered list, then a short
// closing paragraph such as "세 가지를 한 브랜치에서 같이 진행할까요?".
const DECISION_QUESTION = /진행|할까요|하실|하시겠|고르|선택|어느|어떤|어떻게|원하시|정해|괜찮|which|should I|shall I|want me|would you like|prefer/iu;
function trailingChoices(lines) {
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end--;
  let start = end;
  while (start > 0 && lines[start - 1].trim()) start--;
  if (end < 0 || end - start > 2 || lines.slice(start, end + 1).some(line => OPTION.test(line))) return null;
  const asked = lines.slice(start, end + 1).map(plain).join(' ').match(/[^.!?。？]*[?？]/gu)?.at(-1)?.trim();
  if (!asked || !DECISION_QUESTION.test(asked)) return null;
  let row = start - 1;
  while (row >= 0 && !lines[row].trim()) row--;
  const options = [];
  for (; row >= 0 && lines[row].trim(); row--) {
    const match = lines[row].match(OPTION);
    if (match) options.unshift({ label: match[1] || match[2] || match[3], text: plain(match[4]).slice(0, 300) });
    else if (!/^\s+\S/u.test(lines[row])) break; // a heading or prose line ends the list
  }
  if (options.length < 2 || options.length > 8 || new Set(options.map(item => item.label.toLowerCase())).size !== options.length) return null;
  return { question: asked.slice(0, 300), options, recommendation: null };
}
function pendingChoices(answer) {
  const lines = String(answer || '').split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index++) {
    if (!/[?？]\s*(?:\*\*)?\s*$/u.test(lines[index]) || OPTION.test(lines[index])) continue;
    const options = [];
    let row = index + 1;
    for (; row < lines.length; row++) {
      if (!lines[row].trim() && !options.length) continue;
      const match = lines[row].match(OPTION);
      if (!match) break;
      options.push({ label: match[1] || match[2] || match[3], text: plain(match[4]).slice(0, 300) });
    }
    if (options.length < 2 || options.length > 8 || new Set(options.map(item => item.label.toLowerCase())).size !== options.length) continue;
    // The assistant's own pick, when it names one option right after the list.
    let recommendation = null;
    for (let next = row; next < Math.min(lines.length, row + 4) && !recommendation; next++) {
      const line = lines[next];
      if (!/➡|→|권장|추천|제안|봅니다|recommend|suggest|I'd (?:pick|choose)|建议|推荐/iu.test(line)) continue;
      // The first option named wins: "(b)라고 봅니다 … (a)는 권하지 않습니다".
      const named = options.map(item => ({ item, at: line.search(new RegExp(`\\(${item.label}\\)|(?<![A-Za-z0-9])${item.label}\\s*(?:안|번)|\\boption\\s+${item.label}\\b`, 'iu')) }))
        .filter(entry => entry.at >= 0).sort((a, b) => a.at - b.at);
      const picked = named[0]?.item;
      if (picked) recommendation = { label: picked.label, text: plain(line).slice(0, 400) };
    }
    blocks.push({ question: plain(lines[index]).slice(0, 300), options, recommendation });
    index = row - 1;
  }
  const trailing = trailingChoices(lines);
  if (trailing) blocks.push(trailing);
  return blocks.slice(-3);
}

module.exports = { SHAPES, contentInstructions, assessContent, evidenceFor, contentIdentity, historyContent, sourceExcerpt, pendingChoices };
