'use strict';

const { createHash } = require('crypto');
const { bounded, answerText, isSocialRecord } = require('./terminalReviewBudget');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = value => String(value || '').replace(/\s+/gu, ' ').trim();
const text = (locale, ko, en, zh) => locale === 'en' ? en : locale === 'zh-CN' ? zh : ko;
const returned = chunk => (chunk.tools?.items || []).filter(tool => ['returned', 'error'].includes(tool.status));
const report = chunk => answerText(chunk.text);
const generic = value => /^(?:네[,!.\s]*|알겠습니다[,!.\s]*)?(?:완료|수정|처리|변경|작업|진행)(?:했|됐|하겠|하였|되었)습니다[.!\s]*$|^(?:done|completed|fixed|updated|will do)[.!\s]*$/iu.test(normalize(value));
const resultReport = value => /수정했|변경했|구현했|추가했|찾았|확인했|실패|통과|발견|원인은|결과는|완료했|작성했|생성했|삭제했|바꿨|동작합|동작하|\b(?:implemented|fixed|changed|added|failed|passed|found|created|removed|updated|because|result)\b|已修改|已实现|失败|通过|发现|结果/iu.test(value);
const changedRequest = value => /하지\s*말고|그만|대신|아까.*(?:바꿔|변경|수정)|(?:색상|조건|요구사항).*바꿔|\b(?:instead|stop|change the requirement)\b|改为|不要.*改/iu.test(value);
const acknowledgement = value => /^(?:ㅇㅇ|응|네|예|좋아|[1-9]|[abc]|진행해(?:줘)?|허용|승인|yes|y|ok(?:ay)?|proceed|allow|同意|继续)[.!\s]*$/iu.test(value);

function evidenceDigest(chunk) {
  // Timestamps, tool IDs, spinners and token counters are deliberately excluded.
  const tools = returned(chunk);
  const meaningful = tools.filter(item => item.status === 'error' || item.reportedError || item.exitCode && item.exitCode !== 0
    || /^(?:Write|Edit|MultiEdit|apply_patch)$/iu.test(item.name) || /fetch|search/iu.test(item.name)
    || item.operation || item.commandHints?.some(hint => /^(?:git (?:restore|reset|revert|clean)|rm|tar|cp|mv)$/u.test(hint))
    || /\b(?:tests? (?:passed|failed)|\d+ (?:passed|failed)|FAIL|PASS)\b|테스트.*(?:통과|실패)/u.test(item.excerpt || ''));
  return digest([normalize(chunk.request), normalize(String(chunk.text || '').replace(/ASSISTANT \((?:completed answer|current report)\)/gu, 'ASSISTANT')),
    Boolean(tools.length), meaningful.map(item => [item.name, item.status, item.target, normalize(item.excerpt), item.operation, item.exitCode, item.reportedError]),
    chunk.updates?.items?.map(normalize), chunk.localRecord]);
}
function observedFacts(chunk, locale = 'ko') {
  const facts = [];
  const tools = returned(chunk);
  const errors = tools.filter(tool => tool.status === 'error' || tool.reportedError === true || typeof tool.exitCode === 'number' && tool.exitCode !== 0);
  if (tools.length) facts.push(text(locale, `현재 요청에서 도구 결과 ${tools.length}건을 수신했어요.`, `${tools.length} tool results were received for this request.`, `此请求已收到 ${tools.length} 项工具结果。`));
  if (errors.length) facts.push(text(locale, `${errors.length}건에 오류가 보고됐어요.`, `${errors.length} results report an error.`, `${errors.length} 项结果报告错误。`));
  const answer = report(chunk);
  if (answer && !generic(answer)) facts.push(text(locale, `AI의 현재 보고: ${bounded(answer, 500)}`, `AI's current report: ${bounded(answer, 500)}`, `AI 当前报告：${bounded(answer, 500)}`));
  return facts;
}

