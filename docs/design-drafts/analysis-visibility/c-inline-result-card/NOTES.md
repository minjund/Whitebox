# C — 결과가 터미널 안으로 찾아온다

기준 화면은 1440×900입니다. `index.html`을 브라우저에서 직접 열면 됩니다. 외부 폰트, CDN, 이미지, React 실행 환경은 필요하지 않습니다. 상단은 목업 조작부, 하단은 동작 설명이며 실제 제품 UI에 포함할 요소는 아닙니다.

## ① 왜 이 배치인가

사용자가 마지막으로 보던 커서 바로 아래에 결론이 도착합니다. 기본 장면은 좌우 2개 터미널이며 **ONE_ONLY에만 결과가 도착**, TWO_ONLY는 분석 중입니다. 메타데이터보다 17px 굵은 결론을 먼저 읽고, 이유 두 개와 권장 행동 한 개를 이어서 볼 수 있습니다. 본문은 15px/1.8이며 최대 폭은 680px입니다. 기준 화면의 좁은 pane에서는 그 폭에 맞춰 자연스럽게 줄어듭니다.

**출력을 위로 미는 방식**을 선택했습니다. 카드는 pane 안의 flex 항목으로 폭 100%, 높이 최대 40%를 차지합니다. 반투명 겹침은 원문과 결론의 글자가 겹치고, 마지막 명령이나 커서를 가릴 수 있습니다. 이 안은 터미널 영역 자체를 줄여 원문과 결과를 각각 불투명한 배경에서 읽게 합니다. 긴 결과는 카드 내부에서 스크롤하며 최대 높이를 넘지 않습니다. 도착 애니메이션은 260ms이고 reduced-motion에서는 생략합니다. 애니메이션이 없어도 상단 경계선, 카드 배경, 미읽음 라벨로 변화가 남습니다.

**이해·검토 패널은 기본 접힘**을 선택했습니다. 2개 터미널에서 입력 폭을 확보하고, 첫 판단은 해당 pane이 맡습니다. 오른쪽 44px 레일은 패널이 있다는 위치 단서입니다. ‘자세히’를 누르면 기존 이해·검토 역할의 오른쪽 패널을 열고 **같은 터미널의 전체 분석**으로 이동합니다. 목업의 열린 패널은 500px 너비의 임시 drawer로 원래 280px의 읽기 폭 문제를 줄입니다. 따라서 패널 역할은 유지하되 열릴 때의 폭과 표시 방식은 조정한 안입니다. 여닫을 때 pane 크기는 추가로 바뀌지 않으며, 닫으면 호출한 버튼으로 포커스가 돌아갑니다.

## ② 상태와 돌아오는 방법

| 상태 | 해당 pane의 동작 | 다른 pane / 포커스 |
| --- | --- | --- |
| 아직 작업 없음 | 결과 카드·결과 칩 없음. 터미널 사용 가능 | 제품 연결 시 빈 상태 사용; 이 목업의 상태 토글에는 없음 |
| 분석 중 | 헤더에 작은 스피너와 ‘분석 중’. 카드 없이 전체 입력 높이 확보 | 두 pane 모두 이 상태로 전환 가능 |
| 결과 도착 · 미읽음 | 선택된 pane 하단에 카드 등장. 포커스는 빼앗지 않음 | 선택되지 않은 pane은 헤더 결과 칩과 오른쪽 아래 토스트로 알림 |
| 입력 중 도착 | 해당 입력란에 포커스가 있으면 카드 자동 펼침을 억제하고 미읽음 칩으로 보존 | 입력을 끊지 않음 |
| 읽음 | 카드 안 버튼에 포커스하거나 칩을 다시 열거나 자세히를 열면 읽음 처리 | 레일 미읽음 개수와 사이드바 점 감소 |
| Esc / 카드 닫기 | 카드 접기, 읽음 처리, 해당 터미널 입력란에 포커스 | pane 헤더의 작은 ‘결과’ 칩으로 다시 열기 |
| 터미널 입력 시작 | `beforeinput`/`input`에서 카드 접기. 입력 문자는 보존 | 자동 읽음 처리하지 않아 건너뛴 결과를 찾을 수 있음 |
| 오류 | 제품 연결 시 헤더 오류 칩과 재시도 경로 제공, 이전 정상 결과 보존 | 이 목업에는 실제 분석 요청과 오류 주입 기능 없음 |

