---
sketch: 012
name: sidebar-project-readability
question: "왼쪽 프로젝트 목록에서 이름, 상태, 작업을 어떤 위계로 보여줘야 가장 빨리 읽히는가?"
winner: A
recommendation: A
tags: [sidebar, projects, readability, orca, cmux]
---

# 프로젝트 사이드바 가독성 스케치

사용자 요청: main에서 새 브랜치를 만들고 Orca와 cmux처럼 깔끔한 프로젝트 목록을 스케치한다.

- Branch: `codex/sidebar-project-readability`
- Base: fetched `origin/main`, `347b69877455d9a4e9e586ec4969e1ccecf96612`
- Scope: HTML 스케치와 선택한 A안의 제품 renderer 구현.
- User selection: A · 심플 리스트 (2026-09-16 승인). 사용자는 실행 출처보다 프로젝트와 작업의 가독성이 중요하다고 확인함.

## 보는 방법

`index.html`을 브라우저에서 열거나 이 디렉터리에서 `node serve.cjs` 실행 후 출력된 localhost 주소를 연다. HTML/CSS/JS는 빌드나 설치 없이 실행된다.

- 첫 화면은 같은 가상 데이터 8개 프로젝트를 세 안에서 나란히 비교한다.
- A/B/C 탭은 선택한 사이드바를 작업 영역 예시와 함께 보여준다.
- 프로젝트 선택, 작업 펼치기, 출처 접기, 검색, 추가, 순서 이동, 목록 제거, 다크/라이트 전환 가능.
- `/`로 검색. 프로젝트 이름 버튼에서 위/아래 방향키로 이동. Enter/Space로 선택.
- 하단 도구에서 빈 목록, 다량 목록(32개, 긴 이름 포함), 불러오는 중, 오류 상태를 확인할 수 있다.
- 데이터는 메모리에만 유지한다. 초기화/새로고침하면 복원된다. 실제 폴더/세션/AI 실행과 연결되지 않는다.

## 디자인 질문과 변형

1. 이름을 빨리 찾는 데 필요한 기본 정보량은 얼마인가?
2. 프로젝트 → 실행 출처 → 작업의 계층을 항상 보여줄 필요가 있는가?
3. 이름의 안정적인 위치와 확인할 작업 우선 노출 중 무엇이 중요한가?

| 안 | 구조 | 장점 | 구현 시 주의 |
|---|---|---|---|
| A · 심플 리스트 (추천) | 프로젝트 이름 + 짧은 상태, 필요할 때 작업 펼침 | 안정적인 순서와 읽기 쉬운 이름, 적은 시각적 잡음 | 사용자 결정에 따라 프로젝트 선택은 모든 출처의 작업을 함께 표시 |
| B · 프로젝트 트리 | 프로젝트 → 실행 출처 → 작업 | 현재 데이터·동작 구조를 가장 적게 바꾸는 안 | 많은 프로젝트를 펼치면 스크롤 증가. 펼침 상태 보존 필요 |
| C · 상태 중심 | 확인 필요 → 진행 중 → 결과 도착 → 최근 | 사용자의 다음 행동을 빠르게 찾음 | 상태 변경으로 위치가 바뀜. 실제 적용 시 선택·스크롤 유지 필요 |

## 공통 결정

- 중립 회색 바탕, 선택한 행만 낮은 대비 배경과 2px 표시선.
- 이름 14px, 보조 정보 12px. 상태 색은 작은 점과 필요한 문구에만 사용.
- 3개 열 비교의 좁은 화면에서는 이름 13px/보조 11px로 줄이고, 모바일 단일 사이드바는 14px/12px.
- 기존의 테두리 카드, 상시 노출 삭제 버튼, 중복 상태 문구, 큰 이니셜 장식 축소.
- 폴더 경로는 tooltip/더보기/작업 영역에 제공. 작업명은 공간 부족 시 말줄임, tooltip에 전체 표시.
- 아이콘 버튼은 hover/focus 피드백 및 접근 가능한 이름 제공. 버튼 크기는 데스크톱 중심 26–28px 탐색안.
- 검색, 상태 분류, 추가/제거는 제안 동작. 구현 시 기존 저장소·국제화·키보드 트리 탐색과 통합 필요.

## 기존 코드 근거

