'use strict';

const fs = require('fs');
const path = require('path');
const { bounded } = require('./terminalReviewBudget');
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const questions = {
  fulfilled: { type: 'noul', instructions: 'Does the observed work satisfy the user request?', criteria: { true: 'Evidence reports all requested outcomes.', false: 'Evidence shows a requested outcome is missing or contradicted.' } },
  lostCoverage: { type: 'noul', instructions: 'Does the evidence report removal of a verification without replacement?' },
  recovered: { type: 'noul', instructions: 'Does the evidence report recovery after an earlier failure?' },
  repeatsCheck: { type: 'noul', instructions: 'Does the proposed follow-up ask for a check whose valid result is already in the supplied record?' },
  unresolved: { type: 'noul', instructions: 'Is there a decision-changing fact missing from the supplied evidence?' },
};

class JevAnalysis {
  constructor({ file, secure, fetchImpl = globalThis.fetch, now = Date.now } = {}) { Object.assign(this, { file, secure, fetchImpl, now }); }
  key() {
    if (!this.file || !fs.existsSync(this.file)) return process.env.TYPESAFE_API_KEY || '';
    try { return this.secure.decryptString(Buffer.from(JSON.parse(fs.readFileSync(this.file, 'utf8')).key, 'base64')); }
    catch { throw new Error('Jev API 키를 해독할 수 없습니다. 설정에서 다시 저장해 주세요.'); }
  }
  status() { return { configured: Boolean(this.file && fs.existsSync(this.file) || process.env.TYPESAFE_API_KEY), model: 'jev-latest' }; }
  configure({ apiKey, remove = false } = {}) {
    if (remove) { fs.rmSync(this.file, { force: true }); return this.status(); }
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 2000) throw new Error('Jev API 키를 입력해 주세요.');
    if (!this.secure?.isEncryptionAvailable() || this.secure.getSelectedStorageBackend?.() === 'basic_text') throw new Error('운영체제의 안전한 키 저장소를 사용할 수 없습니다.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ key: this.secure.encryptString(apiKey.trim()).toString('base64') }), { mode: 0o600 });
    fs.renameSync(temp, this.file); return this.status();
  }
  async analyze({ request, source, context, lifecycle = 'completed', locale = 'ko' }) {
    const key = this.key();
    if (!key) throw new Error('설정에서 Jev API 키를 저장해 주세요.');
    const startedAt = this.now();
    let response;
    try {
      response = await this.fetchImpl(ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'jev-latest', state: { request, evidence: bounded(source, 16000), priorContext: context, lifecycle }, questions }) });
    } catch { throw new Error('Jev 연결에 실패했거나 30초 응답 시간이 초과되었습니다.'); }
    const firstResponseAt = this.now();
    if (!response.ok) throw new Error(`Jev 요청 실패 (HTTP ${response.status}). API 키와 사용 한도를 확인해 주세요.`);
    const raw = await response.text();
    if (raw.length > 256000) throw new Error('Jev 응답 크기가 제한을 초과했습니다.');
    let data; try { data = JSON.parse(raw); } catch { throw new Error('Jev 응답 형식을 읽을 수 없습니다.'); }
    const judgments = {};
    for (const name of Object.keys(questions)) {
      const answer = data.answers?.[name];
      if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new Error('Jev 판단 응답이 올바르지 않습니다.');
      judgments[name] = answer.noul >= .7 ? 'supported' : answer.noul <= .3 ? 'unsupported' : 'uncertain';
    }
    const copy = locale === 'en' ? {
      result: 'The record supports the requested outcome.', unknown: 'The record does not settle whether all requested outcomes were achieved.', coverage: 'A removed check weakens what the passing tests establish.', recovered: 'The later recovery changes how the earlier failure should be read.', duplicate: 'Reuse the recorded check before asking to run it again.', missing: 'A missing fact could change the next decision.', next: 'Compare the quoted record with the outstanding requirement before choosing the next action.'
    } : locale === 'zh-CN' ? {
      result: '记录支持请求的结果。', unknown: '记录不足以确定所有请求的结果是否实现。', coverage: '删除的检查缩小了通过测试所能证明的范围。', recovered: '后续恢复改变了对先前失败的判断。', duplicate: '先复用已有检查结果，再考虑重新检查。', missing: '缺少的事实可能改变下一步决定。', next: '先比较引用记录与待确认要求，再选择下一步。'
    } : { result: '기록이 요청한 결과를 뒷받침합니다.', unknown: '기록만으로 요청한 결과의 충족 여부를 확정하기 어렵습니다.', coverage: '검사 제거로 인해 테스트 통과가 보장하는 범위가 줄었습니다.', recovered: '후속 복구 결과를 반영해 앞선 실패를 판단해야 합니다.', duplicate: '이미 기록된 확인 결과를 먼저 재사용하세요.', missing: '누락된 사실이 다음 결정을 바꿀 수 있습니다.', next: '인용한 기록과 남은 요구사항을 대조해 다음 행동을 정하세요.' };
    const findings = ['lostCoverage', 'recovered', 'repeatsCheck', 'unresolved'].filter(name => judgments[name] === 'supported')
      .map(name => ({ kind: name, probability: data.answers[name].noul, basis: 'model-judgment', text: copy[({ lostCoverage: 'coverage', recovered: 'recovered', repeatsCheck: 'duplicate', unresolved: 'missing' })[name]] }));
    const task = { request, requestQuote: request.slice(0, 1000), evidenceQuote: source.slice(0, 500),
      actual: judgments.fulfilled === 'supported' ? copy.result : copy.unknown,
      alignment: 'unknown', explanation: copy.unknown, understanding: findings.map(item => item.text).join('\n'),
      why: '', verification: '', impact: '', unverified: [], nextStep: '', decision: null,
      typedAnalysis: { judgments, findings, probabilities: Object.fromEntries(Object.keys(questions).map(name => [name, data.answers[name].noul])), next: copy.next },
      // Typed answers are evidence judgments, never independent proof or generated prose.
      analysisDepth: 'typed', analysisProvider: 'jev', analysisModel: data.model || 'jev-latest',
      analysisUsage: data.usage && Number.isSafeInteger(data.usage.input_tokens) && Number.isSafeInteger(data.usage.output_tokens)
        && data.usage.input_tokens >= 0 && data.usage.output_tokens >= 0 ? { input: data.usage.input_tokens, output: data.usage.output_tokens, total: data.usage.input_tokens + data.usage.output_tokens, cachedInput: 0, cacheWrite: 0 } : null };
    return { task, timings: { modelStartedAt: startedAt, firstResponseAt, completedAt: this.now() } };
  }
}
module.exports = { JevAnalysis, questions, ENDPOINT };
