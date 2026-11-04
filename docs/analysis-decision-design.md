# Analysis that supports the next decision

The analysis should let a reader identify the current result, why it matters,
the uncertainty that could change the judgment, and one useful next action.
More model input and checking must not turn into a longer first screen.

Provider continuation summaries are bookkeeping, not new user requests. Claude's
`isCompactSummary` rows and its anchored "This session is being continued from a
previous conversation that ran out of context." envelope (including a Markdown
heading or wrapped header) do not replace the current native request, enter the
evidence index, or trigger review calls. Ordinary user requests quoting that text
remain tasks. Stored internal-summary turns, queued/failed calls and cards are
removed on capture; an in-flight stale publication is invalidated without freeing
the runner slot early. Renderer history also removes older internal cards on
reload and suppresses their observation indicator. Actual task history remains.

`scripts/terminal-review-continuation-test.js` checks request continuity,
evidence exclusion, saved-state repair and no automatic/manual model calls for
the summary. The Electron workspace check covers an incoming internal-summary
event and a legacy localStorage record while retaining the actual user task.

## First screen and detail

The first screen shows a conclusion, one to three reasons, a material caution
when needed, and a useful recommended action with its reason. Valid action kinds
are finish, verify, choose, and continue. Finishing needs no follow-up request;
its action text and reason may be empty when they would only repeat the answer.
The UI omits that empty action section.
Recommendations never authorize execution: the existing follow-up button opens
a draft for the user to review.

Choose is reserved for an actual unresolved choice. It requires two or three
alternatives, each explaining its tradeoff and the condition that favors it.
Completed explanations and recommendations can also retain supported alternatives
without forcing an unresolved choice or an implementation request. Alternatives
are collapsed. Original requests, reported work, explanations,
verification, and exact evidence excerpts remain in the detailed record.
Decision-changing uncertainty stays visible in the short caution.

First-screen generated body text has maximum budgets of 220 characters for
simple tasks, 450 for standard tasks, and 600 for complex tasks. Count the
conclusion, reason texts, caution, action text and action explanation together.
Titles, quotes, alternatives and the draft request are outside this budget.
There is no minimum: the model must not pad the answer. These initial product
budgets are design choices, not experimentally established readability scores.
The backend rejects an overlong brief instead of cutting a sentence in half.
The source may still have bounded evidence omissions, explicitly marked.

Necessity and design questions separate the operation one caller needs from
shared consumers' needs. Reasons connect operations to consequences instead of
repeating a return type or saying another caller uses it. Declaration-only
changes, behavior changes and changes to a shared/downstream contract must not
be treated as interchangeable. A short question with meaningful tradeoffs uses
the standard budget; a completed label edit does not need invented alternatives.

## Explicit reanalysis

The footer button sends a separate `reanalyze` intent, pinned to the clicked
terminal's creation identity even if selection changes while observation waits.
Selection and automatic polling still deduplicate identical evidence. A manual
request generates fresh analysis for the same completed task, bypasses Jev
screening, and retains earlier results and each run's usage. Duplicate requests
join an active/queued analysis. Failed manual requests retain the previous
result and require another explicit retry; selection does not retry them.
It also works once while automatic review is off, without enabling that setting.
An unfinished answer is never completed by the button. Restarting during a
manual call records an unconfirmed result instead of silently billing again.

The analysis body uses 15px text with 1.8 line height. Short headings and
paragraph wrapping establish hierarchy. More detailed work stays available
through native keyboard-accessible disclosure controls.

## Grounding and bounded repair

Current-request evidence gets up to 12,000 characters, separately from prior
context, intermediate reports and tool metadata. Long native answers preserve
both ends with an omission marker rather than silently dropping the beginning.
No additional file access or tools are enabled for the analysis model.

The existing request/result quote checks still apply. Each decision reason also
needs an exact current-evidence quote. This checks provenance, not the truth of
a claim or whether the quote logically proves it. The writing instructions
require explicit attribution of AI reports. ASD-STE100 clarity principles are
retained in the requested output language.

