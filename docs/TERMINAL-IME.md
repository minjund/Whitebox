# Terminal IME maintenance

Whitebox uses xterm 6.0.0. `renderer/terminal-ime.js` adapts its composition
helper; committed input continues through `terminal.input` → `onData` → the
workbench input queue. The display overlay never changes the textarea value or
sends text to the PTY.

## Orca references

- [PR #12278](https://github.com/stablyai/orca/pull/12278): flush a pending Hangul
  syllable before the next composition starts.
- [PR #12560](https://github.com/stablyai/orca/pull/12560): return composition
  ownership to xterm, replace the delayed textarea-diff path with native input
  reconciliation, preserve lone Meta keys, and align preedit to terminal cells.
  The source patch inspected for this change is pinned at
  `1254e6536d1956a7ff75ad1f176f70e58d1fb56b` in
  `config/patches/xterm-src/@xterm__xterm@6.1.0-beta.287.src.patch`.
- [PR #13168](https://github.com/stablyai/orca/pull/13168): recorded Windows
  Korean event ordering and exactly-once regression coverage. Whitebox's test
  replays the Windows sequence from commit
  `f7719ad37e7b3dd3b83b56af156ecfaed741951b`.

This is an adaptation to Whitebox's installed xterm and accessibility mode,
not a replacement of its dependency with Orca's patched beta package.

## Defects reproduced before the change

The new Chromium/xterm tests observed these exact failures at `terminalWrite`:

| Input | Before | Required |
| --- | --- | --- |
| Process/229, then compose `한` before timers run | `한한` | `한` |
| Insert `2` inside `가다😀끝` through the IME | `가2다😀끝` | `2` only |
| Cancel a composition replacing a selection | DEL byte | No bytes |
| Native commit after compositionend | `한한` or `한한한` | `한` |
| Press Meta during `ㅎ`, then finish `한` | `ㅎ`, hidden preedit | `한` when committed |
| Backspace with `isComposing`, changing `한` to `하` | `한` + DEL | `하` when committed |

The helper now waits for native input after Process/229 instead of scheduling
`_handleAnyTextareaChanges`. Pending commits flush before the next composition
or ordinary control key. A native commit can reconcile with a deferred send for
one event-loop turn. Deduplication uses the textarea state, so a new insertion
of the same text is retained. A keypress already handled by xterm is not sent a
second time by the native input event.

The existing midline suffix protection and row-tail display remain in place.
Preedit spacing uses xterm's Unicode cell widths so the caret and following
text stay aligned when Hangul changes from preedit to committed output.

## Verification and limits

- `npm run test:terminal:ime`: actual Electron/Chromium and installed xterm,
  DOM event sequences, Chromium CDP composition and arrow navigation, CJK/emoji
  midline insertion, cancellation, Enter ordering, late native commits in both
  accessibility modes, Orca's recorded Windows sequence, and addon disposal.
- `npm run test:terminal`: real Windows ConPTY lifecycle and input/output smoke
  tests. This does not drive the OS Korean input method.
- `npm run check:source`: JavaScript syntax checks.

Results are written to `artifacts/terminal-ime/results.json`. The DOM sequences
and recorded-trace replay are automated reproductions, not a fresh physical
keyboard capture. Native Windows/Microsoft Korean and macOS/two-set Korean
keyboard validation remain unexecuted on this change. Before claiming native
platform coverage, exercise continuous `알겠습니다`, 받침 transfer (`각` →
`가나`), shifted consonants, composing Backspace, Space/Enter, and repeated
insertion/cancellation inside `가다😀끝` on each OS, in a shell and agent TUI.

The private xterm hooks are capability checked and restored when the addon is
disposed. Re-run the IME suite whenever changing xterm; an upgrade can invalidate
these hooks even when ordinary terminal typing still works.
