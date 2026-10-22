'use strict';
(() => {

// Completion requires a submitted prompt and a provider's finished-turn marker
// followed by its input prompt. Silence, elapsed time and tool pauses are never
// completion signals. Unknown UI formats remain waiting instead of guessing.
const promptPattern = /^\s*[❯›]\s?(.*)$/u;
const busyPattern = /esc to (?:interrupt|cancel)|ctrl\+c to interrupt|press (?:enter|return) to (?:continue|confirm)|do you want to proceed|allow this|waiting for (?:approval|permission)|enter to confirm|is this a project you created or one you trust/iu;
const finishedPattern = {
  claude: /^\s*[✻✽✶✢✳✺✼*]\s+.+(?:\bfor\s+\d|\bdone\s+\d)/iu,
  codex: /^\s*(?:[─━-]+\s*(?:Worked|Working time|Completed|Finished)\b|Worked for \d+(?:[smh]|\s+(?:seconds?|minutes?|hours?))\b.*[•·]\s*\d{1,2}:\d{2})/iu,
};

function isStartupRequest(request) {
  const text = String(request || '').trim();
  return /^(?:Ask Codex to do anything|Try ".*")[.…]*$/u.test(text)
    || /^(?:Yes, I trust this folder|No, exit)$/iu.test(text)
    || /^(?:\S*[/\\])?(?:claude|codex)(?:\.exe)?(?:\s+(?:--?\S+|resume\b|continue\b)[\s\S]*)?$/iu.test(text)
    || /^\/(?:clear|help|mcp|model|status|config|resume|exit|quit|login|logout|reload-skills|theme|permissions)(?:\s|$)/iu.test(text)
    || /<command-name>\/(?:clear|help|mcp|model|status|config|resume|exit|quit|login|logout|reload-skills|theme|permissions)<\/command-name>/iu.test(text);
}

function submittedPrompt(screen) {
  const lines = String(screen || '').split('\n');
  let index = -1;
  for (let i = 0; i < lines.length; i++) if (promptPattern.test(lines[i])) index = i;
  if (index < 0 || busyPattern.test(lines.slice(-12).join('\n'))) return '';
  const first = lines[index].match(promptPattern)[1].trim();
  // Slash commands are CLI controls, not requests to the AI.
  if (!first || first.startsWith('/') || isStartupRequest(first)) return '';
  const draft = [first];
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*[─━]/u.test(line) || /^\s*(?:Context\b|\[(?:Fable|Opus|Sonnet|Haiku|GPT)|\d+% context)/iu.test(line)) break;
    if (!/^\s{2,}\S/u.test(line)) break;
    draft.push(line.trim());
  }
  return draft.join('\n').slice(0, 4000);
}

function completionStamp(screen, provider) {
  const lines = String(screen || '').split('\n');
  const markers = lines.map((line, index) => finishedPattern[provider]?.test(line) ? index : -1).filter(index => index >= 0);
  const last = markers.at(-1);
  return JSON.stringify({ count: markers.length, marker: last === undefined ? '' : lines[last].trim() });
}

function completedTurn(screen, request, provider, baselineStamp, options = {}) {
  if (!request || !finishedPattern[provider]) return '';
  const lines = String(screen || '').split('\n');
  const first = request.split('\n')[0];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(promptPattern);
    if (match?.[1].trim() === first) start = i;
  }
  // The PTY may echo the final typed/IME characters after Enter. Resolve that
  // provisional draft against the actual new completed turn, never an old one.
  let hasNewCompletion = false;
  if (baselineStamp !== undefined) {
    try {
      const before = JSON.parse(baselineStamp), after = JSON.parse(completionStamp(screen, provider));
      hasNewCompletion = Boolean(after.marker && (after.marker !== before.marker || after.count > before.count));
    } catch { /* Malformed identity never permits a completion fallback. */ }
  }
  if (hasNewCompletion && !options.exactRequest) {
    let lastFinish = -1;
    for (let i = 0; i < lines.length; i++) if (finishedPattern[provider].test(lines[i])) lastFinish = i;
    for (let i = lastFinish - 1; i >= 0; i--) {
      const match = lines[i].match(promptPattern);
      if (match?.[1].trim()) { start = i; request = match[1].trim(); break; }
    }
  }
  if (start < 0 || (options.exactRequest && !hasNewCompletion)) return '';
  if (options.exactRequest) {
    const actual = lines.slice(start, start + request.split('\n').length).map((line, index) => index ? line.trim() : line.replace(promptPattern, '$1').trim()).join('\n');
    if (actual !== request.trim()) return '';
    // A later submitted prompt belongs to another request.
    if (lines.slice(start + 1).some(line => { const match = line.match(promptPattern); return match?.[1].trim() && !/^(?:Ask Codex to do anything|Try ".*")$/u.test(match[1].trim()); })) return '';
  }
  let finished = -1, ready = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (finishedPattern[provider].test(lines[i])) finished = i;
    if (finished >= 0 && promptPattern.test(lines[i])) { ready = i; break; }
  }
  if (ready < 0 || busyPattern.test(lines.slice(ready - 2).join('\n'))) return '';
  const evidence = lines.slice(start, ready).join('\n').trim();
  // A completion banner without answer content is not enough.
  const answer = lines.slice(start + request.split('\n').length, ready)
    .filter(line => line.trim() && !finishedPattern[provider].test(line) && !/^\s*[─━-]+\s*$/u.test(line));
  return answer.length ? evidence : '';
}

