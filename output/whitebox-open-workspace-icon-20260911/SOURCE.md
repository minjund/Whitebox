# Whitebox — visible workspace icon

Created 2026-09-11 as the next icon concept following the terminal-panel preview.

## Design

A single off-white square frame surrounds three visible work areas. The left area spans the frame height; the two right areas represent an overview and active work. A small mint dot inside the largest right-hand area indicates activity. The frame and its open interior are the main mark.

The terminal prompt and browser-style row of dots have been removed. The three spaces are dark openings within one connected white structure, replacing the separate filled panels of the previous concept.

Palette: charcoal `#202522`, off-white `#f6f4ee`, mint `#6ddbb2`.

Method: direct SVG editing, exported at each target size using Chromium canvas. No image-generation model was used. Rounded tile corners have transparency and antialiased edges.

## Source and license

The panel structure is adapted from Lucide `panels-top-left`, with the full-width top panel changed to a full-height left panel and two stacked right-hand areas. The geometry is redrawn as a filled frame with inset spaces and one activity dot.

- Repository: https://github.com/lucide-icons/lucide
- Pinned revision: `5d592a96aaeb4a3a09ffd8134f8f5ed878c9a0c5`
- Original SVG: https://github.com/lucide-icons/lucide/blob/5d592a96aaeb4a3a09ffd8134f8f5ed878c9a0c5/icons/panels-top-left.svg
- Original license: https://github.com/lucide-icons/lucide/blob/5d592a96aaeb4a3a09ffd8134f8f5ed878c9a0c5/LICENSE
- Original SVG SHA-256: `321a2a5500f2b814a2e62eb73c4b01dc65c7334fe2e6f7d77517239383e26bb1`
- Original license SHA-256: `b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57`
- Copyright (c) 2026 Lucide Icons and Contributors.

The upstream SVG and complete license are retained as `upstream-panels-top-left.svg` and `LICENSE.txt`. Their bytes were checked against the pinned official upstream revision in this conversation. The ISC license allows use, modification, and distribution, including commercial use, with the copyright and permission notices retained. Include `LICENSE.txt` with redistributed copies or derivatives.

Permission for the source artwork does not establish exclusive ownership or trademark clearance.

## Files

- `whitebox-icon.svg`: editable master.
- `whitebox-icon.png`: 1024 × 1024 PNG.
- `whitebox-icon-{size}.png`: 16, 24, 32, 48, 64, 128, 256, 512, and 1024 pixel exports.
- `whitebox-icon.ico`: Windows icon with seven embedded sizes, 16 through 256 pixels.
- `preview.png`: previews on light and dark backgrounds, including small sizes.
- `render.cjs`: export script, run with this project's Electron executable.
- `upstream-panels-top-left.svg` and `LICENSE.txt`: original source and required notices.
- `checksums.sha256`: hashes of the packaged files.

This is a separate design proposal; the application icon files have not been replaced.

흰색 프레임 안의 작업 공간과 작은 실행 표시로, 내부 작업이 보이는 Whitebox를 표현한 시안입니다. 배포 시 동봉한 `LICENSE.txt`를 함께 제공하세요.
