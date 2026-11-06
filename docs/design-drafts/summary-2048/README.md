# 요약 모드 · affectUI 디자인 초안

실제 앱의 2048/전송/분석 수정과 별도로 검토할 수 있는 UI 초안이다.
실제 AI 연결이나 외부 전송은 하지 않으며, 본문은 예시 데이터다.

승인된 레이아웃은 실제 `renderer/terminal-summary-chat.js`와
`renderer/styles-summary-chat.css`에 적용되었다. 실제 화면은 전송·답변·분석 상태를
세션 관찰값에서 표시하며, 좁은 화면에는 펼칠 수 있는 사이드바를 제공한다.

- 모드 전환과 상태 선택: affectUI **Segmented Control (Clean)**.
- 전송·원문·복사: affectUI **Button (Clean)**.
- 요약 생성: affectUI **Thinking Loader (Clean)**.
- 요약 본문·진행 단계·컴포저 배치: Whitebox 전용 레이아웃.
- 2048: 앱에서 사용하는 독립 구현을 그대로 불러와 플레이 가능.

컴포넌트는 기존 로컬 번들 `renderer/workspace-affectui.js`를 사용한다.
원본 URL, 해시, MIT 고지는 [기존 출처 기록](../../../renderer/vendor/affectui/README.md)에 있다.
유료 컴포넌트나 CDN 리소스는 사용하지 않았다.

## 확인할 수 있는 동작

상단에서 완료/요약 중/전송 대기를 선택하고, 터미널/요약 토글을 조작할 수 있다.
요약 중에 2048을 열고 플레이할 수 있고, 완료로 전환해도 열린 게임과 점수는 유지된다.
요청 수정·취소, 테마 전환, 좁은 화면 레이아웃도 포함한다.

```sh
node_modules/.bin/electron docs/design-drafts/summary-2048/capture.cjs
```

산출물: `ready-dark.png`, `waiting-dark.png`, `ready-light.png`, `mobile-light.png`.
