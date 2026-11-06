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
  function reviewFailure(review) {
    const failure = review?.state === 'error' && review.failure;
    const previous = failure && review.result?.tasks?.find(task => task.taskId === failure.taskId
      && task.analysisId && task.analysisId === failure.retainedAnalysisId && !task.recordOnly && !task.deferred);
    if (!previous) return null;
    const partial = failure.retainedLifecycle === 'in-progress';
    return { ...failure,
      title: failure.kind === 'reanalysis' ? '다시 분석하지 못했습니다' : partial ? '최종 분석을 완료하지 못했습니다' : '추가 분석을 완료하지 못했습니다',
      description: failure.kind === 'reanalysis' ? '기존 분석은 보존했습니다. 다시 분석하는 과정에서 오류가 발생했습니다.'
        : partial ? '작업 중 작성된 분석은 보존했습니다. 최종 답변은 다시 검토해 주세요.'
          : '이전 분석은 보존했습니다. 이후 갱신된 기록은 다시 검토해 주세요.' };
  }
  function renderContent(content, { t, esc }, recordedAt) {
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
    const claim = item => `<p class="wb-content-claim">${badge(item)}${esc(item.text)}</p>`;
    // Render in reading order so consecutive provenance labels are coalesced.
    const answer = claim(content.answer);
    const handoff = content.handoff;
    const time = new Date(recordedAt || NaN);
    const recordDate = !Number.isNaN(time.getTime()) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(time) + ' KST' : '';
    const timeNote = recordDate || handoff?.temporal ? `<div class="wb-content-time">${recordDate ? `<p>${esc(t('기록 시점'))} · ${esc(recordDate)}</p>` : ''}${handoff?.temporal ? `<p>${esc(handoff.temporal.text)}</p>` : ''}</div>` : '';
    const handoffHtml = handoff ? `<div class="wb-task-section wb-content-handoff"><h3>${esc(t(handoff.kind === 'finish' ? '다음 요청이 필요한가요?' : '먼저 할 판단'))}</h3><p>${esc(handoff.priority.text)}</p>${handoff.prompt ? `<h3>${esc(t('보낼 수 있는 다음 요청'))}</h3><blockquote>${esc(handoff.prompt.text)}</blockquote>` : ''}</div>` : '';
    const details = content.details.map(claim).join('');
    const nextAction = content.nextAction ? claim(content.nextAction) : '';
    const outputs = content.deliverables.map(item => {
      const output = item.kind === 'url' && /^https?:\/\//iu.test(item.value)
      ? `<p><a href="${esc(item.value)}" target="_blank" rel="noopener noreferrer">${esc(item.value)}</a></p>`
      : `<pre>${esc(item.value)}</pre>`;
      if (item.kind === 'command' && item.usage === 'historical') return `<div class="wb-task-section wb-content-output wb-content-historical"><p>${esc(t('과거 명령 · 현재 실행 안내 아님'))}</p><p>${esc(item.usageNote.text)}</p><details class="wb-task-details"><summary>${esc(t('당시 명령 보기'))}</summary><h3>${esc(item.label)}</h3>${output}${badge(item)}</details></div>`;
      return `<div class="wb-task-section wb-content-output"><h3>${esc(item.label)}</h3>${item.kind === 'command' ? `<p class="wb-content-time">${esc(t('기록 당시 명령 · 현재 적용 여부는 별도 확인'))}</p>${item.usageNote ? `<p>${esc(item.usageNote.text)}</p>` : ''}` : ''}${output}${badge(item)}</div>`;
    }).join('');
    const background = (content.background || []).map(claim).join('');
    return `<section class="wb-decision wb-answer-content" aria-label="${esc(t('답과 핵심 설명'))}">
      ${source ? `<p class="wb-content-source">${esc(t(source))}</p>` : ''}
      <div class="wb-task-section wb-decision-conclusion"><h3>${esc(t('실제 답'))}</h3>${answer}</div>
      ${timeNote}
      ${handoffHtml}
      ${content.limitations.length ? `<div class="wb-task-section wb-decision-caution"><h3>${esc(t('확인한 범위와 남은 점'))}</h3>${content.limitations.map(item => `<p>${esc(item.text)}</p>`).join('')}</div>` : ''}
      ${content.details.length ? `<div class="wb-task-section"><h3>${esc(t(content.nextAction ? '판단 근거' : '핵심과 작동 방식'))}</h3>${details}</div>` : ''}
      ${nextAction ? `<div class="wb-task-section wb-decision-action"><h3>${esc(t('필요한 다음 행동'))}</h3>${nextAction}</div>` : ''}
      ${outputs}
      ${background ? `<details class="wb-task-details"><summary>${esc(t('상세 설명'))}</summary>${background}</details>` : ''}
    </section>`;
  }
  function render(task, { t, esc, taskKey }) {
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
  return { render, renderContent, applyHistoryContent, displayTitle, reviewFailure };
});
