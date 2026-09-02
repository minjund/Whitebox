'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-readability-'));
app.setPath('userData', userData);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function forceRepaint(win) {
  const [width, height] = win.getContentSize();
  win.setContentSize(width + 1, height);
  await wait(90);
  win.setContentSize(width, height);
  await wait(220);
}

async function waitFor(win, expression, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await wait(100);
  }
  throw new Error(`화면 준비를 기다리는 중 시간 초과: ${expression}`);
}

async function capturePageWithRetry(win, label) {
  let lastError = null;
  const stableContentSize = win.getContentSize();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      win.webContents.invalidate();
      await wait(180 + attempt * 80);
      return await win.webContents.capturePage();
    } catch (error) {
      lastError = error;
      win.hide();
      await wait(100);
      win.show();
      if (stableContentSize[0] > 0 && stableContentSize[1] > 0) {
        win.setContentSize(stableContentSize[0], stableContentSize[1]);
      }
      win.focus();
      await forceRepaint(win);
    }
  }
  throw new Error(`${label} 캡처 실패: ${lastError?.stack || lastError?.message || lastError}`);
}

async function capture(win, outputDir, name, repaint = false) {
  if (repaint) await forceRepaint(win);
  const [contentWidth, contentHeight] = win.getContentSize();
  let settled = false;
  let settleError = null;
  for (let attempt = 0; attempt < 2 && !settled; attempt += 1) {
    try {
      await win.webContents.executeJavaScript(`document.fonts.ready.then(() => { for (const animation of document.getAnimations()) { try { animation.finish(); } catch {} } return true; })`);
      settled = true;
    } catch (error) {
      settleError = error;
      await wait(120);
    }
  }
  if (!settled) throw settleError;
  let image = null;
  let png = null;
  let encodeError = null;
  for (let attempt = 0; attempt < 3 && !png; attempt += 1) {
    image = await capturePageWithRetry(win, name);
    try {
      png = image.toPNG();
    } catch (error) {
      encodeError = error;
      await forceRepaint(win);
    }
  }
  if (!png) throw new Error(`${name} PNG 인코딩 실패: ${encodeError?.stack || encodeError?.message || encodeError}`);
  const deviceScaleFactor = await win.webContents.executeJavaScript('window.devicePixelRatio || 1');
  const captured = image.getSize();
  const expectedWidth = Math.round(contentWidth * deviceScaleFactor);
  const expectedHeight = Math.round(contentHeight * deviceScaleFactor);
  if (Math.abs(captured.width - expectedWidth) > 2 || Math.abs(captured.height - expectedHeight) > 2) {
    throw new Error(`캡처 크기가 현재 창과 다릅니다: ${name} ${captured.width}×${captured.height} / ${expectedWidth}×${expectedHeight} (DPR ${deviceScaleFactor})`);
  }
  fs.writeFileSync(path.join(outputDir, name), png);
}

