# Whitebox

在终端中运行 AI 工作，并在旁边查看当前请求的理解与审查。

[English](README.md) · [한국어](README.ko.md) · [下载 Windows / macOS](https://github.com/minjund/Whitebox/releases/latest)

## 使用工作区

1. 在左侧添加项目文件夹。
2. 添加面板会创建一个新颜色的面板和一个终端，面板不显示名称。
3. 在面板内添加终端会拆分当前视图。可以通过布局工具或拖动，将不同面板的终端一起显示。
4. 在终端中运行 CLI。旋转标记表示正在工作，确认 AI 答复完成后显示绿点。等待输入或授权另行显示。
5. 在右侧查看本次请求或历史记录。审查始终关联原终端和请求。

删除实例会将其移入回收站并保留运行状态，永久删除是单独操作。调整窗口、切换面板和重新加载界面会保留 PTY 与输出。

## 设置与输入请求

设置包含常规、外观、通知、连接和分析，可调整主题、语言和终端字体。

保存 Jev API 密钥后，会自动选用 Jev 进行判断分析。界面显示已保存状态，可按需查看密钥，隐藏时显示 `***`。密钥由主进程的受保护存储管理。Jev 分析会将请求及相关工作依据发送给 TypeSafe。也可以选择 Claude 或 Codex 分析。

AI 请求授权或回答时，可通过右下角弹窗响应。多个问题分页展示，翻页时保留答案。发送前会核验原终端与请求。

## 安装与开发

从 [GitHub Releases](https://github.com/minjund/Whitebox/releases/latest) 下载桌面安装包，或安装 npm 启动器：

```sh
npm install -g whitebox-ai
whitebox
```

本地开发需要 Node.js 18 或更高版本，以及 `node-pty` 所需的平台编译工具。

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

提供商 CLI 需单独安装并登录。在设置 → 常规中检查应用更新。

## 当前代码范围

`renderer/index.html` 直接加载终端工作区。旧监控仪表盘、代理图、任务抽屉、问卷界面及专用样式和开发夹具已移除。工作区使用的进程与会话读取、提供商连接、审查、PTY 主机和通知代码仍保留。历史终端输出解码、用户配置迁移和已安装客户端的更新兼容性也仍保留。

清理范围与验证方法见 [WORKSPACE-CLEANUP.md](docs/WORKSPACE-CLEANUP.md)。历史 CI 名称 `test:result-review`、`test:drawer-conversation` 和 `test:drawer-actual-pty` 现在分别运行当前审查、终端引擎和工作区弹窗 PTY 测试。

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

应用使用相连的 WB 方框图标。保留的 Lucide 窗口设计及其 ISC 声明详见[图标来源](docs/ICON-LICENSE.md)。

---

<div align="center">
  为同时运行多个 AI、又想准确了解每一个 AI 在做什么的人而设计。
</div>
