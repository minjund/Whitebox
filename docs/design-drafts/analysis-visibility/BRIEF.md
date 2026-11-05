# 분석 결과 가시성 초안 브리프

## 문제
Whitebox 작업 공간은 `사이드바 220px | 터미널 캔버스 | 이해·검토 패널 280px` 3단 그리드다
(`renderer/styles-terminal-workspace.css` 2행, `renderer/terminal-workspace.js` 95~109행,
현재 모습: `artifacts/answer-first-ui/workspace-content.png`).
사용자 피드백: **오른쪽 분석 결과(이해·검토)가 눈에 안 들어온다.**

원인으로 추정되는 것:
1. 280px 폭에 15px/1.8 본문이라 한 줄 10자 남짓, 읽기 피로.
2. 터미널·사이드바·검토 패널이 같은 톤이라 위계가 없다.
3. 결과가 "도착했다"는 상태 변화가 없다. 사용자의 시선은 터미널 커서에 있다.
4. 결론(실제 답)이 패널 중간쯤에 있고, 위에 "선택한 터미널 / 탭 / 이번 요청 / 제목 / 시간" 메타가 먼저 온다.

## 지켜야 할 것
- 터미널은 사용자가 **타이핑하는 곳**이다. 입력 중에는 터미널이 1순위여야 한다. 분석을 영구적으로
  가운데 두고 터미널을 작게 만드는 안은 기본 상태로는 안 된다. 단, **작업이 끝나 결과가 도착한 순간**에는
  분석이 주인공이 되어도 된다. 상태에 따라 주인공이 바뀌는 설계를 생각하라.
- 분석 내용 구조는 `docs/analysis-decision-design.md`를 따른다: 결론 → 이유 1~3개 → (필요시) 주의 →
  권장 행동 1개(finish/verify/choose/continue). 상세는 접힘.
- 상태: `아직 작업 없음` / `분석 중` / `결과 도착(미읽음)` / `읽음` / `오류`. 초안은 최소 `분석 중`과
  `결과 도착` 두 상태를 보여 줘야 한다.
- 다크·라이트 둘 다. 색/간격 토큰은 `renderer/styles-terminal-workspace.css`의 `--wb-*` 변수를 재사용.
- 폰트 15px/1.8 본문, 짧은 소제목 위계 유지. 본문 최대 폭은 60~70자(약 640~720px).
- 한국어 UI 문구. 더미 데이터는 위 스크린샷의 내용(ONE_ONLY, "문서 생성은 보고됐지만 본문은 확인되지 않았습니다." 등)을 쓴다.

## affectUI
https://www.affectui.com/ 의 **무료(MIT) 컴포넌트만** 쓴다. 레지스트리는 `https://www.affectui.com/r/<slug>.json`,
문서는 `https://www.affectui.com/components/<slug>`. 이미 저장소에 있는 것:
`renderer/vendor/affectui/{button-clean,segmented-control-clean,thinking-loader-clean}.tsx`.
참고할 만한 것: toaster, notification-stack, approval-card, smart-recommendation, tips-panel,
`/screens/app-shell`(접히는 사이드바 + 리사이즈 작업 영역), `/screens/app-shell-flat`.
초안은 **정적 HTML 한 파일**이면 되므로 React를 실제로 띄울 필요는 없다. 컴포넌트의 시각 언어(간격, 테두리,
그림자, 상태 색)를 CSS로 옮겨 쓰고, 어떤 컴포넌트를 참고했는지 NOTES에 적는다. 유료 컴포넌트는 쓰지 않는다.

## 산출물 (각 에이전트는 자기 폴더에만 쓴다)
`docs/design-drafts/analysis-visibility/<variant>/`
- `index.html` — 자급자족 정적 목업 1440×900 기준. 외부 CDN 없음. `prefers-color-scheme`로 다크/라이트.
  상단에 작은 토글로 상태(`분석 중` / `결과 도착`)와 테마를 바꿀 수 있게 한다.
- `NOTES.md` — ① 왜 이 배치가 분석을 더 잘 보이게 하는가 ② 상태별 동작(도착 시 무엇이 바뀌는가,
  사용자가 터미널로 돌아가는 방법) ③ 참고한 affectUI 컴포넌트 ④ 실제 구현 시 건드릴 파일과 위험
  ⑤ 이 안의 약점.
- 가능하면 `dark.png`, `light.png` 스크린샷. 저장소 `scripts/`에 Electron/Playwright 캡처 도구가 있으면
  그걸 쓰고, 없으면 스크린샷은 생략하고 NOTES에 생략했다고 적는다. 새 패키지를 설치하지 않는다.

저장소의 다른 파일은 **수정하지 않는다.** 커밋하지 않는다.
