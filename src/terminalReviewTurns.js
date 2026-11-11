'use strict';
(() => {

// Completion requires a submitted prompt and a provider's finished-turn marker
// followed by its input prompt. Silence, elapsed time and tool pauses are never
// completion signals. Unknown UI formats remain waiting instead of guessing.
const promptPattern = /^\s*[❯›]\s?(.*)$/u;
// Gemini CLI (google-gemini/gemini-cli): the input row is " > " (YOLO "* ",
// shell mode "! ") and a sent request is echoed as "> request". Model replies
// are indented under "✦ ", so a quoted "> " inside a reply never starts a row.
// Grok Build (xai-org/grok-build): "❯ " inside the boxed composer
// "│ ❯ draft │", or bare in minimal mode.
const promptPatterns = {
  gemini: /^ ?[>*!] (.*)$/u,
  grok: /^\s*(?:│\s?)?[❯›]\s?(.*?)(?:\s*│)?\s*$/u,
};
const promptFor = provider => promptPatterns[provider] || promptPattern;
// An empty input box shows the provider's own placeholder, not a draft.
const placeholderPattern = /^(?:Ask Codex to do anything|Try ".*"|Summarize recent commits|Find and fix a bug in @filename|Type your message or @path\/to\/file|Build anything)[.…]*$/u;
// Claude's live status line is a spinner glyph, a verb ending in an ellipsis
// and the elapsed time: "✢ Nucleating… (1m 1s · ↓ 4.0k tokens · thought for 3s)".
// Current Claude Code shows no "esc to interrupt" while it works.
const busyPattern = /esc to (?:interrupt|cancel)|ctrl\+c to interrupt|press (?:enter|return) to (?:continue|confirm)|do you want to proceed|allow this|waiting for (?:approval|permission)|enter to confirm|is this a project you created or one you trust|(?:^|\n)\s*[✻✽✶✢✳✺✼*·]\s+[^\n]*…\s*(?:\(\d|$|\n)|(?:^|\n)\s*[\u2801-\u28ff] [^\n]*\S|waiting on answers for|(?:^|\n)\s*(?:│\s*)?(?:allow [^\n?│]{1,80}\?|apply this change\?)[ \t]*(?:│[ \t]*)?(?=\n|$)/iu;
// Gemini and Grok draw a braille spinner row while a turn runs ("⠋ Thinking...
// (esc to cancel, 4s)", "⠧ Run npm test 0.2s"), and ask in a dialog titled
// "Allow …?" / "Apply this change?"; Grok's "◆ Waiting on answers for …" is an
// open question. Each holds automatic delivery like Claude's spinner does.
const finishedPattern = {
  // "✻ Churned for 8m 18s · done 2:57 PM". The live line above can also say
  // "thought for 3s", so a line with the spinner's ellipsis is never a finish.
  claude: /^\s*[✻✽✶✢✳✺✼*]\s+(?![^\n]*…).+(?:\bfor\s+\d|\bdone\s+\d)/iu,
  codex: /^\s*(?:[─━-]+\s*(?:Worked|Working time|Completed|Finished)\b|Worked for \d+(?:[smh]|\s+(?:seconds?|minutes?|hours?))\b.*[•·]\s*\d{1,2}:\d{2})/iu,
  // Grok Build's turn footer: "Worked for 2m5s", or "Turn completed." without a clock.
  grok: /^\s*(?:Worked for \d[\d.hms]*|Turn completed\.)\s*$/u,
  // Gemini CLI prints no turn footer. Its reply rows start with "✦ "; the last
  // one followed by the input row, with no spinner row in between, ends the turn.
  gemini: /^ ?✦ \S/u,
};

function isStartupRequest(request) {
  const text = String(request || '').trim();
  const trustChoice = '(?:[❯›>]\\s*)?(?:[1-3][.)]\\s*)?(?:Trust(?: (?:once|all|this (?:folder|project|directory)))? and continue|Continue without trusting(?:\\s*\\(hooks won[\u0027\u2019]t run\\))?)';
  return /^(?:Ask Codex to do anything|Try ".*")[.…]*$/u.test(text)
    || new RegExp(`^(?:${trustChoice})(?:\\s+${trustChoice})*$`, 'iu').test(text)
    || /^(?:Yes, I trust this folder|No, exit)$/iu.test(text)
    || /^(?:\S*[/\\])?(?:claude|codex)(?:\.exe)?(?:\s+(?:--?\S+|resume\b|continue\b)[\s\S]*)?$/iu.test(text)
    || /^\/(?:clear|help|mcp|model|status|config|resume|exit|quit|login|logout|reload-skills|theme|permissions)(?:\s|$)/iu.test(text)
    || /<command-name>\/(?:clear|help|mcp|model|status|config|resume|exit|quit|login|logout|reload-skills|theme|permissions)<\/command-name>/iu.test(text)
    || isSlashCommand(text);
}

// Built-in CLI commands are controls even with arguments (`/model opus`,
// `/compact focus`). A custom command or skill invoked with content
// (`/grill-me <question>`, `/project:sync 오늘 것`) is a request to the AI and
// is summarized like any other; without content it stays a control. Paths
// such as `/Users/me/a.js` are not commands: the token has no inner slash.
const CONTROL_COMMANDS = new Set(['add-dir', 'agents', 'approvals', 'btw', 'bug', 'clear', 'compact', 'config', 'context', 'cost',
  'diff', 'doctor', 'exit', 'export', 'fast', 'feedback', 'help', 'hooks', 'ide', 'init', 'login', 'logout', 'mcp', 'memory',
  'mention', 'model', 'new', 'permissions', 'plugin', 'pr-comments', 'quit', 'release-notes', 'reload-skills', 'resume',
  'review', 'rewind', 'skills', 'status', 'statusline', 'terminal-setup', 'theme', 'undo', 'upgrade', 'usage', 'vim']);
function slashCommand(request) {
  const text = String(request || '').trim();
  const tagged = text.match(/<command-name>\/([^<\s/]+)<\/command-name>/iu);
  if (tagged) return { name: tagged[1], args: (text.match(/<command-args>([\s\S]*?)<\/command-args>/iu)?.[1] || '').trim() };
  const typed = text.match(/^\/([a-z][\w:.-]*)(?=\s|$)([\s\S]*)$/iu);
  return typed ? { name: typed[1], args: typed[2].trim() } : null;
}
function isSlashCommand(request) {
  const text = String(request || '').trim();
  if (/^<(?:local-command-stdout|local-command-stderr|local-command-caveat)>/iu.test(text)
    || /^Caveat: The messages below were generated by the user while running local commands/iu.test(text)) return true;
  const command = slashCommand(text);
  if (!command) return /^<command-message>/iu.test(text);
  return CONTROL_COMMANDS.has(command.name.toLowerCase()) || !command.args;
}
// The provider log records a skill invocation as tagged markup; show it the
// way the user typed it.
function readableRequest(request) {
  const text = String(request || '');
  const command = /<command-name>/iu.test(text) ? slashCommand(text) : null;
  return command && command.args && !isSlashCommand(text) ? `/${command.name} ${command.args}` : text;
}

function isContinuationSummary(request) {
  const prefix = String(request || '').trimStart().replace(/^#{1,6}[ \t]+/u, '');
  // Match the provider's continuation envelope, not mentions, quoted examples,
  // or ordinary requests to summarize something. Newlines may wrap its header.
  return /^This\s+session\s+is\s+being\s+continued\s+from\s+a\s+previous\s+conversation\s+that\s+ran\s+out\s+of\s+context\.(?:\s|$)/iu.test(prefix);
}
function isNonTaskRequest(request) { return isStartupRequest(request) || isContinuationSummary(request); }

function submittedPrompt(screen, provider) {
  const promptPattern = promptFor(provider);
  const lines = String(screen || '').split('\n');
  let index = -1;
  for (let i = 0; i < lines.length; i++) if (promptPattern.test(lines[i])) index = i;
  if (index < 0 || busyPattern.test(lines.slice(-12).join('\n'))) return '';
  const first = lines[index].match(promptPattern)[1].trim();
  if (!first || placeholderPattern.test(first)) return '';
  const draft = [first];
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*[─━]/u.test(line) || /^\s*(?:Context\b|\[(?:Fable|Opus|Sonnet|Haiku|GPT)|\d+% context)/iu.test(line)) break;
    if (!/^\s{2,}\S/u.test(line)) break;
    draft.push(line.trim());
  }
  const request = draft.join('\n').slice(0, 4000);
  return isNonTaskRequest(request) ? '' : request;
}

function completionStamp(screen, provider) {
  const lines = String(screen || '').split('\n');
  const markers = lines.map((line, index) => finishedPattern[provider]?.test(line) ? index : -1).filter(index => index >= 0);
  const last = markers.at(-1);
  return JSON.stringify({ count: markers.length, marker: last === undefined ? '' : lines[last].trim() });
}

function completedTurn(screen, request, provider, baselineStamp, options = {}) {
  if (!request || !finishedPattern[provider]) return '';
  const promptPattern = promptFor(provider);
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
  // Gemini and Grok can echo a long paste as a chip ("[Pasted Text: 12 lines]")
  // instead of its text. Without a log, the chip of the turn that just finished,
  // with no later request, is that paste.
  if (start < 0 && options.exactRequest && hasNewCompletion && ['gemini', 'grok'].includes(provider)) {
    let lastFinish = -1;
    for (let i = 0; i < lines.length; i++) if (finishedPattern[provider].test(lines[i])) lastFinish = i;
    for (let i = lastFinish - 1; i >= 0; i--) {
      const text = lines[i].match(promptPattern)?.[1].trim();
      if (!text) continue;
      if (/^\[Pasted (?:text|content)\b[^\]]{0,80}\]$/iu.test(text)) { start = i; request = text; }
      break;
    }
  }
  if (start < 0 || (options.exactRequest && !hasNewCompletion)) return '';
  if (options.exactRequest) {
    const actual = lines.slice(start, start + request.split('\n').length).map((line, index) => index ? line.trim() : line.replace(promptPattern, '$1').trim()).join('\n');
    if (actual !== request.trim()) return '';
    // A later submitted prompt belongs to another request.
    if (lines.slice(start + 1).some(line => { const match = line.match(promptPattern); return match?.[1].trim() && !placeholderPattern.test(match[1].trim()); })) return '';
  }
  let finished = -1, ready = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (finishedPattern[provider].test(lines[i])) finished = i;
    if (finished >= 0 && promptPattern.test(lines[i])) { ready = i; break; }
  }
  if (ready < 0 || busyPattern.test(lines.slice(finished + 1).join('\n'))) return '';
  const evidence = lines.slice(start, ready).join('\n').trim();
  // A completion banner without answer content is not enough.
  const answer = lines.slice(start + request.split('\n').length, ready)
    .filter(line => line.trim() && !finishedPattern[provider].test(line) && !busyPattern.test(line) && !/^\s*[─━-]+\s*$/u.test(line));
  return answer.length ? evidence : '';
}

function currentTurnEvidence(screen, request, provider) {
  if (!request) return '';
  const promptPattern = promptFor(provider);
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
  const promptPattern = promptFor(provider);
  const lines = String(screen || '').split('\n');
  let index = -1;
  for (let i = 0; i < lines.length; i++) if (promptPattern.test(lines[i])) index = i;
  if (index < 0 || lines.length - index > 15) return false;
  let finished = -1;
  for (let i = 0; i < index; i++) if (finishedPattern[provider].test(lines[i])) finished = i;
  // Completed-turn scrollback can retain the former spinner. Only a busy
  // indicator after that explicit finish belongs to the current input state.
  if (busyPattern.test(lines.slice(finished >= 0 ? finished + 1 : -15).join('\n'))) return false;
  const draft = lines[index].match(promptPattern)[1].trim();
  if (draft && !placeholderPattern.test(draft)) return false;
  // Gemini wraps a draft under its "> " prefix (3 columns in); the bordered
  // or background box and the footer follow.
  if (provider === 'gemini') {
    const end = lines.findIndex((line, row) => row > index && (!line.trim() || /^\s*[─━╰╭]/u.test(line)));
    return !lines.slice(index + 1, end < 0 ? undefined : end).some(line => /^ {3}\S/u.test(line));
  }
  // Grok's boxed composer: text on any row before its bottom border is a draft.
  // Minimal mode has no box; wrapped rows sit under the 2-column arrow.
  if (provider === 'grok') {
    const boxed = /^\s*│/u.test(lines[index]);
    const end = lines.findIndex((line, row) => row > index && (boxed ? /^\s*╰/u.test(line) : !line.trim()));
    return !lines.slice(index + 1, end < 0 ? undefined : end).some(line => boxed ? /^\s*│\s*[^\s│]/u.test(line) : /^ {2}\S/u.test(line));
  }
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
const api = { currentTurnEvidence, submittedPrompt, completedTurn, completionStamp, inputReady, readinessText, isStartupRequest, isSlashCommand, isContinuationSummary, isNonTaskRequest, readableRequest };
if (typeof module !== 'undefined') module.exports = api;
else window.WhiteboxTerminalReviewTurns = api;

})();