function mechanicalResult(chunk, records = [], locale = 'ko') {
  if (chunk.lifecycle !== 'completed') return '';
  if (!chunk.tools?.items?.length && !chunk.updates?.items?.length && !chunk.tools?.omitted
    && isSocialRecord(chunk.request, chunk.text)) return report(chunk);
  // Only a narrow, literal relay request can be satisfied by collaboration records.
  // Merely mentioning "hi" inside a larger task never disables interpretation.
  const relay = normalize(chunk.request).match(/^(?:같은 패널(?:의)?\s*)?(?:다른\s*)?(Codex|Claude)(?:에게|에)\s*["'“‘]?([^"'”’\s]+)["'”’]?\s*(?:를|을)?\s*(?:보내(?:고|줘)|입력(?:하고|해(?:서|줘)?|\s*후))(?:\s*(?:실제\s*)?(?:답(?:변)?|결과)(?:를|을)?\s*(?:받아(?:서)?\s*)?(?:가져(?:오기|와(?:줘)?)|알려(?:줘)?|보여(?:줘)?))?[.!]?$/iu);
  if (relay) {
    const jobs = records.filter(job => job.sourceId === chunk.terminalId && job.state === 'completed'
      && job.provider === relay[1].toLowerCase() && job.request === relay[2]
      && job.sentAt >= chunk.submittedAt && job.finishedAt <= chunk.observedAt
      && (!chunk.endedAt || job.sentAt <= chunk.endedAt) && job.answer);
    if (jobs.length === 1) {
      const answer = answerText(jobs[0].answer);
      if (answer) return text(locale, `${relay[1]}에 ‘${relay[2]}’를 보냈고 다음 답변을 받았어요: ${bounded(answer, 700)}`, `Sent “${relay[2]}” to ${relay[1]} and received: ${bounded(answer, 700)}`, `已向 ${relay[1]} 发送“${relay[2]}”，并收到：${bounded(answer, 700)}`);
    }
  }
  const rename = normalize(chunk.request).match(/^(?:파일\s*)?["“']([^"”']+)["”'](?:의)?\s*(?:파일\s*)?(?:이름을\s*)?["“']([^"”']+)["”'](?:으)?로\s*(?:이름(?:을)?\s*)?(?:바꿔줘|변경해줘|바꿔|변경해)[.!]?$/u);
  if (rename && !chunk.tools?.omitted) {
    const mutations = (chunk.tools?.items || []).filter(tool => tool.operation?.kind === 'rename');
    if (mutations.length === 1 && mutations[0].operation.from === rename[1] && mutations[0].operation.to === rename[2]
      && mutations[0].exitCode === 0 && mutations[0].status === 'returned'
      && (chunk.tools?.items || []).every(tool => tool === mutations[0] || /^(?:Read|read_file)$/iu.test(tool.name))) {
      return text(locale, `‘${rename[1]}’의 이름을 ‘${rename[2]}’로 변경한 실행 결과가 확인됐어요.`, `The execution record confirms renaming “${rename[1]}” to “${rename[2]}”.`, `执行记录确认已将“${rename[1]}”重命名为“${rename[2]}”。`);
    }
  }
  return '';
}

function classifyEvidence(chunk, records, locale = 'ko') {
  const mechanical = mechanicalResult(chunk, records, locale);
  if (mechanical) return { mode: 'record', actual: mechanical };
  const answer = report(chunk), tools = returned(chunk);
  const substantive = Boolean(answer && !generic(answer) && answer.length >= 8);
  const verification = tools.some(tool => tool.status === 'error' || typeof tool.exitCode === 'number' && tool.exitCode !== 0 || /\b(?:tests? (?:passed|failed)|\d+ (?:passed|failed)|FAIL|PASS)\b|테스트.*(?:통과|실패)/u.test(tool.excerpt || ''));
  const workResult = substantive && resultReport(answer) && (tools.some(tool => tool.excerpt) || answer.length >= 80);
  if (chunk.lifecycle === 'interrupted' && !tools.length && !workResult) return { mode: 'record', actual: text(locale, '요청이 중단됐어요. 수행 결과는 수집되지 않았어요.', 'Request interrupted. No execution result was collected.', '请求已中断，尚未收集到执行结果。') };
  // A completed explanation is itself a result; generic completion claims aren't.
  const finalContent = chunk.lifecycle === 'completed' && substantive;
  const planOnly = /(?:하겠습니다|할게요|예정입니다|살펴보겠습니다|조사하겠습니다|\bI(?:'ll| will)\b)/iu.test(answer) && !resultReport(answer);
  const mutation = /수정|바꿔|변경|구현|만들어|삭제|rename|implement|fix|modify|delete/iu.test(chunk.request);
  const unsupportedMutation = mutation && !tools.some(tool => tool.excerpt) && answer.length < 80 && !/[“"‘'`]/u.test(answer);
  if (verification || workResult || (finalContent && !planOnly && !unsupportedMutation)) return { mode: 'analyze' };
  return { mode: 'defer', actual: text(locale,
    '요청 결과를 판단할 구체적인 내용이 아직 기록에 없어요. 결과가 수집되면 분석할게요.',
    'No concrete result for this request is recorded yet. Analysis will begin when evidence arrives.',
    '尚未记录此请求的具体结果。收集到证据后将进行分析。') };
}

module.exports = { classifyEvidence, evidenceDigest, observedFacts, changedRequest, acknowledgement };
