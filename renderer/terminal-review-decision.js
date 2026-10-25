(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WhiteboxReviewDecision = api;
})(typeof window === 'undefined' ? null : window, () => {
  'use strict';
  function render(task, { t, esc, taskKey }) {
    const decision = task.decision;
    if (!decision) return '';
    const section = (label, value, className = '') => `<div class="wb-task-section ${className}"><h3>${esc(t(label))}</h3><p>${esc(value)}</p></div>`;
    const reasons = `<div class="wb-task-section"><h3>${esc(t('판단 이유'))}</h3><ul class="wb-decision-reasons">${decision.reasons.map(reason => `<li>${esc(reason.text)}</li>`).join('')}</ul></div>`;
    const alternatives = decision.alternatives.length ? `<details class="wb-task-details" data-review-request="${esc(`choices:${taskKey}`)}"><summary>${esc(t('선택지 비교'))}</summary>${decision.alternatives.map(item => `<div class="wb-task-section"><h3>${esc(item.option)}</h3><p>${esc(item.tradeoff)}</p><p class="wb-decision-condition">${esc(t('이 선택이 나은 조건'))}: ${esc(item.when)}</p></div>`).join('')}</details>` : '';
    return `<section class="wb-decision" aria-label="${esc(t('다음 결정을 위한 요약'))}">
      ${section('현재 결론', decision.conclusion, 'wb-decision-conclusion')}
      ${reasons}
      ${decision.caution ? section('판단 전에 알아둘 점', decision.caution, 'wb-decision-caution') : ''}
      <div class="wb-task-section wb-decision-action"><h3>${esc(t(decision.action.kind === 'finish' ? '여기서 마쳐도 돼요' : '권하는 다음 행동'))}</h3><p><strong>${esc(decision.action.text)}</strong></p><p>${esc(decision.action.why)}</p></div>
      ${alternatives}
    </section>`;
  }
  return { render };
});
