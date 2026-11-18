---
name: repro-check
description: Check a claimed Whitebox UI bug fix in the real app. Launches the before-fix and after-fix Whitebox invisibly, replays the user's symptom, and reports 고쳐짐 / 안 고쳐짐 / 재현 못 함 / 판정 불가 with screenshots. Use when the user says "실제 앱에서 확인해줘", "진짜 고쳐졌는지 봐줘", "repro-check", or asks to verify a fix in the real app.
---

# repro-check

Tool: `scripts/repro-check/` (see its README for the scenario API). Reply to the user in their language.

## Rule zero: do not ask the user to choose

The user says one line. Find what to check yourself (step 1), say in one line what you picked, show the frozen scenario, and run it. Ask only when there is no in-scope candidate at all.

## 0. Scope

Reliable only for **in-app UI behavior** (examples that worked: trash, summary-mode send queue, drop position). Do not run, and say why in one line, when the bug depends on:

- AI summary or analysis content (the summary may fail its own checks, so the symptom never sets up)
- process or transcript linking, such as the background-job badge (gave a false alarm on the fixed version)
- tray, menu bar, notifications, window focus (the test window disables them)
- Windows-only behavior (macOS only)
- an old Claude CLI screen (only today's installed CLI is available)

## 1. Find what to check

1. **In this conversation:** if the user described a UI bug and you answered that it is fixed, use the user's message verbatim as the complaint. `after` is the current working folder (if it has uncommitted changes) or the current branch/commit.
2. **Fresh session:** run `node scripts/repro-check/find-recent-fix.js --days 3`. It lists recent "complaint → AI said fixed" pairs from Claude transcripts (newest first) and the installed Whitebox version. Pick the newest in-scope one. Use `git log --oneline -15` only to locate the fixing commit or tag, never to define the symptom.
3. **before:** the previous tag when the fix shipped in a tag (after `v2.0.36` → before `v2.0.35`); otherwise `git merge-base main <after>` or `<fix>~1`. Check whether the user was still on an older installed version when they complained.
4. Say it in one line, e.g. "11-16 드래그앤드롭 위치 불만, v2.0.35 → v2.0.36으로 확인합니다." List other candidates in one line each.

## 2. Freeze the symptom before reading the fix

1. Write the symptom as one sentence about **what is visible on screen**, not tied to a step order. Bad: "the second message after a finished answer is queued". Good: "the AI is idle but my message stays '전송 대기' for over 60 s".
2. Write `scripts/repro-check/scenarios/<name>.js` with numeric Y / N / undecidable conditions.
3. You may read the **before** code to find buttons and DOM names. Do not read the fix diff, commit message, changelog or after-side code until the scenario is frozen.
4. Show the scenario (symptom sentence + Y/N conditions) and run immediately. Stop if the user says so.
5. If you change the scenario after seeing results, label it "(사후) 고침" and do not conclude 고쳐짐 from it.

## 3. Run

```
node scripts/repro-check/run.js scripts/repro-check/scenarios/<name>.js --before <ref> --after <ref|dir> --runs 3
```

- No-AI scenarios: `--runs 3`. Claude scenarios: `--runs 1` first, Haiku, short prompts.
- One run at a time; wait for it to finish.
- A folder used as `after` needs `node_modules` with Electron installed (`npm ci` then `node node_modules/electron/install.js`).

## 4. Report

- Paste the printed verdict table as is; do not reword the `결론:` line.
- Open one or two screenshots yourself and say in one line what each shows.
- Meanings: 고쳐짐 = before showed the symptom at least once, after never. 안 고쳐짐 = after showed it. 재현 못 함 = before never showed it (do not call it fixed). 판정 불가 = errors or timeouts.
- Limits: fresh HOME (no user settings or plugins), today's Claude CLI, invisible window, DOM-level input, small sample.

## 5. Safety

- Never touch the running Whitebox app: do not quit it, focus it, or notify. The tool launches with `WHITEBOX_TEST_INSTANCE=1`, a fresh profile and an invisible window, and refuses targets that lack that switch.
- Do not read or change Claude or Codex settings and hooks, or `~/Library/Application Support/Whitebox`. Reading Claude transcripts under `~/.claude*/projects` is fine.
- Do not kill processes yourself. The tool kills only its own run's processes, never anything whose working folder is under `~/Library/Application Support`, and stops with a list if anything is left. Show that list to the user.
- Do not commit scenario experiments or `runs/` unless the user asks.
