(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WhiteboxReviewDecision = api;
})(typeof window === 'undefined' ? null : window, () => {
  'use strict';
  const validContent = content => [1, 2].includes(content?.version) && typeof content.answer?.text === 'string'
    && ['observed', 'reported', 'inference', 'unknown'].includes(content.answer.basis)
    && Array.isArray(content.details) && content.details.length <= 8 && content.details.every(item => typeof item?.text === 'string')
    && Array.isArray(content.limitations) && content.limitations.length <= 6 && content.limitations.every(item => typeof item?.text === 'string')
    && Array.isArray(content.deliverables) && content.deliverables.length <= 8 && content.deliverables.every(item => typeof item?.label === 'string' && typeof item?.value === 'string'
      && (item.usage === undefined || item.kind === 'command' && ['recorded', 'historical'].includes(item.usage))
      && (item.usageNote == null || typeof item.usageNote.text === 'string')
      && (item.usage !== 'historical' || typeof item.usageNote?.text === 'string'))
    && (content.subject == null || typeof content.subject.text === 'string')
    && (content.background === undefined || Array.isArray(content.background) && content.background.length <= 8 && content.background.every(item => typeof item?.text === 'string'))
    && (content.nextAction == null || typeof content.nextAction.text === 'string')
    && (content.handoff == null || ['verify','decide','continue','finish','reply'].includes(content.handoff.kind)
      && typeof content.handoff.priority?.text === 'string'
      && (content.handoff.temporal == null || typeof content.handoff.temporal.text === 'string')
      && (content.handoff.kind === 'finish' ? content.handoff.prompt == null : typeof content.handoff.prompt?.text === 'string'));
  function displayTitle(task) {
    const title = validContent(task.content) && task.content.subject?.text || task.summary || task.request || '';
    return typeof window !== 'undefined' && window.WhiteboxTerminalReviewTurns?.isNonTaskRequest(title) ? task.request || '' : title;
  }
  function applyHistoryContent(task, entries, sessionId, creationId) {
    if (!Array.isArray(entries)) return task;
    const match = entries.find(item => item.sessionId === sessionId && (!item.creationId || item.creationId === creationId)
      && ['taskId', 'analysisId', 'request', 'evidenceDigest'].every(key => (task[key] || '') === item.identity?.[key]));
    return match && validContent(match.content) ? { ...task, content: match.content, contentIssues: [],
      contentGeneratedAt: match.generatedAt, contentUsage: match.usage } : task;
  }
  function matchesRetainedAnalysis(task, failure) {
    return Boolean(failure && task?.taskId && task.analysisId
      && task.taskId === failure.taskId && task.analysisId === failure.retainedAnalysisId);
  }
  function reviewFailure(review) {
    const failure = review?.state === 'error' && review.failure;
    const previous = failure && review.result?.tasks?.find(task => matchesRetainedAnalysis(task, failure)
      && !task.recordOnly && !task.deferred);
    if (!previous) return null;
    const partial = failure.retainedLifecycle === 'in-progress';
    return { ...failure,
      title: failure.kind === 'reanalysis' ? '다시 분석하지 못했습니다' : partial ? '최종 분석을 완료하지 못했습니다' : '추가 분석을 완료하지 못했습니다',
      description: failure.kind === 'reanalysis' ? '기존 분석은 보존했습니다. 다시 분석하는 과정에서 오류가 발생했습니다.'
        : partial ? '작업 중 작성된 분석은 보존했습니다. 최종 답변은 다시 검토해 주세요.'
          : '이전 분석은 보존했습니다. 이후 갱신된 기록은 다시 검토해 주세요.' };
  }
  // Summary claims arrive as one run of sentences; one sentence per line reads
  // far better, especially in the large answer text. Only a sentence end
  // followed by a space splits: versions (2.0.26), list numbers ("1. ") and
  // common abbreviations stay intact. Explicit newlines are kept.
  const SENTENCE_END = /(?<=(?:[\p{Script=Hangul}\p{Script=Han}A-Za-z)\]"'”’`][.!?]|[。！？]))[ \t]+(?=\S)/gu;
  const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|no|mr|ms|dr)\.$/iu;
  function sentences(text) {
    const lines = [];
    for (const line of String(text || '').split('\n')) {
      let from = 0;
      for (const match of line.matchAll(SENTENCE_END)) {
        const head = line.slice(from, match.index), tail = line.slice(match.index + match[0].length);
        // "e.g. x" and an English period before a lowercase word continue the sentence.
        if (ABBREVIATION.test(head) || /[A-Za-z]\.$/u.test(head) && /^[a-z]/u.test(tail)) continue;
        lines.push(head); from = match.index + match[0].length;
      }
      lines.push(line.slice(from));
    }
    return lines;
  }
  const prose = (text, esc) => sentences(text).map(esc).join('<br>');
  // A pipe table in an output reads as a table, not as raw markdown. Anything
  // that is not a well-formed table stays the exact original text.
  function markdownTable(value, esc) {
    const lines = String(value || '').trim().split('\n');
    const cells = line => line.trim().replace(/^\||\|$/gu, '').split('|').map(cell => cell.trim());
    if (lines.length < 3 || lines.length > 60 || !lines.every(line => /^\s*\|.*\|\s*$/u.test(line))
      || !/^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/u.test(lines[1])) return '';
    const head = cells(lines[0]), rows = lines.slice(2).map(cells);
    if (head.length < 2 || cells(lines[1]).length !== head.length || rows.some(row => row.length !== head.length)) return '';
    const strip = cell => cell.replace(/\*\*|`/gu, '');
    return `<div class="wb-content-table"><table><thead><tr>${head.map(cell => `<th>${esc(strip(cell))}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${esc(strip(cell))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const validChoices = value => (Array.isArray(value) ? value : []).filter(block => typeof block?.question === 'string'
    && Array.isArray(block.options) && block.options.length >= 2 && block.options.length <= 8
    && block.options.every(option => typeof option?.label === 'string' && typeof option.text === 'string')
    && (block.recommendation == null || typeof block.recommendation.label === 'string' && typeof block.recommendation.text === 'string')).slice(0, 3);
  // Every option of a question a reply ends with, verbatim from the reply.
  function renderChoices(value, { t, esc }) {
    return validChoices(value).map(block => `<div class="wb-task-section wb-content-choices"><h3>${esc(t('답해야 할 질문'))}</h3><p>${esc(block.question)}</p><ol>${block.options.map(option => `<li data-recommended="${block.recommendation?.label === option.label}"><b>${esc(option.label)}</b> ${esc(option.text)}${block.recommendation?.label === option.label ? ` <small>${esc(t('답변의 권장'))}</small>` : ''}</li>`).join('')}</ol>${block.recommendation ? `<p class="wb-content-time">${esc(block.recommendation.text)}</p>` : ''}</div>`).join('');
  }
  // The summary's shape follows what the user wanted from the turn.
  const SHAPES = { draft: '초안', change: '코드 변경', answer: '설명 · 답', review: '조사 · 리뷰', decision: '판단 요청' };
  const shapeChip = (shape, { t, esc }) => SHAPES[shape] ? `<p class="wb-content-shape" data-shape="${esc(shape)}">${esc(t(SHAPES[shape]))}</p>` : '';
  const HEADINGS = {
    change: { details: '바꾼 것', limitations: '확인하지 못한 것' },
    review: { details: '찾은 것 · 심각한 순', limitations: '살펴보지 못한 범위' },
    answer: { details: '근거와 설명', limitations: '확인한 범위와 남은 점' },
    decision: { handoff: '정할 것' },
  };
  // The headings of a draft, in order, as its outline.
  const outlineOf = text => (String(text || '').match(/^#{1,4}[ \t]+[^\n]+/gmu) || []).slice(0, 20);
  const headingText = line => String(line).replace(/^#{1,6}[ \t]+/u, '').replace(/\*\*|`/gu, '').trim().slice(0, 60);
  // The draft's own opening words, without heading marks.
  function opening(text) {
    const body = String(text || '').split('\n').filter(line => line.trim() && !/^\s*(?:#{1,6}\s|\|?\s*:?-{3,})/u.test(line))
      .map(line => line.replace(/\*\*|__|`/gu, '').trim()).join(' ');
    return body.length > 260 ? `${body.slice(0, 260)}…` : body;
  }
  function renderDraft(task, { t, esc, actions = false }) {
    const content = task.content, draft = task.draft || {}, file = typeof draft.path === 'string' ? draft.path : '';
    const source = typeof draft.text === 'string' ? draft.text : typeof draft.opening === 'string' ? draft.opening : '';
    const outline = (Array.isArray(draft.outline) && draft.outline.length ? draft.outline : outlineOf(source)).map(headingText).filter(Boolean);
    const handoff = content.handoff && content.handoff.kind !== 'finish' ? content.handoff : null;
    const key = esc(task.taskId || '');
    return `<section class="wb-decision wb-answer-content wb-draft" data-shape="draft" aria-label="${esc(t('초안 요약'))}">
      ${shapeChip('draft', { t, esc })}
      <div class="wb-draft-card">
        <p class="wb-draft-lead">${prose(content.answer.text, esc)}</p>
        ${content.details.length ? `<ul class="wb-draft-points">${content.details.map(item => `<li>${prose(item.text, esc)}</li>`).join('')}</ul>` : ''}
        ${outline.length > 1 ? `<ol class="wb-draft-outline" aria-label="${esc(t('초안 구성'))}">${outline.map(line => `<li>${esc(line)}</li>`).join('')}</ol>` : ''}
      </div>
      ${opening(source) ? `<blockquote class="wb-draft-opening">${esc(opening(source))}</blockquote>` : ''}
      <details class="wb-draft-full" data-summary-draft="${key}" data-draft-source="${file ? 'file' : 'reply'}"><summary>${esc(t('초안 전체 보기'))}</summary><pre class="wb-draft-text">${file ? '' : esc(source)}</pre></details>
      ${actions || file ? `<div class="wb-draft-tools">${file ? `<code title="${esc(file)}">${esc(file.replace(/^\/Users\/[^/]+/u, '~'))}</code>` : ''}${actions ? `<span>${file ? `<button type="button" data-summary-draft-open="${key}">${esc(t('파일 열기'))}</button>` : ''}<button type="button" data-summary-draft-copy="${key}">${esc(t('초안 복사'))}</button></span>` : ''}</div>` : ''}
      ${handoff ? `<div class="wb-task-section wb-draft-check"><h3>${esc(t('보내기 전에 정할 것'))}</h3><p>${prose(handoff.priority.text, esc)}</p>${handoff.prompt ? `<blockquote>${esc(handoff.prompt.text)}</blockquote>` : ''}</div>` : ''}
      ${content.limitations.length ? `<div class="wb-task-section wb-decision-caution"><h3>${esc(t('초안에 남은 점'))}</h3>${content.limitations.map(item => `<p>${prose(item.text, esc)}</p>`).join('')}</div>` : ''}
    </section>`;
  }
  function renderContent(content, { t, esc }, recordedAt) {
    const heading = HEADINGS[content.shape] || {};
    const bases = new Set([content.answer, ...content.details, ...content.deliverables, ...(content.background || []), ...(content.nextAction ? [content.nextAction] : [])].map(item => item.basis));
    const mixed = bases.has('observed') && bases.has('reported');
    const source = mixed ? '대화 원문과 도구 실행 기록 기준' : bases.has('reported') ? '대화 원문 기준' : bases.has('observed') ? '도구 실행 기록 기준' : '';
    let previousBasis = '';
    const badge = item => {
      const show = item.basis !== previousBasis && (['inference', 'unknown'].includes(item.basis) || mixed && item.basis === 'observed');
      previousBasis = item.basis;
      const label = { observed: '도구 출력', inference: '추론', unknown: '확인 안 됨' }[item.basis];
      return show ? `<span class="wb-content-basis">${esc(t(label))}</span>` : '';
    };
    const claim = item => `<p class="wb-content-claim">${badge(item)}${prose(item.text, esc)}</p>`;
    // Render in reading order so consecutive provenance labels are coalesced.
    const answer = claim(content.answer);
    const handoff = content.handoff;
    const time = new Date(recordedAt || NaN);
    const recordDate = !Number.isNaN(time.getTime()) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(time) + ' KST' : '';
    const timeNote = recordDate || handoff?.temporal ? `<div class="wb-content-time">${recordDate ? `<p>${esc(t('기록 시점'))} · ${esc(recordDate)}</p>` : ''}${handoff?.temporal ? `<p>${prose(handoff.temporal.text, esc)}</p>` : ''}</div>` : '';
    const handoffHtml = handoff ? `<div class="wb-task-section wb-content-handoff"><h3>${esc(t(handoff.kind === 'finish' ? '다음 요청이 필요한가요?' : heading.handoff || '먼저 할 판단'))}</h3><p>${prose(handoff.priority.text, esc)}</p>${handoff.prompt ? `<h3>${esc(t('보낼 수 있는 다음 요청'))}</h3><blockquote>${esc(handoff.prompt.text)}</blockquote>` : ''}</div>` : '';
    // Every option of a question the reply ends with, verbatim from the reply.
    const choices = renderChoices(content.choices, { t, esc });
    const details = content.details.map(claim).join('');
    const nextAction = content.nextAction ? claim(content.nextAction) : '';
    const outputs = content.deliverables.map(item => {
      const output = item.kind === 'url' && /^https?:\/\//iu.test(item.value)
      ? `<p><a href="${esc(item.value)}" target="_blank" rel="noopener noreferrer">${esc(item.value)}</a></p>`
      : markdownTable(item.value, esc) || `<pre>${esc(item.value)}</pre>`;
      if (item.kind === 'command' && item.usage === 'historical') return `<div class="wb-task-section wb-content-output wb-content-historical"><p>${esc(t('과거 명령 · 현재 실행 안내 아님'))}</p><p>${esc(item.usageNote.text)}</p><details class="wb-task-details"><summary>${esc(t('당시 명령 보기'))}</summary><h3>${esc(item.label)}</h3>${output}${badge(item)}</details></div>`;
      return `<div class="wb-task-section wb-content-output"><h3>${esc(item.label)}</h3>${item.kind === 'command' ? `<p class="wb-content-time">${esc(t('기록 당시 명령 · 현재 적용 여부는 별도 확인'))}</p>${item.usageNote ? `<p>${esc(item.usageNote.text)}</p>` : ''}` : ''}${output}${badge(item)}</div>`;
    }).join('');
    const background = (content.background || []).map(claim).join('');
    return `<section class="wb-decision wb-answer-content" aria-label="${esc(t('답과 핵심 설명'))}">
      ${shapeChip(content.shape, { t, esc })}
      ${source ? `<p class="wb-content-source">${esc(t(source))}</p>` : ''}
      <div class="wb-task-section wb-decision-conclusion"><h3>${esc(t('실제 답'))}</h3>${answer}</div>
      ${timeNote}
      ${choices}
      ${handoffHtml}
      ${content.limitations.length ? `<div class="wb-task-section wb-decision-caution"><h3>${esc(t(heading.limitations || '확인한 범위와 남은 점'))}</h3>${content.limitations.map(item => `<p>${prose(item.text, esc)}</p>`).join('')}</div>` : ''}
      ${content.details.length ? `<div class="wb-task-section"${content.shape === 'review' ? ' data-findings' : ''}><h3>${esc(t(heading.details || (content.nextAction ? '판단 근거' : '핵심과 작동 방식')))}</h3>${details}</div>` : ''}
      ${nextAction ? `<div class="wb-task-section wb-decision-action"><h3>${esc(t('필요한 다음 행동'))}</h3>${nextAction}</div>` : ''}
      ${outputs}
      ${background ? `<details class="wb-task-details"><summary>${esc(t('상세 설명'))}</summary>${background}</details>` : ''}
    </section>`;
  }
  function render(task, { t, esc, taskKey, draftActions = false }) {
    if (validContent(task.content) && task.content.shape === 'draft') return renderDraft(task, { t, esc, actions: draftActions });
    if (validContent(task.content)) return `${task.contentGeneratedAt ? `<p class="wb-record-label">${esc(t('기존 기록 재설명'))} · ${esc(Number.isSafeInteger(task.contentUsage?.total) ? task.contentUsage.total.toLocaleString() + ' ' + t('토큰') : t('토큰 미제공'))}</p>` : ''}${renderContent(task.content, { t, esc }, task.recordedAt || task.observedAt)}`;
    const decision = task.decision;
    if (!decision) return '';
    const section = (label, value, className = '') => `<div class="wb-task-section ${className}"><h3>${esc(t(label))}</h3><p>${esc(value)}</p></div>`;
    const reasons = `<div class="wb-task-section"><h3>${esc(t('판단 이유'))}</h3><ul class="wb-decision-reasons">${decision.reasons.map(reason => `<li>${esc(reason.text)}</li>`).join('')}</ul></div>`;
    const alternatives = decision.alternatives.length ? `<details class="wb-task-details" data-review-request="${esc(`choices:${taskKey}`)}"><summary>${esc(t('선택지 비교'))}</summary>${decision.alternatives.map(item => `<div class="wb-task-section"><h3>${esc(item.option)}</h3><p>${esc(item.tradeoff)}</p><p class="wb-decision-condition">${esc(t('이 선택이 나은 조건'))}: ${esc(item.when)}</p></div>`).join('')}</details>` : '';
    return `<section class="wb-decision" aria-label="${esc(t('다음 결정을 위한 요약'))}">
      ${section('이전 분석 · 원문 재검토 전', t('아래 내용은 이전 AI 분석의 설명입니다. 실제 답과 확인 범위를 함께 읽어 주세요.'))}
      ${section('현재 결론', task.actual || decision.conclusion, 'wb-decision-conclusion')}
      ${task.understanding ? section('어떻게 동작하나요?', task.understanding) : ''}
      ${task.why ? section('왜 이렇게 바꿨나요?', task.why) : ''}
      ${task.impact ? section('사용자에게 어떤 영향이 있나요?', task.impact) : ''}
      ${reasons}
      ${decision.caution ? section('판단 전에 알아둘 점', decision.caution, 'wb-decision-caution') : ''}
      ${task.verification ? section('기록에서 확인한 범위', task.verification, 'wb-decision-caution') : ''}
      ${(task.unverified || []).map(item => section('완료 판단에 필요한 확인', `${item.item} ${item.reason}`, 'wb-decision-caution')).join('')}
      ${decision.action.text ? `<div class="wb-task-section wb-decision-action"><h3>${esc(t(decision.action.kind === 'finish' ? '여기서 마쳐도 돼요' : '권하는 다음 행동'))}</h3><p><strong>${esc(decision.action.text)}</strong></p>${decision.action.why ? `<p>${esc(decision.action.why)}</p>` : ''}</div>` : ''}
      ${alternatives}
    </section>`;
  }
  // A pass-through reply as written: line breaks kept, markdown emphasis and
  // heading marks dropped, every piece escaped.
  function plainReply(text, esc) {
    return String(text || '').split('\n').map(line => esc(line.replace(/^\s{0,3}#{1,6}\s+/u, '').replace(/\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`/gu, (_, a, b, c) => a ?? b ?? c))).join('<br>');
  }
  return { SHAPES, render, renderContent, renderChoices, plainReply, applyHistoryContent, displayTitle, reviewFailure, matchesRetainedAnalysis };
});
