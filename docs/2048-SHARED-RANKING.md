# 2048 공유 랭킹 — 보류

사용자 결정(2026-11-06): GitHub 로그인과 공용 랭킹은 보류한다. 앱에는 로컬 게임과 애니메이션만 제공한다.

향후 구상은 Supabase Auth의 GitHub 로그인, 개인 최고 점수 공용 순위, Edge Function의 이동 기록 재생 검증이다.

## 보관된 무료 프로젝트

- 조직: minjund’s Org
- 프로젝트: whitebox-2048 (`xjxicbqoqgujuaqeisoi`), 서울
- [관리 화면](https://supabase.com/dashboard/project/xjxicbqoqgujuaqeisoi)
- 무료 플랜에 생성된 프로젝트는 유지 중이다. GitHub 제공자와 앱 리디렉션은 활성화하지 않았다.
- DB에는 `game_2048_profiles`, `game_2048_rounds`, `game_2048_scores`가 준비되어 있고 `game-ranking` Edge Function이 배포되어 있다. 실제 로그인·점수는 수집하지 않았다.
- 로컬 준비 소스는 무시되는 `artifacts/supabase-ranking/deferred-source/`에 보관되어 있으며 앱 패키지에는 포함하지 않는다.

재개 시 GitHub OAuth 앱 등록과 Supabase GitHub 제공자 활성화가 필요하다. 제공자 콜백은 `https://xjxicbqoqgujuaqeisoi.supabase.co/auth/v1/callback`, 데스크톱 허용 리디렉션은 `http://127.0.0.1:*/auth/callback/*`이다. 비밀키는 Supabase 설정에 직접 입력하고 저장소·채팅에 남기지 않는다.
