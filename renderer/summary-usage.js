'use strict';

// Summary-mode header: the connected AI's model and effort, each AI's account
// limit, and a token history kept across terminals (it outlives a closed
// terminal, like the shared 2048 board).
(() => {
  const DAY = 24 * 60 * 60 * 1000;
  const KEEP_DAYS = 30;
  const MAX_ENTRIES = 500;
  const ACCOUNT_REFRESH_MS = 60_000;
  const EFFORT_LEVEL = { minimal: 1, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
  const PROVIDERS = ['claude', 'codex'];
  const providerName = provider => (provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : '');

  // claude-opus-5-5 → Opus 5.5, gpt-6.1-sol → GPT-6.1 Sol.
  function modelLabel(model) {
    const raw = String(model || '').trim().toLowerCase().replace(/-\d{8}$/u, '');
    if (!raw) return '';
    if (raw.startsWith('claude-')) {
      const [name, ...version] = raw.slice(7).split('-');
      return `${name.charAt(0).toUpperCase()}${name.slice(1)}${version.length ? ` ${version.join('.')}` : ''}`;
    }
    if (raw.startsWith('gpt-')) {
      const [version, ...rest] = raw.slice(4).split('-');
      return [`GPT-${version}`, ...rest.map(word => word.charAt(0).toUpperCase() + word.slice(1))].join(' ');
    }
    return raw;
  }
  const effortLevel = effort => EFFORT_LEVEL[String(effort || '').toLowerCase()] || 0;

  function compact(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    if (number < 10_000) return new Intl.NumberFormat('en').format(number);
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
  }

  function untilText(resetsAt, t, now) {
    const at = Date.parse(resetsAt || '');
    if (!Number.isFinite(at)) return '';
    const minutes = Math.max(1, Math.round((at - now) / 60000));
    if (minutes < 60) return t('{minutes}분 뒤 초기화').replace('{minutes}', minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('{hours}시간 {minutes}분 뒤 초기화').replace('{hours}', hours).replace('{minutes}', minutes % 60);
    return t('{days}일 뒤 초기화').replace('{days}', Math.round(hours / 24));
  }

  const finished = task => task?.lifecycle === 'completed' || task?.awaitingResponse === true;
  const taskKey = task => String(task.taskId || task.analysisId || `${task.observedAt}:${task.request}`);
  const taskTime = task => Number(task.submittedAt) || Date.parse(task.observedAt) || 0;
  const oneLine = value => String(value || '').replace(/<\/?pasted_content[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 80);

  function normalizeState(value, now) {
    const cutoff = now - KEEP_DAYS * DAY;
    const entries = (Array.isArray(value?.entries) ? value.entries : []).filter(entry => entry && typeof entry.key === 'string'
      && typeof entry.terminalId === 'string' && Number(entry.at) >= cutoff && PROVIDERS.includes(entry.provider)).slice(-MAX_ENTRIES)
      .map(entry => ({ terminalId: entry.terminalId, key: entry.key, request: oneLine(entry.request), at: Number(entry.at), provider: entry.provider,
        model: String(entry.model || '').slice(0, 80), effort: String(entry.effort || '').slice(0, 12),
        tokens: Number.isFinite(Number(entry.tokens)) ? Math.max(0, Number(entry.tokens)) : null, summaryTokens: Math.max(0, Number(entry.summaryTokens) || 0) }));
    const marks = {};
    for (const [id, mark] of Object.entries(value?.marks || {})) {
      if (Number.isFinite(Number(mark?.total)) && Number.isFinite(Number(mark?.since))) marks[id] = { total: Number(mark.total), since: Number(mark.since), conversationId: String(mark.conversationId || '') };
    }
    return { entries, marks };
  }

  function createView({ meters, button, sheet, t, esc, providerUsage, save = () => {}, now = Date.now }) {
    let state = normalizeState(null, now());
    let accounts = null, accountsAt = 0, accountsLoading = false, open = false, scope = 'conversation', current = null;
    const icon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4" stroke-linecap="round"/></svg>';
    button.innerHTML = `${icon}<span>${esc(t('토큰 기록'))}</span>`;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');

    function refreshAccounts() {
      if (accountsLoading || typeof providerUsage !== 'function' || now() - accountsAt < ACCOUNT_REFRESH_MS) return;
      accountsLoading = true;
      Promise.resolve(providerUsage()).then(value => { accounts = value?.providers || null; })
        .catch(() => { accounts = accounts || null; })
        .finally(() => { accountsLoading = false; accountsAt = now(); if (current) draw(); });
    }

    // Each finished reply records the conversation tokens used since the
    // previous one. History before Whitebox first saw this conversation is
    // never guessed.
    function observe({ terminalId, provider, activity, tasks }) {
      const total = Number(activity?.usage?.total);
      if (!terminalId || !PROVIDERS.includes(provider) || !Number.isFinite(total)) return false;
      const conversationId = String(activity?.conversationId || '');
      let mark = state.marks[terminalId];
      let changed = false;
      if (!mark || total < mark.total || conversationId && mark.conversationId && conversationId !== mark.conversationId) {
        state.marks[terminalId] = { total, since: now(), conversationId };
        return true;
      }
      const recorded = new Map(state.entries.filter(entry => entry.terminalId === terminalId).map(entry => [entry.key, entry]));
      for (const task of (tasks || []).slice().sort((a, b) => taskTime(a) - taskTime(b))) {
        const key = taskKey(task), existing = recorded.get(key);
        const summaryTokens = Math.max(0, Number(task.analysisUsage?.total) || 0);
        if (existing) {
          if (existing.summaryTokens !== summaryTokens) { existing.summaryTokens = summaryTokens; changed = true; }
          continue;
        }
        if (!finished(task) || taskTime(task) < mark.since) continue;
        const entry = { terminalId, key, request: oneLine(task.request), at: taskTime(task) || now(), provider,
          model: String(activity.model || ''), effort: String(activity.effort || ''), tokens: Math.max(0, total - mark.total), summaryTokens };
        state.entries.push(entry); recorded.set(key, entry);
        mark.total = total; changed = true;
      }
      if (state.entries.length > MAX_ENTRIES) state.entries = state.entries.slice(-MAX_ENTRIES);
      return changed;
    }

    function meterMarkup(provider) {
      const account = accounts?.[provider];
      if (!account?.available) return '';
      const window = account.shortWindow || account.weekly;
      if (!window) return '';
      const pct = Math.round(Number(window.usedPercent) || 0);
      const reset = untilText(window.resetsAt, t, now());
      const mine = current?.provider === provider ? Number(current.activity?.usage?.total) : NaN;
      const usageNote = Number.isFinite(mine) ? t('이 대화 {tokens}').replace('{tokens}', compact(mine)) : t('이 대화에선 안 씀');
      const warn = pct >= 80;
      const foot = warn ? `<span class="wb-usage-warn">${esc(t('한도 임박'))}${reset ? ` · ${esc(reset)}` : ''}</span>` : `${esc(usageNote)}${reset ? ` · ${esc(reset)}` : ''}`;
      return `<div class="wb-usage-meter" data-provider="${provider}" title="${esc(`${providerName(provider)} ${t(account.shortWindow ? '5시간 한도' : '주간 한도')} ${pct}%`)}">
        <div class="wb-usage-meter-top"><span class="wb-usage-name"><i class="wb-usage-dot" data-provider="${provider}"></i>${providerName(provider)}</span><span>${esc(t(account.shortWindow ? '5시간' : '주간'))}</span><b>${pct}%</b></div>
        <div class="wb-usage-bar" data-provider="${provider}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(`${providerName(provider)} ${t('한도 사용률')}`)}"><span style="width:${Math.min(100, Math.max(0, pct))}%"></span></div>
        <div class="wb-usage-foot">${foot}</div></div>`;
    }

    function chipMarkup() {
      const parts = PROVIDERS.map(provider => {
        const account = accounts?.[provider];
        const window = account?.available ? account.shortWindow || account.weekly : null;
        return window ? `<span><i class="wb-usage-dot" data-provider="${provider}"></i><b>${Math.round(Number(window.usedPercent) || 0)}%</b></span>` : '';
      }).filter(Boolean);
      return parts.length ? `<span class="wb-usage-chip" aria-hidden="true">${parts.join('<i class="wb-usage-sep"></i>')}</span>` : '';
    }

    function scopeEntries() {
      const since = now() - 7 * DAY;
      return scope === 'conversation' ? state.entries.filter(entry => entry.terminalId === current?.terminalId)
        : state.entries.filter(entry => entry.at >= since);
    }

    function sheetMarkup() {
      const entries = scopeEntries();
      const sum = provider => entries.filter(entry => entry.provider === provider).reduce((total, entry) => total + (entry.tokens || 0), 0);
      const liveTotal = Number(current?.activity?.usage?.total);
      const totals = {
        claude: scope === 'conversation' && current?.provider === 'claude' && Number.isFinite(liveTotal) ? liveTotal : sum('claude'),
        codex: scope === 'conversation' && current?.provider === 'codex' && Number.isFinite(liveTotal) ? liveTotal : sum('codex'),
        summary: scope === 'conversation' ? (current?.tasks || []).reduce((total, task) => total + (Number(task.analysisUsage?.total) || 0), 0)
          : entries.reduce((total, entry) => total + entry.summaryTokens, 0),
      };
      const days = Array.from({ length: 7 }, (_, index) => {
        const start = new Date(now()); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (6 - index));
        const end = start.getTime() + DAY;
        const inDay = state.entries.filter(entry => entry.at >= start.getTime() && entry.at < end);
        return { label: index === 6 ? t('오늘') : new Intl.DateTimeFormat(document.documentElement.lang || 'ko', { weekday: 'short' }).format(start),
          claude: inDay.filter(entry => entry.provider === 'claude').reduce((total, entry) => total + (entry.tokens || 0), 0),
          codex: inDay.filter(entry => entry.provider === 'codex').reduce((total, entry) => total + (entry.tokens || 0), 0) };
      });
      const peak = Math.max(1, ...days.map(day => day.claude + day.codex));
      const bars = days.map((day, index) => `<div class="wb-usage-col${index === 6 ? ' is-today' : ''}" title="${esc(`${day.label} · Claude ${compact(day.claude)} · Codex ${compact(day.codex)}`)}">
        <i data-provider="claude" style="height:${Math.round(day.claude / peak * 60)}px"></i><i data-provider="codex" style="height:${Math.round(day.codex / peak * 60)}px"></i></div>`).join('');
      const peakEntry = Math.max(1, ...entries.map(entry => entry.tokens || 0));
      const time = value => new Intl.DateTimeFormat(document.documentElement.lang || 'ko', { month: scope === 'conversation' ? undefined : 'numeric', day: scope === 'conversation' ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
      const list = entries.slice().sort((a, b) => b.at - a.at).slice(0, 30).map(entry => `<li class="wb-usage-item">
        <i class="wb-usage-dot" data-provider="${entry.provider}"></i><span class="wb-usage-item-title">${esc(entry.request || t('제목 없는 요청'))}</span>
        <b>${entry.tokens === null ? '—' : esc(compact(entry.tokens))}</b>
        <span class="wb-usage-item-meta">${entry.effort ? `<em>${esc(entry.effort)}</em>` : ''}${esc(time(entry.at))}${entry.model ? ` · ${esc(modelLabel(entry.model))}` : ''}${entry.summaryTokens ? ` · ${esc(t('요약 토큰 {tokens}').replace('{tokens}', compact(entry.summaryTokens)))}` : ''}</span>
        <span class="wb-usage-mini" data-provider="${entry.provider}"><span style="width:${Math.round((entry.tokens || 0) / peakEntry * 100)}%"></span></span></li>`).join('');
      return `<div class="wb-usage-scrim" data-usage-close></div>
        <section class="wb-usage-panel" role="dialog" aria-modal="false" aria-label="${esc(t('토큰 기록'))}">
          <header><h2>${esc(t('토큰 기록'))}</h2>
            <span class="wb-usage-seg" role="tablist">
              <button type="button" role="tab" data-usage-scope="conversation" aria-selected="${scope === 'conversation'}">${esc(t('이 대화'))}</button>
              <button type="button" role="tab" data-usage-scope="week" aria-selected="${scope === 'week'}">${esc(t('최근 7일'))}</button></span>
            <button type="button" class="wb-usage-close" data-usage-close aria-label="${esc(t('토큰 기록 닫기'))}">✕</button></header>
          <div class="wb-usage-totals">
            <div><span><i class="wb-usage-dot" data-provider="claude"></i>${esc(t('Claude 작업'))}</span><b>${esc(compact(totals.claude))}</b></div>
            <div><span><i class="wb-usage-dot" data-provider="codex"></i>${esc(t('Codex 작업'))}</span><b>${esc(compact(totals.codex))}</b></div>
            <div><span><i class="wb-usage-dot" data-provider="summary"></i>${esc(t('요약 분석'))}</span><b>${esc(compact(totals.summary))}</b></div></div>
          <div class="wb-usage-chart"><div class="wb-usage-chart-cap"><span>${esc(t('최근 7일 · AI별'))}</span><span><i class="wb-usage-dot" data-provider="claude"></i>Claude <i class="wb-usage-dot" data-provider="codex"></i>Codex</span></div>
            <div class="wb-usage-bars">${bars}</div><div class="wb-usage-days">${days.map(day => `<span>${esc(day.label)}</span>`).join('')}</div></div>
          <div class="wb-usage-list-cap"><span>${esc(t('요청별 · 최신순'))}</span><span>${esc(t('작업 토큰'))}</span></div>
          ${list ? `<ol class="wb-usage-list">${list}</ol>` : `<p class="wb-usage-empty">${esc(t('아직 기록된 요청이 없어요. 답이 끝날 때마다 여기에 쌓입니다.'))}</p>`}
          <p class="wb-usage-note">${esc(t('작업 토큰은 AI가 이 대화에서 쓴 양(입력·출력·캐시 포함), 요약은 Whitebox가 요약을 만드는 데 쓴 양입니다. 한도 %는 계정 기준이라 다른 대화와 합산됩니다.'))}</p>
        </section>`;
    }

    // The summary view re-renders about once a second; rewrite only on change
    // so an open panel keeps its scroll position and focus.
    let lastMeters = null, lastSheet = null;
    function draw() {
      const metersHtml = `${PROVIDERS.map(meterMarkup).join('')}${chipMarkup()}`;
      if (metersHtml !== lastMeters) { meters.innerHTML = metersHtml; lastMeters = metersHtml; }
      button.setAttribute('aria-expanded', String(open));
      button.classList.toggle('is-open', open);
      sheet.hidden = !open;
      if (!open) { lastSheet = null; return; }
      const sheetHtml = sheetMarkup();
      if (sheetHtml !== lastSheet) {
        const list = sheet.querySelector('.wb-usage-list'), scroll = list?.scrollTop || 0;
        const focused = document.activeElement?.closest?.('[data-usage-scope]')?.dataset.usageScope;
        sheet.innerHTML = sheetHtml; lastSheet = sheetHtml;
        const nextList = sheet.querySelector('.wb-usage-list');
        if (nextList) nextList.scrollTop = scroll;
        if (focused) sheet.querySelector(`[data-usage-scope="${focused}"]`)?.focus({ preventScroll: true });
      }
    }

    function setOpen(value) {
      open = Boolean(value);
      draw();
      if (open) sheet.querySelector('.wb-usage-panel [data-usage-scope][aria-selected="true"]')?.focus({ preventScroll: true });
      else button.focus({ preventScroll: true });
    }

    button.addEventListener('click', () => setOpen(!open));
    sheet.addEventListener('click', event => {
      const target = event.target.closest('[data-usage-close], [data-usage-scope]');
      if (!target) return;
      if (target.hasAttribute('data-usage-close')) { setOpen(false); return; }
      scope = target.dataset.usageScope === 'week' ? 'week' : 'conversation';
      draw();
    });
    sheet.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } });

    return {
      render(next) {
        current = next;
        refreshAccounts();
        if (observe(next)) save();
        draw();
      },
      close: () => { if (open) setOpen(false); },
      serialize: () => ({ entries: state.entries.slice(-MAX_ENTRIES), marks: state.marks }),
      restore(value) { state = normalizeState(value, now()); },
    };
  }

  window.WhiteboxSummaryUsage = { createView, modelLabel, effortLevel };
})();
