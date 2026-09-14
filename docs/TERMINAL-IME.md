# Terminal IME maintenance

Whitebox embeds Ghostty through `@crunchloop/ghostty-web` 0.4.6. The browser
textarea owns preedit editing. `renderer/terminal-ime.js` intercepts composition
before it reaches the library's input handler; completed text travels through
`terminal.input` → `onData` → the acknowledged workbench queue. The overlay
never sends bytes directly to a PTY and no xterm private helper is patched.

## Composition contract

- Preedit never reaches the PTY. A deferred commit reads the final textarea
  value, excluding the unchanged suffix and any replaced selection.
- Flush that commit before the next composition or ordinary control key. This
  preserves Korean 받침 transfer when compositionend.data still has the old
  syllable and Chromium updates the textarea before the next compositionstart.
- Reconcile a native insertText event with the previous deferred commit using
  the textarea state, not text equality alone. Identical new syllables remain
  valid input.
- Process/229, composing Backspace and lone modifiers do not finalize preedit.
  Cancellation sends no deletion. Enter submits completed text in order.
- Navigation moves the textarea's shadow caret along grapheme boundaries while
  Ghostty encodes the corresponding PTY key. Enter clears completed shadow text.
- Place the overlay and native candidate anchor at the actual Canvas cursor.
  Ghostty itself measures preedit cell widths. Preserve the existing row tail,
  wide characters, colors and right-edge clipping while composing.
- Blur flushes only already-finished input; disposal cancels pending commits,
  removes listeners/subscriptions and destroys the overlay.

## References

The regression cases retain lessons from Orca's
[commit ownership fixes](https://github.com/stablyai/orca/pull/12278),
[native-input reconciliation](https://github.com/stablyai/orca/pull/12560), and
[recorded Windows sequence](https://github.com/stablyai/orca/pull/13168).
The recorded-trace fixture is pinned to
`f7719ad37e7b3dd3b83b56af156ecfaed741951b`. These are behavior references;
Whitebox's implementation uses Ghostty and browser events.

## Verification and limits

`npm run test:terminal:ime` exercises the real Electron renderer and bundled
Ghostty with synthetic DOM traces and Chromium CDP composition. Coverage
includes rapid `알겠습니다`, `각` → `가나`, midline CJK/emoji replacement,
cancellation, native commit ordering, modifiers, Backspace, Enter, blur,
addon disposal and Codex's delayed cursor restoration. Stock xterm is retained
only as a dev-only comparison in this test. Results are written to
`artifacts/terminal-ime/results.json`.

`npm run test:terminal` also exercises a real Windows PowerShell/ConPTY process,
Ghostty parsing and rendering of computed output, resize and confirmed exit.
The clipboard test is `electron scripts/terminal-clipboard-check.js`.

These checks are automated browser traces, not fresh physical keyboard captures.
Native Windows/Microsoft Korean and macOS/two-set Korean validation remains
unexecuted. Before claiming that coverage, exercise continuous Korean typing,
shifted consonants, composing Backspace, Space/Enter and repeated midline
insertion/cancellation in a shell and agent TUI on each OS. Rerun all terminal
checks whenever upgrading the embedded engine.
