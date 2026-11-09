'use strict';

// A chat is a view of one existing AI process, never a replacement shell.
window.WhiteboxSummaryChat = function createSummaryChat(context) {
  const { root, api, t, esc } = context;
  const ui = window.WhiteboxWorkspaceUI;
  const $ = selector => root.querySelector(selector);
  const records = new Map();
  let flushing = false, selected = '', lastMarkup = '', approvalBusy = false, retryBusy = false, stopBusy = false, modeKey = '', sendKey = '', stopKey = '', thinkingLabel = '';
  const actionHosts = new Set();
  const form = root.querySelector('#wbSummaryForm');
  const input = root.querySelector('#wbSummaryInput');
  const list = root.querySelector('#wbSummaryMessages');
  const transcript = root.querySelector('#wbSummaryTranscript');
  const notice = root.querySelector('#wbSummaryNotice');
  const jobsById = new Map();
  const CAPTURE_GRACE_MS = 15000;
  // One 2048 board is shared by every terminal and session, so play continues
  // when switching conversations or after an AI session restarts.
  let sharedGame = null;
  const game = window.Whitebox2048.createView({ root: root.querySelector('#wbSummaryGame'), t, esc,
    read: () => record(context.activeId()), save: () => context.save(), visibility: () => context.gameVisibility?.() || 'always', behavior: () => context.gameBehavior?.() || 'auto-collapse',
    store: { get: () => sharedGame, set: (_, value) => { sharedGame = value; } } });
  const adoptGame = value => {
    const restored = window.Whitebox2048.restore(value);
    if (!restored) return;
    // An untouched fresh board loses nothing when a saved game replaces it.
    if (!sharedGame || sharedGame.score === 0 && restored.score > 0) sharedGame = { ...restored, best: Math.max(restored.best, sharedGame?.best || 0) };
    else sharedGame.best = Math.max(sharedGame.best, restored.best);
  };
  const identity = member => ({ targetCreationId: member.creationId, targetProviderPid: member.providerPid, targetProvider: member.provider });
  function control(label, attributes, disabled = false, variant = 'ghost', translate = true) {
    return `<span data-summary-control data-variant="${variant}"><button type="button" ${attributes} ${disabled ? 'disabled' : ''}>${esc(translate ? t(label) : label)}</button></span>`;
  }
  function mountControls() {
    if (!ui?.actionButton) return;
    for (const host of transcript.querySelectorAll('[data-summary-control]')) {
      const original = host.querySelector('button');
      const attributes = [...original.attributes].filter(attribute => attribute.name.startsWith('data-summary-'));
      const disabled = original.disabled;
      ui.actionButton(host, { label: original.textContent, variant: host.dataset.variant });
      const button = host.querySelector('button');
      for (const attribute of attributes) button.setAttribute(attribute.name, attribute.value);
      button.disabled = disabled;
      actionHosts.add(host);
    }
  }
  function renderMode(summary, available) {
    const host = $('.wb-mode-switch'), key = JSON.stringify([summary, available, t('터미널'), t('요약')]);
    if (host && ui?.choices && key !== modeKey) {
      ui.choices(host, { value: summary ? 'summary' : 'terminal', label: t('작업 모드'),
        options: [{ value: 'terminal', label: t('터미널') }, { value: 'summary', label: t('요약'), disabled: !available }],
        onChange: setMode });
      host.removeAttribute('role'); host.removeAttribute('aria-label');
      host.querySelectorAll('[role="radio"]').forEach((button, index) => { button.dataset.workspaceMode = index ? 'summary' : 'terminal'; });
      modeKey = key;
    }
    for (const button of root.querySelectorAll('[data-workspace-mode]')) {
      button.disabled = button.dataset.workspaceMode === 'summary' && !available;
      button.setAttribute('aria-pressed', String(button.dataset.workspaceMode === (summary ? 'summary' : 'terminal')));
      button.title = button.disabled ? t('이 터미널에서 AI를 먼저 실행해 주세요.') : button.textContent;
    }
  }
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
  const nonTask = request => window.WhiteboxTerminalReviewTurns?.isNonTaskRequest(request);
  function tasksFor(id) { return context.tasks(id).filter(task => !nonTask(task.request)
    && (task.lifecycle === 'completed' || !task.deferred && task.analysisDepth !== 'deferred')); }
  // Answers are never stored here: each render derives them from the same
  // review results the terminal-mode panel shows. Summary keeps only the
  // user's own sends (queue, delivery state, links to the turn they started).
  const ownSend = message => message.role === 'user' && !String(message.id).startsWith('request:');
  function mergeAnswers(value) {
    // A slash control typed here must still be delivered; it is dropped from
    // the transcript (and never awaits a summary) once it has been sent.
    const own = value.messages.filter(message => ownSend(message)
      && (['queued', 'sending'].includes(message.state) || !nonTask(message.text)));
    const derived = [];
    for (const task of tasksFor(value.id)) {
      const key = taskKey(task);
      let mine = own.find(message => message.answerKey === key);
      if (!mine) {
        // A review event can arrive before the send acknowledgement; link the
        // turn once the outgoing request becomes `sent`.
        mine = own.find(message => message.state === 'sent' && !message.answerKey && (task.submissionId ? task.submissionId === message.id
          : message.text.trim() === String(task.request || '').trim() && !message.baseline?.includes(key)));
        if (mine) mine.answerKey = key;
      }
      if (!mine && task.request) derived.push({ role: 'user', id: `request:${key}`, text: task.request, state: 'sent', answerKey: key,
        at: Number(task.submittedAt) || Date.parse(task.observedAt) || 0 });
      derived.push({ role: 'answer', id: `answer:${key}`, key, task });
    }
    value.messages = chronological([...own, ...derived]).slice(-100);
  }
  // Saved transcripts can hold turns out of order (imported history, restarts,
  // a send acknowledged after a later import). Show each request with its
  // answer in submission time order; unsent messages stay last in send order.
  const sentTime = message => Number(message.sentAt || message.at) || 0;
  function chronological(messages) {
    const units = [], claimed = new Set();
    for (const message of messages) {
      if (message.role === 'answer') {
        if (claimed.has(message)) continue;
        units.push({ items: [message], time: Number(message.task?.submittedAt) || Date.parse(message.task?.observedAt) || 0 });
        continue;
      }
      const answers = message.answerKey ? messages.filter(item => item.role === 'answer' && item.key === message.answerKey && !claimed.has(item)) : [];
      answers.forEach(item => claimed.add(item));
      units.push({ items: [message, ...answers], time: ['queued', 'sending'].includes(message.state) ? Infinity : sentTime(message) });
    }
    // An unknown time keeps the unit next to the one before it.
    let previous = 0;
    for (const unit of units) { if (!unit.time) unit.time = previous; previous = unit.time; }
    return units.map((unit, index) => ({ ...unit, index })).sort((a, b) => a.time - b.time || a.index - b.index).flatMap(unit => unit.items);
  }
  function fallBack(id, message) {
    const value = record(id);
    if (!value || value.mode !== 'summary') return;
    value.mode = 'terminal';
    for (const pending of value.messages.filter(item => item.state === 'queued')) { pending.state = 'interrupted'; pending.error = message; }
    context.save();
    context.reveal(id);
    context.report(message, id);
  }
  function setMode(mode) {
    const id = context.activeId(), value = record(id);
    if (!value || mode === 'summary' && !eligible(id)) return;
    const opening = value.mode !== 'summary' && mode === 'summary';
    value.mode = mode;
    context.save(); render();
    if (mode === 'summary') {
      input.focus({ preventScroll: true });
      // Choosing summary is explicit intent to summarize the existing reply.
      // Passive observation still leaves completed historical turns untouched.
      if (opening && !tasksFor(id).length && context.member(id)?.ready) {
        context.startSummary?.().catch(error => { notice.textContent = String(error.message || error); });
      }
    }
  }
  root.querySelectorAll('[data-workspace-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.workspaceMode)));
  root.querySelector('#wbSummaryStopHost').addEventListener('click', event => { if (event.target.closest('button')) stop(); });
  // Slash-command list: typing "/" offers the provider's commands (built-in,
  // custom, skills, plugins) like the CLI does. Names and descriptions only.
  const commandList = root.querySelector('#wbSummaryCommands');
  const commandCatalog = new Map();
  const sourceLabel = { builtin: '내장', user: '사용자', project: '프로젝트', skill: '스킬', plugin: '플러그인' };
  let commandMatches = [], commandIndex = 0, commandQuery = null;
  function commandPrefix() {
    const match = input.value.match(/^\/([\w:.-]*)$/u);
    return match ? match[1] : null;
  }
  function catalogFor(id) {
    const provider = context.member(id)?.provider;
    if (!provider || typeof api?.slashCommands !== 'function') return Promise.resolve([]);
    const key = `${id}:${provider}`, cached = commandCatalog.get(key);
    if (cached?.promise) return cached.promise;
    if (cached && Date.now() - cached.at < 60000) return Promise.resolve(cached.items);
    const promise = Promise.resolve(api.slashCommands({ id, provider })).then(items => {
      const list = (Array.isArray(items) ? items : []).filter(item => typeof item?.name === 'string' && /^[\w:.-]+$/u.test(item.name)).slice(0, 400);
      commandCatalog.set(key, { at: Date.now(), items: list }); return list;
    }).catch(() => { commandCatalog.delete(key); return []; });
    commandCatalog.set(key, { at: 0, items: [], promise });
    return promise;
  }
  function closeCommands() { commandQuery = null; commandMatches = []; commandList.hidden = true; commandList.innerHTML = ''; }
  function renderCommands() {
    commandList.innerHTML = commandMatches.map((item, index) => `<li role="option" data-command-index="${index}" aria-selected="${index === commandIndex}"><code>/${esc(item.name)}</code><span>${esc(item.description || '')}</span><small>${esc(t(sourceLabel[item.source] || ''))}</small></li>`).join('')
      + `<li class="wb-summary-commands-hint" aria-hidden="true"><small>${esc(t('↑↓ 선택 · Tab/Enter 입력 · Esc 닫기'))}</small></li>`;
    commandList.hidden = false;
    commandList.querySelector('[aria-selected=true]')?.scrollIntoView?.({ block: 'nearest' });
  }
  async function updateCommands() {
    const query = commandPrefix();
    if (query === null) { closeCommands(); return; }
    const items = await catalogFor(context.activeId());
    if (commandPrefix() !== query) return;
    const lower = query.toLowerCase();
    const starts = items.filter(item => item.name.toLowerCase().startsWith(lower));
    const contains = items.filter(item => !item.name.toLowerCase().startsWith(lower) && item.name.toLowerCase().includes(lower));
    commandMatches = [...starts, ...contains].slice(0, 12);
    if (!commandMatches.length) { closeCommands(); return; }
    if (commandQuery !== query) commandIndex = 0;
    commandQuery = query;
    renderCommands();
  }
  function pickCommand(index) {
    const item = commandMatches[index];
    if (!item) return;
    input.value = `/${item.name} `;
    input.dispatchEvent(new Event('input'));
    input.focus({ preventScroll: true });
    input.setSelectionRange?.(input.value.length, input.value.length);
  }
  commandList.addEventListener('mousedown', event => event.preventDefault());
  commandList.addEventListener('click', event => {
    const item = event.target.closest('[data-command-index]');
    if (item) pickCommand(Number(item.dataset.commandIndex));
  });
  input.addEventListener('input', () => {
    const value = record(context.activeId());
    if (value) { value.draft = input.value; context.save(); }
    input.style.height = 'auto'; input.style.height = `${Math.min(180, input.scrollHeight)}px`;
    updateCommands().catch(() => closeCommands());
  });
  input.addEventListener('blur', () => closeCommands());
  input.addEventListener('keydown', event => {
    if (!commandList.hidden && commandMatches.length && !event.isComposing && event.keyCode !== 229) {
      const current = commandMatches[commandIndex];
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        commandIndex = (commandIndex + (event.key === 'ArrowDown' ? 1 : commandMatches.length - 1)) % commandMatches.length;
        renderCommands(); return;
      }
      if (event.key === 'Escape') { event.preventDefault(); closeCommands(); return; }
      if (event.key === 'Tab' || event.key === 'Enter' && !event.shiftKey && current?.name !== commandQuery) {
        event.preventDefault(); pickCommand(commandIndex); return;
      }
      if (event.key === 'Enter') closeCommands(); // An exactly typed command sends as usual.
    }
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
  root.querySelector('#wbSummary').addEventListener('click', event => {
    const button = event.target.closest('[data-summary-edit], [data-summary-cancel], [data-summary-send-now], [data-summary-choice], [data-summary-terminal], [data-summary-copy], [data-summary-retry]');
    if (!button) return;
    if (button.hasAttribute('data-summary-retry')) {
      if (retryBusy || !context.startSummary) return;
      retryBusy = true; render();
      context.startSummary().catch(error => { notice.textContent = String(error.message || error); })
        .finally(() => { retryBusy = false; render(); });
      return;
    }
    if (button.hasAttribute('data-summary-copy')) {
      const text = button.closest('.wb-summary-answer')?.querySelector('.wb-summary-answer-body')?.innerText;
      if (text) api.writeClipboard(text).then(() => { notice.textContent = t('요약을 복사했어요.'); })
        .catch(error => { notice.textContent = String(error.message || error); });
      return;
    }
    if (button.hasAttribute('data-summary-terminal')) { setMode('terminal'); context.reveal(context.activeId()); return; }
    if (button.dataset.summaryChoice) { respond(button.dataset.summaryChoice).catch(error => { notice.textContent = String(error.message || error); }); return; }
    const value = record(context.activeId());
    const message = value?.messages.find(item => item.id === (button.dataset.summaryEdit || button.dataset.summaryCancel || button.dataset.summarySendNow));
    if (!message || message.state !== 'queued') return;
    if (button.dataset.summarySendNow) {
      sendNow(value, message).catch(error => { notice.textContent = String(error.message || error); });
      return;
    }
    if (button.dataset.summaryEdit) {
      if (value.draft) return;
      value.draft = message.text; input.value = value.draft; input.focus();
    }
    message.state = 'cancelled'; context.save(); render();
  });
  async function stop() {
    const id = context.activeId(), value = record(id), member = context.member(id);
    if (stopBusy || !value || !eligible(id)) return;
    stopBusy = true; render();
    try {
      const result = await api.terminalCollaboration({ operation: 'summary-stop', groupId: context.groupId(id), targetId: id, ...identity(member) });
      if (!result?.ok) throw new Error(t('요청을 멈추지 못했습니다. 터미널을 확인해 주세요.'));
      const stopped = new Set(result.stopped || []);
      // Requests typed in the terminal have no job; stop the newest unanswered one.
      const latest = [...value.messages].reverse().find(message => message.role === 'user' && message.state === 'sent' && message.targetCreationId);
      for (const message of value.messages) if (message.role === 'user' && (stopped.has(message.id) || message === latest && !message.replyCaptured)) {
        message.state = 'stopped'; message.replyCaptured = true; delete message.error;
      }
      context.interrupted?.(id);
      notice.textContent = t('요청을 멈췄어요.');
      context.save();
      await context.refresh();
    } catch (error) { notice.textContent = String(error.message || error); }
    finally { stopBusy = false; render(); }
  }
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
  async function deliver(value, message, sendNow = false) {
    const result = await api.terminalCollaboration({ operation: 'summary-send', id: message.id, groupId: context.groupId(value.id),
      targetId: value.id, message: message.text, targetCreationId: message.targetCreationId,
      targetProviderPid: message.targetProviderPid, targetProvider: message.targetProvider, sendNow });
    if (result?.deferred) {
      message.state = 'queued';
      if (sendNow) notice.textContent = t('터미널의 입력 상태를 확인한 뒤 다시 전송해 주세요.');
    } else if (result?.ok && ['running', 'completed'].includes(result.job?.state)) {
      message.state = 'sent'; message.sentAt = result.job.sentAt; context.submitted(result.job);
    } else { message.state = 'interrupted'; message.error = result?.job?.error || t('전송 상태를 확인하지 못했습니다. 터미널을 확인해 주세요.'); }
  }
  async function sendNow(value, message) {
    // Reserve before refreshing so polling, double clicks and automatic flush
    // cannot dispatch the same queue item concurrently.
    message.state = 'sending'; context.save(); render();
    try {
      await context.refresh();
      const member = context.member(value.id);
      if (!eligible(value.id) || member.creationId !== message.targetCreationId
        || member.providerPid !== message.targetProviderPid || member.provider !== message.targetProvider) {
        throw new Error(t('AI 세션이 종료되거나 바뀌었습니다. 자동 전송하지 않았습니다.'));
      }
      await deliver(value, message, true);
    } catch (error) {
      message.state = 'interrupted'; message.error = String(error.message || error);
    } finally { context.save(); render(); }
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
        mergeAnswers(value);
        if (!member.ready || detectedPrompt(value.id)) continue;
        // Archive each completed reply in the reviewer before replacing the
        // observed turn. Model analysis may finish later or be deferred; it
        // must not hold the user's next request indefinitely.
        let waiting = false;
        for (const sent of value.messages.filter(item => item.state === 'sent' && item.targetCreationId && !item.replyCaptured)) {
          const job = jobsById.get(sent.id);
          if (job?.state !== 'completed') { waiting = true; break; }
          try {
            // The backend already confirmed this exact reply finished. Archiving
            // it is best effort and must not hold the next request forever.
            const settled = Number(job.finishedAt) > 0 && Date.now() - job.finishedAt > CAPTURE_GRACE_MS;
            if (!await context.captureReply(job) && !settled) { waiting = true; break; }
            sent.replyCaptured = true;
            context.save();
          } catch (error) { notice.textContent = String(error.message || error); waiting = true; break; }
        }
        if (waiting) continue;
        // Capturing evidence is asynchronous: recheck the process and frame
        // before asking the guarded backend to send.
        if (!eligible(value.id) || !context.member(value.id)?.ready || message.state !== 'queued') continue;
        message.state = 'sending'; context.save(); render();
        try {
          await deliver(value, message);
        } catch (error) {
          // A bridge error can hide an accepted write. Never automatically retry.
          message.state = 'interrupted'; message.error = String(error.message || error);
        } finally { context.save(); render(); }
      }
    } finally { flushing = false; }
  }
  function renderProgress(value, member, review, prompt) {
    const failure = window.WhiteboxReviewDecision.reviewFailure(review);
    const users = value.messages.filter(message => message.role === 'user' && ['sent', 'sending', 'interrupted', 'stopped'].includes(message.state));
    // Imported historical requests may arrive later than a user's new send.
    // Follow submission identity/time, not the last rendered bubble.
    const outgoing = users.filter(message => message.targetCreationId)
      .reduce((latest, message) => !latest || sentTime(message) >= sentTime(latest) ? message : latest, null);
    const preview = review?.preview;
    const current = preview && (users.find(message => preview.submissionId === message.id || preview.taskId && preview.taskId === message.answerKey)
      || { id: preview.submissionId || `request:${preview.taskId}`, answerKey: preview.taskId, state: 'sent', at: preview.submittedAt });
    const sent = outgoing && !(preview?.submittedAt > (outgoing.sentAt || outgoing.at || 0)) ? outgoing
      : current || outgoing || [...users].sort((a, b) => (a.at || 0) - (b.at || 0)).at(-1);
    const task = value.messages.find(message => message.role === 'answer' && message.key === sent?.answerKey)?.task;
    const job = jobsById.get(sent?.id);
    const matchesPreview = !preview || !sent || preview.submissionId === sent.id || Boolean(task?.taskId && preview.taskId === task.taskId);
    const matchesAnalysis = review?.analysisTaskId ? review.analysisTaskId === task?.taskId
      || matchesPreview && review.analysisTaskId === preview?.taskId : matchesPreview;
    const needsResponse = Boolean(prompt || member.activity?.state === 'waiting');
    const working = member.activity?.state === 'working';
    const stopped = sent?.state === 'stopped';
    const interrupted = stopped || sent?.state === 'interrupted' || task?.lifecycle === 'interrupted';
    const analyzing = !interrupted && matchesAnalysis && review?.state === 'reviewing';
    const collecting = !interrupted && matchesAnalysis && review?.state === 'collecting';
    const backoff = collecting && review?.retryAt > Date.now();
    // A reply that ends by asking the user something is finished too: the
    // review keeps that turn open for the answer, but the AI is not replying.
    const finished = item => item?.lifecycle === 'completed' || item?.awaitingResponse === true;
    const replyDone = !working && (job?.state === 'completed' || finished(task) || matchesPreview && finished(preview));
    const awaiting = !interrupted && !replyDone && (matchesPreview && review?.state === 'awaiting-answer'
      || sent?.state === 'sending' || sent?.state === 'sent' && !task && job?.state !== 'completed');
    const deferred = Boolean(task?.deferred || task?.analysisDepth === 'deferred');
    const summaryDone = Boolean(task && task.analysisLifecycle !== 'in-progress' && !deferred && !analyzing && !collecting && !awaiting && !working && !interrupted
      && (!failure || failure.kind === 'reanalysis' && failure.retainedLifecycle === 'completed')
      && !needsResponse && (!task.lifecycle || finished(task)));
    const loading = !needsResponse && !interrupted && (analyzing || working || awaiting);
    const label = analyzing ? '요약 중…' : working ? 'AI가 작업 중입니다.' : 'AI 답변을 기다리고 있어요';
    $('#wbSummaryWorking').hidden = !loading;
    if (loading) {
      if (t(label) !== thinkingLabel) {
        if (ui?.thinking) ui.thinking($('#wbSummaryThinking'), t(label));
        else $('#wbSummaryThinking').textContent = t(label);
        thinkingLabel = t(label);
      }
      $('#wbSummaryWorkingDescription').textContent = t(analyzing && replyDone
        ? 'AI 답변은 도착했어요. 요청과 결과를 비교해 요약으로 정리하고 있어요.'
        : '작업 중 보낸 요청은 전송 대기로 보관합니다.');
    } else if (thinkingLabel) { ui?.clear?.($('#wbSummaryThinking')); thinkingLabel = ''; }
    let title = '다음 요청을 입력하세요.', description = '같은 AI 세션에서 대화를 이어갑니다.';
    if (needsResponse) { title = '응답이 필요합니다'; description = '터미널에서 응답이 필요합니다.'; }
    else if (failure) { title = failure.title; description = failure.description; }
    else if (stopped) { title = '요청을 멈췄어요'; description = '다음 요청을 바로 이어갈 수 있어요.'; }
    else if (interrupted) { title = '요청이 중단됐어요'; description = '터미널에서 수행 기록을 확인한 뒤 다음 요청을 이어가세요.'; }
    else if (working) { title = 'AI가 작업 중입니다.'; description = '작업 중 보낸 요청은 전송 대기로 보관합니다.'; }
    else if (summaryDone) { title = '답변과 요약이 도착했어요'; description = '다음 요청을 바로 이어갈 수 있어요.'; }
    else if (backoff) { title = '분석 재시도 대기'; description = '사용 한도가 풀리면 분석을 다시 시도합니다.'; }
    else if (analyzing) { title = replyDone ? '답변은 완료, 요약은 정리 중' : '작업 내용을 분석 중입니다.'; description = '새로운 결과가 도착하면 요약을 이어서 정리합니다.'; }
    else if (replyDone && deferred) { title = '답변 완료 · 분석 대기'; description = '결과를 판단할 구체적인 내용이 아직 부족해요.'; }
    else if (replyDone || collecting) { title = replyDone ? '답변 완료 · 분석 대기' : '분석 대기'; description = '새로운 결과가 도착하면 요약을 이어서 정리합니다.'; }
    else if (awaiting) { title = 'AI 답변을 기다리고 있어요'; description = '같은 AI 세션에서 대화를 이어갑니다.'; }
    $('#wbSummaryStateTitle').textContent = t(title);
    $('#wbSummaryStateDescription').textContent = t(description);
    $('#wbSummaryStateTitle').dataset.state = failure || interrupted ? 'warning' : needsResponse ? 'waiting' : summaryDone ? 'done' : 'working';
    const replyState = needsResponse ? '응답 필요' : stopped ? '멈춤' : interrupted ? '중단됨' : replyDone ? '완료' : working ? '작업 중' : sent || awaiting ? '대기 중' : '—';
    // Same live reviewer wording as terminal mode, so analysis never looks stalled.
    const live = review?.state === 'reviewing' ? review.phase === 'evidence' ? '근거 준비 중…' : '분석중…'
      : review?.state === 'awaiting-answer' && (working || awaiting) ? '작업 관찰 중' : '';
    const reviewState = failure ? summaryDone ? '기존 검토 완료' : '추가 검토 필요'
      : interrupted ? '중단됨' : summaryDone ? '완료' : backoff ? '분석 재시도 대기' : analyzing && replyDone ? '정리 중' : live
        || (deferred || collecting || replyDone ? '분석 대기' : '대기 중');
    $('#wbSummaryReplyState').textContent = t(replyState);
    $('#wbSummaryReplyState').dataset.state = interrupted ? 'warning' : needsResponse ? 'waiting' : replyDone ? 'done' : 'working';
    $('#wbSummaryReviewState').textContent = t(reviewState);
    $('#wbSummaryReviewState').dataset.state = summaryDone ? 'done' : 'working';
    const queueCount = value.messages.filter(message => message.state === 'queued').length;
    $('#wbSummaryQueueRow').hidden = queueCount === 0;
    $('#wbSummaryQueueCount').textContent = String(queueCount);
    const done = [sent?.state === 'sent', replyDone, summaryDone];
    root.querySelectorAll('[data-summary-step]').forEach((step, index) => {
      step.dataset.state = done[index] ? 'done' : index === done.findIndex(value => !value) ? 'current' : 'pending';
      step.querySelector('b').textContent = done[index] ? '✓' : String(index + 1);
      if (step.dataset.state === 'current') step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    });
    const canStop = !needsResponse && !interrupted && !replyDone && (working || awaiting) && eligible(value.id);
    const nextStopKey = JSON.stringify([t('멈추기'), stopBusy]);
    if (ui?.actionButton && nextStopKey !== stopKey) {
      ui.actionButton($('#wbSummaryStopHost'), { label: `${t('멈추기')} ■`, variant: 'secondary' });
      $('#wbSummaryStopHost button').id = 'wbSummaryStop'; stopKey = nextStopKey;
    }
    $('#wbSummaryStopHost').hidden = !canStop;
    $('#wbSummaryStop').disabled = stopBusy;
    $('#wbSummaryNext').hidden = !summaryDone;
    $('#wbSummaryNextText').textContent = task?.content?.nextAction?.text || task?.content?.handoff?.priority?.text
      || task?.decision?.action?.text || task?.nextStep || t('변경 내용을 확인한 뒤, 이 대화에서 다음 작업을 이어가세요.');
    // Fold the game only once the summary itself is done, not at reply arrival.
    game.render({ waiting: analyzing && !needsResponse, completed: summaryDone, replyKey: summaryDone ? sent?.id || task?.taskId || preview?.taskId : null });
  }
  function render() {
    const id = context.activeId(), value = record(id), available = eligible(id), member = context.member(id);
    const stillRunning = member && member.providerPid > 0 && ['claude', 'codex'].includes(member.provider)
      && member.creationId === context.session(id)?.creationId && member.pid === context.session(id)?.pid;
    const summary = value?.mode === 'summary' && stillRunning;
    root.classList.toggle('summary-mode', summary);
    root.querySelector('#wbSummary').hidden = !summary;
    root.querySelector('#wbCanvas').hidden = summary;
    renderMode(summary, available);
    if (value?.mode === 'summary' && member && !stillRunning) {
      fallBack(id, t('AI 세션이 종료되었습니다. 터미널에서 확인해 주세요.')); return;
    }
    if (!summary) {
      root.classList.remove('summary-sidebar-open');
      if (thinkingLabel) { ui?.clear?.($('#wbSummaryThinking')); thinkingLabel = ''; }
      return;
    }
    const review = context.review(id);
    const retainedFailure = window.WhiteboxReviewDecision.reviewFailure(review);
    if (review?.state === 'error' && !retainedFailure) {
      fallBack(id, t('요약하지 못했습니다. 터미널에서 원문을 확인해 주세요.')); return;
    }
    mergeAnswers(value);
    root.querySelector('#wbSummaryTarget').textContent = context.title?.(id) || context.label(id);
    root.querySelector('#wbSummaryTarget').title = context.label(id);
    root.querySelector('#wbSummaryProvider').textContent = member.provider === 'claude' ? 'Claude' : 'Codex';
    $('#wbSummaryRailProvider').textContent = member.provider.toUpperCase();
    $('#wbSummaryConnection').dataset.connected = String(available);
    $('#wbSummaryConnectionState').textContent = t(available ? '같은 대화에 연결됨' : '연결 확인 중');
    if (selected !== `${id}:${value.creationId}`) {
      selected = `${id}:${value.creationId}`; input.value = value.draft; notice.textContent = ''; lastMarkup = ''; closeCommands();
    }
    const states = { queued: t('전송 대기'), sending: t('전송 중…'), sent: t('전송됨'), cancelled: t('전송 취소'), interrupted: t('전송 확인 필요'), stopped: t('멈춤') };
    let markup = value.messages.map(message => {
      if (message.role === 'answer') {
        const task = message.task;
        const retained = window.WhiteboxReviewDecision.matchesRetainedAnalysis(task, retainedFailure);
        return `<article class="wb-summary-answer"><div class="wb-summary-answer-heading"><span class="wb-summary-answer-mark" aria-hidden="true">✳</span><span>${esc(t('Whitebox 요약'))}</span></div>${retained ? `<div class="wb-summary-retained-notice" data-retained-analysis><strong>${esc(t(retainedFailure.title))}</strong><p>${esc(t(retainedFailure.description))}</p>${review.message ? `<details><summary>${esc(t('실패 상세'))}</summary><p>${esc(review.message)}</p></details>` : ''}${control('다시 검토', 'data-summary-retry', retryBusy, 'secondary')}</div>` : ''}<div class="wb-summary-answer-body">${window.WhiteboxReviewDecision.render(task, { t, esc, taskKey: message.key }) || `<p class="wb-summary-answer-fallback">${esc(task.actual || task.explanation || task.summary || '')}</p>`}</div><footer class="wb-summary-answer-actions">${control('복사', 'data-summary-copy')}${control('원래 답변 보기', 'data-summary-terminal')}</footer></article>`;
      }
      const time = message.sentAt || message.at;
      const timestamp = Number.isFinite(time) ? new Date(time).toLocaleTimeString(window.WhiteboxI18n?.getLocaleTag?.() || undefined, { hour: '2-digit', minute: '2-digit' }) : '';
      return `<article class="wb-summary-user" data-state="${esc(message.state)}"><div class="wb-summary-label">${esc(t('내 요청'))} <span>${esc(states[message.state] || '')}${timestamp ? ` · ${esc(timestamp)}` : ''}</span></div><p>${esc(message.text)}</p>${message.error ? `<p class="wb-summary-delivery-error">${esc(message.error)}</p>${control('터미널에서 확인', 'data-summary-terminal')}` : ''}${message.state === 'queued' ? `<div class="wb-summary-queue-actions">${control('그래도 전송하기', `data-summary-send-now="${esc(message.id)}"`)}${control('수정', `data-summary-edit="${esc(message.id)}"`, Boolean(value.draft))}${control('취소', `data-summary-cancel="${esc(message.id)}"`)}</div>` : ''}</article>`;
    }).join('');
    if (!markup) markup = `<div class="wb-summary-empty"><span>${esc(t('이해 · 검토'))}</span><h1>${esc(t('요약을 읽고, 다음 요청을 이어가세요.'))}</h1><p>${esc(t('같은 AI 세션에서 대화를 이어갑니다.'))}</p></div>`;
    const prompt = detectedPrompt(id);
    if (prompt) {
      const raw = context.snapshot(id).text || '';
      markup += `<article class="wb-summary-prompt" role="group" aria-label="${esc(t('응답이 필요합니다'))}"><h2>${esc(prompt.question)}</h2><pre>${esc(raw.slice(-8000))}</pre><div>${prompt.choices.map(choice => control(choice.label, `data-summary-choice="${esc(choice.id)}"`, approvalBusy, 'secondary', false)).join('')}</div></article>`;
    } else if (member.activity?.state === 'waiting') {
      markup += `<article class="wb-summary-prompt"><p>${esc(t('터미널에서 응답이 필요합니다.'))}</p>${control('터미널에서 확인', 'data-summary-terminal')}</article>`;
    }
    if (markup !== lastMarkup) {
      const nearBottom = list.scrollHeight - list.clientHeight - list.scrollTop < 80;
      const opened = [...list.querySelectorAll('details')].map((node, index) => node.open ? index : -1);
      for (const host of actionHosts) ui?.clear?.(host);
      actionHosts.clear();
      transcript.innerHTML = markup; lastMarkup = markup; mountControls();
      list.querySelectorAll('details').forEach((node, index) => { node.open = opened.includes(index); });
      if (nearBottom) list.scrollTop = list.scrollHeight;
    }
    renderProgress(value, member, review, prompt);
    input.disabled = !available;
    const nextSendKey = JSON.stringify([t('전송'), available]);
    if (ui?.actionButton && $('#wbSummarySendHost') && nextSendKey !== sendKey) {
      ui.actionButton($('#wbSummarySendHost'), { label: `${t('전송')} ↑`, type: 'submit', variant: 'primary' });
      $('#wbSummarySendHost button').id = 'wbSummarySend'; sendKey = nextSendKey;
    }
    root.querySelector('#wbSummarySend').disabled = !available;
    root.querySelector('#wbSummaryComposerHint').textContent = t(member.ready ? 'Enter 전송 · Shift+Enter 줄바꿈' : '작업 중 보낸 요청은 전송 대기로 보관합니다.');
  }
  function observe(jobs = []) {
    jobsById.clear();
    for (const job of jobs) if (job.operation === 'summary') jobsById.set(job.id, job);
    for (const value of records.values()) for (const message of value.messages) {
      const job = jobs.find(item => item.operation === 'summary' && item.id === message.id);
      if (job && ['failed', 'interrupted'].includes(job.state)) { message.state = 'interrupted'; message.error = job.error; }
      else if (job?.state === 'stopped' && message.state === 'sent') { message.state = 'stopped'; message.replyCaptured = true; }
    }
    render(); flush().catch(error => { notice.textContent = String(error.message || error); });
  }
  return {
    render, observe, setMode, eligible,
    pendingJobs: () => [...records.values()].flatMap(value => {
      const message = value.messages.find(item => item.state === 'sent' && item.targetCreationId && !item.replyCaptured);
      return message ? [{ id: message.id, targetId: value.id, targetCreationId: message.targetCreationId,
        targetProviderPid: message.targetProviderPid, targetProvider: message.targetProvider }] : [];
    }).slice(0, 100),
    needsReview: id => {
      const value = records.get(id);
      if (!value) return false;
      mergeAnswers(value);
      return value.mode === 'summary' || value.messages.some(message => message.state === 'sent' && !message.answerKey);
    },
    serialize: () => [...records.values()].slice(-100).map(({ game2048, ...value }) => ({ ...value, messages: value.messages.filter(ownSend).slice(-100) })),
    serializeGame: () => sharedGame,
    restoreGame(value) { adoptGame(value); },
    restore(values) {
      // Older versions saved one board per terminal: keep the furthest one.
      const legacy = (Array.isArray(values) ? values : []).map(item => window.Whitebox2048.restore(item?.game2048)).filter(Boolean)
        .sort((a, b) => b.score - a.score || b.best - a.best);
      for (const value of legacy) adoptGame(value);
      for (const item of (Array.isArray(values) ? values : []).slice(-100)) {
        const session = context.session(item?.id);
        if (!session || item.creationId !== session.creationId) continue;
        // Older versions saved answer copies and imported requests; both are
        // derived from the live review results now and are not restored.
        const messages = (Array.isArray(item.messages) ? item.messages : []).filter(message => message && typeof message.id === 'string'
          && ownSend(message) && typeof message.text === 'string' && message.text.length <= 8000 && !nonTask(message.text)).slice(-100);
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
