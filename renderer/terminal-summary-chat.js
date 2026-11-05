'use strict';

// A chat is a view of one existing AI process, never a replacement shell.
window.WhiteboxSummaryChat = function createSummaryChat(context) {
  const { root, api, t, esc } = context;
  const records = new Map();
  let flushing = false, selected = '', lastMarkup = '', approvalBusy = false;
  const form = root.querySelector('#wbSummaryForm');
  const input = root.querySelector('#wbSummaryInput');
  const list = root.querySelector('#wbSummaryMessages');
  const notice = root.querySelector('#wbSummaryNotice');
  const identity = member => ({ targetCreationId: member.creationId, targetProviderPid: member.providerPid, targetProvider: member.provider });
  const eligible = id => {
    const session = context.session(id), member = context.member(id);
    return Boolean(session?.status === 'running' && member && Date.now() - member.observedAt < 5000
      && member.creationId === session.creationId && member.pid === session.pid
      && member.providerPid > 0 && ['claude', 'codex'].includes(member.provider));
  };
  function record(id) {
    const session = context.session(id);
    if (!session) return null;
    let value = records.get(id);
    if (!value || value.creationId !== session.creationId) {
      value = { id, creationId: session.creationId, mode: 'terminal', draft: '', messages: [] };
      records.set(id, value);
    }
    return value;
  }
  const taskKey = task => String(task.taskId || task.analysisId || `${task.observedAt}:${task.request}`);
  function tasksFor(id) { return context.tasks(id).filter(task => !task.deferred && task.analysisDepth !== 'deferred'); }
  function mergeAnswers(value) {
    for (const task of tasksFor(value.id)) {
      const key = taskKey(task);
      const previous = value.messages.find(message => message.role === 'answer' && message.key === key);
      if (previous) { previous.task = task; continue; }
      const pending = value.messages.find(message => message.role === 'user' && message.state === 'sent'
        && !message.answerKey && message.text.trim() === String(task.request || '').trim() && !message.baseline?.includes(key));
      if (pending) pending.answerKey = key;
      else if (task.request) value.messages.push({ role: 'user', id: `request:${key}`, text: task.request, state: 'sent', answerKey: key });
      const answer = { role: 'answer', id: `answer:${key}`, key, task };
      if (pending) value.messages.splice(value.messages.indexOf(pending) + 1, 0, answer);
      else value.messages.push(answer);
    }
    value.messages = value.messages.slice(-100);
  }
  function fallBack(id, message) {
    const value = record(id);
    if (!value || value.mode !== 'summary') return;
    value.mode = 'terminal';
    context.save();
    context.reveal(id);
    context.report(message);
  }
  function setMode(mode) {
    const id = context.activeId(), value = record(id);
    if (!value || mode === 'summary' && !eligible(id)) return;
    value.mode = mode;
    context.save(); render();
    if (mode === 'summary') input.focus({ preventScroll: true });
  }
  root.querySelectorAll('[data-workspace-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.workspaceMode)));
  input.addEventListener('input', () => {
    const value = record(context.activeId());
    if (value) { value.draft = input.value; context.save(); }
    input.style.height = 'auto'; input.style.height = `${Math.min(180, input.scrollHeight)}px`;
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault(); form.requestSubmit();
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const id = context.activeId(), value = record(id), member = context.member(id), text = input.value.trim();
    if (!value || !text || text.length > 8000 || !eligible(id) || /[\x00-\x08\x0b-\x1f\x7f]/u.test(text)) return;
    if (value.messages.filter(message => message.state === 'queued').length >= 20) return;
    value.messages.push({ id: crypto.randomUUID(), role: 'user', text, state: 'queued', ...identity(member),
      baseline: tasksFor(id).map(taskKey), at: Date.now() });
    value.draft = ''; input.value = ''; input.style.height = 'auto';
    context.save(); render();
    context.refresh().then(flush).catch(error => { notice.textContent = String(error.message || error); });
  });
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-summary-edit], [data-summary-cancel], [data-summary-choice], [data-summary-terminal]');
    if (!button) return;
    if (button.hasAttribute('data-summary-terminal')) { setMode('terminal'); context.reveal(context.activeId()); return; }
    if (button.dataset.summaryChoice) { respond(button.dataset.summaryChoice).catch(error => { notice.textContent = String(error.message || error); }); return; }
    const value = record(context.activeId());
    const message = value?.messages.find(item => item.id === (button.dataset.summaryEdit || button.dataset.summaryCancel));
    if (!message || message.state !== 'queued') return;
    if (button.dataset.summaryEdit) {
      if (value.draft) return;
      value.draft = message.text; input.value = value.draft; input.focus();
    }
    message.state = 'cancelled'; context.save(); render();
  });
  function detectedPrompt(id) {
    return window.WhiteboxTerminalPrompts.detectPendingPrompt(context.snapshot(id).text || '');
  }
  async function respond(choiceId) {
    if (approvalBusy) return;
    const id = context.activeId(), member = context.member(id), prompt = detectedPrompt(id);
    if (!prompt || !eligible(id)) return;
    approvalBusy = true; render();
    try {
      await context.refresh();
      const current = context.member(id);
      if (!eligible(id) || current.creationId !== member.creationId || current.providerPid !== member.providerPid
        || detectedPrompt(id)?.fingerprint !== prompt.fingerprint) throw new Error(t('승인 요청이 바뀌었습니다. 다시 확인해 주세요.'));
      const result = await api.terminalCollaboration({ operation: 'summary-respond', groupId: context.groupId(id), targetId: id,
        ...identity(member), fingerprint: prompt.fingerprint, choiceId });
      if (!result?.ok || result.requiresText) { setMode('terminal'); context.reveal(id); }
      await context.refresh();
    } finally { approvalBusy = false; render(); }
  }
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      for (const value of records.values()) {
        const message = value.messages.find(item => item.state === 'queued');
        if (!message) continue;
        const member = context.member(value.id);
        if (!eligible(value.id)) {
          if (member) { message.state = 'interrupted'; message.error = t('AI 세션이 종료되거나 바뀌었습니다. 자동 전송하지 않았습니다.'); context.save(); }
          continue;
        }
        if (message.targetCreationId !== member.creationId || message.targetProviderPid !== member.providerPid || message.targetProvider !== member.provider) {
          message.state = 'interrupted'; message.error = t('AI 세션이 종료되거나 바뀌었습니다. 자동 전송하지 않았습니다.'); context.save(); continue;
        }
        if (!member.ready || detectedPrompt(value.id)) continue;
        message.state = 'sending'; context.save(); render();
        try {
          const result = await api.terminalCollaboration({ operation: 'summary-send', id: message.id, groupId: context.groupId(value.id),
            targetId: value.id, message: message.text, targetCreationId: message.targetCreationId,
            targetProviderPid: message.targetProviderPid, targetProvider: message.targetProvider });
          if (result?.deferred) { message.state = 'queued'; continue; }
          if (result?.ok && ['running', 'completed'].includes(result.job?.state)) {
            message.state = 'sent'; message.sentAt = result.job.sentAt; context.submitted(result.job);
          } else { message.state = 'interrupted'; message.error = result?.job?.error || t('전송 상태를 확인하지 못했습니다. 터미널을 확인해 주세요.'); }
        } catch (error) {
          // A bridge error can hide an accepted write. Never automatically retry.
          message.state = 'interrupted'; message.error = String(error.message || error);
        } finally { context.save(); render(); }
      }
    } finally { flushing = false; }
  }
  function render() {
    const id = context.activeId(), value = record(id), available = eligible(id), member = context.member(id);
    const stillRunning = member && member.providerPid > 0 && ['claude', 'codex'].includes(member.provider)
      && member.creationId === context.session(id)?.creationId && member.pid === context.session(id)?.pid;
    const summary = value?.mode === 'summary' && stillRunning;
    root.classList.toggle('summary-mode', summary);
    root.querySelector('#wbSummary').hidden = !summary;
    root.querySelector('#wbCanvas').hidden = summary;
    for (const button of root.querySelectorAll('[data-workspace-mode]')) {
      button.disabled = button.dataset.workspaceMode === 'summary' && !available;
      button.setAttribute('aria-pressed', String(button.dataset.workspaceMode === (summary ? 'summary' : 'terminal')));
      button.title = button.disabled ? t('이 터미널에서 AI를 먼저 실행해 주세요.') : button.textContent;
    }
    if (value?.mode === 'summary' && member && !stillRunning) {
      fallBack(id, t('AI 세션이 종료되었습니다. 터미널에서 확인해 주세요.')); return;
    }
    if (!summary) return;
    const review = context.review(id);
    if (review?.state === 'error') {
      fallBack(id, t('요약하지 못했습니다. 터미널에서 원문을 확인해 주세요.')); return;
    }
    mergeAnswers(value);
    root.querySelector('#wbSummaryTarget').textContent = context.label(id);
    root.querySelector('#wbSummaryProvider').textContent = member.provider === 'claude' ? 'Claude' : 'Codex';
    if (selected !== `${id}:${value.creationId}`) {
      selected = `${id}:${value.creationId}`; input.value = value.draft; notice.textContent = ''; lastMarkup = '';
    }
    const states = { queued: t('전송 대기'), sending: t('전송 중…'), sent: t('전송됨'), cancelled: t('전송 취소'), interrupted: t('전송 확인 필요') };
    let markup = value.messages.map(message => {
      if (message.role === 'answer') {
        const task = message.task;
        return `<article class="wb-summary-answer"><div class="wb-summary-label">${esc(t('요약'))}</div>${window.WhiteboxReviewDecision.render(task, { t, esc, taskKey: message.key }) || `<p>${esc(task.actual || task.explanation || task.summary || '')}</p>`}</article>`;
      }
      return `<article class="wb-summary-user"><div class="wb-summary-label">${esc(t('내 요청'))} <span>${esc(states[message.state] || '')}</span></div><p>${esc(message.text)}</p>${message.error ? `<p class="wb-summary-delivery-error">${esc(message.error)}</p><button data-summary-terminal>${esc(t('터미널에서 확인'))}</button>` : ''}${message.state === 'queued' ? `<div class="wb-summary-queue-actions"><button data-summary-edit="${esc(message.id)}" ${value.draft ? 'disabled' : ''}>${esc(t('수정'))}</button><button data-summary-cancel="${esc(message.id)}">${esc(t('취소'))}</button></div>` : ''}</article>`;
    }).join('');
    if (!markup) markup = `<div class="wb-summary-empty"><span>${esc(t('이해 · 검토'))}</span><h1>${esc(t('요약을 읽고, 다음 요청을 이어가세요.'))}</h1><p>${esc(t('같은 AI 세션에서 대화를 이어갑니다.'))}</p></div>`;
    const prompt = detectedPrompt(id);
    if (prompt) {
      const raw = context.snapshot(id).text || '';
      markup += `<article class="wb-summary-prompt" role="group" aria-label="${esc(t('응답이 필요합니다'))}"><h2>${esc(prompt.question)}</h2><pre>${esc(raw.slice(-8000))}</pre><div>${prompt.choices.map(choice => `<button data-summary-choice="${esc(choice.id)}" ${approvalBusy ? 'disabled' : ''}>${esc(choice.label)}</button>`).join('')}</div></article>`;
    } else if (member.activity?.state === 'waiting') {
      markup += `<article class="wb-summary-prompt"><p>${esc(t('터미널에서 응답이 필요합니다.'))}</p><button data-summary-terminal>${esc(t('터미널에서 확인'))}</button></article>`;
    }
    const pending = ['awaiting-answer', 'collecting', 'reviewing'].includes(review?.state);
    if (pending || member.activity?.state === 'working') markup += `<p class="wb-summary-working" role="status">${esc(t(review?.state === 'reviewing' ? '요약 중…' : 'AI가 작업 중입니다.'))}</p>`;
    if (markup !== lastMarkup) {
      const nearBottom = list.scrollHeight - list.clientHeight - list.scrollTop < 80;
      const opened = [...list.querySelectorAll('details')].map((node, index) => node.open ? index : -1);
      list.innerHTML = markup; lastMarkup = markup;
      list.querySelectorAll('details').forEach((node, index) => { node.open = opened.includes(index); });
      if (nearBottom) list.scrollTop = list.scrollHeight;
    }
    input.disabled = !available;
    root.querySelector('#wbSummarySend').disabled = !available;
    root.querySelector('#wbSummaryComposerHint').textContent = t(member.ready ? 'Enter 전송 · Shift+Enter 줄바꿈' : '작업 중 보낸 요청은 전송 대기로 보관합니다.');
  }
  function observe(jobs = []) {
    for (const value of records.values()) for (const message of value.messages) {
      const job = jobs.find(item => item.operation === 'summary' && item.id === message.id);
      if (job && ['failed', 'interrupted'].includes(job.state)) { message.state = 'interrupted'; message.error = job.error; }
    }
    render(); flush().catch(error => { notice.textContent = String(error.message || error); });
  }
  return {
    render, observe, setMode, eligible,
    needsReview: id => {
      const value = records.get(id);
      if (!value) return false;
      mergeAnswers(value);
      return value.mode === 'summary' || value.messages.some(message => message.state === 'sent' && !message.answerKey);
    },
    serialize: () => [...records.values()].slice(-100).map(value => ({ ...value, messages: value.messages.slice(-100) })),
    restore(values) {
      for (const item of (Array.isArray(values) ? values : []).slice(-100)) {
        const session = context.session(item?.id);
        if (!session || item.creationId !== session.creationId) continue;
        const messages = (Array.isArray(item.messages) ? item.messages : []).filter(message => message && typeof message.id === 'string'
          && (message.role === 'user' && typeof message.text === 'string' && message.text.length <= 8000
          || message.role === 'answer' && message.task && typeof message.task === 'object')).slice(-100);
        for (const message of messages) if (['queued', 'sending'].includes(message.state)) {
          message.state = 'interrupted'; message.error = t('앱이 다시 시작되었습니다. 전송 상태를 확인해 주세요.');
        }
        records.set(item.id, { id: item.id, creationId: item.creationId, mode: item.mode === 'summary' ? 'summary' : 'terminal',
          draft: String(item.draft || '').slice(0, 8000), messages });
      }
    },
    forget(id) { records.delete(id); },
  };
};
