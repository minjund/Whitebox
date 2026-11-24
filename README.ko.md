<p align="center">
  <img src="build/icon.png" alt="Whitebox" width="96" height="96">
</p>

<h1 align="center">Whitebox</h1>

<p align="center">
  <b>여러 AI 에이전트를 터미널에서 함께 돌리고,<br>어느 것이 일하는지, 기다리는지, 확인할 답이 있는지 한눈에 보는 작업 공간</b>
</p>

<p align="center">
  <a href="https://github.com/minjund/Whitebox/releases/latest"><img alt="최신 릴리스" src="https://img.shields.io/github/v/release/minjund/Whitebox?style=flat-square&label=release"></a>
  <a href="https://github.com/minjund/Whitebox/releases"><img alt="다운로드" src="https://img.shields.io/github/downloads/minjund/Whitebox/total?style=flat-square"></a>
  <img alt="플랫폼" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-555?style=flat-square">
  <a href="https://www.npmjs.com/package/whitebox-ai"><img alt="npm" src="https://img.shields.io/npm/v/whitebox-ai?style=flat-square"></a>
  <a href="LICENSE"><img alt="MIT 라이선스" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <b>한국어</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#설치"><b>설치</b></a> ·
  <a href="#빠른-시작">빠른 시작</a> ·
  <a href="#주요-기능">주요 기능</a> ·
  <a href="#whitebox-cli">CLI</a> ·
  <a href="#개발">개발</a>
</p>

<p align="center">
  <img src="docs/assets/readme/ko/workspace.png" alt="Whitebox 작업 공간: 왼쪽 프로젝트·패널 트리, Claude와 Codex 분할 터미널" width="100%">
</p>

## Whitebox는

Claude Code, Codex 같은 AI CLI를 여러 개 띄워 두면 어느 터미널이 무엇을 하고 있는지, 어느 것이 끝났거나 내 답을 기다리는지 놓치기 쉽습니다. Whitebox는 그 터미널들을 프로젝트별 패널로 묶어 두고, **어느 터미널이 작업 중인지, 입력을 기다리는지, 아직 확인하지 않은 답이 있는지** 한눈에 보여 줍니다.

