# Analysis that supports the next decision

The analysis should let a reader identify the current result, why it matters,
the uncertainty that could change the judgment, and one useful next action.
More model input and checking must not turn into a longer first screen.

## First screen and detail

The first screen shows a conclusion, one to three reasons, a material caution
when needed, and one recommended action with its reason. Valid action kinds
are finish, verify, choose, and continue. Finishing needs no follow-up request.
Recommendations never authorize execution: the existing follow-up button opens
a draft for the user to review.

Choose is reserved for an actual unresolved choice. It requires two or three
alternatives, each explaining its tradeoff and the condition that favors it.
Alternatives are collapsed. Original requests, reported work, explanations,
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
