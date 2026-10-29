# Whitebox

A terminal workspace for AI work, with request-scoped understanding and review beside the terminal.

[한국어](README.ko.md) · [简体中文](README.zh-CN.md) · [Download for Windows / macOS](https://github.com/minjund/Whitebox/releases/latest)

## Using the workspace

1. Add a project folder in the left sidebar.
2. Add a panel to create and display one terminal. Panels have colors, without visible names.
3. Add a terminal inside a panel to split its existing view. Use the layout controls or drag a terminal when you want a different arrangement; terminals from different panels can share a split view.
4. Run your CLI in the terminal. A spinning ring indicates work in progress; a green dot indicates a confirmed AI answer. Input/approval waiting remains a separate state.
5. Use the right-hand review area for the current request or its history. Reviews stay attached to the terminal and the request that produced them.

Deleting an instance moves it to the trash while preserving its running session. Permanent deletion requires a separate action. Resizing, switching panels, and renderer reloads preserve PTY identity and output.

## Settings and input requests

Settings contains General, Appearance, Notifications, Connections, and Analysis. Choose dark, light, or system appearance, language, and terminal typography there.

Saving a Jev API key selects Jev for judgment analysis. The saved key has a visible saved-state badge and can be revealed on request; hiding it shows `***`. Keys are stored through the protected main-process key store. Jev analysis sends the request and relevant work evidence to TypeSafe; it is not a local-only analysis mode. Claude and Codex analysis options remain available.

When the AI needs approval or an answer, the bottom-right popup can receive the response. Multiple questions are paged, with answers retained while navigating. The response is delivered only to the validated original terminal/request.

## Install and develop

Download a desktop installer from [GitHub Releases](https://github.com/minjund/Whitebox/releases/latest), or install the npm launcher:

```sh
npm install -g whitebox-ai
whitebox
```

For local development, use Node.js 18 or newer and your platform's native build tools for `node-pty`:

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

Provider CLIs require their own installation and authentication. Settings → General contains the app update controls.

## Code layout and compatibility

`renderer/index.html` loads the terminal workspace directly. The former monitoring dashboard, agent graph, task drawer, quiz screens, and their styles/dev fixtures have been retired. `src/` still contains the process/session readers, provider adapters, review services, PTY host, and notification delivery used by the workspace. Legacy contract decoding remains for retained terminal output. Existing profile migration and installed-client updater compatibility remain required.

The current test entry points and cleanup scope are documented in [WORKSPACE-CLEANUP.md](docs/WORKSPACE-CLEANUP.md). The historical `test:result-review`, `test:drawer-conversation`, and `test:drawer-actual-pty` CI names now run current review, terminal-engine, and workspace-to-popup PTY tests respectively.

## Release

Pushing a `v*` Git tag validates the version, builds and verifies desktop artifacts, stages a draft release, publishes the npm package with provenance when enabled, and only then publishes the GitHub Release. The `package.json` version and tag must match. The current internal channel permits unsigned desktop artifacts; signing/notarization secrets and fail-closed checks must be restored before public production distribution.

Maintainer credentials and gates are documented in [Releasing](docs/RELEASING.md).

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json
VERSION=$(node -p 'require("./package.json").version')
git commit -m "release: v$VERSION"
git tag "v$VERSION"
git push origin HEAD --follow-tags
```

## License

Whitebox is available under the [MIT License](LICENSE).

The application uses the connected WB box icon. The retained Lucide window design and its ISC notices are documented in [icon provenance](docs/ICON-LICENSE.md).

---

<div align="center">
  Built for people who run more than one AI agent—and still want to know exactly what each one is doing.
</div>
