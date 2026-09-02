<div align="center">

<img src="build/icon.png" alt="Whitebox 图标" width="112" />

# Whitebox

### 一眼看清每个 AI 正在做什么，并在需要时立即介入

监控 Claude、Codex、Gemini 和 Grok 会话，追踪主代理与子代理的关系，检查 Token 用量，并把任务直接发送到已连接的终端。对话记录不会上传到外部服务。

[![Desktop CI](https://github.com/minjund/Whitebox/actions/workflows/desktop-ci.yml/badge.svg)](https://github.com/minjund/Whitebox/actions/workflows/desktop-ci.yml)
[![npm version](https://img.shields.io/npm/v/whitebox-ai?logo=npm&color=CB3837)](https://www.npmjs.com/package/whitebox-ai)
[![GitHub Release](https://img.shields.io/github/v/release/minjund/Whitebox?display_name=tag&sort=semver)](https://github.com/minjund/Whitebox/releases/latest)
![macOS](https://img.shields.io/badge/macOS-支持-111827?logo=apple)
![Windows](https://img.shields.io/badge/Windows-支持-111827?logo=windows11)
![Local first](https://img.shields.io/badge/数据-本地优先-35d69f)

[English](README.md) | **简体中文** | [한국어](README.ko.md)

[**下载 Windows / macOS 程序**](https://github.com/minjund/Whitebox/releases/latest) · [**通过 npm 安装**](https://www.npmjs.com/package/whitebox-ai)

</div>

<div align="center">
  <img src="docs/assets/whitebox-dashboard.png" alt="Whitebox：查看 AI 任务、仅显示状态的子任务、Token 用量和所属节点的全屏 PTY 专注视图" width="960" />
</div>

> AI 会话记录始终保留在你的电脑上。Whitebox 只读取你已经在使用的 AI 工具生成的本地会话文件。

## 安装与运行

你可以使用 npm，也可以直接下载可运行的桌面文件。两种方式都不需要通过 Git 下载仓库。

### 方式一：npm

Whitebox 通过 npm 包 [`whitebox-ai`](https://www.npmjs.com/package/whitebox-ai) 发布。全局安装后，运行更简短的 `whitebox` 命令即可打开桌面应用：

```bash
npm install -g whitebox-ai
whitebox
```

npm 安装方式不会创建桌面或应用程序快捷方式。每次需要打开应用时，请在终端运行 `whitebox`。如果安装后终端暂时找不到该命令，请关闭并重新打开终端。

```bash
# 更新
npm install -g whitebox-ai@latest

# 卸载
npm uninstall -g whitebox-ai
```

### 方式二：直接下载桌面文件

打开[最新 GitHub Release](https://github.com/minjund/Whitebox/releases/latest)，下载与你的电脑匹配的文件。此方式不需要 Node.js。

| 系统 | 下载文件 | 启动方式 |
|---|---|---|
| Windows 10/11 (x64) | `Whitebox-Setup-<version>.exe` | 推荐用于首次安装和应用内更新。 |
| Windows 10/11 (x64) | `Whitebox-<version>-portable.exe` | 双击下载的文件。它是无需安装的便携版程序。 |
| Apple 芯片 Mac | `Whitebox-<version>-arm64.dmg` | 打开 DMG，将 Whitebox 拖入“应用程序”，然后从“应用程序”中打开。 |
| Intel Mac | `Whitebox-<version>-x64.dmg` | 打开 DMG，将 Whitebox 拖入“应用程序”，然后从“应用程序”中打开。 |

当前桌面文件尚未进行代码签名，因此 Windows SmartScreen 或 macOS Gatekeeper 可能显示未知开发者警告。只有在文件来自本仓库官方 Releases 页面时才继续。macOS 用户可按住 Control 键点按 Whitebox，然后选择**打开**；Windows 用户可选择**更多信息 → 仍要运行**。

### 在应用内更新

Whitebox 启动时会比较当前包版本与最新的稳定 GitHub Release 标签。如果存在更高版本，应用顶部以及**设置 → 程序更新**中会显示提示。应用会下载对应的 Windows Setup EXE 或 macOS DMG，并校验 GitHub 提供的文件大小和 SHA-256（如有），随后可直接打开安装文件。npm 安装仍可使用 `npm install -g whitebox-ai@latest` 更新。

### 环境要求

- macOS 或 Windows
- 仅通过 npm 安装时需要 Node.js 18 或更高版本
- 至少安装并登录一个 CLI：Claude Code、Codex CLI、Gemini CLI 或 Grok CLI
- macOS 持久 AI 会话或 Windows WSL 托管会话需要 tmux。Windows 原生 AI 会话和普通命令行仍使用直接 PTY 后端。

## 前 10 分钟上手

1. 在**首页**点击`新建 AI 任务`，填写目标并选择工作目录。如果尚未安装受支持的 AI，请先按照应用中显示的官方安装链接完成设置。
2. 打开**进行中**，查看所有绿色状态的 AI。只有需要检查子代理分工时，再展开`查看详细流程`。
3. 当**需要你确认**出现数字时，优先处理需要回复或选择的任务。
4. 打开任务卡片或点击`确认完成`后，会进入该任务所属节点的**准确 PTY 专注视图**；输出查看和输入都在这里继续。

首页的`10 分钟入门指南`可以带你实际完成同样的四个步骤。进度只保存在本机，并且可随时重新打开。

### 在所属节点的真实 PTY 中继续

启动新 AI 任务或打开任务、确认请求时，Whitebox 会进入全屏 PTY 专注视图，而不再打开右侧详情或独立对话页。它只打开该任务所属根节点已经连接的 PTY，不会猜测其他终端，也不会静默创建替代 Shell。子任务与执行单元只在顶部显示状态；输出、审批、输入和滚动记录都保留在同一个 PTY 中。

## Whitebox 可以展示什么

| 视图 | 内容 |
|---|---|
| 代理地图 | 按 Claude、Codex、Gemini 和 Grok 分组的实时任务 |
| 关系视图 | 用户请求、当前代理以及它直接委派的所有子代理 |
| 执行单元 | AI 启动的前台 Shell、后台 Shell 与后台任务，包括命令、工作目录、执行 ID 和实时状态 |
| 运行概览与待确认收件箱 | 将阻塞性回复、可选后续事项，以及当前失败、停滞或暂停风险分开显示 |
| 管理摘要 | 检查点、观测置信度、完成摘要、产物、验证结果和执行控制 |
| Token 视图 | 输入、输出、缓存、推理、总量和已报告的上下文占用率 |
| PTY 专注视图 | 在一个全屏界面中查看所属节点的准确现有 PTY 与其下游工作状态 |

Whitebox 会区分可直接控制的终端、需要桥接的会话、必须回到原应用继续的只读会话以及已结束会话。它不会向任意外部窗口注入键盘输入。

## 使用已连接的终端

保持 Whitebox 桌面应用运行，然后通过经过认证的本地桥接启动 AI CLI：

```bash
whitebox run claude
whitebox run codex
whitebox run gemini
whitebox run grok
```

`--` 后面的参数会原样传给对应的 AI CLI：

```bash
whitebox run claude -- --model claude-sonnet-4-6
```

外部终端与 Whitebox 仪表盘会共同控制同一个 Whitebox 专用会话。在 AI 卡片中打开 PTY 时，会在全屏专注视图中复用准确的现有终端和会话 ID，不会创建新的 Shell；重新打开视图时输出和滚动记录也会保留。在其他地方启动的现有会话仍然可见，但除非原应用提供受支持的交接方式，否则会保持只读。

macOS 和 WSL 的持久 AI 终端运行在隔离的 `tmux -L whitebox` 服务器中，不会混入个人 tmux。`关闭终端视图`只会分离当前 attach 画面，AI 工作仍在后台继续。`重新连接现有工作`会连接到相同的 tmux 会话和 Whitebox 会话 ID，不会创建新的 AI 对话。`结束 AI 会话`会停止实际 tmux 工作但保留记录，随后可以单独移除已停止的记录。

即使仪表盘或终端主机意外退出，只要 tmux 工作仍然存在，下次启动就会恢复同一个会话。若保存的 tmux 会话已经消失，Whitebox 会将记录标记为已停止，而不会静默创建重复的 AI 对话。Windows 原生 AI 会话和普通命令行继续使用直接 PTY/终端主机方式。运行中、已分离、自然退出或启动失败的记录都会保留到用户明确移除为止。

## 本地优先与安全

- 会话文件直接从用户目录读取。
- 不读取或显示 API Key 文件；认证由各个 AI CLI 自行处理。
- 终端桥接使用每位用户独立的令牌，以及本地 named pipe 或 Unix domain socket。
- 执行终端或 tmux 操作前，会验证请求来源、目标和输入格式。
- 开启工作目录写入权限后，所选 AI 可以修改该目录，因此请只在可信仓库中启用。

共享屏幕前请检查当前显示的会话内容，因为 AI 对话和工具输入可能包含敏感的项目信息。

## 本地开发

```bash
npm install
npm start
npm test
```

其他检查与发行构建：

```bash
npm run test:terminal
npm run test:terminal:managed
npm run test:bridge
npm run test:tmux -- macOS
npm run test:visual
npm run dist:mac
npm run dist:win
```

`dist:mac` 会生成 Apple Silicon 和 Intel 的 DMG/ZIP 文件；`dist:win` 会生成 Windows Setup 和便携版可执行文件。正式的 macOS 发行仍需要维护者提供 Apple 签名与 notarization 凭据。

## 支持的会话来源

| AI | 现有会话 | 新任务流 | 子代理 |
|---|---|---|---|
| Claude | Claude Code 本地 JSONL 记录 | 结构化 headless 输出 | transcript 中的 subagent 记录 |
| Codex | Codex 本地 rollout JSONL | `codex exec --json` | `thread_spawn` 父级元数据 |
| Gemini | Gemini 本地 chat JSON/JSONL | 结构化流式输出 | 工具提供时使用父级 ID |
| Grok | Grok 本地 session JSON/JSONL | 结构化流式输出 | 工具提供时使用父级 ID |

各提供商的事件映射与上下文计算规则记录在 [Provider Contracts](docs/PROVIDER-CONTRACTS.md) 中。

## 安全与本地数据

渲染进程在沙箱中运行。应用内更新会验证可信的 GitHub Release URL 和 SHA-256 digest，正式发行渠道还要求有效的平台签名。当前内部测试渠道允许未签名的 macOS DMG，并且只会从待安装的应用中移除 quarantine 属性。已完成的托管任务与终端历史默认在 30 天后过期。详情请参阅[安全政策](SECURITY.md)、[威胁模型](docs/THREAT-MODEL.md)和[数据保留政策](docs/DATA-RETENTION.md)。

## 发布

将 `v*` Git 标签推送到远程仓库后，工作流会先验证版本、构建并检查桌面文件、上传私有草稿，再按配置发布带来源证明的 npm 包，最后公开 GitHub Release。`package.json` 版本必须与标签一致。当前内部测试渠道允许未签名的桌面文件；切换到外部正式发行前，必须恢复代码签名、notarization 密钥和 fail-closed 检查。

维护者所需凭据和发布门禁记录在 [Releasing](docs/RELEASING.md) 中。

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json
VERSION=$(node -p 'require("./package.json").version')
git commit -m "release: v$VERSION"
git tag "v$VERSION"
git push origin HEAD --follow-tags
```

## 许可证

Whitebox 采用 [MIT 许可证](LICENSE)发布。

---

<div align="center">
  为同时运行多个 AI、又想准确了解每一个 AI 在做什么的人而设计。
</div>