- `renderer/app-dashboard.js`: 프로젝트를 source별로 묶고 live/attention/result-ready를 집계한다. 현재 트리는 3단계이고 source별 세션은 3개까지 미리 본다.
- `renderer/styles-studio-shell.css`: 프로젝트 이름 12px, source 이름 11px, 일부 보조 텍스트 10px. 들여쓰기와 여러 고정 폭 버튼이 프로젝트·작업 이름 공간을 줄인다.
- 구현은 기존 `projectOrder`, 정확한 PTY 연결, projectless 그룹, 결과 확인 상태를 유지한다. 펼침 상태는 `sidebarExpandedProjects`로 저장하고, 과거 출처 선택 필터는 `all`로 초기화한다.
- 스케치는 sample source와 task만 사용하며 실제 생산 데이터가 아니다. Git 브랜치/PR/포트 메타데이터를 새로 요구하지 않는다.

## 참고한 공식 자료

2026-09-16 조회. 레이아웃 원리를 참고하고 코드/에셋을 복사하지 않았다.

- [Orca GitHub](https://github.com/stablyai/orca), [공식 제품 UI](https://www.onorca.dev/): 프로젝트 아래 작업을 묶고 이름과 부가 정보를 구분하는 구조.
- [cmux GitHub](https://github.com/manaflow-ai/cmux): 세로 workspace 목록, 작업 컨텍스트와 알림을 계층적으로 표시하는 구조.

## 검증

- Codex 인앱 브라우저: 세 안에서 8개 프로젝트 표시, 이미지 정상 로드, 가로 overflow 없음.
- 검색 1개 결과/결과 없음/검색 지우기, 프로젝트 선택에 따른 작업 영역 전환, 작업 펼치기 확인.
- B의 실행 출처 접기, 더보기로 순서 이동, 프로젝트 추가·제거 확인.
- 빈 목록에 추가 시 1개로 시작하는 동작 확인. 오류 재시도로 정상 목록 복구 확인.
- 32개 목록의 내부 스크롤 확인: viewport 높이 407px / content 높이 1740px. 검증 중 발견한 flex 최소 높이 문제 수정.
- 375px 화면 가로 overflow 없음. 좁은 콘텐츠 미리보기 → 전체 너비 복원 확인.
- 다크/라이트 렌더링 확인. 브라우저 JavaScript 오류 없음.
- `node --check serve.cjs`, 인라인 script의 `vm.Script` 구문 검사, `git diff --check` 실행.
- PNG 재생성: 저장소 루트에서 `node_modules/.bin/electron .planning/sketches/012-sidebar-project-readability/capture.cjs`.
- 실제 앱의 회귀/Windows updater E2E는 실행하지 않았다. 이 변경은 스케치 파일에 한정된다.

## A안 구현

- 프로젝트 이름 14px, 보조 상태 12px, 중립 배경과 폴더 아이콘.
- 프로젝트 이름은 선택, 화살표는 작업 펼치기. 출처 중간 행 없이 모든 현재 root 작업을 최신순으로 표시.
- 이름·경로 검색, 전체 접기, 더보기 메뉴에서 위/아래 이동 및 목록 제거. 폴더 아이콘 드래그와 Alt+방향키 순서 변경 유지.
- 작업이 없는 저장 프로젝트와 별도 프로젝트 없음 그룹 유지. 정확한 세션 ID와 PTY/읽기 전용 라우팅 유지.
- 키보드 트리는 프로젝트→작업 2단계, 한 개의 Tab 진입점 및 펼침 상태 저장.

검증: `node scripts/regression-test.js` (529개), `npm run check:source`, `electron scripts/project-sidebar-readability-check.js`, `WHITEBOX_INTERACTION_ROUNDS=1 electron scripts/interaction-check.js`, `electron scripts/project-selection-visual.js --reorder-only`. 실제 Electron fixture 화면에서 다크/라이트, 1024px 폭, 32개 추가 프로젝트와 긴 이름, 한국어/영어/중국어를 확인함. 스크린샷은 `artifacts/sidebar-readability/`에 생성됨.

추가 검사 제한: `project-studio-interaction-check.js`는 1280px PTY 화면의 기존 작업 기록 버튼이 오른쪽 1296px까지 나가 실패한다. `project-selection-visual.js` 전체 모드는 삭제된 `#projectContextNav`를 `getComputedStyle`에 넘기는 기존 검사 코드에서 중단된다. 두 실패 모두 정확한 기반 SHA `347b69877455d9a4e9e586ec4969e1ccecf96612`의 별도 worktree에서도 재현했다. 이 패치의 사이드바 검사는 새 독립 Electron 검사와 현재 `interaction-check.js` 1회 전체 실행으로 검증했다.