async function auditVisibleText(win, view) {
  await win.webContents.executeJavaScript(`document.fonts.ready.then(() => {
    for (const animation of document.getAnimations()) { try { animation.finish(); } catch {} }
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })`);
  return win.webContents.executeJavaScript(`(() => {
    const withinViewport = rect => rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    const visibleAtCenter = element => {
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const top = document.elementsFromPoint(x, y).find(candidate => getComputedStyle(candidate).pointerEvents !== 'none');
      return Boolean(top && (top === element || element.contains(top) || top.contains(element)));
    };
    const parseColor = value => {
      const match = String(value || '').match(/rgba?\\(([^)]+)\\)/);
      if (!match) return null;
      const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const channel = value => {
      const normalized = value / 255;
      return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    };
    const luminance = color => .2126 * channel(color.r) + .7152 * channel(color.g) + .0722 * channel(color.b);
    const contrast = (foreground, background) => {
      const high = Math.max(luminance(foreground), luminance(background));
      const low = Math.min(luminance(foreground), luminance(background));
      return (high + .05) / (low + .05);
    };
    const solidBackground = element => {
      let current = element;
      while (current) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color.a >= .92) return color;
        current = current.parentElement;
      }
      return parseColor(getComputedStyle(document.documentElement).backgroundColor) || { r: 6, g: 10, b: 16, a: 1 };
    };
    const candidates = [...document.querySelectorAll('body *')].flatMap(element => {
      if (element.closest('[aria-hidden="true"], details:not([open]), .sr-only, .visually-hidden, .xterm-helper-textarea, script, style')) return [];
      const text = [...element.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent.replace(/\\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ');
      if (text.length < 2) return [];
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width < 2 || rect.height < 2 || !withinViewport(rect) || !visibleAtCenter(element)
        || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < .55) return [];
      const fontSize = Number.parseFloat(style.fontSize);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const foreground = parseColor(style.color);
      if (!foreground || foreground.a < .75) return [];
      const background = solidBackground(element);
      const ratio = contrast(foreground, background);
      const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
      const selector = [element.id && '#' + element.id, ...[...element.classList].slice(0, 2).map(name => '.' + name)].filter(Boolean).join('') || element.tagName.toLowerCase();
      const parent = element.parentElement;
      const parentSelector = parent ? [parent.id && '#' + parent.id, ...[...parent.classList].slice(0, 3).map(name => '.' + name)].filter(Boolean).join('') || parent.tagName.toLowerCase() : '';
      return [{ selector, parent: parentSelector, text: text.slice(0, 80), fontSize, color: style.color, background: style.backgroundColor, opacity: style.opacity, ratio: Number(ratio.toFixed(2)), required: large ? 3 : 4.5 }];
    });
    const hitTargets = [...document.querySelectorAll('button, select, textarea, summary, a[href], [role="button"], [tabindex]:not([tabindex="-1"]), input:not([type="checkbox"]):not([type="radio"])')]
      .flatMap(element => {
        if (element.closest('[inert], [aria-hidden="true"], details:not([open]), .hidden, .sr-only, .visually-hidden, .xterm-helper-textarea')) return [];
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (rect.width < 2 || rect.height < 2 || !withinViewport(rect) || !visibleAtCenter(element)
          || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < .2) return [];
        const selector = [element.id && '#' + element.id, ...[...element.classList].slice(0, 2).map(name => '.' + name)].filter(Boolean).join('') || element.tagName.toLowerCase();
        return [{ element, selector, text: String(element.innerText || element.value || element.getAttribute('aria-label') || '').trim().slice(0, 60), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }];
      });
    const overlaps = [];
    for (let left = 0; left < hitTargets.length; left += 1) {
      for (let right = left + 1; right < hitTargets.length; right += 1) {
        const a = hitTargets[left];
        const b = hitTargets[right];
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width > .75 && height > .75) overlaps.push({ first: a.selector, second: b.selector, width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) });
        if (overlaps.length >= 20) break;
      }
      if (overlaps.length >= 20) break;
    }
    const spacingGroups = [
      '.top-actions',
      '.view-nav',
      '.workspace-list',
      '.session-tools',
      '.provider-filter',
      '.app-error-actions',
      '.management-filter-group',
      '.management-quick-actions',
      '.management-control-buttons',
      '.terminal-create-actions',
      '.agent-inline-terminal-actions',
      '.run-modal-actions',
      '.modal-actions',
      '.agent-command-actions',
    ];
    const crowdedGroups = spacingGroups.flatMap(selector => [...document.querySelectorAll(selector)].flatMap(group => {
      const rect = group.getBoundingClientRect();
      const style = getComputedStyle(group);
      if (rect.width < 2 || rect.height < 2 || !withinViewport(rect) || !visibleAtCenter(group)
        || group.closest('[inert], [aria-hidden="true"], .hidden')
        || style.display === 'none' || style.visibility === 'hidden') return [];
      const interactiveChildren = [...group.children].filter(child => {
        if (!child.matches('button, select, input, textarea, summary, a[href], label, [role="button"], details, div')) return false;
        const childRect = child.getBoundingClientRect();
        const childStyle = getComputedStyle(child);
        return childRect.width >= 2 && childRect.height >= 2 && childStyle.display !== 'none' && childStyle.visibility !== 'hidden';
      });
      if (interactiveChildren.length < 2) return [];
      const rowGap = Number.parseFloat(style.rowGap) || 0;
      const columnGap = Number.parseFloat(style.columnGap) || 0;
      const minimumGap = Math.min(rowGap, columnGap);
      return minimumGap + .01 < 10 ? [{
        selector,
        rowGap,
        columnGap,
        children: interactiveChildren.length,
      }] : [];
    }));
    return {
      view: ${JSON.stringify(view)},
      textNodes: candidates.length,
      tooSmall: candidates.filter(item => item.fontSize < 11.9).slice(0, 30),
      lowContrast: candidates.filter(item => item.ratio + .02 < item.required).slice(0, 30),
      minimumFontSize: candidates.length ? Math.min(...candidates.map(item => item.fontSize)) : 0,
      minimumContrast: candidates.length ? Math.min(...candidates.map(item => item.ratio)) : 0,
      tooSmallTargets: hitTargets.filter(item => item.width < 43.5 || item.height < 43.5).slice(0, 30).map(({ element, ...item }) => item),
      overlaps,
      crowdedGroups,
    };
  })()`);
}