function currentTurnEvidence(screen, request) {
  if (!request) return '';
  const lines = String(screen || '').split('\n');
  const first = request.split('\n')[0];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(promptPattern);
    if (match?.[1].trim() === first) start = i;
  }
  if (start < 0) return '';
  const body = lines.slice(start + request.split('\n').length);
  const next = body.findIndex(line => promptPattern.test(line));
  const scoped = next >= 0 ? body.slice(0, next) : body;
  const reports = scoped.filter(line => !/^\s*(?:[✻✽✶✢✳✺✼*]|[─━]|Context\b|\[(?:Fable|Opus|Sonnet|Haiku|GPT)|⏵)/u.test(line));
  const answer = reports.join('\n').trim();
  return answer ? `USER:\n${request}\nASSISTANT (current report):\n${answer}` : '';
}

function inputReady(screen, provider) {
  if (!finishedPattern[provider]) return false;
  const lines = String(screen || '').split('\n');
  if (busyPattern.test(lines.slice(-15).join('\n'))) return false;
  let index = -1;
  for (let i = 0; i < lines.length; i++) if (promptPattern.test(lines[i])) index = i;
  if (index < 0 || lines.length - index > 15) return false;
  const draft = lines[index].match(promptPattern)[1].trim();
  if (draft && !/^(?:Ask Codex to do anything|Try ".*"|Summarize recent commits|Find and fix a bug in @filename)$/u.test(draft)) return false;
  // Claude puts its custom multi-line status bar below the input's closing
  // rule. Only text inside that bounded input area can be a wrapped draft.
  const closingRule = lines.findIndex((line, row) => row > index && /^\s*[─━]{8,}\s*$/u.test(line));
  if (provider === 'claude' && closingRule > index
    && lines.slice(closingRule + 1).some(line => /^\s*\[(?:Fable|Opus|Sonnet|Haiku)/u.test(line))) {
    return lines.slice(index + 1, closingRule).every(line => !line.trim());
  }
  // Wrapped input is also a draft. Status/footer rows have known delimiters.
  return !lines.slice(index + 1).some(line => /^\s{2,}\S/u.test(line)
    && !/^\s*(?:[─━│←?⚠⏵]|\[(?:Fable|Opus|Sonnet|Haiku|GPT)|Context\b|\d+% context|GPT-|.*for shortcuts)/u.test(line));
}
function readinessText(buffer) {
  const start = Math.max(0, buffer.length - 400);
  const rows = Array.from({ length: buffer.length - start }, (_, offset) => buffer.getLine(start + offset));
  const lines = rows.map(row => row?.translateToString(true) || '');
  let prompt = -1;
  for (let row = 0; row < lines.length; row++) if (promptPattern.test(lines[row])) prompt = row;
  // A ghost suggestion is faint text *after* the cursor in an otherwise empty
  // prompt. Never strip ordinary text, text before the cursor, or IME input.
  const cursorRow = buffer.baseY + buffer.cursorY - start;
  if (prompt >= 0 && cursorRow === prompt) {
    const prefix = rows[prompt]?.translateToString(false, 0, buffer.cursorX) || '';
    const end = lines.findIndex((line, row) => row > prompt && /^\s*[─━]{8,}\s*$/u.test(line));
    if (/^\s*[❯›]\s*$/u.test(prefix) && end > prompt) {
      let faint = true, characters = 0;
      for (let row = prompt; row < end; row++) {
        for (let col = row === prompt ? buffer.cursorX : 0; col < (rows[row]?.length || 0); col++) {
          const cell = rows[row].getCell(col), text = cell?.getChars() || '';
          if (!text.trim()) continue;
          characters++;
          if (!cell.isDim?.()) faint = false;
        }
      }
      if (faint && characters) {
        lines[prompt] = prefix;
        for (let row = prompt + 1; row < end; row++) lines[row] = '';
      }
    }
  }
  return lines.join('\n').slice(-24000);
}
const api = { currentTurnEvidence, submittedPrompt, completedTurn, completionStamp, inputReady, readinessText, isStartupRequest };
if (typeof module !== 'undefined') module.exports = api;
else window.WhiteboxTerminalReviewTurns = api;

})();