Mechanical validation checks required fields, quotes, action kind, material
unverified requirements, omission caution, per-field and total lengths, exact
duplicate text, and meaningful choice structure. These checks do not reliably
detect paraphrased repetition, unsupported semantic conclusions or every hidden
uncertainty. An invalid new decision object gets one replacement call from the
same evidence and the failed check names; the bad draft is not supplied as new
evidence. Both calls' reported usage is added. If either usage is unknown, the
total remains unknown. There is no unbounded improvement loop.

Malformed JSON, conflicting result objects, and zero or multiple tasks for one
submitted request share that single replacement opportunity. Format recovery
uses the unchanged scoped evidence and static failure labels, never the invalid
draft. It also applies to a malformed response after the one optional evidence
retrieval, for at most three model calls in that path. Existing decision-only
repair retains its two-call budget. A second format failure keeps the last usable
review and reports the error; polling unchanged evidence cannot restart recovery.
Replacement output still passes the original citation, decision and session
identity checks, and all reported usage is accumulated without treating unknown
usage as zero.

A second invalid brief is hidden and cannot supply a follow-up draft. The
observed-work record remains available with a notice. Failed runner calls keep
the existing error/retry behavior. A session revision/process change invalidates
late repairs; a newly interrupted request cannot receive a finish action.
Legacy replies without a decision object use the existing record display and
do not trigger an automatic extra call. This is a compatibility path, not proof
that the new decision contract was fulfilled.

## Public design references

Consulted on 2026-10-25. The implementation and prompt text are original. No
third-party runtime or upstream prompt is copied into Whitebox.

