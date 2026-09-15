'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { QuestionnairePreferenceStore } = require('../../src/questionnairePreferenceStore');
const { BackgroundQuestionnaire } = require('../../src/backgroundQuestionnaire');

const tick = () => new Promise(resolve => setImmediate(resolve));
function task(id) {
  return { id, provider: 'codex', status: 'completed', completionObserved: true,
    completedAt: new Date(5_000).toISOString(), messages: [{ id: `${id}-u1`, role: 'user', text: '버튼을 수정해줘' }],
    questionnaireSource: { prompt: '버튼을 수정해줘', answer: '버튼 색을 파란색으로 변경했습니다.' } };
}

function registerQuestionnairePreferenceTests({ test, temp }) {
  test('신규·기존 미설정·손상된 설정은 질문지를 끄고, 켜기와 끄기 선택을 재실행 후에도 보존한다', () => {
    const file = path.join(temp, 'questionnaire-preference.json');
    const store = new QuestionnairePreferenceStore(file);
    assert.deepStrictEqual(store.load(), { configured: false, enabled: false });
    for (const value of ['{}', '{"enabled":"true"}', '{"enabled":null}', 'null', '{invalid']) {
      fs.writeFileSync(file, value);
      assert.deepStrictEqual(store.load(), { configured: false, enabled: false });
    }
    for (const enabled of [true, false]) {
      assert.deepStrictEqual(store.save({ enabled }), { configured: true, enabled });
      assert.deepStrictEqual(new QuestionnairePreferenceStore(file).load(), { configured: true, enabled });
    }
    assert.throws(() => store.save({ enabled: 'true' }), TypeError);
  });

  test('설정 저장 실패 시 동의나 변경이 적용된 것으로 처리하지 않는다', () => {
    const file = path.join(temp, 'questionnaire-save-failure.json');
    const store = new QuestionnairePreferenceStore(file);
    store.save({ enabled: false });
    store.fs = { ...fs, renameSync() { throw new Error('disk write failed'); } };
    assert.throws(() => store.save({ enabled: true }), /disk write failed/);
    assert.deepStrictEqual(store.snapshot(), { configured: true, enabled: false });
    assert.deepStrictEqual(new QuestionnairePreferenceStore(file).load(), { configured: true, enabled: false });
    assert(!fs.existsSync(`${file}.${process.pid}.tmp`));
  });

  test('동의 전에는 AI와 상세 조회를 호출하지 않고, 활성화해도 지난 작업에 소급 과금하지 않는다', async () => {
    const tasks = [task('past'), task('future')];
    let calls = 0;
    let details = 0;
    const service = new BackgroundQuestionnaire({ file: path.join(temp, 'consent-default.json'), now: () => 1_000,
      runner: { generateQuestionnaire: async () => { calls += 1; return '{"kind":"skip"}'; } },
      requestDetail: async id => { details += 1; return tasks.find(item => item.id === id); } });
    service.observe([]);
    service.observe([tasks[0]]);
    await tick();
    assert.equal(calls, 0);
    assert.equal(details, 0);
    assert.deepStrictEqual(service.retry('past'), { ok: false });
    service.setEnabled(true);
    service.observe([tasks[0]]);
    await tick();
    assert.equal(calls, 0);
    service.observe(tasks);
    await tick();
    assert.equal(calls, 1);
    assert.equal(details, 1);
  });

  test('상세 조회 중 끄고 다시 켜도 이전 대기 요청은 AI 호출 전에 폐기한다', async () => {
    let resolveDetail;
    let calls = 0;
    const completed = task('detail-race');
    const service = new BackgroundQuestionnaire({ file: path.join(temp, 'consent-detail-race.json'), enabled: true, now: () => 1_000,
      runner: { generateQuestionnaire: async () => { calls += 1; return '{"kind":"skip"}'; } },
      requestDetail: () => new Promise(resolve => { resolveDetail = resolve; }) });
    service.observe([]); service.observe([completed]);
    service.setEnabled(false);
    service.setEnabled(true);
    resolveDetail(completed);
    await tick();
    assert.equal(calls, 0);
    assert.equal(service.project(completed).comprehension.status, 'skipped');
  });

  test('끄기는 대기열을 비우고 진행 중 요청만 마무리하며 다시 켜도 대기열을 재실행하지 않는다', async () => {
    const tasks = [task('in-flight'), task('queued')];
    let calls = 0;
    let finish;
    const service = new BackgroundQuestionnaire({ file: path.join(temp, 'consent-queue.json'), enabled: true, now: () => 1_000,
      runner: { generateQuestionnaire: () => { calls += 1; return new Promise(resolve => { finish = resolve; }); } },
      requestDetail: async id => tasks.find(item => item.id === id) });
    service.observe([]); service.observe(tasks); await tick();
    assert.equal(calls, 1);
    service.setEnabled(false);
    assert.equal(service.queue.length, 0);
    finish('{"kind":"skip"}'); await tick();
    assert.equal(calls, 1);
    assert.equal(service.busy, false);
    service.setEnabled(true); service.observe(tasks); await tick();
    assert.equal(calls, 1);
  });

  test('질문지가 꺼진 동안은 실패한 생성도 재시도할 수 없다', async () => {
    let calls = 0;
    const completed = task('failed');
    const service = new BackgroundQuestionnaire({ file: path.join(temp, 'consent-retry.json'), enabled: true, now: () => 1_000,
      runner: { generateQuestionnaire: async () => { calls += 1; throw new Error('fixture failure'); } },
      requestDetail: async () => completed });
    service.observe([]); service.observe([completed]); await tick();
    assert.equal(service.project(completed).comprehension.status, 'failed');
    service.setEnabled(false);
    assert.deepStrictEqual(service.retry(completed.id), { ok: false });
    await tick();
    assert.equal(calls, 1);
    service.setEnabled(true);
    assert.deepStrictEqual(service.retry(completed.id), { ok: true });
    await tick();
    assert.equal(calls, 2);
  });
}

module.exports = { registerQuestionnairePreferenceTests };
