'use strict';

(() => {
  const bridge = window.attentionPopup;
  const card = document.getElementById('popupCard');
  let current = null;
  let currentRevision = '';
  let lifecycle = 0;
  let busy = false;
  let measureFrame = 0;
  let pushedRequestSeen = false;
  let refreshQuestionPager = null;

  const copy = {
    ko: {
      dismiss: '닫기', other: '기타', required: '필수 답변입니다.', failed: '요청을 처리하지 못했습니다.',
      permissionActions: '권한 선택', questionActions: '질문 응답', terminalActions: '터미널 선택', requestDetail: '요청 내용',
      previous: '이전', next: '다음', questionPage: '질문',
    },
    en: {
      dismiss: 'Dismiss', other: 'Other', required: 'This answer is required.', failed: 'The request could not be processed.',
      permissionActions: 'Permission choices', questionActions: 'Question response', terminalActions: 'Terminal choices', requestDetail: 'Request details',
      previous: 'Previous', next: 'Next', questionPage: 'Question',
    },
    'zh-CN': {
      dismiss: '关闭', other: '其他', required: '此项为必答。', failed: '无法处理请求。',
      permissionActions: '权限选择', questionActions: '问题回答', terminalActions: '终端选择', requestDetail: '请求内容',
      previous: '上一题', next: '下一题', questionPage: '问题',
    },
  };

  function localeText(key) {
    return (copy[current && current.locale] || copy.ko)[key] || copy.ko[key];
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function visibleTextInput() {
    return [...card.querySelectorAll('textarea, input[type="text"]')]
      .some(input => !input.disabled && input.offsetParent !== null);
  }

  function scheduleMeasure(expectedLifecycle = lifecycle) {
    if (measureFrame) cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(() => {
      measureFrame = 0;
      if (expectedLifecycle !== lifecycle) return;
      const height = Math.ceil(Math.max(card.scrollHeight, card.getBoundingClientRect().height));
      bridge.resize({ height, hasTextInput: visibleTextInput() }).catch(error => {
        if (expectedLifecycle === lifecycle) showFailure(error);
      });
    });
  }

  function showFailure(error) {
    const message = error && error.message || localeText('failed');
    const target = card.querySelector('.popup-error');
    if (target) target.textContent = message;
  }

  function setBusy(next) {
    busy = Boolean(next);
    card.setAttribute('aria-busy', String(busy));
    for (const control of card.querySelectorAll('button, input, textarea')) control.disabled = busy;
    refreshQuestionPager?.();
  }

  async function perform(operation) {
    if (busy) return;
    const expectedLifecycle = lifecycle;
    setBusy(true);
    const errorTarget = card.querySelector('.popup-error');
    if (errorTarget) errorTarget.textContent = '';
    try {
      const result = await operation();
      if (!result || result.ok !== true) {
        const error = new Error(result && result.error && result.error.message || localeText('failed'));
        if (result && result.error && result.error.code) error.code = result.error.code;
        throw error;
      }
    } catch (error) {
      if (expectedLifecycle !== lifecycle) return;
      setBusy(false);
      showFailure(error);
      scheduleMeasure(expectedLifecycle);
    }
  }

  function button(label, className, action) {
    const control = element('button', `popup-button ${className || ''}`.trim(), label);
    control.type = 'button';
    control.addEventListener('click', action);
    return control;
  }

  function actionGroup(className, label) {
    const group = element('div', `popup-actions ${className || ''}`.trim());
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    return group;
  }

  function describedButton(label, className, description, descriptionId, action) {
    const control = button('', className, action);
    control.setAttribute('aria-label', label);
    control.append(element('span', 'popup-button-label', label));
    if (description) {
      const detail = element('span', 'popup-button-description', description);
      detail.id = descriptionId;
      control.setAttribute('aria-describedby', detail.id);
      control.append(detail);
    }
    return control;
  }

  function renderHeader(container, request) {
    const header = element('header', 'popup-header');
    const heading = element('div', 'popup-heading');
    const title = element('h1', 'popup-title', request.title);
    title.id = 'popupTitle';
    const eyebrow = element('div', 'popup-eyebrow');
    if (request.provider) eyebrow.append(element('span', 'popup-provider', request.provider));
    if (request.project) {
      const project = element('span', 'popup-project', request.project);
      project.title = request.projectPath || request.project;
      eyebrow.append(project);
    }
    if (eyebrow.childNodes.length) heading.append(eyebrow);
    heading.append(title);
    const requestMeta = request.meta;
    if (request.toolLabel || requestMeta) {
      const context = element('div', 'popup-request-context');
      if (request.toolLabel) context.append(element('span', 'popup-tool-pill', request.toolLabel));
      if (requestMeta) context.append(element('span', 'popup-meta', requestMeta));
      heading.append(context);
    }
    header.append(heading);
    if (request.dismissible) {
      const dismiss = element('button', 'popup-dismiss', '×');
      dismiss.type = 'button';
      dismiss.setAttribute('aria-label', localeText('dismiss'));
      dismiss.addEventListener('click', () => perform(() => bridge.dismiss()));
      header.append(dismiss);
    }
    container.append(header);
  }

  function renderCopy(container, request) {
    const descriptionIds = [];
    if (request.type === 'permission') {
      if (request.body && request.detail && request.detail !== request.body) {
        const body = element('p', 'popup-body', request.body);
        body.id = 'popupBody';
        descriptionIds.push(body.id);
        container.append(body);
      }
      const commandText = request.detail || request.body;
      if (commandText) {
        const command = element('pre', 'popup-command', commandText);
        command.id = 'popupCommand';
        command.setAttribute('role', 'region');
        command.setAttribute('aria-label', localeText('requestDetail'));
        descriptionIds.push(command.id);
        container.append(command);
      }
      return descriptionIds;
    }
    if (request.body) {
      const body = element('p', 'popup-body', request.body);
      body.id = 'popupBody';
      descriptionIds.push(body.id);
      container.append(body);
    }
    if (request.detail && request.detail !== request.body) {
      const detail = element('p', 'popup-detail', request.detail);
      detail.id = 'popupDetail';
      descriptionIds.push(detail.id);
      container.append(detail);
    }
    return descriptionIds;
  }

  function renderPermission(container, request) {
    const actions = actionGroup('permission-actions', localeText('permissionActions'));
    actions.append(button(request.allowLabel, 'allow', () => perform(() => bridge.decide({ action: 'allow' }))));
    actions.append(button(request.denyLabel, 'deny', () => perform(() => bridge.decide({ action: 'deny' }))));
    const suggestions = Array.isArray(request.permissionSuggestions) ? request.permissionSuggestions : [];
    suggestions.forEach((suggestion, index) => {
      const raw = suggestion && typeof suggestion === 'object' ? suggestion : { id: suggestion, label: suggestion };
      const suggestionId = String(raw.id || '').trim();
      const label = String(raw.label || '').trim();
      if (!suggestionId || !label) return;
      actions.append(describedButton(
        label,
        'suggestion full-width',
        String(raw.description || '').trim(),
        `permissionSuggestionDescription${index}`,
        () => perform(() => bridge.decide({ action: 'suggestion', suggestionId })),
      ));
    });
    if (request.openMain) {
      actions.append(button(request.openMainLabel, 'open-main full-width', () => perform(() => bridge.openMain())));
    }
    container.append(actions);
  }

  function renderTerminal(container, request) {
    const actions = actionGroup('terminal-actions', localeText('terminalActions'));
    request.choices.forEach((choice, index) => actions.append(describedButton(
      choice.label,
      choice.tone,
      choice.description,
      `terminalChoiceDescription${index}`,
      () => perform(() => bridge.decide({ action: 'choice', choiceId: choice.id })),
    )));
    container.append(actions);
  }

  function optionControl(question, option, groupName, otherWrap) {
    const wrapper = element('label', 'popup-option');
    const input = document.createElement('input');
    input.type = question.multiple ? 'checkbox' : 'radio';
    input.name = groupName;
    input.value = option.value;
    input.dataset.questionId = question.id;
    input.dataset.other = option.isOther ? 'true' : 'false';
    const optionCopy = element('span', 'option-copy');
    optionCopy.append(element('span', 'option-label', option.label));
    if (option.description) optionCopy.append(element('span', 'option-description', option.description));
    wrapper.append(input, optionCopy);
    input.addEventListener('change', () => {
      if (otherWrap) {
        const selectedOther = [...wrapper.parentElement.querySelectorAll('input[data-other="true"]')].some(item => item.checked);
        otherWrap.hidden = !selectedOther;
        if (selectedOther) {
          requestAnimationFrame(() => {
            const otherInput = otherWrap.querySelector('input');
            if (otherInput) otherInput.focus();
          });
        }
      }
      scheduleMeasure();
    });
    return wrapper;
  }

  function renderQuestionField(question, index) {
    const field = element('fieldset', 'popup-question');
    field.dataset.questionId = question.id;
    const legend = element('legend');
    if (question.header) legend.append(element('span', 'question-header', question.header));
    legend.append(document.createTextNode(question.question));
    field.append(legend);
    if (question.description) field.append(element('p', 'question-description', question.description));

    if (!question.options.length) {
      const input = element('textarea', 'popup-text');
      input.rows = 3;
      input.maxLength = 10000;
      input.placeholder = question.placeholder;
      input.dataset.freeText = 'true';
      input.required = question.required;
      field.append(input);
      return field;
    }

    const optionList = element('div', 'option-list');
    const groupName = `question-${index}`;
    const otherWrap = element('div', 'popup-other-wrap');
    otherWrap.hidden = true;
    const otherText = element('input', 'popup-other-text');
    otherText.type = 'text';
    otherText.maxLength = 10000;
    otherText.placeholder = question.placeholder;
    otherWrap.append(otherText);
    const options = [...question.options];
    if (question.allowOther && !options.some(option => option.isOther)) {
      options.push({ id: '__other__', value: '', label: localeText('other'), description: '', isOther: true });
    }
    for (const option of options) optionList.append(optionControl(question, option, groupName, otherWrap));
    field.append(optionList);
    if (question.allowOther) field.append(otherWrap);
    return field;
  }

  function collectAnswers(request, form, revealInvalid) {
    const answers = [];
    let invalid = null;
    for (const question of request.questions) {
      const field = form.querySelector(`fieldset[data-question-id="${CSS.escape(question.id)}"]`);
      if (!question.options.length) {
        const textInput = field.querySelector('[data-free-text="true"]');
        const answerText = textInput.value.trim();
        if (question.required && !answerText && !invalid) invalid = textInput;
        answers.push({ questionId: question.id, values: [], otherText: '', text: answerText });
        continue;
      }
      const checked = [...field.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')];
      const values = checked.filter(input => input.dataset.other !== 'true').map(input => input.value);
      const otherSelected = checked.some(input => input.dataset.other === 'true');
      const otherInput = field.querySelector('.popup-other-text');
      const otherText = otherSelected && otherInput ? otherInput.value.trim() : '';
      if (question.required && !values.length && !otherText && !invalid) invalid = otherSelected && otherInput ? otherInput : checked[0] || field.querySelector('input');
      if (otherSelected && !otherText && !invalid) invalid = otherInput;
      answers.push({ questionId: question.id, values, otherText, text: '' });
    }
    if (invalid) {
      revealInvalid?.(invalid);
      invalid.focus();
      throw new Error(localeText('required'));
    }
    return answers;
  }

  function renderQuestions(container, request) {
    const form = element('form', 'popup-form');
    // Validation can reveal a missing answer on an earlier page before focus.
    // Native required validation would try to focus a hidden textarea instead.
    form.noValidate = true;
    const paged = request.questions.length > 1;
    let page = 0;
    const progress = element('p', 'question-progress');
    progress.setAttribute('role', 'status');
    progress.setAttribute('aria-live', 'polite');
    progress.setAttribute('aria-atomic', 'true');
    if (paged) form.append(progress);
    const questions = element('div', 'popup-questions');
    const fields = request.questions.map(renderQuestionField);
    fields.forEach(field => questions.append(field));
    form.append(questions);
    const actions = actionGroup(`question-actions${request.canDeny ? ' has-deny' : ''}${paged ? ' is-paged' : ''}`, localeText('questionActions'));
    const previous = button(`← ${localeText('previous')}`, 'question-previous', () => showPage(page - 1));
    const next = button(`${localeText('next')} →`, 'primary question-next', () => showPage(page + 1));
    if (paged) actions.append(previous, next);
    const submit = button(request.submitLabel, 'primary question-submit');
    submit.type = 'submit';
    actions.append(submit);
    if (request.canDeny) {
      actions.append(button(request.denyLabel, 'deny question-deny', () => perform(() => bridge.decide({ action: 'deny' }))));
    }
    if (request.openMain) {
      actions.append(button(request.openMainLabel, 'open-main full-width', () => perform(() => bridge.openMain())));
    }
    form.append(actions);
    function refreshPager() {
      fields.forEach((field, index) => { field.hidden = paged && index !== page; });
      progress.textContent = `${localeText('questionPage')} ${page + 1} / ${fields.length}`;
      previous.disabled = busy || page === 0;
      next.disabled = busy;
      next.hidden = page === fields.length - 1;
      submit.hidden = paged && page !== fields.length - 1;
    }
    function showPage(index) {
      if (busy) return;
      page = Math.max(0, Math.min(fields.length - 1, index));
      refreshPager();
      const error = card.querySelector('.popup-error');
      if (error) error.textContent = '';
      card.scrollTop = 0;
      fields[page].querySelector('input, textarea')?.focus();
      scheduleMeasure();
    }
    refreshQuestionPager = refreshPager;
    refreshPager();
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (busy) return;
      if (paged && page < fields.length - 1) { showPage(page + 1); return; }
      try {
        const answers = collectAnswers(request, form, invalid => {
          const index = fields.findIndex(field => field.contains(invalid));
          if (index >= 0) showPage(index);
        });
        perform(() => bridge.decide({ action: 'answer', answers }));
      } catch (error) {
        showFailure(error);
        scheduleMeasure();
      }
    });
    container.append(form);
  }

  function renderInput(container, request) {
    const actions = actionGroup('input-actions', localeText('questionActions'));
    actions.append(button(request.openMainLabel, 'primary', () => perform(() => bridge.openMain())));
    container.append(actions);
  }

  function render(request) {
    if (!request || !request.id) return;
    const revision = JSON.stringify(request);
    if (current && revision === currentRevision) return;
    currentRevision = revision;
    lifecycle += 1;
    current = request;
    busy = false;
    refreshQuestionPager = null;
    document.documentElement.lang = request.locale || 'ko';
    document.title = `${request.title || '확인 요청'} · Whitebox`;
    card.replaceChildren();
    card.dataset.type = request.type;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-labelledby', 'popupTitle');
    card.setAttribute('aria-busy', 'false');
    renderHeader(card, request);
    const content = element('section', 'popup-content');
    const descriptionIds = renderCopy(content, request);
    if (descriptionIds.length) card.setAttribute('aria-describedby', descriptionIds.join(' '));
    else card.removeAttribute('aria-describedby');
    if (request.type === 'permission') renderPermission(content, request);
    else if (request.type === 'terminal-approval') renderTerminal(content, request);
    else if (request.type === 'question') renderQuestions(content, request);
    else renderInput(content, request);
    const error = element('p', 'popup-error');
    error.setAttribute('role', 'alert');
    error.setAttribute('aria-live', 'assertive');
    error.setAttribute('aria-atomic', 'true');
    content.append(error);
    card.append(content);
    scheduleMeasure(lifecycle);
  }

  if (!bridge) {
    card.replaceChildren(element('div', 'popup-loading', 'Popup bridge is unavailable.'));
    return;
  }

  bridge.onRequest(request => {
    pushedRequestSeen = true;
    render(request);
  });
  bridge.onError(error => showFailure(error));
  bridge.ready(false).then(result => {
    if (!result || !result.ok || !result.request) throw new Error(localeText('failed'));
    if (!pushedRequestSeen) render(result.request);
  }).catch(showFailure);

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => scheduleMeasure());
    observer.observe(card);
  }
})();
