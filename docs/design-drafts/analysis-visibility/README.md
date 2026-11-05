# 분석 결과 가시성 초안 (2026-11-05)

피드백 "오른쪽 분석 결과가 눈에 안 들어온다"에 대한 정적 HTML 초안 세 가지.
제품 코드는 바꾸지 않았다. 각 폴더의 `index.html`을 브라우저로 열면 되고,
`NOTES.md`에 근거·상태별 동작·참고한 affectUI 무료 컴포넌트·구현 시 위험이 있다.
`BRIEF.md`는 세 초안에 공통으로 준 브리프다.

| 안 | 폴더 | 요약 |
| --- | --- | --- |
| A 읽기 모드 | `a-reading-mode/` | 결과 도착 시 분석이 가운데, 터미널은 오른쪽 도크. 읽기 모드를 유지한 채 타이핑하면 도크 터미널로 입력된다. |
| B 패널 강화 | `b-right-pane-attention/` | 3단 유지, 패널 폭 확대, 결론 카드 우선, 도착 신호(바·필·사이드바 점·헤더 배지) 연결. |
| C 인라인 카드 | `c-inline-result-card/` | 작업이 끝난 터미널 pane 하단에서 결론 카드가 올라온다. 다른 터미널은 토스트. |

권장 순서: B를 기반으로 먼저 적용하고 C의 카드를 도착 신호로 얹는다. A는 자동 전환이 아니라
사용자가 켜는 읽기 모드 토글로 이후 검토한다.

`capture.cjs`는 저장소에 설치된 Electron으로 각 목업을 캡처·검증하는 보조 스크립트다.
예: `node_modules/.bin/electron docs/design-drafts/analysis-visibility/a-reading-mode/capture.cjs`
