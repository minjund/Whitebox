'use strict';

// A chat is a view of one existing AI process, never a replacement shell.
window.WhiteboxSummaryChat = function createSummaryChat(context) {
  const { root, api, t, esc } = context;
  const ui = window.WhiteboxWorkspaceUI;
  const $ = selector => root.querySelector(selector);
  // Every AI CLI the app recognizes in a terminal. Claude and Codex steps come
  // from their own logs; Gemini and Grok from their own screen markers.
  const SUMMARY_PROVIDERS = ['claude', 'codex', 'gemini', 'grok'];
  const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok' };
  const records = new Map();
  let flushing = false, selected = '', lastMarkup = '', approvalBusy = false, retryBusy = false, stopBusy = false, modeKey = '', sendKey = '', stopKey = '', thinkingLabel = '';
  let lastPastMarkup = '', pastSelected = '', flashTimer = 0;
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
  // Model/effort, account limits and the token history live in the header.
  const usage = root.querySelector('#wbSummaryHistoryButton') && window.WhiteboxSummaryUsage?.createView({ meters: root.querySelector('#wbSummaryUsageMeters'),
    button: root.querySelector('#wbSummaryHistoryButton'), sheet: root.querySelector('#wbSummaryHistory'), t, esc,
    providerUsage: () => context.api?.providerUsage?.(), save: () => context.save() });
  const adoptGame = value => {
    const restored = window.Whitebox2048.restore(value);
    if (!restored) return;
    // An untouched fresh board loses nothing when a saved game replaces it.
    if (!sharedGame || sharedGame.score === 0 && restored.score > 0) sharedGame = { ...restored, best: Math.max(restored.best, sharedGame?.best || 0) };
    else sharedGame.best = Math.max(sharedGame.best, restored.best);
  };
  const identity = member => ({ targetCreationId: member.creationId, targetProviderPid: member.providerPid, targetProvider: member.provider });
  // What a queued request is waiting for, shown under it until it is sent.
  const WAIT = {
    ready: 'AI가 입력을 받을 수 있게 되면 자동으로 보내요.',
    working: 'AI 작업이 끝나면 자동으로 보내요.',
    previous: '앞의 요청이 끝나면 자동으로 보내요.',
    prompt: 'AI가 터미널에서 응답을 기다려요. 응답하면 이어서 보내요.',
    draft: '터미널 입력창에 쓰던 글이 있어요. 비우면 자동으로 보내요.',
    screen: '터미널 화면을 확인하면 자동으로 보내요.',
    connection: 'AI 연결을 확인하면 자동으로 보내요.',
  };
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
  // The AI process this terminal last reported, however old the observation.
  const known = id => {
    const session = context.session(id), member = context.member(id);
    return Boolean(session?.status === 'running' && member && member.creationId === session.creationId && member.pid === session.pid
      && member.providerPid > 0 && SUMMARY_PROVIDERS.includes(member.provider));
  };
  const eligible = id => known(id) && Date.now() - context.member(id).observedAt < 5000;
  // A queued request ends only when its AI session is really gone or replaced.
  // A slow or missed observation keeps it queued until the AI is seen again.
  function sessionChanged(id, message) {
    const session = context.session(id), member = context.member(id);
    if (!session || session.status !== 'running' || session.creationId !== message.targetCreationId) return true;
    return Boolean(member && member.creationId === session.creationId && member.pid === session.pid && member.providerPid > 0
      && (member.providerPid !== message.targetProviderPid || member.provider !== message.targetProvider));
  }
  function record(id) {
    const session = context.session(id);
    if (!session) return null;
    let value = records.get(id);
    if (!value || value.creationId !== session.creationId) {
      value = { id, creationId: session.creationId, mode: 'terminal', draft: '', attachments: [], messages: [], marks: [] };
      records.set(id, value);
    }
    return value;
  }
  const taskKey = task => String(task.taskId || task.analysisId || `${task.observedAt}:${task.request}`);
  // Where the AI's memory was emptied (/clear) or folded (/compact). Summary
  // cards before the last clear leave the screen; past requests stay listed.
  const MARK_KINDS = ['clear', 'compact'];
  function markReset(id, kind, at = Date.now()) {
    const value = record(id);
    if (!value || !MARK_KINDS.includes(kind)) return;
    // One Enter can be seen twice (terminal echo and Summary send).
    if (value.marks.some(mark => mark.kind === kind && Math.abs(mark.at - at) < 3000)) return;
    value.marks = [...value.marks, { kind, at }].sort((a, b) => a.at - b.at).slice(-50);
    lastMarkup = ''; lastPastMarkup = '';
    context.save(); render();
  }
  const lastClear = value => value.marks?.filter(mark => mark.kind === 'clear').at(-1)?.at || 0;
  const messageTime = message => message.role === 'answer'
    ? Number(message.task?.submittedAt) || Date.parse(message.task?.observedAt) || 0 : sentTime(message);
  const markText = mark => `${t(mark.kind === 'clear' ? '여기서 대화를 비웠어요' : '대화를 압축했어요')}${clock(mark.at) ? ` · ${clock(mark.at)}` : ''}`;
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
          : String(message.delivered || message.text).trim() === String(task.request || '').trim() && !message.baseline?.includes(key)));
        if (mine) mine.answerKey = key;
      }
      // A message sent while the AI worked can be absorbed into this turn; the
      // one reply answers it too.
      for (const joinedId of task.joinedSubmissionIds || []) {
        const joined = own.find(message => message.id === joinedId && message.state === 'sent' && !message.answerKey);
        if (joined) joined.answerKey = key;
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
    // A turn that absorbed later messages shows its answer after the last one.
    const answerOwner = new Map();
    for (const message of messages) {
      if (message.role === 'answer' || !message.answerKey) continue;
      const current = answerOwner.get(message.answerKey);
      if (!current || sentTime(message) >= sentTime(current)) answerOwner.set(message.answerKey, message);
    }
    for (const message of messages) {
      if (message.role === 'answer') {
        if (claimed.has(message)) continue;
        units.push({ items: [message], time: Number(message.task?.submittedAt) || Date.parse(message.task?.observedAt) || 0 });
        continue;
      }
      const answers = message.answerKey && answerOwner.get(message.answerKey) === message
        ? messages.filter(item => item.role === 'answer' && item.key === message.answerKey && !claimed.has(item)) : [];
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
    // Typing continues where the user switched to.
    if (mode === 'terminal') context.focusTerminal?.(id);
    if (mode === 'summary') {
      input.focus({ preventScroll: true });
      if (opening) game.open();
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
  // Screenshots for the next request: picked, pasted or dropped. Each is saved
  // by the main process at once (type and size checked there); the request
  // carries only the saved IDs, and the AI receives each copy's path.
  const MAX_IMAGES = 5, MAX_IMAGE_BYTES = 10 * 1024 * 1024, PATH_RESERVE = 300;
  const attachList = root.querySelector('#wbSummaryAttachments');
  const attachInput = root.querySelector('#wbSummaryAttachInput');
  const saving = new Map();
  let lastAttachmentMarkup = '';
  const ipcMessage = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/u, '');
  const cleanAttachments = items => (Array.isArray(items) ? items : []).filter(item => item && typeof item.id === 'string'
    && /^[a-f0-9-]{36}\.(png|jpg|gif|webp)$/u.test(item.id)).slice(0, MAX_IMAGES)
    .map(item => ({ id: item.id, thumb: typeof item.thumb === 'string' && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/u.test(item.thumb) && item.thumb.length < 40000 ? item.thumb : '' }));
  const imageCount = count => t('이미지 {count}장').replace('{count}', count);
  // The images a request carried: their previews and how many.
  const userImages = message => {
    const items = message.attachments || [];
    if (!items.length) return '';
    const thumbs = items.filter(item => item.thumb).map((item, index) => `<img src="${esc(item.thumb)}" alt="${esc(t('첨부 이미지 {index}').replace('{index}', index + 1))}">`).join('');
    return `${thumbs ? `<div class="wb-summary-user-images">${thumbs}</div>` : ''}<span class="wb-summary-image-count">${esc(imageCount(items.length))}</span>`;
  };
  // A small JPEG preview kept with the request; the full image stays on disk.
  async function thumbnail(file) {
    try {
      if (typeof createImageBitmap !== 'function') return '';
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 128 / Math.max(bitmap.width, bitmap.height, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch { return ''; }
  }
  function renderAttachments(value) {
    const items = value?.attachments || [], pending = saving.get(value?.id) || 0;
    const markup = items.map((item, index) => `<li data-state="ready">${item.thumb ? `<img src="${esc(item.thumb)}" alt="${esc(t('첨부 이미지 {index}').replace('{index}', index + 1))}">` : `<span class="sr-only">${esc(t('첨부 이미지 {index}').replace('{index}', index + 1))}</span>`}<button type="button" data-summary-attachment-remove="${esc(item.id)}" aria-label="${esc(t('이미지 빼기'))}" title="${esc(t('이미지 빼기'))}">×</button></li>`).join('')
      + Array.from({ length: pending }, () => `<li data-state="saving" aria-label="${esc(t('이미지 저장 중…'))}"></li>`).join('');
    if (markup !== lastAttachmentMarkup) { attachList.innerHTML = markup; lastAttachmentMarkup = markup; }
    attachList.hidden = !markup;
    root.querySelector('#wbSummaryAttach').disabled = items.length + pending >= MAX_IMAGES;
  }
  async function addImages(files) {
    const id = context.activeId(), value = record(id);
    if (!value) return;
    const images = [...files].filter(file => file && /^image\//u.test(String(file.type || '')));
    if (!images.length) { if (files.length) notice.textContent = t('PNG, JPG, GIF, WebP 이미지만 첨부할 수 있어요.'); return; }
    const room = MAX_IMAGES - value.attachments.length - (saving.get(id) || 0);
    if (images.length > room) notice.textContent = t('이미지는 한 번에 5장까지 보낼 수 있어요.');
    for (const file of images.slice(0, Math.max(0, room))) {
      if (file.size > MAX_IMAGE_BYTES) { notice.textContent = t('이미지는 한 장에 10MB까지 첨부할 수 있어요.'); continue; }
      saving.set(id, (saving.get(id) || 0) + 1); renderAttachments(value);
      try {
        const [saved, thumb] = await Promise.all([
          Promise.resolve(file.arrayBuffer()).then(buffer => api.summaryAttachmentSave({ type: file.type, data: new Uint8Array(buffer) })),
          thumbnail(file),
        ]);
        if (records.get(id) !== value) { api.summaryAttachmentRemove?.([saved.id]).catch(() => {}); continue; }
        value.attachments.push(...cleanAttachments([{ id: saved.id, thumb }]));
        context.save();
      } catch (error) { notice.textContent = t(ipcMessage(error)); }
      finally {
        saving.set(id, Math.max(0, (saving.get(id) || 0) - 1));
        if (context.activeId() === id) renderAttachments(value);
      }
    }
  }
  function discardAttachments(items) {
    const ids = (items || []).map(item => item.id);
    if (ids.length) Promise.resolve(api.summaryAttachmentRemove?.(ids)).catch(() => {});
  }
  root.querySelector('#wbSummaryAttach').addEventListener('click', () => attachInput.click());
  attachInput.addEventListener('change', () => {
    const files = [...(attachInput.files || [])];
    attachInput.value = '';
    addImages(files).catch(error => { notice.textContent = t(ipcMessage(error)); });
  });
  attachList.addEventListener('click', event => {
    const button = event.target.closest('[data-summary-attachment-remove]');
    const value = record(context.activeId());
    if (!button || !value) return;
    const removed = value.attachments.filter(item => item.id === button.dataset.summaryAttachmentRemove);
    value.attachments = value.attachments.filter(item => !removed.includes(item));
    discardAttachments(removed);
    context.save(); renderAttachments(value);
    input.focus({ preventScroll: true });
  });
  input.addEventListener('paste', event => {
    const items = [...(event.clipboardData?.items || [])];
    const files = items.filter(item => item.kind === 'file' && /^image\//u.test(item.type)).map(item => item.getAsFile()).filter(Boolean);
    if (!files.length) return;
    // A copied image may also carry text (its name or address); keep that
    // paste only when the user copied text on purpose.
    if (!event.clipboardData.getData('text/plain')) event.preventDefault();
    addImages(files).catch(error => { notice.textContent = t(ipcMessage(error)); });
  });
  const draggingFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
  form.addEventListener('dragover', event => {
    if (!draggingFiles(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; form.dataset.drop = 'true';
  });
  form.addEventListener('dragleave', event => { if (!form.contains(event.relatedTarget)) delete form.dataset.drop; });
  form.addEventListener('drop', event => {
    delete form.dataset.drop;
    if (!draggingFiles(event)) return;
    event.preventDefault();
    addImages(event.dataTransfer.files).catch(error => { notice.textContent = t(ipcMessage(error)); });
  });
  // A draft's full text: the reply itself, or the file the turn wrote (read
  // from disk only when the user opens or copies it; never sent to a model).
  const draftTexts = new Map();
  function draftTask(id, taskId) { return tasksFor(id).find(task => task.taskId === taskId && task.content?.shape === 'draft'); }
  async function draftText(id, taskId) {
    const task = draftTask(id, taskId);
    if (!task) throw new Error(t('초안을 찾지 못했어요.'));
    if (typeof task.draft?.text === 'string') return task.draft.text;
    const key = `${id}:${taskId}`;
    if (!draftTexts.has(key)) {
      const result = await api.summaryDraft({ id, taskId });
      draftTexts.set(key, String(result?.text || ''));
    }
    return draftTexts.get(key);
  }
  // A written draft's full text is read once from disk (never sent to a
  // model) so its card can show its length and items per section.
  const draftLoads = new Set();
  function draftCache(id, task) {
    if (task?.content?.shape !== 'draft' || typeof task.draft?.path !== 'string') return undefined;
    const key = `${id}:${task.taskId}`;
    if (draftTexts.has(key) || draftLoads.has(key) || typeof api?.summaryDraft !== 'function') return draftTexts.get(key);
    draftLoads.add(key);
    Promise.resolve(api.summaryDraft({ id, taskId: task.taskId })).then(result => {
      draftTexts.set(key, String(result?.text || '')); lastMarkup = ''; render();
    }).catch(() => {});
    return undefined;
  }
  function fillDrafts() {
    const id = context.activeId();
    for (const node of transcript.querySelectorAll('details[data-draft-source="file"]')) {
      const text = draftTexts.get(`${id}:${node.dataset.summaryDraft}`);
      if (text !== undefined) node.querySelector('.wb-draft-text').textContent = text;
    }
  }
  list.addEventListener('toggle', event => {
    const node = event.target;
    if (!node.matches?.('details[data-draft-source="file"]') || !node.open) return;
    const pre = node.querySelector('.wb-draft-text');
    if (pre.textContent) return;
    pre.textContent = t('초안을 불러오는 중…');
    draftText(context.activeId(), node.dataset.summaryDraft).then(text => { pre.textContent = text; })
      .catch(error => { pre.textContent = t(ipcMessage(error)); });
  }, true);
  form.addEventListener('submit', event => {
    event.preventDefault();
    // Invisible control characters (from a copied terminal line) are dropped;
    // the guarded write would otherwise refuse the whole request.
    const id = context.activeId(), value = record(id), member = context.member(id);
    const attachments = value?.attachments || [];
    let text = input.value.replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, '').trim();
    if (!value || !text && !attachments.length) return;
    // Images alone still make a request the AI can act on.
    if (!text) text = t('첨부한 이미지를 확인해 주세요.');
    // Every refusal says why and keeps the text and images in the composer.
    const refusal = saving.get(id) ? t('이미지를 저장하는 중이에요. 잠시 후 보내 주세요.')
      : text.length + attachments.length * PATH_RESERVE > 8000 ? t('요청이 너무 길어요. 8000자 이하로 줄여서 보내 주세요.')
      : !known(id) ? t('AI 연결을 확인하는 중이에요. 잠시 후 다시 보내 주세요.')
        : value.messages.filter(message => message.state === 'queued').length >= 20 ? t('전송 대기 중인 요청이 너무 많아요. 앞의 요청이 전송된 뒤 보내 주세요.') : '';
    if (refusal) { notice.textContent = refusal; return; }
    notice.textContent = '';
    value.messages.push({ id: crypto.randomUUID(), role: 'user', text, state: 'queued', ...identity(member),
      ...(attachments.length ? { attachments: attachments.map(item => ({ ...item })) } : {}),
      baseline: tasksFor(id).map(taskKey), at: Date.now() });
    value.draft = ''; value.attachments = []; input.value = ''; input.style.height = 'auto';
    context.save(); render(); renderAttachments(value);
    context.refresh().then(flush).catch(error => { notice.textContent = String(error.message || error); });
  });
  root.querySelector('#wbSummary').addEventListener('click', event => {
    const button = event.target.closest('[data-summary-edit], [data-summary-cancel], [data-summary-send-now], [data-summary-choice], [data-summary-terminal], [data-summary-copy], [data-summary-retry], [data-summary-resend], [data-summary-draft-copy], [data-summary-draft-open]');
    if (!button) return;
    if (button.dataset.summaryDraftOpen) {
      Promise.resolve(api.summaryDraft?.({ id: context.activeId(), taskId: button.dataset.summaryDraftOpen, action: 'open' }))
        .catch(error => { notice.textContent = t(ipcMessage(error)); });
      return;
    }
    if (button.dataset.summaryDraftCopy) {
      draftText(context.activeId(), button.dataset.summaryDraftCopy).then(text => api.writeClipboard(text))
        .then(() => { notice.textContent = t('초안을 복사했어요.'); })
        .catch(error => { notice.textContent = t(ipcMessage(error)); });
      return;
    }
    if (button.dataset.summaryResend) { resend(button.dataset.summaryResend); return; }
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
      if (value.draft || value.attachments.length) return;
      value.draft = message.text; input.value = value.draft; input.focus();
      // Its images go back to the composer with the text.
      value.attachments = cleanAttachments(message.attachments);
      delete message.attachments;
      renderAttachments(value);
    } else {
      // A cancelled request will never be sent: its saved images are removed.
      discardAttachments(message.attachments);
      delete message.attachments;
    }
    message.state = 'cancelled'; context.save(); render();
  });
  // The user's explicit retry of a request that did not reach the AI (or whose
  // delivery is unknown). It queues again under a new ID for the current AI
  // session, so the old delivery record is never replayed by itself.
  function resend(messageId) {
    const id = context.activeId(), value = record(id), member = context.member(id);
    const message = value?.messages.find(item => item.id === messageId);
    if (!message || message.state !== 'interrupted' || message.answerKey) return;
    if (!known(id)) { notice.textContent = t('AI 연결을 확인하는 중이에요. 잠시 후 다시 보내 주세요.'); return; }
    Object.assign(message, { id: crypto.randomUUID(), state: 'queued', ...identity(member), baseline: tasksFor(id).map(taskKey), at: Date.now() });
    for (const key of ['error', 'sentAt', 'wait', 'replyCaptured', 'delivered']) delete message[key];
    notice.textContent = '';
    context.save(); render();
    context.refresh().then(flush).catch(error => { notice.textContent = String(error.message || error); });
  }
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
      targetProviderPid: message.targetProviderPid, targetProvider: message.targetProvider, sendNow,
      ...(message.attachments?.length ? { attachments: message.attachments.map(item => item.id) } : {}) });
    if (result?.deferred) {
      message.state = 'queued'; message.wait = Object.hasOwn(WAIT, result.reason) ? result.reason : 'ready';
      if (sendNow) notice.textContent = t('터미널의 입력 상태를 확인한 뒤 다시 전송해 주세요.');
    } else if (result?.ok && ['running', 'completed'].includes(result.job?.state)) {
      message.state = 'sent'; message.sentAt = result.job.sentAt; context.submitted(result.job);
      const reset = window.WhiteboxTerminalReviewTurns?.conversationReset(message.text);
      if (reset) markReset(value.id, reset, Number(result.job.sentAt) || Date.now());
      // The exact text the AI received (with image paths) links its turn back.
      if (message.attachments?.length && typeof result.job.request === 'string') message.delivered = result.job.request;
    } else { message.state = 'interrupted'; message.error = result?.job?.error || t('전송 상태를 확인하지 못했습니다. 터미널을 확인해 주세요.'); }
  }
  async function sendNow(value, message) {
    // Reserve before refreshing so polling, double clicks and automatic flush
    // cannot dispatch the same queue item concurrently.
    message.state = 'sending'; context.save(); render();
    try {
      await context.refresh();
      if (sessionChanged(value.id, message)) throw new Error(t('AI 세션이 종료되거나 바뀌었습니다. 자동 전송하지 않았습니다.'));
      // Not observed just now: the request stays queued and says so.
      if (!eligible(value.id)) {
        message.state = 'queued'; message.wait = 'connection';
        notice.textContent = t('AI 연결을 확인하는 중이에요. 잠시 후 다시 보내 주세요.');
        return;
      }
      await deliver(value, message, true);
    } catch (error) {
      message.state = 'interrupted'; message.error = String(error.message || error);
    } finally { context.save(); render(); }
  }
  async function flush() {
    if (flushing) return;
    flushing = true;
    let waitChanged = false;
    // A queued request shows what it waits for; it drains on its own.
    const hold = (message, reason) => { if (message.wait !== reason) { message.wait = reason; waitChanged = true; } };
    try {
      for (const value of records.values()) {
        const message = value.messages.find(item => item.state === 'queued');
        if (!message) continue;
        const member = context.member(value.id);
        if (sessionChanged(value.id, message)) {
          message.state = 'interrupted'; message.error = t('AI 세션이 종료되거나 바뀌었습니다. 자동 전송하지 않았습니다.'); context.save(); waitChanged = true; continue;
        }
        if (!eligible(value.id)) { hold(message, 'connection'); continue; }
        mergeAnswers(value);
        if (detectedPrompt(value.id)) { hold(message, 'prompt'); continue; }
        if (!member.ready) {
          const previous = value.messages.some(item => item.state === 'sent' && item.targetCreationId && !item.replyCaptured && jobsById.get(item.id)?.state !== 'completed');
          hold(message, previous ? 'previous' : 'ready'); continue;
        }
        // Archive each completed reply in the reviewer before replacing the
        // observed turn. Model analysis may finish later or be deferred; it
        // must not hold the user's next request indefinitely.
        let waiting = false;
        for (const sent of value.messages.filter(item => item.state === 'sent' && item.targetCreationId && !item.replyCaptured)) {
          const job = jobsById.get(sent.id);
          if (job?.state !== 'completed') { waiting = true; break; }
          // The backend already confirmed this exact reply finished. Archiving
          // it is best effort and must not hold the next request forever.
          const settled = Number(job.finishedAt) > 0 && Date.now() - job.finishedAt > CAPTURE_GRACE_MS;
          try {
            if (!await context.captureReply(job) && !settled) { waiting = true; break; }
          } catch (error) { notice.textContent = String(error.message || error); if (!settled) { waiting = true; break; } }
          sent.replyCaptured = true;
          context.save();
        }
        if (waiting) { hold(message, 'previous'); continue; }
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
    } finally {
      flushing = false;
      if (waitChanged) render();
    }
  }
  // The live step of a working AI, from its session log or its own status
  // line (no model call). Shell commands arrive as a kind or program name
  // only, never their arguments.
  const PROGRESS = {
    test: ['테스트 실행 중', '테스트 결과 확인 중'], build: ['빌드 중', '빌드 결과 확인 중'], install: ['패키지 설치 중', '설치 결과 확인 중'],
    git: ['git 실행 중', 'git 결과 확인 중'], read: ['파일 읽는 중', '읽은 내용 정리 중'], search: ['코드 검색 중', '검색 결과 확인 중'],
    edit: ['파일 수정 중', '수정 내용 확인 중'], web: ['웹에서 확인 중', '웹 결과 정리 중'], agent: ['도움 AI가 작업하는 중', '도움 AI 결과 확인 중'],
    plan: ['작업 계획 정리 중', '작업 계획 정리 중'], ask: ['질문 준비 중', '질문 준비 중'], skill: ['스킬 실행 중', '스킬 결과 확인 중'],
    mcp: ['연결 도구 사용 중', '도구 결과 확인 중'], command: ['명령 실행 중', '명령 결과 확인 중'], tool: ['도구 사용 중', '도구 결과 확인 중'],
    thinking: ['생각 중', '생각 중'], respond: ['답변 작성 중', '답변 작성 중'], wait: ['백그라운드 결과 기다리는 중', '백그라운드 결과 확인 중'], monitor: ['모니터 켜는 중', '모니터 결과 확인 중'],
    compact: ['대화 압축 중', '대화 압축 중'], retry: ['오류가 나서 다시 시도하는 중', '오류가 나서 다시 시도하는 중'], limit: ['사용 한도가 풀리길 기다리는 중', '사용 한도가 풀리길 기다리는 중'],
  };
  // Waits outside the AI's own steps explain themselves on the second line.
  const PROGRESS_NOTE = {
    compact: '대화가 길어져 앞부분을 줄이고 있어요. 끝나면 이어서 작업해요.',
    retry: 'AI 서비스 응답에 문제가 있어 자동으로 다시 시도하고 있어요.',
    limit: '한도가 풀리면 AI가 자동으로 이어서 작업해요.',
  };
  // What an approval prompt is holding, for the "response needed" card.
  const RUN = 'AI가 명령 실행 허락을 기다려요';
  const PERMISSION = { edit: 'AI가 파일 수정 허락을 기다려요', web: 'AI가 웹 접속 허락을 기다려요', mcp: 'AI가 연결 도구 사용 허락을 기다려요',
    agent: 'AI가 도움 AI 실행 허락을 기다려요', skill: 'AI가 스킬 실행 허락을 기다려요', test: RUN, build: RUN, install: RUN, git: RUN, command: RUN, read: RUN };
  // A finished reply whose summary is still being made: Summary mode shows
  // only the status, never the raw reply in place of the summary.
  // Why a summary failed, in the words the user acts on.
  const FAILURE_REASON = {
    'rate-limit': '사용 한도에 걸려 요약하지 못했어요. 한도가 풀린 뒤 다시 요약해 주세요.',
    auth: '분석에 쓰는 AI에 로그인되어 있지 않거나 권한이 없어요. 설정 → 이해 · 검토에서 분석 서비스를 확인해 주세요.',
    quality: '요약이 내용 검사를 통과하지 못했어요. 아래는 AI 원문입니다.',
    transient: '요약 중 오류가 나서 한 번 더 시도했지만 실패했어요. 아래는 AI 원문입니다.',
  };
  const summaryPending = (task, review) => Boolean(task && !task.content && task.deferred && !task.passThrough && !task.summaryFailure && task.lifecycle === 'completed'
    && ['reviewing', 'collecting'].includes(review?.state)
    && [review.analysisTaskId, review.currentTaskId, review.preview?.taskId].includes(task.taskId));
  function progressText(progress) {
    if (!progress || typeof progress.kind !== 'string') return '';
    if (progress.kind === 'note') return String(progress.detail || '').slice(0, 90);
    if (progress.kind === 'agent' && progress.count > 1 && progress.phase === 'running') return `${t('도움 AI {count}개 작업 중').replace('{count}', progress.count)}…`;
    const labels = PROGRESS[progress.kind] || PROGRESS.tool;
    const detail = typeof progress.detail === 'string' && progress.detail && progress.kind !== 'thinking' ? ` · ${progress.detail.slice(0, 60)}` : '';
    return `${t(labels[progress.phase === 'after' ? 1 : 0])}${detail}…`;
  }
  // Unnamed jobs carry the backend's generic Korean label; name them plainly.
  const BACKGROUND_DEFAULT = { 명령창: '이름 없는 명령', 모니터: '이름 없는 모니터', '도움 AI': '이름 없는 도움 AI' };
  // Work the AI started and left running: background commands, monitors and
  // helper AIs, as observed for this exact AI process.
  function backgroundJobs(activity) {
    const items = Array.isArray(activity?.background?.items) ? activity.background.items : [];
    return items.filter(item => item && typeof item.label === 'string' && ['running', 'waiting'].includes(item.state));
  }
  function backgroundNames(items) {
    const names = items.slice(0, 2).map(item => Object.hasOwn(BACKGROUND_DEFAULT, item.label) ? t(BACKGROUND_DEFAULT[item.label]) : item.label.slice(0, 40));
    return items.length > 2 ? `${names.join(', ')} ${t('외 {count}개').replace('{count}', items.length - 2)}` : names.join(', ');
  }
  function backgroundLabel(items) {
    const agents = items.every(item => item.kind === 'agent');
    if (items.length === 1) return t(agents ? '답변 완료 · 도움 AI 실행 중' : '답변 완료 · 백그라운드 작업 실행 중');
    return t(agents ? '답변 완료 · 도움 AI {count}개 실행 중' : '답변 완료 · 백그라운드 작업 {count}개 실행 중').replace('{count}', items.length);
  }
  // How long this request has run and how much the AI has done, from counts
  // the session log already holds. Minutes only, so the line stays calm.
  function turnText(turn, items, now = Date.now()) {
    const parts = [];
    const minutes = Number.isFinite(turn?.since) && now >= turn.since ? Math.floor((now - turn.since) / 60000) : -1;
    if (minutes === 0) parts.push(t('방금 시작했어요'));
    else if (minutes > 0 && minutes < 60) parts.push(t('{minutes}분째 작업 중').replace('{minutes}', minutes));
    else if (minutes >= 60) parts.push(t('{hours}시간 {minutes}분째 작업 중').replace('{hours}', Math.floor(minutes / 60)).replace('{minutes}', minutes % 60));
    if (turn?.steps > 0) parts.push(t('도구 {count}번 사용').replace('{count}', turn.steps));
    if (turn?.files > 0) parts.push(t('파일 {count}개 수정').replace('{count}', turn.files));
    if (items.length) parts.push(t('백그라운드 {count}개 실행 중').replace('{count}', items.length));
    return parts.join(' · ');
  }
  function permissionText(progress) {
    if (progress?.kind === 'ask') return t('AI가 질문했어요. 터미널에서 답해 주세요.');
    const action = progress?.kind && PERMISSION[progress.kind];
    if (!action) return t('터미널에서 응답이 필요합니다.');
    const detail = typeof progress.detail === 'string' && progress.detail ? ` · ${progress.detail.slice(0, 60)}` : '';
    return `${t(action)}${detail}`;
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
    // A reply that asks the user something keeps its turn open for the answer,
    // so its analysis stays "in-progress"; its summary is still complete.
    const summaryDone = Boolean(task && (task.analysisLifecycle !== 'in-progress' || task.awaitingResponse === true) && !deferred && !analyzing && !collecting && !awaiting && !working && !interrupted
      && (!failure || failure.kind === 'reanalysis' && failure.retainedLifecycle === 'completed')
      && !needsResponse && (!task.lifecycle || finished(task)));
    const summaryQueued = !needsResponse && !interrupted && !failure && !analyzing && summaryPending(task, review);
    const loading = !needsResponse && !interrupted && (analyzing || working || awaiting || summaryQueued);
    // The AI's own turn ended while work it started still runs: it is waiting
    // on that work, not finished and not waiting on the user.
    const jobs = backgroundJobs(member.activity);
    const backgroundWait = Boolean(member.activity?.backgroundWait && jobs.length && !needsResponse && !interrupted);
    const progress = member.activity?.progress;
    const liveStep = analyzing ? '' : backgroundWait ? backgroundLabel(jobs) : working ? progressText(progress) : '';
    const label = analyzing ? t('요약 중…') : summaryQueued ? t('답변 완료 · 요약 준비 중…') : liveStep || t(working ? 'AI가 작업 중입니다.' : 'AI 답변을 기다리고 있어요');
    const backgroundNote = backgroundWait ? `${backgroundNames(jobs)} · ${t(member.provider === 'claude' ? '다음 요청을 지금 보내도 돼요. 작업이 끝나면 AI가 결과를 받아 이어서 작업해요.' : '다음 요청을 지금 보내도 돼요. 작업은 계속 실행 중이에요.')}` : '';
    $('#wbSummaryWorking').hidden = !(loading || backgroundWait);
    if (loading || backgroundWait) {
      if (label !== thinkingLabel) {
        if (ui?.thinking) ui.thinking($('#wbSummaryThinking'), label);
        else $('#wbSummaryThinking').textContent = label;
        thinkingLabel = label;
      }
      const detail = analyzing && replyDone ? t('AI 답변은 도착했어요. 요청과 결과를 비교해 요약으로 정리하고 있어요.')
        : backgroundWait && !analyzing && !summaryQueued ? backgroundNote
          : working && PROGRESS_NOTE[progress?.kind] ? t(PROGRESS_NOTE[progress.kind])
            : working ? turnText(member.activity?.turn, jobs) : '';
      $('#wbSummaryWorkingDescription').textContent = detail || t('작업 중 보낸 요청은 전송 대기로 보관합니다.');
    } else if (thinkingLabel) { ui?.clear?.($('#wbSummaryThinking')); thinkingLabel = ''; }
    let title = '다음 요청을 입력하세요.', description = '같은 AI 세션에서 대화를 이어갑니다.';
    // A pass-through reply needs no summary; a failed summary is final.
    const passThroughDone = Boolean(replyDone && !working && task?.passThrough && !task.content);
    const summaryFailed = Boolean(!failure && !working && task?.summaryFailure && !task.content);
    // Live text is already translated and may hold AI-written details.
    let liveDescription = '';
    if (needsResponse) { title = '응답이 필요합니다'; description = '터미널에서 응답이 필요합니다.'; liveDescription = prompt ? '' : permissionText(progress); }
    else if (summaryFailed) { title = '요약하지 못했어요'; description = '아래 카드에서 AI 원문과 이유를 확인하고 다시 요약할 수 있어요.'; }
    else if (passThroughDone) { title = '답변이 도착했어요'; description = '짧은 답이라 요약 없이 그대로 보여 드려요.'; }
    else if (failure) { title = failure.title; description = failure.description; }
    else if (stopped) { title = '요청을 멈췄어요'; description = '다음 요청을 바로 이어갈 수 있어요.'; }
    else if (interrupted) { title = '요청이 중단됐어요'; description = '터미널에서 수행 기록을 확인한 뒤 다음 요청을 이어가세요.'; }
    else if (backgroundWait) { title = '답변은 끝났고 백그라운드 작업만 실행 중이에요'; liveDescription = backgroundNote; }
    else if (working) { title = 'AI가 작업 중입니다.'; description = '작업 중 보낸 요청은 전송 대기로 보관합니다.'; liveDescription = liveStep; }
    else if (summaryDone) { title = '답변과 요약이 도착했어요'; description = '다음 요청을 바로 이어갈 수 있어요.'; }
    else if (backoff) { title = '분석 재시도 대기'; description = '사용 한도가 풀리면 분석을 다시 시도합니다.'; }
    else if (analyzing) { title = replyDone ? '답변은 완료, 요약은 정리 중' : '작업 내용을 분석 중입니다.'; description = '새로운 결과가 도착하면 요약을 이어서 정리합니다.'; }
    else if (replyDone && deferred) { title = '답변 완료 · 분석 대기'; description = '결과를 판단할 구체적인 내용이 아직 부족해요.'; }
    else if (replyDone || collecting) { title = replyDone ? '답변 완료 · 분석 대기' : '분석 대기'; description = '새로운 결과가 도착하면 요약을 이어서 정리합니다.'; }
    else if (awaiting) { title = 'AI 답변을 기다리고 있어요'; description = '같은 AI 세션에서 대화를 이어갑니다.'; }
    $('#wbSummaryStateTitle').textContent = t(title);
    $('#wbSummaryStateDescription').textContent = liveDescription || t(description);
    $('#wbSummaryStateTitle').dataset.state = failure || interrupted || summaryFailed ? 'warning' : needsResponse ? 'waiting' : summaryDone || passThroughDone ? 'done' : 'working';
    const replyState = needsResponse ? '응답 필요' : stopped ? '멈춤' : interrupted ? '중단됨' : replyDone ? '완료' : working ? '작업 중' : sent || awaiting ? '대기 중' : '—';
    // Same live reviewer wording as terminal mode, so analysis never looks stalled.
    const live = review?.state === 'reviewing' ? review.phase === 'evidence' ? '근거 준비 중…' : '분석중…'
      : review?.state === 'awaiting-answer' && (working || awaiting) ? '작업 관찰 중' : '';
    const reviewState = summaryFailed ? '요약 실패' : passThroughDone ? '요약 필요 없음' : failure ? summaryDone ? '기존 검토 완료' : '추가 검토 필요'
      : interrupted ? '중단됨' : summaryDone ? '완료' : backoff ? '분석 재시도 대기' : analyzing && replyDone ? '정리 중' : live
        || (deferred || collecting || replyDone ? '분석 대기' : '대기 중');
    // A finished reply reads as finished even while its background work runs.
    $('#wbSummaryReplyState').textContent = replyState === '작업 중' && liveStep ? liveStep : t(replyState);
    $('#wbSummaryReplyState').dataset.state = interrupted ? 'warning' : needsResponse ? 'waiting' : replyDone ? 'done' : 'working';
    $('#wbSummaryReviewState').textContent = t(reviewState);
    $('#wbSummaryReviewState').dataset.state = summaryFailed ? 'warning' : summaryDone || passThroughDone ? 'done' : 'working';
    const done = [sent?.state === 'sent', replyDone, summaryDone || passThroughDone];
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
    // The wait covers the AI's own work and the summary that follows it,
    // including the gap between the reply and the analysis start. Fold the
    // game only once the summary itself is done, not at reply arrival.
    const pendingSummary = replyDone && !summaryDone && !deferred && !failure && !backoff;
    const gameWait = !needsResponse && !interrupted && (loading || collecting && !backoff || pendingSummary);
    game.render({ waiting: gameWait, completed: summaryDone, replyKey: summaryDone ? sent?.id || task?.taskId || preview?.taskId : null });
    // The request still in progress, for the past-request list.
    return { liveId: !interrupted && (loading || pendingSummary) ? sent?.id || '' : '', replyDone, step: liveStep };
  }
  // Past requests: every request of this conversation, newest first, each
  // with the summary's actual answer as written (no extra model call).
  const oneLine = text => String(text || '').replace(/\s+/gu, ' ').trim().slice(0, 240);
  const clock = time => Number.isFinite(time) && time > 0 ? new Date(time).toLocaleTimeString(window.WhiteboxI18n?.getLocaleTag?.() || undefined, { hour: '2-digit', minute: '2-digit' }) : '';
  const SHAPE_TAGS = { draft: '초안', change: '코드 변경', review: '리뷰' };
  const asksUser = task => Boolean(task && (task.awaitingResponse === true || task.content?.choices?.length || task.choices?.length));
  function answerLine(message, task, live) {
    if (typeof task?.content?.answer?.text === 'string' && task.content.answer.text.trim()) return { text: task.content.answer.text };
    if (task?.decision && (task.actual || task.decision.conclusion)) return { text: task.actual || task.decision.conclusion };
    if (task?.passThrough && task.actual) return { text: task.actual };
    if (message.state === 'stopped') return { text: t('멈춘 요청이에요.'), state: 'muted' };
    if (message.state === 'interrupted' || task?.lifecycle === 'interrupted') return { text: t('요청이 중단됐어요.'), state: 'muted' };
    if (task?.summaryFailure) return { text: t('요약하지 못했어요 · 누르면 AI 원문을 볼 수 있어요'), state: 'muted' };
    if (task?.explanation || task?.summary) return { text: task.explanation || task.summary };
    if (live) return { text: live.replyDone ? t('요약 중…') : live.step || t('AI가 작업 중 · 요약은 답이 끝나면 붙어요'), state: 'live' };
    if (task?.lifecycle === 'completed' && !task.content && !task.deferred && task.analysisDepth !== 'deferred') return { text: t('요약 중…'), state: 'live' };
    return { text: t('요약이 없어요.'), state: 'muted' };
  }
  function renderPast(value, progress) {
    const answers = new Map(value.messages.filter(message => message.role === 'answer').map(message => [message.key, message.task]));
    let previousTask = null;
    const items = [];
    for (const message of value.messages) {
      if (message.role === 'answer') { previousTask = message.task; continue; }
      // A request that never reached the AI is not a past request.
      if (!['sent', 'sending', 'stopped'].includes(message.state) && !(message.state === 'interrupted' && (message.sentAt || message.answerKey))) continue;
      const task = answers.get(message.answerKey);
      const live = progress.liveId && message.id === progress.liveId ? progress : null;
      items.push({ message, task, live, judgement: asksUser(previousTask) });
    }
    const cut = lastClear(value), marks = [...(value.marks || [])];
    const rows = [];
    for (const item of items) {
      const time = sentTime(item.message);
      while (marks.length && time && marks[0].at <= time) rows.push({ mark: marks.shift() });
      rows.push(item);
    }
    rows.push(...marks.map(mark => ({ mark })));
    rows.reverse();
    const markup = rows.map(({ mark, message, task, live, judgement }) => {
      if (mark) return `<li class="wb-summary-past-mark" data-summary-mark="${esc(mark.kind)}" role="separator"><span>${esc(markText(mark))}</span></li>`;
      const answer = answerLine(message, task, live);
      return `<li${cut && sentTime(message) < cut ? ' data-cleared="true"' : ''}><button type="button" data-summary-past="${esc(message.id)}" data-state="${live ? 'live' : 'done'}"${pastSelected === message.id ? ' aria-current="true"' : ''}><span class="wb-summary-past-request">${judgement ? `<em>${esc(t('판단'))}</em>` : ''}${SHAPE_TAGS[task?.content?.shape] ? `<em data-shape="${esc(task.content.shape)}">${esc(t(SHAPE_TAGS[task.content.shape]))}</em>` : ''}<span>${esc(oneLine(message.text))}</span>${message.attachments?.length ? `<em class="wb-summary-past-images">${esc(imageCount(message.attachments.length))}</em>` : ''}<time>${esc(clock(message.sentAt || message.at))}</time></span><span class="wb-summary-past-answer" data-state="${answer.state || 'summary'}">${esc(oneLine(answer.text))}</span></button></li>`;
    }).join('');
    $('#wbSummaryPastSection').hidden = !items.length;
    $('#wbSummaryPastCount').textContent = items.length ? `${t('{count}개').replace('{count}', items.length)} · ${t('최신순')}` : '';
    if (markup !== lastPastMarkup) { $('#wbSummaryPast').innerHTML = markup; lastPastMarkup = markup; }
  }
  // Jump to a past request without leaving summary mode.
  function showPast(id) {
    const target = [...transcript.querySelectorAll('[data-summary-message]')].find(node => node.dataset.summaryMessage === id);
    if (!target) return;
    pastSelected = id; lastPastMarkup = ''; render();
    const folded = target.closest('details');
    if (folded) folded.open = true;
    target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    transcript.querySelectorAll('[data-summary-flash]').forEach(node => node.removeAttribute('data-summary-flash'));
    target.setAttribute('data-summary-flash', '');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => target.removeAttribute('data-summary-flash'), 1800);
  }
  $('#wbSummaryPast').addEventListener('click', event => {
    const button = event.target.closest('[data-summary-past]');
    if (button) showPast(button.dataset.summaryPast);
  });
  // One observation tick can miss the AI process (a slow or skipped scan).
  // Leaving Summary then hides the composer mid-typing and ends a Korean
  // composition, so the view only gives up after the AI has stayed missing.
  const MISSING_GRACE_MS = 3000, FOCUSED_GRACE_MS = 30000;
  let missing = null, composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('blur', () => { composing = false; });
  function holdSummary(id, value) {
    if (value?.mode !== 'summary' || root.querySelector('#wbSummary').hidden || !selected.startsWith(`${id}:`)) { missing = null; return false; }
    const key = `${id}:${value.creationId}`, now = Date.now();
    if (missing?.key !== key) missing = { key, since: now };
    const typing = document.activeElement === input;
    // Never pull the composer away during a composition; a focused composer
    // waits longer, and an ended AI session still falls back after that.
    return composing && typing || now - missing.since < (typing ? FOCUSED_GRACE_MS : MISSING_GRACE_MS);
  }
  // The transcript with its clear/compact dividers. Everything before the
  // last clear folds into one closed group the user can open again.
  function withMarks(value, parts) {
    const marks = [...(value.marks || [])].sort((a, b) => a.at - b.at), cut = lastClear(value);
    const rows = [];
    let next = 0;
    // Queued requests (not sent yet) always follow the dividers.
    const placed = part => part.html && (!part.user || part.time);
    for (const part of parts) {
      while (next < marks.length && placed(part) && marks[next].at <= part.time) rows.push({ time: marks[next].at, mark: marks[next++] });
      rows.push(part);
    }
    while (next < marks.length) rows.push({ time: marks[next].at, mark: marks[next++] });
    const html = row => row.mark ? `<div class="wb-summary-mark" data-summary-mark="${esc(row.mark.kind)}" role="separator"><span>${esc(markText(row.mark))}</span></div>` : row.html;
    const before = cut ? rows.filter(row => row.time < cut || row.mark && row.time <= cut && row.mark.at !== cut) : [];
    const after = rows.filter(row => !before.includes(row));
    const visible = after.filter(row => !row.mark).length;
    const count = before.filter(row => row.user).length;
    const folded = count ? `<details class="wb-summary-cleared" data-summary-cleared><summary>${esc(t('비우기 전 대화 {count}개 보기').replace('{count}', count))}</summary>${before.map(html).join('')}</details>` : '';
    const empty = cut && !visible ? `<div class="wb-summary-empty" data-summary-cleared-empty><h1>${esc(t('대화를 비웠어요.'))}</h1><p>${esc(t('AI는 앞의 대화를 기억하지 않아요. 지난 요청에서 이전 요약을 다시 볼 수 있어요.'))}</p></div>` : '';
    return folded + after.map(html).join('') + empty;
  }
  function render() {
    const id = context.activeId(), value = record(id), available = eligible(id), member = context.member(id);
    const stillRunning = member && member.providerPid > 0 && SUMMARY_PROVIDERS.includes(member.provider)
      && member.creationId === context.session(id)?.creationId && member.pid === context.session(id)?.pid;
    if (stillRunning) missing = null;
    // Keep the current Summary view untouched while the AI is briefly unobserved.
    else if (holdSummary(id, value)) return;
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
    mergeAnswers(value);
    root.querySelector('#wbSummaryTarget').textContent = context.title?.(id) || context.label(id);
    root.querySelector('#wbSummaryTarget').title = context.label(id);
    root.querySelector('#wbSummaryProvider').textContent = PROVIDER_NAMES[member.provider] || '';
    $('#wbSummaryConnection').dataset.connected = String(available);
    $('#wbSummaryConnectionState').textContent = t(available ? '같은 대화에 연결됨' : '연결 확인 중');
    // The model and effort of the AI's latest reply, read from its own log.
    const activity = member.activity || {};
    const usageApi = window.WhiteboxSummaryUsage;
    $('#wbSummaryModel').textContent = usageApi ? usageApi.modelLabel(activity.model) : '';
    const level = usageApi ? usageApi.effortLevel(activity.effort) : 0;
    $('#wbSummaryEffort').hidden = !level;
    $('#wbSummaryEffortValue').textContent = level ? activity.effort : '';
    $('#wbSummaryEffort').title = level ? `${t('추론 강도')} · ${activity.effort}` : '';
    $('#wbSummaryEffort').querySelectorAll('.wb-summary-effort-level i').forEach((bar, index) => bar.classList.toggle('is-on', index < level));
    usage?.render({ terminalId: id, provider: member.provider, activity, tasks: tasksFor(id) });
    if (selected !== `${id}:${value.creationId}`) {
      selected = `${id}:${value.creationId}`; input.value = value.draft; notice.textContent = ''; lastMarkup = ''; lastPastMarkup = ''; pastSelected = ''; closeCommands();
    }
    renderAttachments(value);
    const states = { queued: t('전송 대기'), sending: t('전송 중…'), sent: t('전송됨'), cancelled: t('전송 취소'), interrupted: t('전송 확인 필요'), stopped: t('멈춤') };
    let askedBefore = null;
    const parts = value.messages.map(message => ({ time: messageTime(message), user: message.role === 'user', html: (() => {
      const asked = askedBefore;
      if (message.role === 'answer') askedBefore = message.task;
      if (message.role === 'answer') {
        const task = message.task;
        const retained = window.WhiteboxReviewDecision.matchesRetainedAnalysis(task, retainedFailure);
        if (!retained && summaryPending(task, review)) return '';
        const decision = window.WhiteboxReviewDecision, analyzed = decision.render(task, { t, esc, taskKey: message.key, draftActions: true, chip: false, draftText: draftCache(id, task) });
        const failed = !analyzed && task.summaryFailure ? task.summaryFailure : null, passThrough = !analyzed && !failed && task.passThrough;
        const kind = failed ? 'failed' : passThrough ? 'pass-through' : 'summary';
        const heading = { failed: '요약하지 못했어요 · AI 원문', 'pass-through': 'AI 답변 · 짧아서 그대로 보여요', summary: 'Whitebox 요약' }[kind];
        const body = analyzed || (failed || passThrough
          ? `${failed ? `<div class="wb-summary-failure" data-summary-failure><p>${esc(t(FAILURE_REASON[failed.kind] || FAILURE_REASON.transient))}</p>${control('다시 요약', 'data-summary-retry', retryBusy, 'secondary')}</div>` : ''}<p class="wb-summary-reply">${decision.plainReply(task.actual || '', esc)}</p>${passThrough ? decision.renderChoices(task.choices, { t, esc }) : ''}`
          : `<p class="wb-summary-answer-fallback">${esc(task.actual || task.explanation || task.summary || '')}</p>`);
        const shape = analyzed && decision.SHAPES[task.content?.shape] ? task.content.shape : '';
        const chooser = shape ? task.analysisGate?.shape === shape ? 'Jev가 모양을 골랐어요' : '요약 모델이 모양을 골랐어요' : '';
        return `<article class="wb-summary-answer" data-result-kind="${kind}"${shape ? ` data-shape="${esc(shape)}"` : ''}><div class="wb-summary-answer-heading"><span class="wb-summary-answer-mark" aria-hidden="true">W</span><b>${esc(t(heading))}</b>${shape ? `<span class="wb-content-shape" data-shape="${esc(shape)}">${esc(t(decision.SHAPES[shape]))}</span>` : ''}${chooser ? `<small>${esc(t(chooser))}</small>` : ''}</div>${retained ? `<div class="wb-summary-retained-notice" data-retained-analysis><strong>${esc(t(retainedFailure.title))}</strong><p>${esc(t(retainedFailure.description))}</p>${review.message ? `<details><summary>${esc(t('실패 상세'))}</summary><p>${esc(review.message)}</p></details>` : ''}${control('다시 검토', 'data-summary-retry', retryBusy, 'secondary')}</div>` : ''}<div class="wb-summary-answer-body">${body}</div><footer class="wb-summary-answer-actions">${control('원래 답변 보기', 'data-summary-terminal')}${control('복사', 'data-summary-copy')}</footer></article>`;
      }
      const timestamp = clock(message.sentAt || message.at);
      // The user's own words sit in a bubble on the right; when and how it was
      // sent, and whether it answered the AI's question, read under it.
      const judgement = message.role === 'user' && asksUser(asked);
      return `<article class="wb-summary-user" data-state="${esc(message.state)}" data-summary-message="${esc(message.id)}"><div class="wb-summary-bubble"><p>${esc(message.text)}</p>${userImages(message)}</div><div class="wb-summary-label">${judgement ? `<em data-summary-judgement>${esc(t('판단'))}</em>` : ''}<span>${esc(states[message.state] || '')}${timestamp ? ` · ${esc(timestamp)}` : ''}</span></div>${message.error ? `<p class="wb-summary-delivery-error">${esc(message.error)}</p>${message.state === 'interrupted' && !message.answerKey ? control('다시 보내기', `data-summary-resend="${esc(message.id)}"`, false, 'secondary') : ''}${control('터미널에서 확인', 'data-summary-terminal')}` : ''}${message.state === 'queued' && WAIT[message.wait] ? `<p class="wb-summary-queue-note" data-summary-wait="${esc(message.wait)}">${esc(t(WAIT[message.wait]))}</p>` : ''}${message.state === 'queued' ? `<div class="wb-summary-queue-actions">${control('그래도 전송하기', `data-summary-send-now="${esc(message.id)}"`)}${control('수정', `data-summary-edit="${esc(message.id)}"`, Boolean(value.draft || value.attachments?.length))}${control('취소', `data-summary-cancel="${esc(message.id)}"`)}</div>` : ''}</article>`;
    })() })).filter(part => part.html);
    let markup = withMarks(value, parts);
    if (!markup) markup = `<div class="wb-summary-empty"><span>${esc(t('이해 · 검토'))}</span><h1>${esc(t('요약을 읽고, 다음 요청을 이어가세요.'))}</h1><p>${esc(t('같은 AI 세션에서 대화를 이어갑니다.'))}</p></div>`;
    const prompt = detectedPrompt(id);
    if (prompt) {
      const raw = context.snapshot(id).text || '';
      markup += `<article class="wb-summary-prompt" role="group" aria-label="${esc(t('응답이 필요합니다'))}"><h2>${esc(prompt.question)}</h2><pre>${esc(raw.slice(-8000))}</pre><div>${prompt.choices.map(choice => control(choice.label, `data-summary-choice="${esc(choice.id)}"`, approvalBusy, 'secondary', false)).join('')}</div></article>`;
    } else if (member.activity?.state === 'waiting') {
      markup += `<article class="wb-summary-prompt"><p>${esc(permissionText(member.activity.progress))}</p>${control('터미널에서 확인', 'data-summary-terminal')}</article>`;
    }
    if (markup !== lastMarkup) {
      const nearBottom = list.scrollHeight - list.clientHeight - list.scrollTop < 80;
      const opened = [...list.querySelectorAll('details')].map((node, index) => node.open ? index : -1);
      for (const host of actionHosts) ui?.clear?.(host);
      actionHosts.clear();
      transcript.innerHTML = markup; lastMarkup = markup; mountControls(); fillDrafts();
      list.querySelectorAll('details').forEach((node, index) => { node.open = opened.includes(index); });
      if (nearBottom) list.scrollTop = list.scrollHeight;
    }
    renderPast(value, renderProgress(value, member, review, prompt));
    // Keep the composer editable: `available` also drops for a slow or briefly
    // missing observation, and disabling the focused textarea ends a Korean
    // composition and drops keys. Sending stays gated by the button and submit.
    input.disabled = false;
    const nextSendKey = JSON.stringify([t('전송'), available]);
    if (ui?.actionButton && $('#wbSummarySendHost') && nextSendKey !== sendKey) {
      ui.actionButton($('#wbSummarySendHost'), { label: `${t('전송')} ↑`, type: 'submit', variant: 'primary' });
      $('#wbSummarySendHost button').id = 'wbSummarySend'; sendKey = nextSendKey;
    }
    // A briefly unobserved AI still takes the request; it waits in the queue.
    root.querySelector('#wbSummarySend').disabled = !known(id);
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
    render, observe, setMode, eligible, markReset,
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
    serializeUsage: () => usage?.serialize() || null,
    restoreUsage(value) { usage?.restore(value); },
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
        for (const message of messages) {
          const images = cleanAttachments(message.attachments);
          if (images.length) message.attachments = images; else delete message.attachments;
          if (typeof message.delivered !== 'string' || message.delivered.length > 8000) delete message.delivered;
        }
        records.set(item.id, { id: item.id, creationId: item.creationId, mode: item.mode === 'summary' ? 'summary' : 'terminal',
          draft: String(item.draft || '').slice(0, 8000), attachments: cleanAttachments(item.attachments), messages,
          marks: (Array.isArray(item.marks) ? item.marks : []).filter(mark => MARK_KINDS.includes(mark?.kind) && Number.isFinite(mark.at) && mark.at > 0)
            .map(mark => ({ kind: mark.kind, at: mark.at })).sort((a, b) => a.at - b.at).slice(-50) });
      }
    },
    forget(id) { records.delete(id); },
  };
};