app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    const win = new BrowserWindow({
      x: 24,
      y: 24,
      width: 1440,
      height: 980,
      show: true,
      focusable: true,
      webPreferences: {
        preload: path.join(__dirname, 'interaction-fixture-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await waitFor(win, `Boolean(window.WhiteboxApp?.initialized && window.WhiteboxApp?.state?.snapshot?.sessions?.length)`);
    win.setContentSize(1440, 980);
    await wait(260);
    const outputDir = path.join(__dirname, '..', 'artifacts');
    fs.mkdirSync(outputDir, { recursive: true });

    await win.webContents.executeJavaScript(`(async () => {
      const bootstrap = await window.whitebox.bootstrap();
      const app = window.WhiteboxApp;
      app.state.providers = bootstrap.providers;
      app.state.availability = bootstrap.availability;
      app.state.workspaces = bootstrap.workspaces;
      app.state.rawSnapshot = bootstrap.snapshot;
      app.state.snapshot = bootstrap.snapshot;
      app.state.hiddenProviders.clear();
      window.WhiteboxI18n.setLocale('ko');
      app.state.view = 'all';
      app.state.workspace = 'D:\\\\fixture';
      app.state.graphFocusId = null;
      app.syncViewChrome();
      app.render('view');
      document.querySelector('#beginnerGuide')?.classList.add('hidden');
      const stage = document.querySelector('.main-stage');
      const target = document.querySelector('#liveSection');
      if (stage && target) stage.scrollTop = Math.max(0, target.offsetTop - 18);
      return true;
    })()`);
    await waitFor(win, `!document.querySelector('#liveSection')?.classList.contains('hidden')
      && Boolean(document.querySelector('#sessionTokenOverview'))
      && Boolean(document.querySelector('[data-control-room-overview]'))`);
    // Chromium can return a stale first frame for a newly shown BrowserWindow.
    // Prime the compositor once so the checked artifact always reflects the DOM.
    await capturePageWithRetry(win, 'compositor-prime');
    await wait(300);
    await capture(win, outputDir, 'whitebox-readability-overview.png', true);

    await win.webContents.executeJavaScript(`(() => {
      window.WhiteboxApp.state.graphFocusId = null;
      window.WhiteboxApp.renderSessions('view');
      document.querySelector('[data-graph-focus="fixture-root"]')?.click();
      return true;
    })()`);
    await waitFor(win, `Boolean(document.querySelector('.execution-activity-panel') && document.querySelector('[data-execution-mode="foreground"]'))`);
    await forceRepaint(win);
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('#mainContent')?.focus({ preventScroll: true });
      const foreground = document.querySelector('[data-execution-mode="foreground"]');
      if (foreground) foreground.open = true;
      const stage = document.querySelector('.main-stage');
      const panel = document.querySelector('.execution-activity-panel');
      if (stage && panel) stage.scrollTop = Math.max(0, panel.offsetTop - 90);
      return true;
    })()`);
    await waitFor(win, `!document.querySelector('#detailDrawer,#drawerBackdrop,#drawerContent,#drawerComposer,#sessionResetModal,#mobileMoreBtn,#mobileToolsMenu,'
      + '#terminalSection,#terminalHistoryPanel,#terminalHistoryList,#automationOverview,#tmuxSection,#tmuxCreateModal')
      && !document.querySelector('#appShell')?.inert
      && !document.body.classList.contains('dialog-open')`);
    // Recreate the native compositor surface before checking the expanded
    // read-only execution status panel.
    win.hide();
    await wait(100);
    win.show();
    win.focus();
    await wait(260);
    await waitFor(win, `(() => { const detail = document.querySelector('[data-execution-mode="foreground"]'); if (!detail) return false; detail.open = true; return detail.querySelector('.execution-detail-output pre')?.textContent.includes('128개 테스트 통과'); })()`);
    await win.webContents.executeJavaScript(`(() => {
      const detail = document.querySelector('[data-execution-mode="foreground"]');
      const stage = document.querySelector('.main-stage');
      if (detail && stage) {
        detail.open = true;
        const detailRect = detail.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        stage.scrollTop += detailRect.top - stageRect.top - 72;
      }
      return true;
    })()`);
    await waitFor(win, `(() => { const detail = document.querySelector('[data-execution-mode="foreground"]'); const rect = detail?.getBoundingClientRect(); return Boolean(detail?.open && rect && rect.top >= 0 && rect.top < innerHeight * .5); })()`);
    await capture(win, outputDir, 'whitebox-execution-activity.png', true);

    win.setContentSize(360, 620);
    await wait(250);
    await win.webContents.executeJavaScript(`(() => {
      window.WhiteboxApp.state.view = 'all';
      window.WhiteboxApp.state.graphFocusId = null;
      window.WhiteboxApp.syncViewChrome();
      window.WhiteboxApp.renderSessions('view');
      document.querySelector('#beginnerGuide')?.classList.add('hidden');
      const stage = document.querySelector('.main-stage');
      const target = document.querySelector('#liveSection');
      if (stage && target) stage.scrollTop = Math.max(0, target.offsetTop - 10);
      return true;
    })()`);
    await waitFor(win, `(() => {
      const live = document.querySelector('#liveSection');
      const stage = document.querySelector('.main-stage');
      return Boolean(live && !live.classList.contains('hidden')
        && live.scrollWidth <= live.clientWidth + 2
        && stage.scrollWidth <= stage.clientWidth + 2
        && document.querySelector('#sessionTokenOverview')
        && live.querySelector('[data-control-room-overview]')
        && live.querySelector('.control-room-main')
        && live.querySelector('.helper-node')
        && live.querySelector('.execution-node'));
    })()`);
    await capture(win, outputDir, 'whitebox-control-room-360.png', true);

    await waitFor(win, `!document.querySelector('#mobileMoreBtn,#mobileToolsMenu')
      && Boolean([...document.querySelectorAll('[data-pty-focus-trigger="fixture-root"]')]
        .find(node => node.getBoundingClientRect().height > 0))`);
    const mobileProjectStatusMetrics = await win.webContents.executeJavaScript(`(() => {
      const card = [...document.querySelectorAll('[data-control-session="fixture-root"]')]
        .find(candidate => candidate.getBoundingClientRect().height > 0);
      const status = card?.querySelector('.control-room-main .control-main-top > em,.control-session-live,.status-pill');
      const trigger = [...document.querySelectorAll('[data-pty-focus-trigger="fixture-root"]')]
        .find(candidate => candidate.getBoundingClientRect().height > 0);
      const rect = trigger?.getBoundingClientRect();
      return {
        found: Boolean(card && trigger),
        width: rect?.width || 0,
        height: rect?.height || 0,
        noOverflow: Boolean(card && card.scrollWidth <= card.clientWidth + 2),
        statusText: status?.textContent.trim() || '',
        accessibleLabel: trigger?.getAttribute('aria-label') || trigger?.textContent.trim() || '',
        oldMobileUiAbsent: !document.querySelector('#mobileMoreBtn,#mobileToolsMenu'),
      };
    })()`);
    if (!mobileProjectStatusMetrics.found
      || mobileProjectStatusMetrics.width < 44 || mobileProjectStatusMetrics.height < 44
      || !mobileProjectStatusMetrics.noOverflow || !mobileProjectStatusMetrics.statusText
      || !mobileProjectStatusMetrics.accessibleLabel || !mobileProjectStatusMetrics.oldMobileUiAbsent) {
      throw new Error(`모바일 작업 현황·PTY 진입 가독성 계약 미달: ${JSON.stringify(mobileProjectStatusMetrics)}`);
    }
    await capture(win, outputDir, 'whitebox-responsive-control-room-360.png');

    win.setContentSize(1440, 900);
    await wait(250);
    const viewReports = [];
    for (const view of ['all', 'active', 'waiting', 'settings']) {
      await win.webContents.executeJavaScript(`(() => {
        const app = window.WhiteboxApp;
        app.state.view = ${JSON.stringify(view)};
        app.state.graphFocusId = null;
        app.syncViewChrome();
        app.render('view');
        const guide = document.querySelector('#beginnerGuide');
        if (guide) guide.classList.toggle('hidden', ${JSON.stringify(view)} !== 'all');
        document.querySelector('.main-stage')?.scrollTo(0, 0);
        return true;
      })()`);
      await wait(240);
      const report = await auditVisibleText(win, view);
      viewReports.push(report);
      await capture(win, outputDir, `whitebox-readability-${view}.png`);
    }

    // Conversation drawers, the legacy terminal page, session reset, and the
    // mobile-more menu no longer exist. Their former readability cases are
    // represented by the only writable task surface: exact full-screen PTY
    // focus, at both desktop and compact sizes.
    await win.webContents.executeJavaScript(`(() => {
      const app = window.WhiteboxApp;
      app.closePtyFocus?.({ restoreFocus: false });
      app.state.view = 'all';
      app.state.workspace = 'D:\\\\fixture';
      app.state.graphFocusId = null;
      app.syncViewChrome();
      app.render('pty-readability');
      const trigger = [...document.querySelectorAll('[data-pty-focus-trigger="fixture-root"]')]
        .find(node => node.getBoundingClientRect().height > 0);
      trigger?.click();
      return Boolean(trigger);
    })()`);
    await waitFor(win, `(() => {
      const embedded = window.WhiteboxTerminal.embeddedState();
      return window.WhiteboxApp.state.ptyFocusSessionId === 'fixture-root'
        && window.WhiteboxApp.state.ptyFocusTargetId === 'terminal-main'
        && embedded.connected && embedded.terminalId === 'terminal-main'
        && Boolean(document.querySelector('#ptyFocusTerminalViewport .xterm'));
    })()`);
    const ptyMarker = `PTY_READABILITY_${Date.now()}`;
    await win.webContents.executeJavaScript(`window.interactionTest.emitTerminalData('terminal-main', ${JSON.stringify(`\r\n${ptyMarker}\r\n`)})`);
    await waitFor(win, `[...document.querySelectorAll('#ptyFocusTerminalViewport .xterm-rows > div')]
      .some(row => (row.textContent || '').includes(${JSON.stringify(ptyMarker)}))`);
    const ptyDesktopMetrics = await win.webContents.executeJavaScript(`(() => {
      const surface = document.querySelector('#ptyFocusSurface');
      const flow = document.querySelector('#ptyFocusFlow');
      const terminal = document.querySelector('#ptyFocusTerminalShell');
      const viewport = document.querySelector('#ptyFocusTerminalViewport');
      const back = document.querySelector('#ptyFocusBackBtn');
      const rect = surface?.getBoundingClientRect();
      return {
        fullViewport: Boolean(rect && Math.abs(rect.left) <= 1 && Math.abs(rect.top) <= 1
          && Math.abs(rect.right - innerWidth) <= 1 && Math.abs(rect.bottom - innerHeight) <= 1),
        labelled: surface?.getAttribute('aria-labelledby') === 'ptyFocusTitle'
          && Boolean(document.querySelector('#ptyFocusTitle')?.textContent.trim())
          && Boolean(viewport?.getAttribute('aria-label')),
        backTarget: back?.getBoundingClientRect().width >= 44 && back?.getBoundingClientRect().height >= 44,
        flowLanes: flow?.querySelectorAll('.pty-focus-flow-lane').length || 0,
        statusOnly: !flow?.querySelector('button,a,input,textarea,select,[contenteditable="true"]'),
        terminalVisible: terminal?.getBoundingClientRect().height > 180,
        viewportNoOverflow: Boolean(viewport && viewport.scrollWidth <= viewport.clientWidth + 2),
        backgroundInert: Boolean(document.querySelector('#mainContent')?.inert
          && document.querySelector('.sidebar')?.inert),
        oldUiAbsent: !document.querySelector('#detailDrawer,#drawerBackdrop,#drawerContent,#drawerComposer,'
          + '#sessionResetModal,#mobileMoreBtn,#mobileToolsMenu,#terminalSection,#terminalHistoryPanel,#terminalHistoryList,'
          + '#automationOverview,#tmuxSection,#tmuxCreateModal'),
      };
    })()`);
    if (!ptyDesktopMetrics.fullViewport || !ptyDesktopMetrics.labelled || !ptyDesktopMetrics.backTarget
      || ptyDesktopMetrics.flowLanes !== 3 || !ptyDesktopMetrics.statusOnly
      || !ptyDesktopMetrics.terminalVisible || !ptyDesktopMetrics.viewportNoOverflow
      || !ptyDesktopMetrics.backgroundInert || !ptyDesktopMetrics.oldUiAbsent) {
      throw new Error(`PTY 집중 모드 데스크톱 가독성 계약 미달: ${JSON.stringify(ptyDesktopMetrics)}`);
    }
    viewReports.push(await auditVisibleText(win, 'pty-focus-desktop'));
    await capture(win, outputDir, 'whitebox-readability-pty-focus.png', true);

    win.setContentSize(390, 760);
    await wait(280);
    const ptyCompactMetrics = await win.webContents.executeJavaScript(`(() => {
      const surface = document.querySelector('#ptyFocusSurface');
      const flow = document.querySelector('.pty-focus-flow-region');
      const terminal = document.querySelector('#ptyFocusTerminalShell');
      const viewport = document.querySelector('#ptyFocusTerminalViewport');
      const back = document.querySelector('#ptyFocusBackBtn');
      const title = document.querySelector('#ptyFocusTitle');
      const rect = surface?.getBoundingClientRect();
      return {
        fullViewport: Boolean(rect && Math.abs(rect.left) <= 1 && Math.abs(rect.top) <= 1
          && Math.abs(rect.right - innerWidth) <= 1 && Math.abs(rect.bottom - innerHeight) <= 1),
        noBodyOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
        flowContained: Boolean(flow && flow.getBoundingClientRect().left >= -1
          && flow.getBoundingClientRect().right <= innerWidth + 1),
        terminalHeight: terminal?.getBoundingClientRect().height || 0,
        viewportNoOverflow: Boolean(viewport && viewport.scrollWidth <= viewport.clientWidth + 2),
        titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize),
        backTarget: back?.getBoundingClientRect().width >= 44 && back?.getBoundingClientRect().height >= 44,
        xtermVisible: Boolean(viewport?.querySelector('.xterm')?.getBoundingClientRect().height),
      };
    })()`);
    if (!ptyCompactMetrics.fullViewport || !ptyCompactMetrics.noBodyOverflow
      || !ptyCompactMetrics.flowContained || ptyCompactMetrics.terminalHeight < 180
      || !ptyCompactMetrics.viewportNoOverflow || ptyCompactMetrics.titleFontSize < 15.9
      || !ptyCompactMetrics.backTarget || !ptyCompactMetrics.xtermVisible) {
      throw new Error(`PTY 집중 모드 작은 화면 가독성 계약 미달: ${JSON.stringify(ptyCompactMetrics)}`);
    }
    viewReports.push(await auditVisibleText(win, 'pty-focus-compact'));
    await capture(win, outputDir, 'whitebox-readability-pty-focus-compact.png', true);
    await win.webContents.executeJavaScript(`document.querySelector('#ptyFocusBackBtn')?.click()`);
    await waitFor(win, `!window.WhiteboxApp.state.ptyFocusSessionId
      && document.querySelector('#ptyFocusSurface')?.classList.contains('hidden')`);

    win.setContentSize(1440, 900);
    await wait(250);
    await win.webContents.executeJavaScript(`document.querySelector('#newRunBtn')?.click()`);
    await waitFor(win, `!document.querySelector('#runModal')?.classList.contains('hidden')
      && !document.querySelector('#runModal')?.inert`);
    viewReports.push(await auditVisibleText(win, 'run-modal'));
    await capture(win, outputDir, 'whitebox-readability-run-modal.png', true);
    await win.webContents.executeJavaScript(`document.querySelector('#cancelRunBtn')?.click()`);
    await waitFor(win, `document.querySelector('#runModal')?.classList.contains('hidden')
      && document.querySelector('#runModal')?.inert`);

    const ptyReadabilityFailures = viewReports.filter(report => report.tooSmall.length || report.lowContrast.length
      || report.tooSmallTargets.length || report.overlaps.length || report.crowdedGroups.length);
    if (ptyReadabilityFailures.length) throw new Error(`전 화면 텍스트 가독성 기준 미달: ${JSON.stringify(ptyReadabilityFailures)}`);
    process.stdout.write(`readability visual check passed ${JSON.stringify({
      views: viewReports.map(report => report.view), ptyDesktopMetrics, ptyCompactMetrics,
    })}\n`);
  } catch (error) {
    exitCode = 1;
    process.stderr.write(`${error.stack || error.message}\n`);
  } finally {
    app.exit(exitCode);
  }
}).catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});

app.on('quit', () => {
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
});
