'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-theme-'));
app.setPath('userData', userData);
app.once('quit', () => {
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
});

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(win, expression, message, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await wait(60);
  }
  throw new Error(message);
}

async function capture(win, outputDir, name) {
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await win.webContents.executeJavaScript(`(() => {
    for (const animation of document.getAnimations()) {
      try { animation.finish(); } catch {}
    }
    void document.body.offsetHeight;
    return true;
  })()`);
  win.webContents.invalidate();
  await wait(180);
  const output = path.join(outputDir, name);
  fs.writeFileSync(output, (await win.webContents.capturePage()).toPNG());
  return output;
}

const BUTTON_AUDIT_EXPRESSION = `(() => {
  const trackedActionSelector = [
    '.primary-button',
    '.ghost-button',
    '.new-run-cta',
    '.app-error-actions > button',
    '.update-actions > button',
    '.management-quick-actions > button',
    '.management-control-buttons > button',
    '.attention-card-header-actions > button',
    '.modal-actions > button',
    '.agent-command-actions > button',
    '.terminal-create-actions > button',
    '.agent-inline-terminal-actions > button',
    '.pty-focus-back',
  ].join(',');
  const actionGroupSelector = [
    '.top-actions',
    '.app-error-actions',
    '.update-actions',
    '.modal-actions',
    '.management-quick-actions',
    '.management-control-buttons',
    '.attention-card-header-actions',
    '.agent-command-actions',
    '.terminal-create-actions',
    '.agent-inline-terminal-actions',
  ].join(',');
  const overlaySurfaceSelector = [
    '.management-result-review',
    '.management-progress',
    '.management-health',
    '.management-artifacts',
    '.management-checks',
    '.management-evidence',
    '.management-controls',
    '.management-attention-detail',
    '.management-outcome',
    '.agent-command-panel',
    '.execution-purpose-card',
    '.execution-process-card',
    '.execution-process-card > header',
    '.execution-process-card dl',
    '.execution-process-card dl > div',
    '.execution-code-card',
    '.execution-code-card > header',
    '.execution-code-card pre',
    '.execution-code-card > p',
    '.execution-timeline',
    '.subagent-assignment-card',
    '.subagent-assignment-card aside',
    '.agent-communication-panel',
    '.agent-communication-panel > header',
    '.agent-communication-event',
    '.quality-modal',
    '.quality-search',
    '.quality-command-list button',
    '.quality-command-list button > span',
    '.shortcut-help-list > div',
    '.run-modal',
    '.run-modal-actions',
    '.pty-focus-surface',
    '.pty-focus-header',
    '.pty-focus-flow-region',
    '.pty-focus-flow-lane',
  ].join(',');
  const pixels = value => Number.parseFloat(value) || 0;
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const number = (value, percentageScale = 1) => {
    const input = String(value || '').trim();
    const parsed = Number.parseFloat(input);
    if (!Number.isFinite(parsed)) return null;
    return input.endsWith('%') ? parsed / 100 * percentageScale : parsed;
  };
  const parse = value => {
    const input = String(value || '').trim();
    const rgbMatch = input.match(/^rgba?\\(([^)]+)\\)$/i);
    const srgbMatch = input.match(/^color\\(\\s*srgb\\s+([^)]+)\\)$/i);
    const match = rgbMatch || srgbMatch;
    if (!match) return null;
    const values = match[1].replace(/,/g, ' ').split(/[\\s\\/]+/).filter(Boolean);
    if (values.length < 3) return null;
    const srgb = Boolean(srgbMatch);
    const scale = srgb ? 1 : 255;
    const red = number(values[0], scale);
    const green = number(values[1], scale);
    const blue = number(values[2], scale);
    const alpha = values.length > 3 ? number(values[3], 1) : 1;
    if ([red, green, blue, alpha].some(channel => channel === null)) return null;
    return {
      r: clamp(srgb ? red * 255 : red, 0, 255),
      g: clamp(srgb ? green * 255 : green, 0, 255),
      b: clamp(srgb ? blue * 255 : blue, 0, 255),
      a: clamp(alpha, 0, 1),
    };
  };
  const composite = (foreground, background) => {
    const alpha = foreground.a + background.a * (1 - foreground.a);
    if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
      g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
      b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
      a: alpha,
    };
  };
  const linear = channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  };
  const luminance = color => .2126 * linear(color.r) + .7152 * linear(color.g) + .0722 * linear(color.b);
  const contrast = (a, b) => {
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
  };
  const effectiveBackground = element => {
    const layers = [];
    let current = element;
    while (current) {
      const color = parse(getComputedStyle(current).backgroundColor);
      if (color && color.a > .001) {
        layers.push(color);
        if (color.a >= .999) break;
      }
      current = current.parentElement;
    }
    let background = { r: 255, g: 255, b: 255, a: 1 };
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      background = composite(layers[index], background);
    }
    return background;
  };
  const theme = document.documentElement.dataset.theme;
  const buttons = [...document.querySelectorAll('button')].filter(button => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth
      && style.visibility !== 'hidden' && style.display !== 'none';
  });
  const results = buttons.map((button, index) => {
    const style = getComputedStyle(button);
    const foreground = parse(style.color);
    const background = effectiveBackground(button);
    const ratio = foreground ? contrast(foreground, background) : 0;
    const backgroundLuminance = luminance(background);
    const semantic = button.matches('.primary-button,.new-run-cta,.conversation-send,.accent,[data-status-action],[data-result-review-complete],.stop-run,.conversation-interrupt');
    const terminal = Boolean(button.closest('.terminal-screen,.terminal-xterm,.xterm,.xterm-viewport,.pty-focus-surface'));
    const trackedAction = button.matches(trackedActionSelector);
    const themeMismatch = !terminal && (
      (theme === 'light' && backgroundLuminance < .16 && !semantic)
      || (theme === 'dark' && backgroundLuminance > .92 && !semantic)
    );
    const minimumContrast = button.disabled ? 2.2 : 3;
    return {
      index,
      label: (button.innerText || button.getAttribute('aria-label') || button.id || button.className || 'button').replace(/\\s+/g, ' ').trim().slice(0, 80),
      id: button.id || '',
      className: String(button.className || '').slice(0, 120),
      disabled: Boolean(button.disabled),
      foreground: style.color,
      background: 'rgb(' + background.r + ', ' + background.g + ', ' + background.b + ')',
      contrast: Number(ratio.toFixed(2)),
      themeMismatch,
      lowContrast: ratio < minimumContrast,
      trackedAction,
      height: Number(button.getBoundingClientRect().height.toFixed(2)),
      paddingLeft: pixels(style.paddingLeft),
      paddingRight: pixels(style.paddingRight),
      letterSpacing: pixels(style.letterSpacing),
    };
  });
  const textResults = [...document.querySelectorAll('body *')].flatMap(element => {
    if (element.closest(
      '[aria-hidden="true"], [inert], details:not([open]), .hidden, .sr-only, .visually-hidden, '
      + '.xterm-helper-textarea, .terminal-screen, .terminal-xterm, .xterm, script, style'
    )) return [];
    const text = [...element.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => String(node.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
    if (text.length < 2) return [];
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width < 2 || rect.height < 2 || rect.bottom <= 0 || rect.right <= 0
      || rect.top >= innerHeight || rect.left >= innerWidth
      || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < .55) return [];
    const foreground = parse(style.color);
    if (!foreground || foreground.a < .75) return [];
    const background = effectiveBackground(element);
    const ratio = contrast(foreground, background);
    const fontSize = pixels(style.fontSize);
    const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const selector = [
      element.id && '#' + element.id,
      ...[...element.classList].slice(0, 3).map(name => '.' + name),
    ].filter(Boolean).join('') || element.tagName.toLowerCase();
    return [{
      selector,
      text: text.slice(0, 100),
      parent: [
        element.parentElement?.id && '#' + element.parentElement.id,
        ...[...(element.parentElement?.classList || [])].slice(0, 3).map(name => '.' + name),
      ].filter(Boolean).join('') || element.parentElement?.tagName?.toLowerCase() || '',
      html: element.outerHTML.slice(0, 240),
      foreground: style.color,
      background: 'rgb(' + background.r + ', ' + background.g + ', ' + background.b + ')',
      contrast: Number(ratio.toFixed(2)),
      required: large ? 3 : 4.5,
    }];
  });
  const trackedActions = results.filter(result => result.trackedAction);
  const actionGroups = [...document.querySelectorAll(actionGroupSelector)]
    .filter(group => {
      const rect = group.getBoundingClientRect();
      const style = getComputedStyle(group);
      const visibleButtons = [...group.children].filter(child => child.matches?.('button') && child.getBoundingClientRect().width > 0);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && visibleButtons.length > 1;
    })
    .map(group => {
      const style = getComputedStyle(group);
      return {
        className: String(group.className || group.id || group.tagName),
        columnGap: pixels(style.columnGap),
        rowGap: pixels(style.rowGap),
      };
    });
  const overlaySurfaces = [...document.querySelectorAll(overlaySurfaceSelector)].flatMap(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width < 2 || rect.height < 2 || style.display === 'none' || style.visibility === 'hidden'
      || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return [];
    const background = effectiveBackground(element);
    const imageColors = (String(style.backgroundImage || '').match(/(?:rgba?\\([^)]*\\)|color\\(\\s*srgb\\s+[^)]*\\))/gi) || [])
      .map(parse)
      .filter(Boolean);
    const backgroundLuminance = luminance(background);
    const darkGradient = imageColors.some(color => color.a >= .6 && luminance(color) < .55);
    const localDarkSurface = Boolean(element.closest('.pty-focus-surface'));
    return [{
      selector: [
        element.id && '#' + element.id,
        ...[...element.classList].slice(0, 3).map(name => '.' + name),
      ].filter(Boolean).join('') || element.tagName.toLowerCase(),
      background: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      effectiveBackground: 'rgb(' + background.r + ', ' + background.g + ', ' + background.b + ')',
      luminance: Number(backgroundLuminance.toFixed(3)),
      themeMismatch: theme === 'light' && !localDarkSurface && (backgroundLuminance < .55 || darkGradient),
    }];
  });
  const elementContract = selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const foreground = parse(style.color);
    const background = effectiveBackground(element);
    return {
      selector,
      display: style.display,
      visibility: style.visibility,
      opacity: Number(style.opacity),
      position: style.position,
      left: Number(rect.left.toFixed(2)),
      top: Number(rect.top.toFixed(2)),
      width: Number(rect.width.toFixed(2)),
      height: Number(rect.height.toFixed(2)),
      color: style.color,
      backgroundColor: style.backgroundColor,
      effectiveBackground: 'rgb(' + background.r + ', ' + background.g + ', ' + background.b + ')',
      contrast: foreground ? Number(contrast(foreground, background).toFixed(2)) : 0,
      backgroundImage: style.backgroundImage,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      fontWeight: Number(style.fontWeight) || style.fontWeight,
      lineHeight: style.lineHeight,
    };
  };
  return {
    theme,
    total: results.length,
    themeMismatches: results.filter(result => result.themeMismatch),
    lowContrast: results.filter(result => result.lowContrast),
    contracts: {
      body: elementContract('body'),
      pageTitle: elementContract('#pageTitle'),
      newRun: elementContract('#newRunBtn'),
      homeAttention: elementContract('.home-attention-strip'),
      firstAttention: elementContract('.home-attention-item:first-child'),
      homeAttentionText: elementContract('.home-attention-item b'),
      projectGroup: elementContract('.control-room-project-group'),
      projectHeader: elementContract('.control-project-header'),
      projectHeading: elementContract('.control-project-heading'),
      projectAction: elementContract('.control-project-flow-link'),
      projectActionLabel: elementContract('.control-project-flow-link > span'),
      memoryProject: elementContract('#memoryWorkspaceFilter'),
      providerFilter: elementContract('#providerFilter'),
      newRunTitle: elementContract('#newRunBtn .new-run-cta-copy b'),
      newRunShortcut: elementContract('#newRunBtn .new-run-cta-copy small'),
      newRunKey: elementContract('#newRunBtn .new-run-cta-copy kbd'),
      terminalTargetTitle: elementContract('#ptyFocusTerminalTitle'),
    },
    text: {
      total: textResults.length,
      lowContrast: textResults.filter(result => result.contrast + .02 < result.required).slice(0, 40),
      minimumContrast: textResults.length ? Math.min(...textResults.map(result => result.contrast)) : 0,
    },
    surfaces: {
      total: overlaySurfaces.length,
      themeMismatches: overlaySurfaces.filter(result => result.themeMismatch),
    },
    rhythm: {
      trackedActions: trackedActions.length,
      shortActions: trackedActions.filter(result => result.height < 39.5),
      unevenPadding: trackedActions.filter(result => Math.abs(result.paddingLeft - result.paddingRight) > 1),
      trackedLetterSpacing: trackedActions.filter(result => Math.abs(result.letterSpacing) > .01),
      tightActionGroups: actionGroups.filter(group => group.columnGap < 7.5 || group.rowGap < 7.5),
      actionGroups,
    },
  };
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    backgroundColor: '#f4f5f8',
    webPreferences: {
      preload: path.join(__dirname, 'interaction-fixture-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  const outputDir = path.join(__dirname, '..', 'artifacts', 'theme');
  fs.mkdirSync(outputDir, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), screens: [], failures: [] };

  async function inspect(theme, label) {
    await wait(240);
    const file = await capture(win, outputDir, `${theme}-${label}.png`);
    const audit = await win.webContents.executeJavaScript(BUTTON_AUDIT_EXPRESSION);
    report.screens.push({ theme, label, file, audit });
    const contractFailures = [];
    if (label === 'all') {
      const projectHeaderVisible = audit.contracts.projectHeader
        && audit.contracts.projectHeader.display !== 'none'
        && audit.contracts.projectHeader.width >= 1;
      if (!audit.contracts.newRun || audit.contracts.newRun.display === 'none' || audit.contracts.newRun.width < 1) {
        contractFailures.push('처리 중 화면의 새 AI 작업 시작 버튼이 보이지 않습니다.');
      }
      if (
        projectHeaderVisible
        && audit.contracts.projectAction
        && (audit.contracts.projectAction.display === 'none' || audit.contracts.projectAction.width < 1)
      ) {
        contractFailures.push('작업 진행 화면 보기 버튼이 보이지 않습니다.');
      }
      if (
        projectHeaderVisible
        && audit.contracts.projectAction
        && audit.contracts.projectAction.width >= 1
        && Math.abs(
          audit.contracts.projectHeader.top + audit.contracts.projectHeader.height / 2
          - audit.contracts.projectAction.top - audit.contracts.projectAction.height / 2,
        ) > 1.5
      ) {
        contractFailures.push('작업 진행 화면 보기 버튼이 프로젝트 헤더 중앙에 정렬되지 않았습니다.');
      }
      if (Number(audit.contracts.pageTitle?.fontWeight || 0) > 800) {
        contractFailures.push('화면 제목 글자 굵기가 800을 초과합니다.');
      }
      const firstAttentionVisible = audit.contracts.firstAttention
        && audit.contracts.firstAttention.display !== 'none'
        && audit.contracts.firstAttention.visibility !== 'hidden'
        && audit.contracts.firstAttention.width >= 1
        && audit.contracts.firstAttention.height >= 1;
      if (theme === 'light' && firstAttentionVisible) {
        const background = audit.contracts.firstAttention.backgroundColor;
        const border = audit.contracts.firstAttention.borderColor;
        const shadow = audit.contracts.firstAttention.boxShadow;
        if (
          !/^rgb\(250, 247, 241\)$/.test(background)
          || !/^rgb\(230, 189, 112\)$/.test(border)
          || shadow === 'none'
        ) {
          contractFailures.push('라이트 테마의 우선 확인 카드가 중립 표면과 경고 레일을 함께 사용하지 않습니다.');
        }
      }
      if (
        audit.contracts.homeAttention
        && audit.contracts.firstAttention
        && audit.contracts.firstAttention.top + audit.contracts.firstAttention.height
          > audit.contracts.homeAttention.top + audit.contracts.homeAttention.height + 1.5
      ) {
        contractFailures.push('우선 확인 카드가 확인 결과 영역의 높이를 넘어 다음 영역과 겹칩니다.');
      }
      if (
        audit.contracts.firstAttention
        && audit.contracts.newRun
        && audit.contracts.newRun.top
          < audit.contracts.firstAttention.top + audit.contracts.firstAttention.height - 1.5
      ) {
        contractFailures.push('현재 프로젝트 작업 바가 우선 확인 카드 위를 덮습니다.');
      }
    }
    if (label === 'waiting' && audit.contracts.newRun && audit.contracts.newRun.display !== 'none' && audit.contracts.newRun.width > 0) {
      contractFailures.push('확인 대기 화면에 새 AI 작업 시작 버튼이 노출됩니다.');
    }
    if (label === 'active') {
      if (!audit.contracts.memoryProject || audit.contracts.memoryProject.display === 'none' || audit.contracts.memoryProject.width < 1) {
        contractFailures.push('지난 작업 프로젝트 필터가 보이지 않습니다.');
      }
      if (!audit.contracts.providerFilter || audit.contracts.providerFilter.display === 'none' || audit.contracts.providerFilter.width < 1) {
        contractFailures.push('지난 작업 AI 필터가 보이지 않습니다.');
      }
    }
    if (label === 'wide-all') {
      if (audit.contracts.newRunShortcut?.display !== 'none' && audit.contracts.newRunShortcut?.width > 0) {
        contractFailures.push('새 AI 작업 시작 버튼에 제거한 단축키 안내가 다시 노출됩니다.');
      }
    }
    if (
      label === 'pty-focus'
      && theme === 'light'
      && Number(audit.contracts.terminalTargetTitle?.contrast || 0) + .02 < 4.5
    ) {
      contractFailures.push('라이트 테마의 터미널 대상 제목과 작업판 대비가 4.5:1 미만입니다.');
    }
    if (
      audit.themeMismatches.length
      || audit.lowContrast.length
      || audit.text.lowContrast.length
      || audit.surfaces.themeMismatches.length
      || audit.rhythm.shortActions.length
      || audit.rhythm.unevenPadding.length
      || audit.rhythm.trackedLetterSpacing.length
      || audit.rhythm.tightActionGroups.length
      || contractFailures.length
    ) {
      report.failures.push({ theme, label, contractFailures, ...audit });
    }
  }

  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await waitFor(
      win,
      `Boolean(window.WhiteboxApp?.initialized && window.WhiteboxApp?.state?.snapshot && window.WhiteboxTheme)`,
      '테마 검수용 앱 화면이 준비되지 않았습니다.',
    );
    await win.webContents.executeJavaScript(`(() => {
      window.WhiteboxI18n.setLocale('ko');
      window.WhiteboxApp.state.guideExpanded = false;
      window.WhiteboxApp.state.workspace = window.WhiteboxApp.state.workspaces[0]?.path || 'all';
      window.WhiteboxApp.render();
      document.querySelector('#beginnerGuide')?.classList.add('hidden');
      return true;
    })()`);

    for (const theme of ['dark', 'light']) {
      await win.webContents.executeJavaScript(`window.WhiteboxTheme.setTheme(${JSON.stringify(theme)})`);
      for (const view of ['all', 'active', 'waiting', 'settings']) {
        await win.webContents.executeJavaScript(`(() => {
          window.WhiteboxApp.selectView(${JSON.stringify(view)});
          window.WhiteboxApp.state.guideCompleted.clear();
          window.WhiteboxApp.render();
          document.querySelector('.main-stage')?.scrollTo(0, 0);
          return true;
        })()`);
        await inspect(theme, view);
      }

      await win.webContents.executeJavaScript(`document.querySelector('#newRunBtn')?.click()`);
      await waitFor(win, `!document.querySelector('#runModal')?.classList.contains('hidden')`, '새 작업 모달을 열지 못했습니다.');
      await inspect(theme, 'run-modal');
      await win.webContents.executeJavaScript(`document.querySelector('#cancelRunBtn')?.click()`);

      await waitFor(win, `document.querySelector('#runModal')?.classList.contains('hidden')`, '새 작업 모달을 닫지 못했습니다.');
      await win.webContents.executeJavaScript(`(() => {
        const app = window.WhiteboxApp;
        app.closePtyFocus?.({ restoreFocus: false });
        app.selectView('all');
        app.state.workspace = 'D:\\\\fixture';
        app.state.workspaceSource = 'all';
        app.state.graphFocusId = null;
        app.state.search = '';
        app.state.providerFilters?.clear?.();
        app.renderWorkspaces?.();
        app.renderSessions?.('theme-pty-focus');
        return true;
      })()`);
      await waitFor(
        win,
        `(() => {
          const root = window.WhiteboxApp.state.snapshot.sessions.find(session => session.id === 'fixture-root');
          const target = window.WhiteboxTerminal.agentTargets(root)
            .find(item => item.terminalId === 'terminal-main');
          const trigger = document.querySelector('#liveSessionGrid [data-pty-focus-trigger="fixture-root"]');
          const rect = trigger?.getBoundingClientRect();
          return Boolean(target && rect && rect.width > 0 && rect.height > 0);
        })()`,
        '작업 노드와 exact PTY target이 준비되지 않았습니다.',
      );
      await win.webContents.executeJavaScript(
        `document.querySelector('#liveSessionGrid [data-pty-focus-trigger="fixture-root"]')?.click()`,
      );
      try {
        await waitFor(
          win,
          `(() => {
            const embedded = window.WhiteboxTerminal.embeddedState();
            return window.WhiteboxApp.state.ptyFocusSessionId === 'fixture-root'
              && window.WhiteboxApp.state.ptyFocusTargetId === 'terminal-main'
              && embedded.connected && embedded.terminalId === 'terminal-main'
              && Boolean(document.querySelector('#ptyFocusTerminalViewport .xterm'));
          })()`,
          '작업 노드의 exact PTY 집중 모드를 열지 못했습니다.',
        );
      } catch (error) {
        const focusDebug = await win.webContents.executeJavaScript(`(() => {
          const app = window.WhiteboxApp;
          const root = app.state.snapshot.sessions.find(session => session.id === 'fixture-root');
          return {
            view: app.state.view,
            workspace: app.state.workspace,
            workspaceSource: app.state.workspaceSource,
            focusSessionId: app.state.ptyFocusSessionId,
            focusTargetId: app.state.ptyFocusTargetId,
            embedded: window.WhiteboxTerminal.embeddedState(),
            targets: window.WhiteboxTerminal.agentTargets(root),
            terminals: window.interactionTest.getTerminals(),
            calls: window.interactionTest.getCalls().slice(-12),
            surfaceHidden: document.querySelector('#ptyFocusSurface')?.classList.contains('hidden'),
          };
        })()`);
        throw new Error(`${error.message}: ${JSON.stringify(focusDebug)}`);
      }
      const ptyMarker = `PTY_THEME_${theme}_${Date.now()}`;
      await win.webContents.executeJavaScript(
        `window.interactionTest.emitTerminalData('terminal-main', ${JSON.stringify(`\r\n${ptyMarker}\r\n`)})`,
      );
      await waitFor(
        win,
        `[...document.querySelectorAll('#ptyFocusTerminalViewport .xterm-rows > div')]
          .some(row => (row.textContent || '').includes(${JSON.stringify(ptyMarker)}))`,
        'PTY 집중 모드에 실제 xterm 출력을 표시하지 못했습니다.',
      );
      const retiredUiAbsent = await win.webContents.executeJavaScript(
        `!document.querySelector('#detailDrawer,#drawerBackdrop,#drawerContent,#drawerComposer,'
          + '#sessionResetModal,#mobileMoreBtn,#mobileToolsMenu,#terminalSection,#terminalHistoryPanel,#terminalHistoryList,'
          + '#automationOverview,#tmuxSection,#tmuxCreateModal')`,
      );
      if (!retiredUiAbsent) throw new Error('삭제된 대화·추가 기능·legacy terminal UI가 다시 노출되었습니다.');
      await inspect(theme, 'pty-focus');
      await win.webContents.executeJavaScript(`document.querySelector('#ptyFocusBackBtn')?.click()`);
      await waitFor(
        win,
        `!window.WhiteboxApp.state.ptyFocusSessionId
          && document.querySelector('#ptyFocusSurface')?.classList.contains('hidden')`,
        'PTY 집중 모드를 닫지 못했습니다.',
      );

      await win.webContents.executeJavaScript(`window.WhiteboxApp.openQuickPalette()`);
      await waitFor(win, `!document.querySelector('#quickPaletteModal')?.classList.contains('hidden')`, '빠른 이동 창을 열지 못했습니다.');
      await inspect(theme, 'quick-palette');
      await win.webContents.executeJavaScript(`window.WhiteboxApp.closeQuickPalette()`);

      await win.webContents.executeJavaScript(`window.WhiteboxApp.openShortcutHelp()`);
      await waitFor(win, `!document.querySelector('#shortcutHelpModal')?.classList.contains('hidden')`, '키보드 단축키 창을 열지 못했습니다.');
      await inspect(theme, 'shortcut-help');
      await win.webContents.executeJavaScript(`window.WhiteboxApp.closeShortcutHelp()`);

      win.setBounds({ width: 1840, height: 900 }, false);
      await win.webContents.executeJavaScript(`(() => {
        window.WhiteboxApp.selectView('all');
        document.querySelector('.main-stage')?.scrollTo(0, 0);
        return true;
      })()`);
      await inspect(theme, 'wide-all');

      win.setBounds({ width: 390, height: 844 }, false);
      await win.webContents.executeJavaScript(`(() => {
        window.WhiteboxApp.selectView('all');
        document.querySelector('.main-stage')?.scrollTo(0, 0);
        return true;
      })()`);
      await inspect(theme, 'mobile-home');
      win.setBounds({ width: 1440, height: 900 }, false);
    }

    await win.webContents.executeJavaScript(`window.WhiteboxTheme.setTheme('light')`);
    await win.webContents.reload();
    await waitFor(
      win,
      `document.documentElement.dataset.theme === 'light'
        && window.WhiteboxApp?.initialized
        && document.querySelector('[data-theme-choice="light"]')?.getAttribute('aria-checked') === 'true'`,
      '저장한 라이트 모드가 앱 재실행 상태에서 복원되지 않았습니다.',
    );
    report.persistence = {
      restoredTheme: await win.webContents.executeJavaScript('document.documentElement.dataset.theme'),
      lightChoiceChecked: await win.webContents.executeJavaScript(`document.querySelector('[data-theme-choice="light"]')?.getAttribute('aria-checked')`),
    };

    const reportPath = path.join(outputDir, 'theme-audit.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    if (report.failures.length) {
      throw new Error(`테마 버튼 색상·간격 검수 실패: ${JSON.stringify(report.failures, null, 2)}`);
    }
    console.log('다크·라이트 테마 화면 및 버튼 색상 검수 통과');
    console.log(reportPath);
  } catch (error) {
    console.error(error && error.stack || error);
    app.exit(1);
    return;
  } finally {
    if (!win.isDestroyed()) win.close();
  }
  app.quit();
});
