# repro-check

A developer tool for Whitebox itself. It checks a claimed UI bug fix in the real
app: it launches the before-fix and after-fix Whitebox invisibly, replays one
frozen scenario on each side, and records whether the user's symptom is visible.
It is not packaged into the app. macOS only.

The agent workflow (find the bug, freeze the symptom before reading the fix,
run, report) lives in `.claude/skills/repro-check/SKILL.md`. In a Claude session
in this repository, say "실제 앱에서 확인해줘".

## Run

```
node scripts/repro-check/run.js scripts/repro-check/scenarios/trash.js --before v2.0.23 --after v2.0.25 --runs 3
```

- `--before`, `--after`: a tag, commit or branch of this repository, or a folder
  (a worktree with uncommitted changes). A ref becomes a temporary worktree with
  `npm ci` and is removed afterwards. A folder must already have `node_modules`
  with Electron installed.
- `--runs`: runs per side (default 3).
- `--keep`: keep each run's profile and fake HOME for debugging.
- `WHITEBOX_REPO`: repository to take refs from (default: this checkout).

Results go to `scripts/repro-check/runs/<time>-<scenario>/` (git-ignored):
`verdict.txt`, `summary.json`, and per run `timeline.jsonl`, `result.json`,
`isolation.json` and `shots/*.png` (the test window only).

`node scripts/repro-check/find-recent-fix.js --days 3` lists recent
"complaint → AI said fixed" pairs from local Claude transcripts and the
installed Whitebox version. It only reads.

| Scenario | Time per run | AI | Checked |
|---|---|---|---|
| `trash.js` | ~12 s | none | v2.0.23 Y, v2.0.25 N |
| `send-wait.js` | ~1–2 min | Claude Haiku, 1–2 short prompts | v2.0.28 Y, v2.0.34 N |
| `drop-position.js` | ~35 s | none | v2.0.35 Y, v2.0.36 N |

## What it is good for

In-app UI behavior. Bugs that depend on AI summary content, process or
transcript linking, tray/menu bar/notifications/focus, Windows, or an old
Claude CLI gave wrong answers in both directions in testing; do not use it for
those.

## Isolation

- Every run gets a fresh `--user-data-dir`, a fake HOME (only
  `~/Library/Keychains` is linked so the Claude CLI stays signed in), a short
  private TMPDIR and a free debug port.
- The environment is built from scratch. Session variables (`CLAUDE*`,
  `ANTHROPIC*`, `WHITEBOX_PANEL*`) and the `~/.whitebox/bin` adapter are not
  passed through, and this is checked before launch.
- `lib/launcher-main.js` loads the target's own `main.js` with
  `WHITEBOX_TEST_INSTANCE=1`, an invisible, unfocusable, click-through window,
  no notifications and no Dock icon. Targets whose `main.js` does not honor
  `WHITEBOX_TEST_INSTANCE` are refused.
- Input goes through CDP (`Runtime.evaluate`), not OS input.
- After every run, processes whose command line contains the run folder or
  whose working folder is the run folder are stopped with their children.
  Nothing whose working folder is under `~/Library/Application Support` is ever
  stopped. The next run starts only when nothing is left.

## Scenario format

```js
module.exports = {
  name: 'my-bug',
  complaint: 'the user complaint, verbatim',
  symptom: 'one sentence: what is visible on screen',
  needsClaude: false,          // true puts the real claude CLI on PATH
  timeoutSec: 120,             // optional, default 300
  async steps(page, ctx) {
    const id = await ctx.newShell();
    // click, wait, read ...
    await page.shot('after-click');
    return { symptom: true, note: 'one line' };  // true = symptom, false = none, null = undecidable
  },
};
```

`page`: `eval(fn, ...args)`, `waitFor(fn, label, ms, ...args)`, `click(selector)`,
`fill(selector, text)`, `text(selector)`, `visible(selector)`, `shot(name)`.

`ctx`: `newShell()`, `newClaude({ model, args })`, `type(id, text)`, `enter(id)`,
`terminalText(id)`, `activeId()`, `sleep(ms)`, `log(obj)`, and `side`, `run`,
`version`.

Wait the way a user would. Do not click anything else while watching for the
symptom; creating a new terminal, for example, can release a stuck message and
hide the bug.