- 상단 ‘분석 중’ / ‘결과 도착’은 장면을 초기화합니다. ‘결과 도착’은 항상 ONE_ONLY 한 개만 도착한 기본 장면입니다.
- ‘다른 터미널에 결과 도착’은 현재 선택하지 않은 터미널의 완료 이벤트를 시뮬레이션합니다. 카드가 그쪽에서 자동으로 펼쳐지지 않습니다. 토스트 클릭 시 그 터미널을 선택하고 결과 카드를 엽니다.
- 두 입력란으로 선택을 번갈아 옮겨 해당 버튼을 누르면 토스트가 누적됩니다. 같은 터미널의 알림은 중복 생성하지 않습니다. 토스트는 무음·비모달이며 자동 소멸하지 않습니다. 닫아도 결과 칩은 보존됩니다. 실제 제품에서는 최대 3개와 초과 개수 요약을 적용해야 합니다.
- 권장 행동은 ‘본문 확인 요청 준비’ 한 개입니다. 클릭하면 편집 가능한 **요청 초안**을 보여줍니다. 분석 추천을 실행 권한으로 취급하지 않습니다. 이 목업은 전송·명령 실행을 하지 않습니다.
- ‘자세히’는 결론 → 주의 → 이유 → 행동 → 접힌 원문 근거 순으로 전체 분석을 보여줍니다. 열린 검토 패널에서 Esc를 누르면 패널부터 닫습니다. 입력란에서는 Enter가 실제 PTY에 전달되지 않습니다.
- 네이티브 button, label, dialog, details를 사용했습니다. 결과는 polite live region으로 알리고, 버튼에 포커스 표시와 이름을 제공합니다. 테마 기본값은 `prefers-color-scheme`이며 상단에서 시스템·다크·라이트로 바꿀 수 있습니다.

## ③ affectUI 참고 및 무료 범위

2026-11-05 공개 문서와 저장소의 출처 기록을 확인했습니다. 시각적 참고와 실제 코드 사용을 구분합니다.

