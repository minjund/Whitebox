# Whitebox

AI 작업을 터미널에서 실행하고, 옆에서 요청별 이해·검토를 확인하는 작업 공간입니다.

[English](README.md) · [简体中文](README.zh-CN.md) · [Windows / macOS 다운로드](https://github.com/minjund/Whitebox/releases/latest)

## 사용 방법

1. 왼쪽에서 프로젝트 폴더를 추가합니다.
2. **패널 추가**를 누르면 새로운 색상의 패널과 터미널 하나가 생성됩니다. 패널 이름은 표시하지 않습니다.
3. 패널 안의 **터미널 추가**를 누르면 해당 패널의 화면을 분할합니다. 배치 도구나 드래그로 다른 패널의 터미널도 함께 분할해서 볼 수 있습니다.
4. 터미널에서 CLI를 실행합니다. 작업 중에는 회전 표시가 나타나고, AI 답변 완료가 확인되면 초록색 점으로 바뀝니다. 입력·승인 대기는 별도로 구분합니다.
5. 오른쪽에서 이번 요청이나 히스토리를 확인합니다. 이해·검토는 해당 터미널과 요청에 연결됩니다.

인스턴스를 삭제하면 실행 상태를 유지한 채 휴지통으로 이동합니다. 영구 삭제는 별도 작업입니다. 창 크기 변경, 패널 전환, 화면 새로고침 후에도 PTY와 출력 내용을 유지합니다.

## 설정과 질문 알림

설정은 일반, 화면, 알림, 연결, 분석으로 구성됩니다. 다크·라이트·시스템 테마와 언어, 터미널 글꼴을 변경할 수 있습니다.

Jev API 키를 저장하면 판단 분석에 Jev를 자동으로 선택합니다. 저장 표시가 나타나며 키 보기를 누르면 저장된 키를 확인할 수 있습니다. 숨기면 `***`로 표시합니다. 키는 메인 프로세스의 보호된 저장소에서 관리합니다. Jev 분석은 요청과 관련 작업 근거를 TypeSafe로 전송합니다. Claude와 Codex 분석도 선택할 수 있습니다.

AI가 권한이나 답변을 요청하면 오른쪽 아래 창에서 응답합니다. 질문이 여러 개면 페이지를 넘겨가며 선택하고, 입력한 답은 유지됩니다. 응답은 원래 터미널과 요청을 검증한 뒤 전달합니다.

## 설치와 개발

[GitHub Releases](https://github.com/minjund/Whitebox/releases/latest)에서 프로그램을 내려받거나 npm 실행기를 설치합니다.

```sh
npm install -g whitebox-ai
whitebox
```

로컬 개발에는 Node.js 18 이상과 `node-pty`용 플랫폼 빌드 도구가 필요합니다.

```sh
npm install
npm start
npm run check:source
npm test
npm run test:workspace
npm run test:terminal:engine
npm run test:terminal:ime
npm run test:attention-popup
npm run test:performance
```

사용할 AI CLI는 별도로 설치하고 로그인해야 합니다. 앱 업데이트는 설정 → 일반에서 확인할 수 있습니다.

## 현재 코드 범위

`renderer/index.html`은 터미널 작업 공간을 직접 실행합니다. 이전 관제 대시보드, 에이전트 그래프, 작업 드로어, 질문지 화면과 전용 스타일·개발용 시뮬레이터를 제거했습니다. 현재 작업 공간이 사용하는 프로세스·세션 분석, 제공사 연결, 이해·검토, PTY 호스트, 알림 전달 코드는 유지합니다. 보관된 터미널 출력의 이전 계약 해석과 기존 프로필·업데이트 호환성도 유지합니다.

정리 범위와 검사 방법은 [WORKSPACE-CLEANUP.md](docs/WORKSPACE-CLEANUP.md)에 기록합니다. 기존 CI 명령 이름 중 `test:result-review`, `test:drawer-conversation`, `test:drawer-actual-pty`는 각각 현재 검토, 터미널 엔진, 작업 공간과 팝업의 실제 PTY 연결 검사로 연결됩니다.

## 릴리스

`v*` 형식의 Git 태그를 원격 저장소에 푸시하면 버전 검증, 데스크톱 빌드·검사, 비공개 초안 업로드, 출처 증명이 포함된 npm 발행 순서로 처리한 뒤 GitHub Release를 공개합니다. `package.json` 버전과 태그는 반드시 같아야 합니다. 현재 내부 테스트 채널은 unsigned 데스크톱 파일을 허용하며, 외부 정식 배포로 전환하기 전에는 코드 서명·공증 비밀값과 fail-closed 검사를 복구해야 합니다.

관리자용 인증 정보와 검증 단계는 [Releasing](docs/RELEASING.md)에 정리되어 있습니다.

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json
VERSION=$(node -p 'require("./package.json").version')
git commit -m "release: v$VERSION"
git tag "v$VERSION"
git push origin HEAD --follow-tags
```

## 라이선스

Whitebox는 [MIT 라이선스](LICENSE)로 제공됩니다.

앱에는 WB 연결형 박스 아이콘을 사용합니다. 보존된 Lucide 창 모양 시안과 ISC 라이선스 고지는 [아이콘 출처 문서](docs/ICON-LICENSE.md)에 정리되어 있습니다.

---

<div align="center">
  여러 AI를 동시에 쓰면서도 각각 무엇을 하는지 정확히 알고 싶은 사람을 위해 만들었습니다.
</div>
