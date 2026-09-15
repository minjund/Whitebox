# Whitebox — exposed AI circuitry

Created 2026-09-11 in response to feedback that window panels did not communicate observing how AI works.

## Concept

A cutaway white enclosure reveals a brain-to-circuit structure. The left half uses a simplified filled brain silhouette. Visible circuit branches extend to the right, with one mint output crossing the open side of the enclosure. The visual intent is inspecting AI activity inside the box, rather than arranging application windows.

The brain represents AI, and the exposed circuit routes represent observable execution.

Palette: charcoal `#202522`, off-white `#f6f4ee`, mint `#6ddbb2`.

Method: existing vector artwork adapted through direct SVG editing, then exported at each size using Chromium canvas. No image-generation model was used.

## Source and permission

The brain silhouette and exposed circuit motif are adapted from Lucide `brain-circuit`.

- Repository: https://github.com/lucide-icons/lucide
- Pinned revision: `5d592a96aaeb4a3a09ffd8134f8f5ed878c9a0c5`
- Original icon: https://github.com/lucide-icons/lucide/blob/5d592a96aaeb4a3a09ffd8134f8f5ed878c9a0c5/icons/brain-circuit.svg
- Original license: https://github.com/lucide-icons/lucide/blob/5d592a96aaeb4a3a09ffd8134f8f5ed878c9a0c5/LICENSE
- Copyright (c) 2026 Lucide Icons and Contributors.
- Original SVG SHA-256: `a338cb589935721dc00da71ea7d7457ab7fbb85cff90a62cc3ac6b2ebc68cd82`.

The unmodified upstream icon is included as `upstream-brain-circuit.svg`. The complete upstream license is included as `LICENSE.txt`. See `checksums.sha256` for file hashes. The original icon was fetched from the pinned official repository; the license bytes were verified against the same revision earlier in this conversation.

Changes: fill the brain silhouette, simplify its folds, redraw and thicken the circuit routes, extend one output, add a cutaway enclosure and charcoal tile, and apply the Whitebox palette.

The ISC license allows commercial use, modification and distribution with the original copyright and permission notices retained. Include `LICENSE.txt` when redistributing the icon or a derivative. This records source permission, not exclusive ownership or trademark clearance.

## Deliverables

- `whitebox-icon.svg`: editable master.
- `whitebox-icon.png`: 1024 × 1024 PNG.
- `whitebox-icon-{size}.png`: 16, 24, 32, 48, 64, 128, 256, 512 and 1024 pixel exports.
- `whitebox-icon.ico`: seven embedded Windows icon sizes, 16 through 256 pixels.
- `preview.png`: light and dark preview with small-size samples.
- `render.cjs`: reproducible export script for the project's Electron executable.
- `upstream-brain-circuit.svg`, `LICENSE.txt`: original artwork and license.
- `checksums.sha256`: hashes of the packaged files.

This is a separate preview; the application icon files have not been replaced.