- **[notification-stack](https://www.affectui.com/components/notification-stack)**: 공식 문서가 Free / MIT로 명시합니다. 모서리의 조용한 알림, 누적 표시, 닫아도 다음 알림이 남는 패턴을 참고했습니다. 이 목업의 토스트 CSS와 이벤트 코드는 직접 작성했고 upstream 소스는 가져오지 않았습니다.
- **[button-clean](https://www.affectui.com/r/button-clean.json)**: `renderer/vendor/affectui/provenance.json`의 MIT 기록과 실제 `button-clean.tsx`를 읽었습니다. 작은 6px 라운드, 32px 버튼 높이, 주 행동과 얇은 경계의 보조 행동, 명확한 포커스 스타일을 CSS로 재구성했습니다. 원본 React 컴포넌트나 런타임을 포함하지 않습니다.
- **[toaster](https://www.affectui.com/components/toaster)** / **[approval-card](https://www.affectui.com/components/approval-card)**: 요청에 따라 공개 사용 문서를 확인했으나 현재 문서가 **Pro**로 표시합니다. 컴포넌트와 유료 소스는 사용하지 않았습니다. 토스트는 무료 notification-stack 패턴과 자체 CSS로, 결과 카드는 Whitebox의 결론·이유·행동 구조와 자체 CSS로 구성했습니다. 승인을 요구하는 카드로 의미를 바꾸지 않았습니다.
- 화이트박스 토큰은 `renderer/styles-terminal-workspace.css`의 `--wb-bg`, `--wb-panel`, `--wb-side`, `--wb-soft`, `--wb-line`, `--wb-text`, `--wb-muted`, `--wb-accent`, `--wb-sidebar-width` 이름과 다크·라이트 값을 로컬에 복사했습니다. 여기에만 간격·라운드 토큰을 추가했습니다. 외부 CSS를 읽지 않습니다.

참고한 무료 button-clean의 저작권 고지:

```text
MIT License

Copyright (c) 2026 Florian Höller (adfects)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ④ 실제 구현 시 파일과 위험

아래는 향후 구현 대상이며 이번 작업에서 수정하지 않았습니다.

- `renderer/terminal-workspace.js`: pane 생성부에 카드/칩, 선택된 터미널 기준 도착 분기, 기존 이해·검토의 결과 탐색을 연결합니다. 작업·세션·생성 identity별로 읽음/접힘을 보관해야 오래된 비동기 결과가 새 터미널에 붙지 않습니다.
- `renderer/styles-terminal-workspace.css`: 카드 높이, 레일, theme 토큰 기반 상태 스타일을 연결합니다. 좁은 폭·낮은 pane의 카드 내부 스크롤과 행동 버튼 노출을 별도로 확인해야 합니다.
- `renderer/terminal-engine.js`, `renderer/terminal-ime.js`: 카드 펼침/접힘 뒤 실제 terminal fit 및 PTY resize를 적용합니다. 입력 원문과 한글 조합을 가로채지 않아야 하고 scrollback, 커서 위치, selection을 보존해야 합니다. **이 HTML은 실제 PTY 리플로를 재현하지 않습니다.**
- `renderer/terminal-review-decision.js`, `renderer/terminal-workspace-i18n.js`: 기존 결론/근거/행동 데이터와 문구를 재사용합니다. 원문 귀속과 근거 불확실성을 카드에서도 유지해야 합니다.
- `scripts/terminal-workspace-check.js`, `scripts/terminal-ime-check.js`, `scripts/terminal-input-performance-check.js`: 실제 제품을 연결할 때 분할, IME 조합 중 도착, 읽던 scrollback, 빠른 입력, 새 세션 전환, pane 제거 뒤 늦은 결과를 검증할 후보입니다. 이번 목업 검사로 이 제품 동작을 통과했다고 주장하지 않습니다.

## ⑤ 이 안의 약점

1. 카드가 나타나면 터미널 높이가 바뀝니다. 실제 PTY에서 줄바꿈과 scrollback 위치가 흔들릴 수 있어 원래 커서와 읽던 위치를 보존하는 구현이 필요합니다.
2. 좁거나 낮은 pane에서는 결론이 여러 줄이 되고 40% 제한 안에 내부 스크롤이 생깁니다. 이유나 권장 행동이 처음부터 전부 보이지 않을 수 있습니다.
3. 입력 중 카드가 접히고 다른 pane은 조용한 토스트로만 알려지므로 결과를 지나칠 수 있습니다. 지속적인 미읽음 칩도 발견을 보장하지 않으며, 실제 사용자 검증이 필요합니다.

## 캡처와 확인

저장소 `scripts/terminal-workspace-check.js` 등에 이미 있는 Electron `BrowserWindow` / `webContents.capturePage()` 방식을 사용했습니다. 기존 설치된 Electron만 사용하며 새 패키지를 설치하지 않습니다. 제품을 부팅하거나 PTY를 만들지 않습니다.

재현 명령:

```sh
node_modules/.bin/electron docs/design-drafts/analysis-visibility/c-inline-result-card/capture.cjs
```

`capture.cjs`는 이 폴더의 정적 HTML만 열어 기본 장면의 `dark.png` / `light.png`를 저장하고 목업 상호작용을 검사하는 보조 도구입니다. 제품 기능 E2E가 아닙니다. 입력 포커스 이벤트를 검증하기 위해 Electron 창을 잠시 표시합니다.

2026-11-05 최종 실행: **PASS**.

- 1440×900: 카드 폭 560px / pane 내부 폭 560px. 카드 높이 190px / pane 내부 높이 658px = 약 29%. 결론은 한 줄(실제 요소 높이 26px, 계산 행간 25.5px의 정수 반올림). 카드 내부 넘침과 페이지 가로 넘침 없음.
- 1100×900: 카드 높이 186px / pane 내부 높이 664px. 최대 40% 제한 준수, 카드 내부 넘침 및 페이지 가로 넘침 없음.
- 기본 장면 한 개 결과만 표시, 분석 중 전환, 실제 키 이벤트 Esc 접기, 첫 입력 문자 `a` 보존과 카드 접기, 칩 다시 열기, 상세 내용 연결과 닫은 뒤 호출 버튼 포커스 복귀, 실행 없는 편집 가능 초안 확인.
- 입력란으로 pane 선택 변경, 다른 pane 완료 토스트, 토스트 클릭으로 해당 pane 선택 및 결과 열기, 두 알림 누적, 알림 닫기 뒤 결과 칩 보존 확인.
- 시스템 테마를 OS 다크·라이트로 각각 바꿔 계산된 color-scheme 확인. 명시적 다크·라이트 캡처 생성. 콘솔 오류 없음.
- `dark.png`, `light.png`를 직접 열어 결론, 이유, 행동 버튼, 두 pane과 하단 경계가 모두 보이는지 확인했습니다.

첫 캡처 검사에서 25.5px 행간과 정수 `clientHeight`의 0.5px 반올림을 동일값으로 비교해 실패하여 허용 오차를 반영했습니다. 숨긴 Electron 창의 `focus()`는 실제 focus 이벤트를 재현하지 않아 이후 검사는 창을 표시한 상태로 실행했습니다. 이 두 초기 실패를 제품 동작 실패나 성공 근거로 계산하지 않았습니다.
