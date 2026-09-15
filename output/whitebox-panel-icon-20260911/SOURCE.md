# Whitebox panel icon

Created 2026-09-11 as a proposed Whitebox app icon. The application assets have not been replaced.

## Source and permission

The three-pane structure is adapted from Lucide `panels-top-left`, through the local `output/app-icon-refinement-20260911/status-control.svg` concept.

- Upstream repository: https://github.com/lucide-icons/lucide
- Pinned revision: `5d592a96aaeb4a3a09ffd8134f8f5ed878c9a0c5`
- Original SVG: https://github.com/lucide-icons/lucide/blob/5d592a96aaeb4a3a09ffd8134f8f5ed878c9a0c5/icons/panels-top-left.svg
- Original license: https://github.com/lucide-icons/lucide/blob/5d592a96aaeb4a3a09ffd8134f8f5ed878c9a0c5/LICENSE
- Original SVG SHA-256: `321a2a5500f2b814a2e62eb73c4b01dc65c7334fe2e6f7d77517239383e26bb1`
- Copyright (c) 2026 Lucide Icons and Contributors.

The upstream SVG is retained as `upstream-panels-top-left.svg`; the complete upstream license is retained as `LICENSE.txt`. The ISC license permits use, modification and distribution, including commercial use, provided the copyright and permission notices accompany copies. Retain `LICENSE.txt` in distributions of this icon or its derivatives.

## Design changes

The outline window becomes three solid rounded panels on a charcoal tile. The top panel contains three status dots. The sidebar is off-white, and the large terminal panel is mint, with a geometric `>_` prompt. The icon uses flat fills and transparent outer corners. The structure is intentionally readable at small app-icon sizes.

Palette: charcoal `#202522`, off-white `#f6f4ee`, mint `#6ddbb2`.

Method: direct SVG editing and deterministic Chromium canvas export. No image-generation model was used for these assets. PNG and ICO files are rendered from `whitebox-icon.svg`.

This documents permission for the source artwork; it does not establish exclusive ownership or trademark clearance.

## Files

- `whitebox-icon.svg`: editable master.
- `whitebox-icon.png`: 1024 × 1024 PNG.
- `whitebox-icon-{size}.png`: 16, 24, 32, 48, 64, 128, 256, 512 and 1024 pixel exports.
- `whitebox-icon.ico`: Windows ICO with seven PNG frames from 16 through 256 pixels.
- `preview.png`: light and dark preview with actual-size examples.
- `upstream-panels-top-left.svg`, `LICENSE.txt`: source and license notices.
- `render.cjs`: reproducible export script; run with this project's Electron executable.
- `checksums.sha256`: SHA-256 hashes of the included files.

상업적 사용·수정·배포가 가능한 Lucide 기반 아이콘입니다. 재배포할 때 `LICENSE.txt`의 원저작권 표시와 허가문을 함께 제공하세요. 앱 적용 전 시안이며, 상표권 검토를 완료한 것은 아닙니다.
