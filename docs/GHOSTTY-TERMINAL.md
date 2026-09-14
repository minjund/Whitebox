# Embedded Ghostty terminal

Whitebox embeds Ghostty's WASM terminal engine through the MIT-licensed
[`@crunchloop/ghostty-web` 0.4.6](https://github.com/crunchloop/ghostty-web).
This version is pinned in the manifest and lockfile. It supplies Ghostty VT
parsing/state, Canvas rendering, keyboard encoding, mouse reporting and
selection. It is a community browser integration, not the native Ghostty app
or its Metal/OpenGL renderer. No Ghostty installation or network download is
needed at runtime. Existing node-pty/Windows ConPTY sessions remain the shell
backend. macOS/Linux use the same renderer with their existing PTY backend.

`renderer/terminal-engine.js` loads the local ES module and its embedded WASM
once, lazily, before creating a terminal. The production CSP permits WASM
compilation and `data:` fetches for that embedded binary. HTTP/HTTPS connections
remain disallowed. Loading failures reject terminal creation and are surfaced
through the existing error path; there is no fallback to a different engine.

## Integration contract

- Normalize upstream's distance-from-bottom scroll offsets to Whitebox's
  absolute viewport coordinates; preserve scrollback while output arrives.
- Complete parsed writes on a task, independently of animation frames, so
  hidden sessions can hydrate and finish their pending work.
- Keep empty cells, explicitly printed spaces, wide cells and grapheme text
  intact when reading the buffer. Expose visible rows to assistive technology
  without making the Canvas text selectable as a second browser surface.
- Preserve explicit focus ownership, clipboard shortcuts, normalized bracketed
  paste, Shift+Tab, theme changes, resize and TUI mouse wheel reporting.
- Preserve the WASM object across resets so selection does not retain freed
  state. The full-history selection adapter uses two capability-checked
  internal range fields because 0.4.6's public `selectAll()` selects only the
  viewport. Recheck this hook on every dependency upgrade.
- Keep Korean composition ownership in `terminal-ime.js`; see
  [TERMINAL-IME.md](TERMINAL-IME.md).

Existing `xterm` CSS class names are retained for the app's layout and
accessibility/test selectors. They do not load an xterm emulator. The sole
remaining xterm dependency is dev-only, for comparative IME tests; it is absent
from the packaged runtime.

## Verification

```powershell
npm run test:terminal
npm run test:terminal:ime
& node_modules/.bin/electron.cmd scripts/terminal-clipboard-check.js
npm run test:drawer-conversation
npm test
npm run check:source
npm run check:package
& node_modules/.bin/electron-builder.cmd --dir --win --x64 --publish never --config.directories.output=artifacts/ghostty-terminal/package
$env:WHITEBOX_GHOSTTY_APP_ROOT = (Resolve-Path artifacts/ghostty-terminal/package/win-unpacked/resources/app.asar).Path
npm run test:terminal:engine
Remove-Item Env:WHITEBOX_GHOSTTY_APP_ROOT
```

The engine test loads the production CSP, checks actual WASM/Canvas use,
Unicode/ANSI/theme/alternate-screen state, terminal replies, scrollback,
selection/reset, composition, hidden-window write callbacks, keyboard/mouse
input, and a real PowerShell/ConPTY command with computed output, resize and
confirmed exit. `WHITEBOX_GHOSTTY_APP_ROOT` reruns it against the packaged
`app.asar`, including its packaged node-pty. Screenshots are written to
`artifacts/ghostty-terminal/` and `artifacts/whitebox-pty-focus-visual.png`.

The automated IME traces and Chromium CDP tests are not physical Windows or
macOS input-method certification. The current local validation host is Windows.
No performance improvement over xterm is claimed without comparative profiling.

### Focused Hangul check (2026-09-14)

Run `electron scripts/terminal-hangul-check.js` from the project root; set
`WHITEBOX_GHOSTTY_APP_ROOT` as above to repeat against the packaged ASAR.
Results and dark/light/PowerShell screenshots are saved under
`artifacts/terminal-hangul/{source,packaged}/`.

Both source and the matching packaged renderer were exercised. The checks
preserved all 11,172 modern Hangul syllables in the buffer with two-cell widths;
six UTF-8 chunk sizes (including one byte); compatibility jamo, NFD Hangul,
complex final consonants, mixed emoji/paths; four narrow/wide resizes; ANSI
overwrites and alternate-screen restoration. The dark/light Canvas screenshots
were visually inspected. Chromium composition through the input queue and a
real PowerShell/ConPTY round trip returned the exact mixed Korean text.
`npm run test:terminal:ime` also passed all 17 existing groups in this rerun.
These results do not certify every font glyph or physical Microsoft IME input.

The initial full-history selection check reproduced six missing printed spaces
in a 1,920-character wrapped sample. For 1.8.17, the adapter reads selected
cells directly and trims only unused cells. Its native selection manager uses
the same reader, preserving spaces for mouse and keyboard copy too. The source
Hangul check now passes, as do forward, reverse and partial Unicode selections,
space-only lines, and clearing a selection in the engine integration test.

The release preparation rerun also passed the real Electron OS clipboard check,
including full selection, paste shortcuts, bracketed multiline paste and Ctrl+C.
An earlier access-denied clipboard attempt remains a failed historical result.

## Release status

This is an implementation change, not release approval. The package changes
require the repository's `AGENTS.md` updater compatibility gate before merge or
release: exact candidate SHA, official frozen 1.7.3/1.7.4 installers, fixed
1.7.5 installer, official 1.6.3 → immutable 1.6.23 bridge, and all packaged
success/relaunch/cleanup invariants. Those four updater E2E runs and live-channel
publication verification are not supplied by the terminal tests above. Their
absence remains a release blocker.