- [Matt Pocock — grilling](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md)
  ([MIT](https://github.com/mattpocock/skills/blob/main/LICENSE)) separates facts
  the agent should establish from decisions owned by the user, and makes
  dependent decisions explicit. Whitebox adapts that distinction into evidence,
  recommendation and conditions. It does not run the interview skill.
- [Daniel Miessler — Fabric extract_wisdom](https://github.com/danielmiessler/Fabric/blob/main/data/patterns/extract_wisdom/system.md)
  ([MIT](https://github.com/danielmiessler/Fabric/blob/main/LICENSE)) distinguishes
  a takeaway from recommendations and discourages duplication. Whitebox uses
  that structural idea without its long item quotas or fixed word counts.
- [Promptfoo — assertions and metrics](https://www.promptfoo.dev/docs/configuration/expected-outputs/)
  ([MIT project](https://github.com/promptfoo/promptfoo)) separates deterministic
  checks from model-graded criteria. Whitebox implements small local checks for
  length, shape and source quotations; it does not install Promptfoo or claim
  these checks establish writing quality.
- [Andrej Karpathy — autoresearch](https://github.com/karpathy/autoresearch)
  uses an explicit evaluation objective and fixed experiment budget. This is
  relevant as an evaluation principle, but its model-training code is not a
  component suitable for this terminal analysis feature and is not imported.

## Verification

`node scripts/terminal-review-test.js` includes the decision-brief fixtures:
invented quotes, unsupported follow-ups, unfinished requests, uncertainty,
omission markers, adaptive length, duplicate text, actual alternatives, escaped
HTML, conditional single repair, token aggregation and a late interruption.
The suite also exercises existing request identity, evidence and lifecycle
behavior. These are synthetic regression checks. They do not establish improved
real-model judgment, actual reading speed or usability with production outputs.

## Answer-first explanations and historical records

New reviews use `content.version = 2`; saved version 1 remains readable. Its answer contains the substantive
answer, not an evaluation such as “the assistant answered correctly”. Necessary
mechanism, conditions, evidence limits and literal outputs stay on the default
screen. Transcript excerpts remain available in a disclosure. A command output
is copied exactly from its supporting quote; the renderer never executes it.

Version 2 synthesizes the answer into 3–5 short sentences, aiming for 180–350
Korean characters and rejecting more than 560 explanatory characters. It allows
two essential detail points and two material limitations. Optional background
starts collapsed; a lengthy step-by-step retelling is not the default view.
Literal requested commands are exempt from the prose budget. The fresh runner
declares v2 independently of the model output, so an old verbose schema cannot
silently replace the requested compact explanation.

The pyramid rule makes the user's needed judgment the first sentence. Failed
required tests take priority over a successful edit. Explanation requests start
with the substantive answer, not a verdict on the assistant. Decisive reasons
follow, then optional `nextAction` for an unresolved need in the authorized scope.
That action is source-grounded, counts toward the same prose budget and does not
silently become an executable follow-up. Completed explanations and literal
relays need no invented action. Error analysis distinguishes symptoms, proven
causes and hypotheses; repeated HTTP errors alone do not establish a root cause.

The opening also includes the constraint that changes the practical judgment:
possible lost edits outrank a list of passing autosave tests. An explained but
untried central workflow stage is qualified upfront. The default renderer puts
material limitations immediately after the answer, before supporting details.
Workflow explanations name the starting input, system action, human handoff,
resume trigger and resulting output in plain words. Historical internal state
and unexplained project jargon are removed unless needed to understand the
answer. Missing context is identified rather than invented. Each quote must
support all facts in its claim; mixed observed/reported claims retain the lower
certainty, and proposed diagnostic reasoning is marked as inference.

The paired evaluator's `--standalone` mode pins the previous pyramid prompt
and reuses its actual outputs only when their exact prompt hashes match. It
counts reused outputs separately from new model calls. Fresh outputs and saved
history are reviewed with the transcript closed to look for missing referents,
handoffs and misleading openings. This is an internal content review, not a
human-reader comprehension study or a semantic guarantee from citation checks.

`scripts/terminal-review-pyramid-evaluation.js` compares a pinned compact baseline
against the new prompt using the six original writing-evaluation fixtures plus
the saved Specflow answer and an unknown-cause control. It records exact prompts,
raw model output, usage, validation and the default rendered text. The change
combines pyramid ordering, scoped next action and compressed prompt wording; it
is not an isolated causal experiment or a human reading-performance measurement.

Each answer/detail identifies `observed`, `reported`, `inference` or `unknown`.
The UI states the source scope once per explanation because repeated provenance
badges interrupt reading. Reported paragraphs and outputs have no repeated
labels. Mixed-source explanations identify tool observations at group boundaries;
inference and unknown labels remain visible, as do material evidence limits.
Pasted user output is not attributed to the AI.
Observed means an exact returned/error tool excerpt was recorded, not that the
tool's contents establish every associated claim. Assistant explanations and
reported checks cannot be upgraded to tool observations. Every supported claim
needs a source quote; unknown answers do not manufacture one. Creation metadata
does not verify a document body, and a missing item in a shortened excerpt does
not establish its absence from the complete file or environment. Exact citation
validation is mechanical provenance checking, not semantic fact verification.
Whitespace-normalized quotation matches are accepted only when they resolve to
one identical original substring. The exact source bytes are then displayed,
including shell continuations and line breaks. No command tokens, punctuation,
order or intervening headings may be rewritten. Omission markers can explain
an evidence limitation but cannot support an answer or factual claim.

`node scripts/terminal-review-content-test.js` covers provenance/command
substitution rejection, unsafe URLs/HTML, visible content with disclosures
closed, legacy limitations and stale-history identity. The normal review suite
includes it. `electron scripts/terminal-workspace-check.js` checks the production
renderer with a real PTY fixture, including visible answer/mechanism/limits/
commands and reading archived responses without restoration.

`scripts/reexplain-terminal-history.js` accepts an explicit array of saved
`{location, session, task}` records. It sends original response/tool/context
records to the application's tool-disabled transformer. It does not feed the
previous analysis as evidence or resume the user's original task. Each result
and usage record is saved independently and validated before reuse. Startup
choices remain startup records. Missing original responses receive an explicit
unknown result. The generated comparison uses the supplied frozen baseline
renderer; it is a before/after content inspection, not a human usability test.
`--baseline-content` preserves the previous actual explanation alongside its
renderer. The preview initially shows only improved content and offers comparison
and search controls. `--quality-notes` can regenerate specific records after an
editorial review. Feedback is not evidence: the transformer rereads only original
records, and previous drafts remain as separate hashed result files. Instruction
snapshots prevent mixing prompt revisions in one output directory. Such targeted
revisions are counted separately; they are not claimed as first-pass results.

The optional `--profile <directory> --apply` writes only a new private
`terminal-review-content-backfill.json` beside the review store, via atomic
rename. Existing review/session files and Chromium's database are not rewritten.
The improved renderer loads validated additions through the existing review IPC
and applies them only when session, creation, task, original analysis, request
and evidence identities match. Freshly changed/reanalyzed tasks keep their own
results. Historical re-explanation usage is separate from original usage. An
already-installed older executable does not acquire the new UI by writing this
sidecar; the improved application source must be run or distributed separately.

## Artifact content and follow-up writing

Status, destination and test counts cannot substitute for a document's content.
Rule changes include actual clauses and one short applied example; guides include
prerequisites, sequence, expected results and the next step. Commands copied from
separate source blocks cannot be silently joined into a new command sequence.

`terminalReviewArtifacts` captures bounded fragments only from structured
`Write`/`Edit` calls, after a matching explicit success acknowledgement. It
retains headings, short status/resume sections and a real blank-line change
example. Pending, failed, unmatched and credential-like fragments are omitted.
Shell execution arguments, raw custom patches, hidden reasoning and arbitrary
filesystem reads remain excluded. These fragments are reported authored changes,
not an independent read or proof of the complete resulting file. Original tool
returns remain separately attributed. Authored whitespace affects evidence identity.

When an authored body is available, a default-visible answer/detail/literal must
cite some of its content. A metadata-only result triggers the existing single
bounded repair. Exact overlap checks coverage, not semantic correctness. The
same check preserves a known continuation command and a specifically requested
applied spacing example as visible literals when they exist in the fragments.
It never manufactures an absent command/example or joins separate code blocks.
The
artifact tests cover successful/pending/failed calls, sensitive data exclusions,
heading/resume retention, whitespace identity and the live one-repair path.

Historical recovery is explicitly scoped to the original request and recorded
write acknowledgement. A Python string literal can be read as data with an AST;
its script is never executed. Such a recovered draft excerpt is distinguished
from the full saved document and from later filesystem contents. Partial updates
use `--apply --merge` to preserve other validated historical additions.

`terminal-review-followup-evaluation.js` renders the production default view,
removes collapsed sources, and gives only that visible analysis to a fresh
tool-disabled writer. It asks for a next DB instruction or a rule-sharing draft.
The resulting factual claims are checked against the visible analysis and then
the original evidence. Missing commands/examples trigger another content revision;
known uncertainty may be stated rather than invented away. Actual drafts, invalid
attempts and prompt hashes are retained. This is a task-specific model writing
check, not a human-reader study or a guarantee for every possible follow-up.

`terminal-review-history-audit.js` applies the same separation to a frozen union
of active and trash records. Each fresh writer receives only the default-visible
analysis and title; a separate source auditor then checks the draft and explanation
against the original request. A parent review adjudicates essential omissions and
scope errors rather than treating model self-ratings as proof. CLI controls are
inventoried separately. Optional suggestions are not made mandatory merely to
reproduce the whole original answer.

Writing prose stays bounded; explicitly requested source-exact command blocks
are exempt from the prose budget. Audit citations may contain several separately
validated passages with original offsets. They are stored as an explicit array,
never passed off as one contiguous command or used to loosen output validation.
Invalid attempts and prompt hashes remain available. New source recovery and
changed explanations require a new pinned round. Reports distinguish retained,
revised, control and genuinely unavailable records and never count missing data as
passed. Partial application preserves the other historical additions and does not
rewrite live session stores or restore trash.

## Choosing the next request

Compact content may include a validated `handoff`: `kind`, optional `temporal`,
`priority`, and optional `prompt`. The text budgets are 140/140/240 characters,
with a 360-character total. Time and priority use the same evidence attribution
rules as the answer. The suggested request is always an inference with a source
quote; it is escaped, selectable prose and grants no execution authority. A finish
has no prompt. A handoff replaces `nextAction`, avoiding two competing priorities.
New production calls require this handoff and use the existing single repair;
legacy records without it remain readable.

The screen displays the record timestamp explicitly. The runtime preserves
that time separately from the analysis generation time: `recordedAt`
advances on a new source observation and stays unchanged on explicit reanalysis.
The prompt also identifies saved-result reanalysis as historical. Legacy records
fall back to their original observation time.
A historical backfill can include later original records only after their same target/workflow relationship
has been checked. It preserves the old answer while showing later changes and
the current verification boundary. An old implementation or posting must not be
requested again after a later completion report. A newer date, similar title, or
shared directory does not establish that another repository's result applies.
The frozen inventory is not a live installed-state check.

`terminal-review-next-instruction.js` tests the next decision rather than writing
another summary. Tool-disabled readers receive default-visible analyses only and
choose a target, first need, natural request and expected result, or decide to
finish. Separate source auditors check scope, temporal consistency, duplicate
work and unsupported claims against original records and scoped later evidence.
The initial batched diagnostic pass uses three independently labelled records.
The final reader pass uses `--batch-size 1`: each fresh reader receives exactly
one analysis, preventing another article from filling its gaps. Source audits may
use three labelled records; quotations are validated per record. An audit pins
both the exact visible text and the reader-result hash, so an earlier audit cannot
approve a changed decision. Raw attempts and prompt hashes remain available.
Reader self-ratings are not acceptance evidence; audit failures need source review
and either a correction or a documented scope adjudication.

## Recorded commands, task purpose and missing names

Commands are recorded-time instructions. The renderer labels their time boundary;
this does not prove that they still work in the current installation. A command
superseded by scoped later evidence has `usage: "historical"` and a sourced
`usageNote` claim. Its literal bytes remain in a collapsed historical section,
while the reason stays visible. Never rewrite a command into an unrecorded new
spelling. A recorded command may also carry a visible sourced `usageNote` to
explain a connector name or a target prerequisite.

Optional v2 `subject: {text,basis,quote}` names the user's task goal when the
saved summary is raw command markup or vague. Active cards, history and trash
use the same `displayTitle(task)` helper. The original request, identity and
evidence digest are preserved. The actual user request is valid citation
material for scope and inferred priorities, but is excluded from the observed
tool-result channel; a requested change is not evidence of its completion.

The first recommended task must explain its relation to the user's goal. If a
visible failure is left for separate work, retain it and explain why the first
decision precedes it; do not declare the failure unrelated without evidence.
Explain internal IDs at first use or omit them. A later question alone does not
revoke an earlier restriction (for example a StarCraft 1 naming constraint).
Readers must write a concrete next request from one visible analysis; separate
source auditors check scope, priority, repetition and unsupported assertions.
Known input gaps may lead to an identification request, never fabricated names.

The 2026-11-04 15:18 KST audit freezes 97 records including trash: 86 substantive
bodies, 9 CLI/system records and 2 requests without response evidence. The latter
11 are preserved separately and excluded from successful body counts. Artifact
proofs, isolated reader decisions and profile-write validation are in
`artifacts/standalone-usage-final-20261104/`; these files are ignored by Git.