- **터미널은 그대로입니다.** 평소 쓰던 CLI를 Whitebox 터미널에서 그대로 실행합니다. 별도 에이전트 프레임워크나 프롬프트 형식이 필요 없습니다.
- **상태를 한눈에 봅니다.** 사이드바에서 터미널마다 작업 중, 대기, 확인할 답을 표시하고, Claude·Codex 터미널은 채팅으로도 읽을 수 있어 여러 AI가 동시에 일해도 섞이지 않습니다.
- **로컬 데스크톱 앱입니다.** 터미널 출력, 요청, 기록은 내 컴퓨터에 저장됩니다. 자세한 내용은 [데이터와 개인정보](#데이터와-개인정보)에 정리했습니다.

## 설치

### Windows 10/11 (x64)

[Releases](https://github.com/minjund/Whitebox/releases/latest)에서 `Whitebox-Setup-*.exe`를 내려받아 실행합니다. NSIS 설치 프로그램에서 설치 대상을 현재 사용자로 고르면 사용자 영역에 설치되므로 관리자 권한이 필요하지 않습니다. 설치 폴더도 바꿀 수 있고, 이후 업데이트는 앱 안(설정 → 일반)에서 받을 수 있습니다. 설치 없이 실행하려면 `Whitebox-*-portable.exe`를 받으세요.

현재 Windows 설치 프로그램은 앱 업데이트 때 GitHub 릴리스에 기록된 크기와 SHA-256으로 내려받은 파일의 무결성을 검증하지만, Authenticode 코드 서명은 적용되지 않았습니다. 브라우저에서 내려받으면 Microsoft Defender SmartScreen이 알 수 없는 게시자 경고를 표시할 수 있습니다. 공식 [minjund/Whitebox Releases](https://github.com/minjund/Whitebox/releases) URL에서 받은 파일인지 확인한 뒤 **추가 정보 → 실행**을 누르세요.

### macOS

#### 설치 스크립트

```sh
curl -fsSL https://raw.githubusercontent.com/minjund/Whitebox/main/scripts/install-macos.sh | bash
```

최신 릴리스에서 이 Mac에 맞는 DMG(Apple Silicon은 `arm64`, Intel은 `x64`)를 내려받아 릴리스에 기록된 크기·SHA-256과 대조한 뒤 `/Applications/Whitebox.app`에 복사하고 quarantine 속성을 제거합니다. 위치를 바꾸려면 `WHITEBOX_INSTALL_DIR`를 지정:

```sh
curl -fsSL https://raw.githubusercontent.com/minjund/Whitebox/main/scripts/install-macos.sh \
  | WHITEBOX_INSTALL_DIR="$HOME/Applications" bash
```

#### 수동 DMG

[Releases](https://github.com/minjund/Whitebox/releases/latest)에서 `Whitebox-*-arm64.dmg`(Apple Silicon) 또는 `Whitebox-*-x64.dmg`(Intel)를 받아 Applications로 복사한 뒤 quarantine 속성 제거:

```sh
xattr -dr com.apple.quarantine /Applications/Whitebox.app
```

Whitebox는 Apple Developer ID로 서명·공증되지 않은 ad-hoc 빌드입니다. 위 명령은 Gatekeeper의 quarantine 플래그만 떼는 단계로 앱 무결성에는 영향이 없습니다.

### npm 실행기

Node.js 18 이상이 있다면 npm으로 설치하고 `whitebox` 명령으로 앱을 열 수 있습니다.

```sh
npm install -g whitebox-ai
whitebox
```

### 준비물

Whitebox는 AI CLI를 대신 설치하지 않습니다. 쓰려는 CLI([Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex) 등)를 먼저 설치하고 로그인해 두세요.

## 빠른 시작

1. 왼쪽 사이드바의 **프로젝트 추가**로 작업할 폴더를 엽니다.
2. **패널 추가**를 누르면 그 폴더에서 터미널 하나가 열립니다.
3. 터미널에서 `claude`나 `codex`를 실행하고 평소처럼 요청합니다.
4. 같은 패널에 **터미널**을 더하거나 <kbd>⌘/Ctrl</kbd>+<kbd>D</kbd>로 화면을 나눠 다른 AI를 함께 돌립니다.
5. 답이 끝나면 사이드바의 그 터미널에 노란 점이 붙습니다. 사이드바 위쪽 **확인할 답**을 누르면 아직 읽지 않은 답이 있는 터미널을 차례로 엽니다.

| 단축키 | 동작 |
| --- | --- |
| <kbd>⌘/Ctrl</kbd>+<kbd>T</kbd> | 터미널 추가 |
| <kbd>⌘/Ctrl</kbd>+<kbd>D</kbd> | 화면 분할 |
| <kbd>⌘/Ctrl</kbd>+<kbd>K</kbd> | 프로젝트 찾기 |

## 주요 기능

### 프로젝트 · 패널 · 분할 터미널

- 프로젝트마다 패널을 두고, 패널 안에서 터미널을 격자로 나눠 봅니다. 드래그로 다른 패널의 터미널과 함께 볼 수도 있습니다.
- 사이드바에서 터미널마다 작업 중, 입력·승인 대기, 아직 확인하지 않은 답변을 구분해 보여 줍니다. 오래 도는 백그라운드 명령과 감시(모니터) 작업은 따로 배지로 표시합니다. 사이드바 위쪽 **확인할 답**은 새 AI 답이 있는 터미널 수를 세고, 누르면 하나씩 엽니다.
- 터미널 이름은 마지막 요청을 따라 바뀌어, 여러 개를 열어도 어느 것이 무슨 일을 하는지 알 수 있습니다. 요청은 이 컴퓨터에 기록할 뿐 AI를 따로 부르지 않습니다.
- 창 크기 변경, 패널 전환, 앱 재시작 뒤에도 터미널 세션과 출력이 유지됩니다. 한글 입력(IME)도 지원합니다.
- 휴지통으로 옮기면 세션을 멈추고 실행 한도를 비웁니다. 출력과 기록은 남아 있어 읽기 전용으로 복원할 수 있고, 영구 삭제하면 기록도 지웁니다.

### 채팅 보기

<p align="center">
  <img src="docs/assets/readme/ko/chat.png" alt="채팅 보기: 분할 화면 안에서 Claude 터미널을 말풍선 대화로 보고, 아래 입력창으로 다음 요청을 보냄" width="100%">
</p>

Claude나 Codex가 도는 터미널을 그 칸 안에서 채팅처럼 읽고, 아래 입력창으로 같은 AI 세션에 다음 요청을 보냅니다. 상단의 **터미널 / 채팅**은 화면에 있는 Claude·Codex 터미널을 한 번에 바꾸고, 터미널 머리의 채팅 버튼은 그 칸만 바꿉니다. 터미널마다 보기 방식을 기억합니다.

- 말풍선은 이 컴퓨터에 있는 그 터미널의 대화 기록에서 바로 가져옵니다. AI를 따로 부르지 않습니다. 도구 사용은 한 줄로 접히고, 생각 과정은 보이지 않습니다.
- 터미널은 그 아래에서 크기 그대로 계속 돌고, 칸은 다른 터미널과 함께 분할 화면에 남습니다.
- AI가 작업 중이거나, 터미널 입력창에 쓰던 글이 있거나, 질문을 띄운 동안 보낸 글은 채팅에서 기다렸다가 AI가 준비되면 갑니다. 앱을 다시 켜도 자동으로 다시 보내지 않습니다.
- AI가 터미널에서 질문하면 채팅에 알려 주고, **터미널로 보기**로 터미널을 열어 답합니다.

### 질문 · 승인 팝업

<p align="center">
  <img src="docs/assets/readme/ko/popup-permission.png" alt="권한 요청 팝업" width="320">
  &nbsp;&nbsp;
  <img src="docs/assets/readme/ko/popup-question.png" alt="질문 팝업" width="320">
</p>

AI가 명령 실행 권한이나 답변을 요청하면 다른 창을 쓰고 있어도 화면 오른쪽 아래에 작은 창이 뜹니다. 그 자리에서 허용·거부하거나 답을 고르고, 질문이 여러 개면 페이지를 넘기며 답합니다. 응답은 원래 터미널과 요청인지 확인한 뒤에만 전달합니다.

### 터미널끼리 협업

Whitebox 터미널 안의 AI는 `whitebox` CLI나 패널 MCP 도구로 같은 패널에 새 AI 터미널을 열고, 다른 터미널에 요청을 보내고, 그 응답을 기다릴 수 있습니다. Whitebox 터미널에서는 tmux나 외부 터미널 앱을 여는 명령을 막고 Whitebox 도구를 쓰도록 안내합니다.

### 설정

<p align="center">
  <img src="docs/assets/readme/ko/settings.png" alt="설정 화면: 일반, 터미널, 연결, 단축키" width="100%">
</p>

설정은 **일반**(테마, 언어, 입력 요청 알림, 앱 업데이트), **터미널**(글꼴, 글자 크기), **연결**(Codex · Claude CLI 연결), **단축키**로 나뉩니다. 화면 언어는 한국어, English, 简体中文을 지원합니다. 앱은 시작할 때와 15분마다 새 버전을 확인합니다.

## whitebox CLI

npm 실행기나 앱에 포함된 `whitebox` 명령으로 앱과 터미널을 다룰 수 있습니다.

```sh
whitebox                                        # 데스크톱 앱 열기
whitebox run claude                             # 앱 브리지에서 AI 실행 (claude | codex | gemini | grok)
whitebox new-terminal codex --count 3           # 같은 패널에 AI 터미널 3개 열기
whitebox list-panels                            # 같은 패널의 터미널 목록
whitebox ask codex "테스트 실패 원인 찾아줘"       # 다른 터미널에 요청 보내기
whitebox wait <job-id>                          # 그 요청의 실제 응답 기다리기
whitebox read-screen --surface <terminal-id>    # 터미널 출력 읽기
```

전체 명령은 `whitebox --help`로 확인합니다. `run`과 패널 명령은 Whitebox 앱이 열려 있어야 합니다.

## 데이터와 개인정보

- 터미널 출력, 요청, 기록은 내 컴퓨터에만 저장합니다. 끝난 기록은 기본 30일 뒤 지우며, 보관 기간은 [데이터 보관](docs/DATA-RETENTION.md)에서 바꾸는 방법을 확인할 수 있습니다.
- Whitebox는 요청이나 터미널 출력을 분석하려고 AI 모델에 보내지 않습니다. 터미널에서 실행한 AI CLI는 평소처럼 각자의 서비스와 통신합니다.
- 보안 취약점 신고는 [SECURITY.md](SECURITY.md)를 따라 주세요.

## 개발

Node.js 22 이상과 `node-pty` 빌드에 필요한 플랫폼 도구(macOS는 Xcode Command Line Tools, Windows는 Visual Studio Build Tools)가 필요합니다.

```sh
git clone https://github.com/minjund/Whitebox.git
cd Whitebox
npm ci
npm start
```

주요 검사:

```sh
npm run check:source      # 소스 규칙 검사
npm test                  # 회귀 테스트
npm run test:workspace    # 작업 공간 UI·터미널 통합 테스트
npm run test:terminal     # 터미널 엔진·PTY 테스트
```

구조는 [ARCHITECTURE.md](docs/ARCHITECTURE.md), 터미널 작업 공간 동작은 [terminal-workspace.md](docs/terminal-workspace.md), 릴리스 절차는 [RELEASING.md](docs/RELEASING.md)에 정리되어 있습니다. 기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## 라이선스

Whitebox는 [MIT 라이선스](LICENSE)로 제공됩니다. 앱 아이콘 출처와 고지는 [ICON-LICENSE.md](docs/ICON-LICENSE.md)에 있습니다.

---

<p align="center">
  여러 AI를 동시에 쓰면서도 각각 무엇을 하는지 정확히 알고 싶은 사람을 위해 만들었습니다.
</p>
