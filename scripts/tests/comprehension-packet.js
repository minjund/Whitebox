'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  COMPREHENSION_CONTRACT,
  MAX_PACKET_BYTES,
  MAX_RESPONSE_BYTES,
  PACKET_CLOSE,
  PACKET_OPEN,
  comprehensionEligibility,
  extractComprehensionPacket,
  finalizeComprehension,
  hasComprehensionContract,
  injectComprehensionContract,
  promoteComprehensionCandidate,
  stageComprehensionCandidate,
  stripComprehensionContract,
  validateComprehensionPacket,
} = require('../../src/comprehensionPacket');
const rendererComprehension = require('../../renderer/comprehension-packet');
const rendererOutput = require('../../renderer/comprehension-output-filter');

function option(id, label) {
  return { id, label };
}

function question(index, topics = ['change', 'decision', 'constraint-risk']) {
  return {
    id: `q${index}`,
    kind: index % 2 ? '변경 사항' : '선택 이유',
    topics,
    prompt: `질문 ${index}의 올바른 설명은 무엇인가요?`,
    options: [
      option(`q${index}-a`, '올바른 설명'),
      option(`q${index}-b`, '틀린 설명'),
    ],
    answerId: `q${index}-a`,
    explanation: `질문 ${index}의 판단 근거입니다.`,
    evidenceIds: ['e1'],
    variant: {
      prompt: `질문 ${index}을 다른 상황에 적용하면 무엇인가요?`,
      options: [
        option(`q${index}-va`, '올바른 적용'),
        option(`q${index}-vb`, '틀린 적용'),
      ],
      answerId: `q${index}-va`,
      explanation: `질문 ${index}의 변형 문제 해설입니다.`,
    },
  };
}

function packet(count = 1) {
  return {
    schemaVersion: 1,
    id: 'packet-1',
    title: '완료 작업 이해 브리핑',
    summary: '실제 변경과 선택 이유, 남은 제약을 설명합니다.',
    difficulty: 3,
    difficultyReason: '변경 범위와 오해 위험을 함께 고려했습니다.',
    evidence: [{ id: 'e1', label: '구현 근거', detail: '실제 작업 기록과 검증 결과' }],
    questions: Array.from({ length: count }, (_value, index) => question(index + 1)),
  };
}

function maximumAsciiPacket() {
  const value = {
    schemaVersion: 1,
    id: 'max-packet',
    title: 'Maximum packet',
    summary: 's',
    difficulty: 5,
    difficultyReason: 'd',
    evidence: Array.from({ length: 20 }, (_entry, index) => ({
      id: `max-e${index + 1}`,
      label: `Evidence ${index + 1}`,
      detail: 'e',
    })),
    questions: Array.from({ length: 5 }, (_entry, index) => ({
      id: `max-q${index + 1}`,
      kind: 'change',
      topics: index === 0 ? ['change', 'decision', 'constraint-risk'] : ['change'],
      prompt: 'p',
      options: [
        option(`max-q${index + 1}-a`, 'Correct'),
        option(`max-q${index + 1}-b`, 'Incorrect'),
      ],
      answerId: `max-q${index + 1}-a`,
      explanation: 'x',
      evidenceIds: ['max-e1'],
      variant: {
        prompt: 'v',
        options: [
          option(`max-q${index + 1}-va`, 'Variant correct'),
          option(`max-q${index + 1}-vb`, 'Variant incorrect'),
        ],
        answerId: `max-q${index + 1}-va`,
        explanation: 'y',
      },
    })),
  };
  const fill = (target, key, limit) => {
    const remaining = MAX_PACKET_BYTES - Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (remaining <= 0) return;
    const current = target[key];
    target[key] = `${current}${'x'.repeat(Math.min(limit - current.length, remaining))}`;
  };
  fill(value, 'summary', 6000);
  fill(value, 'difficultyReason', 1200);
  for (const evidence of value.evidence) fill(evidence, 'detail', 2000);
  for (const question of value.questions) {
    fill(question, 'explanation', 2400);
    fill(question, 'prompt', 1200);
    fill(question.variant, 'explanation', 2400);
    fill(question.variant, 'prompt', 1200);
  }
  return value;
}

function envelope(value) {
  return `${PACKET_OPEN}${JSON.stringify(value)}${PACKET_CLOSE}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setOptionCount(target, prefix, count) {
  target.options = Array.from({ length: count }, (_value, index) => (
    option(`${prefix}-${index + 1}`, `${prefix} 선택지 ${index + 1}`)
  ));
  target.answerId = `${prefix}-1`;
}

function registerComprehensionPacketTests({ test, root = path.resolve(__dirname, '..', '..') }) {
  test('이해 패킷 스키마는 1개부터 5개까지 문항을 허용한다', () => {
    for (let count = 1; count <= 5; count += 1) {
      assert.equal(validateComprehensionPacket(packet(count)).ok, true, `${count}개 문항`);
    }
  });

  test('이해 패킷 스키마는 0개와 6개 문항을 거절한다', () => {
    const empty = packet(1);
    empty.questions = [];
    const excessive = packet(5);
    excessive.questions.push(question(6));
    assert.equal(validateComprehensionPacket(empty).ok, false);
    assert.equal(validateComprehensionPacket(excessive).ok, false);
  });

  test('원문과 변형 문제는 각각 2개부터 6개까지 선택지를 허용한다', () => {
    for (let count = 2; count <= 6; count += 1) {
      const candidate = packet();
      setOptionCount(candidate.questions[0], `initial-${count}`, count);
      setOptionCount(candidate.questions[0].variant, `variant-${count}`, count);
      assert.equal(validateComprehensionPacket(candidate).ok, true, `${count}개 선택지`);
    }

    for (const count of [1, 7]) {
      const candidate = packet();
      setOptionCount(candidate.questions[0], `invalid-initial-${count}`, count);
      setOptionCount(candidate.questions[0].variant, `invalid-variant-${count}`, count);
      const optionCountIssues = validateComprehensionPacket(candidate).issues
        .filter(row => row.code === 'OPTION_COUNT');
      assert.equal(optionCountIssues.length, 2, `${count}개 선택지는 원문과 변형 모두 거절`);
    }
  });

  test('원문과 변형 문제의 중복 선택지 label을 fail-closed 처리한다', () => {
    const candidate = packet();
    candidate.questions[0].options[1].label = candidate.questions[0].options[0].label;
    candidate.questions[0].variant.options[1].label = candidate.questions[0].variant.options[0].label;
    const duplicates = validateComprehensionPacket(candidate).issues
      .filter(row => row.code === 'OPTION_LABEL_DUPLICATE');
    assert.deepStrictEqual(duplicates.map(row => row.path), [
      '$.questions[0].options[1].label',
      '$.questions[0].variant.options[1].label',
    ]);
  });

  test('이해 패킷 스키마는 여분 키와 전역 중복 ID를 fail-closed 처리한다', () => {
    const extra = packet();
    extra.debug = true;
    assert.ok(validateComprehensionPacket(extra).issues.some(row => row.code === 'PACKET_KEYS'));
    const duplicate = packet();
    duplicate.questions[0].id = 'e1';
    assert.ok(validateComprehensionPacket(duplicate).issues.some(row => row.code === 'DUPLICATE_ID'));
  });

  test('choice IDs are scoped to each question and variant, including escaped provider envelopes', () => {
    const value = packet(2);
    for (const question of value.questions) {
      for (const target of [question, question.variant]) {
        target.options = [option('a', '정답'), option('b', '오답')];
        target.answerId = 'a';
      }
    }
    const response = `답변\n\\${PACKET_OPEN}${JSON.stringify(value)}\\${PACKET_CLOSE}`;
    const session = { id: 'owned', status: 'completed', completionObserved: true, comprehensionContractInjected: true };
    const result = finalizeComprehension(session, response);
    assert.equal(result.body, '답변');
    assert.equal(result.comprehension.status, 'ready');
    assert(rendererComprehension.isEligibleSession({ ...session, comprehension: result.comprehension }));
    value.questions[0].options[1].id = 'a';
    assert(validateComprehensionPacket(value).issues.some(row => row.code === 'DUPLICATE_ID'));
  });

  test('damaged or repeated private envelopes stay hidden without manufacturing questions', () => {
    for (const payload of [
      `${PACKET_OPEN}{broken`,
      `${PACKET_OPEN}{broken\n${envelope(packet())}`,
      '<whitebox-comprehension-packet version=',
      `${PACKET_OPEN}{broken}${PACKET_CLOSE}`,
    ]) {
      const result = extractComprehensionPacket(`답변\n${payload}`);
      assert.equal(result.body, '답변');
      assert.equal(result.comprehension.status, 'invalid');
      assert.equal(result.comprehension.packet, null);
    }
  });

  test('이해 패킷 스키마는 선택지 정답과 근거 참조를 검증한다', () => {
    const invalid = packet();
    invalid.questions[0].answerId = 'unknown-option';
    invalid.questions[0].evidenceIds = ['unknown-evidence'];
    const codes = validateComprehensionPacket(invalid).issues.map(row => row.code);
    assert.ok(codes.includes('ANSWER_REFERENCE'));
    assert.ok(codes.includes('EVIDENCE_REFERENCE'));
  });

  test('이해 패킷 스키마는 세 필수 주제의 합집합을 요구한다', () => {
    const invalid = packet();
    invalid.questions[0].topics = ['change'];
    const coverage = validateComprehensionPacket(invalid).issues.filter(row => row.code === 'TOPIC_COVERAGE');
    assert.deepStrictEqual(coverage.map(row => row.message), [
      'must cover topic decision',
      'must cover topic constraint-risk',
    ]);
  });

  test('이해 패킷 스키마는 HTML과 실행 가능한 문자열을 거절한다', () => {
    const html = packet();
    html.summary = '<img src=x onerror=alert(1)>';
    assert.ok(validateComprehensionPacket(html).issues.some(row => row.code === 'UNSAFE_HTML'));
    const scheme = packet();
    scheme.evidence[0].detail = 'javascript:alert(1)';
    assert.ok(validateComprehensionPacket(scheme).issues.some(row => row.code === 'UNSAFE_HTML'));
  });

  test('이해 패킷 스키마는 과도한 크기를 거절한다', () => {
    const excessive = packet();
    excessive.summary = '가'.repeat(70 * 1024);
    assert.ok(validateComprehensionPacket(excessive).issues.some(row => row.code === 'PACKET_TOO_LARGE'));
  });

  test('이해 패킷 추출은 trim 전 원시 JSON payload의 64KiB 한도를 적용한다', () => {
    const validJson = JSON.stringify(packet());
    const paddedPayload = `${' '.repeat(MAX_PACKET_BYTES)}${validJson}`;
    const extracted = extractComprehensionPacket(`보이는 답변\n${PACKET_OPEN}${paddedPayload}${PACKET_CLOSE}`);

    assert.equal(extracted.comprehension.status, 'invalid');
    assert.equal(extracted.error?.code, 'COMPREHENSION_PACKET_TOO_LARGE');
    assert.equal(extracted.body, '보이는 답변');
  });

  test('이해 패킷 추출은 보이는 최종 답변 본문을 보존한다', () => {
    const visible = '구현을 완료했습니다.\n\n- 테스트 통과';
    const extracted = extractComprehensionPacket(`${visible}\n\n${envelope(packet())}\n`);
    assert.equal(extracted.comprehension.status, 'ready');
    assert.deepStrictEqual(extracted.comprehension.packet, packet());
    assert.equal(extracted.body, visible);
  });

  test('최대 응답 크기의 이해 패킷을 3초 안에 추출하고 초과 응답은 즉시 거절한다', () => {
    const packetEnvelope = envelope(packet(5));
    const separator = '\n';
    const visibleBytes = MAX_RESPONSE_BYTES - Buffer.byteLength(`${separator}${packetEnvelope}`, 'utf8');
    const visible = 'x'.repeat(visibleBytes);
    const response = `${visible}${separator}${packetEnvelope}`;
    assert.equal(Buffer.byteLength(response, 'utf8'), MAX_RESPONSE_BYTES);

    const startedAt = process.hrtime.bigint();
    const extracted = extractComprehensionPacket(response);
    const oversized = extractComprehensionPacket(`${response}x`);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    assert.equal(extracted.comprehension.status, 'ready');
    assert.equal(extracted.body, visible);
    assert.equal(oversized.comprehension.status, 'invalid');
    assert.equal(oversized.error?.code, 'COMPREHENSION_RESPONSE_TOO_LARGE');
    assert.ok(elapsedMs < 3000, `bounded extraction took ${elapsedMs.toFixed(1)}ms`);
    const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const interval = Number(mainSource.match(/const MONITOR_INTERVAL_MS = ([0-9_]+);/u)?.[1]?.replace(/_/g, ''));
    assert(Number.isFinite(interval) && interval <= 3_000,
      'watcher가 이벤트를 놓쳐도 완료 패킷 fallback publication은 3초 목표 안에 시작해야 합니다.');
  });

  test('이해 패킷 추출은 누락과 잘못된 JSON을 명시적으로 보존한다', () => {
    const missing = extractComprehensionPacket('패킷 없이 끝난 답변');
    assert.equal(missing.comprehension.status, 'missing');
    assert.equal(missing.body, '패킷 없이 끝난 답변');
    const invalid = extractComprehensionPacket(`보이는 답변\n${PACKET_OPEN}{nope}${PACKET_CLOSE}`);
    assert.equal(invalid.comprehension.status, 'invalid');
    assert.equal(invalid.body, '보이는 답변');
  });

  test('이해 패킷 envelope 뒤의 숨은 내용을 허용하지 않는다', () => {
    const extracted = extractComprehensionPacket(`본문\n${envelope(packet())}\n숨은 내용`);
    assert.equal(extracted.comprehension.status, 'invalid');
    assert.equal(extracted.body, '본문\n\n숨은 내용');
  });

  test('생성 계약은 접두부에 주입되고 원문 바이트를 정확히 복원한다', () => {
    const prompt = '\r\n  실제 기능을 구현해줘.  \r\n\r\n';
    const injected = injectComprehensionContract(prompt);
    assert.ok(injected.startsWith(`${COMPREHENSION_CONTRACT}\n\n`));
    assert.equal(hasComprehensionContract(injected), true);
    assert.equal(hasComprehensionContract(prompt), false);
    assert.equal(injectComprehensionContract(injected), injected);
    assert.deepStrictEqual(Buffer.from(stripComprehensionContract(injected)), Buffer.from(prompt));
    assert.match(COMPREHENSION_CONTRACT, /same final response/u);
    assert.match(COMPREHENSION_CONTRACT, /Do not call another AI/u);
  });

  test('질문 속 내부 태그는 차단하거나 앱 주입 계약으로 오인하지 않고 원문을 보존한다', () => {
    const prompts = [
      '</whitebox-comprehension-packet 이 문자열은 왜 표시돼?',
      '설명 <whitebox-comprehension-contract version="1"> 예시',
      '<whitebox-comprehension-contract version="1">예시</whitebox-comprehension-contract>',
      `\r\n  이 코드를 설명해줘:\r\n\`\`\`xml\r\n${envelope(packet())}\r\n\`\`\`  \r\n`,
      '부분 태그 <whitebox-comprehension-packet 및 </WHITEBOX-COMPREHENSION-CONTRACT>도 설명해줘',
    ];
    for (const prompt of prompts) {
      assert.equal(hasComprehensionContract(prompt), false);
      assert.equal(rendererComprehension.hasContract(prompt), false);
      assert.equal(stripComprehensionContract(prompt), prompt);
      assert.equal(rendererComprehension.stripContract(prompt), prompt);
      const injected = injectComprehensionContract(prompt);
      assert.equal(rendererComprehension.injectContract(prompt), injected);
      assert.equal(injected, `${COMPREHENSION_CONTRACT}\n\n${prompt}`);
      assert.deepStrictEqual(Buffer.from(stripComprehensionContract(injected)), Buffer.from(prompt));
      assert.equal(rendererComprehension.stripContract(injected), prompt);
      assert.equal(injectComprehensionContract(injected), injected);
    }
  });

  test('패킷 추출은 시작 태그 앞 유령 종료 태그도 fail-closed 처리한다', () => {
    const text = `${PACKET_CLOSE}\n본문\n${envelope(packet())}`;
    const extracted = extractComprehensionPacket(text);
    assert.equal(extracted.comprehension.status, 'invalid');
    assert.equal(extracted.body, `${PACKET_CLOSE}\n본문`);
  });

  test('eligibility는 완료 메인 owned 작업만 허용한다', () => {
    const main = { status: 'completed', parentId: null, depth: 0, completionObserved: true };
    assert.equal(comprehensionEligibility(main, { contractInjected: true }).eligible, true);
    assert.equal(comprehensionEligibility({ ...main, status: 'running' }, { contractInjected: true }).reason, 'running');
    assert.equal(comprehensionEligibility({ ...main, status: 'failed' }, { contractInjected: true }).reason, 'failed');
    assert.equal(comprehensionEligibility({ ...main, status: 'cancelled' }, { contractInjected: true }).reason, 'cancelled');
    assert.equal(comprehensionEligibility({ ...main, parentId: 'codex:root', depth: 1 }, { contractInjected: true }).reason, 'subagent');
  });

  test('외부 관측 완료 작업은 unsupported이고 별도 생성으로 복구하지 않는다', () => {
    const session = { status: 'completed', parentId: null, completionObserved: true };
    const finalized = finalizeComprehension(session, `본문\n${envelope(packet())}`);
    assert.equal(finalized.comprehension.status, 'unsupported');
    assert.equal(finalized.body, `본문\n${envelope(packet())}`);
  });

  test('외부 observed 패킷 후보는 명시적 bridge 승격 전까지 unsupported로 남는다', () => {
    const response = `본문\n${envelope(packet())}`;
    const session = {
      id: 'codex:observed',
      status: 'completed',
      parentId: null,
      completionObserved: true,
      comprehensionContractInjected: false,
    };
    const staged = stageComprehensionCandidate(session, response, { stageCandidate: true });

    assert.equal(staged.comprehension.status, 'unsupported');
    assert.equal(staged.eligibility.status, 'unsupported');
    assert.equal(staged.candidate.status, 'ready');
    assert.equal(staged.body, '본문');
    assert.equal(session.comprehensionContractInjected, false);

    const observedSession = {
      ...session,
      comprehension: staged.comprehension,
      comprehensionContractObserved: true,
      comprehensionCandidate: staged.candidate,
    };
    assert.equal(rendererComprehension.isEligibleSession(observedSession), false);
    assert.equal(promoteComprehensionCandidate(observedSession, 'test-terminal-bridge'), true);
    assert.equal(observedSession.comprehension.status, 'ready');
    assert.equal(observedSession.comprehensionContractInjected, true);
    assert.deepStrictEqual(observedSession.comprehensionOrigin, {
      contractInjected: true,
      authority: 'test-terminal-bridge',
    });
    assert.equal(rendererComprehension.isEligibleSession(observedSession), true);
    assert.equal(observedSession.comprehensionCandidate, undefined);
  });

  test('owned 완료 작업의 missing과 invalid 상태를 자동 변경하지 않는다', () => {
    const session = { status: 'completed', parentId: null, completionObserved: true };
    assert.equal(finalizeComprehension(session, '본문', { contractInjected: true }).comprehension.status, 'missing');
    assert.equal(finalizeComprehension(session, `본문\n${PACKET_OPEN}{}${PACKET_CLOSE}`, { contractInjected: true }).comprehension.status, 'invalid');
  });

  test('검증은 입력 객체를 변경하지 않는다', () => {
    const input = packet(5);
    const before = clone(input);
    validateComprehensionPacket(input);
    assert.deepStrictEqual(input, before);
  });

  test('renderer 최초 프롬프트 계약은 backend 계약과 바이트 단위로 같다', () => {
    const prompt = '동일 AI가 패킷까지 만들어줘';
    assert.equal(rendererComprehension.CONTRACT_BLOCK, COMPREHENSION_CONTRACT);
    assert.equal(rendererComprehension.injectContract(prompt), injectComprehensionContract(prompt));
    assert.equal(rendererComprehension.stripContract(rendererComprehension.injectContract(prompt)), prompt);
    assert.equal(rendererComprehension.hasContract(rendererComprehension.injectContract(prompt)), true);
  });

  test('renderer 이해 패킷 UI 메시지는 ko/en/zh-CN 전체 catalog와 locale 갱신 계약을 가진다', () => {
    const rendererSource = fs.readFileSync(path.join(root, 'renderer', 'comprehension-packet.js'), 'utf8');
    const messagesSource = fs.readFileSync(path.join(root, 'renderer', 'i18n-messages.js'), 'utf8');
    const fallbackStart = rendererSource.indexOf('const FALLBACK_MESSAGES');
    const fallbackEnd = rendererSource.indexOf('function interpolateMessage', fallbackStart);
    assert(fallbackStart >= 0 && fallbackEnd > fallbackStart, 'renderer fallback message catalog을 찾지 못했습니다.');
    const fallbackBlock = rendererSource.slice(fallbackStart, fallbackEnd);
    const keys = [...fallbackBlock.matchAll(/^\s{4}([a-z][a-z0-9_]*):/gmu)].map(match => match[1]);
    assert(keys.length >= 50, `이해 패킷 UI message key가 불완전합니다: ${keys.length}`);

    const sandbox = { window: {} };
    vm.runInNewContext(messagesSource, sandbox, { filename: 'i18n-messages.js' });
    const messages = sandbox.window.WhiteboxMessages;
    for (const key of keys) {
      const row = messages[`comprehension.${key}`];
      assert(row, `comprehension.${key} catalog 항목이 없습니다.`);
      for (const locale of ['ko', 'en', 'zh-CN']) {
        assert.equal(typeof row[locale], 'string', `comprehension.${key}.${locale} 번역이 없습니다.`);
        assert(row[locale].trim(), `comprehension.${key}.${locale} 번역이 비어 있습니다.`);
      }
    }
    assert.match(rendererSource, /addEventListener\?\.\("whitebox:locale-changed", onLocaleChanged\)/u);
    assert.match(rendererSource, /removeEventListener\?\.\("whitebox:locale-changed", onLocaleChanged\)/u);
  });

  function markerWithAnsi(marker) {
    return `${marker.slice(0, 4)}\u001b[31m${marker.slice(4, 15)}`
      + `\u001b]8;;https://example.test\u0007${marker.slice(15, 27)}`
      + `\u001bP1;2|fixture\u001b\\${marker.slice(27)}`;
  }

  function splitEveryBoundary(value) {
    const chunks = [];
    const widths = [1, 2, 7, 3, 11, 5];
    for (let offset = 0, index = 0; offset < value.length; index += 1) {
      const end = Math.min(value.length, offset + widths[index % widths.length]);
      chunks.push(value.slice(offset, end));
      offset = end;
    }
    return chunks;
  }

  function authorizedFilter(expectedPacket, authority = {}) {
    return rendererOutput.createFilter({
      contractBlock: COMPREHENSION_CONTRACT,
      isOwnedTerminal: () => authority.owned !== false,
      packetFingerprint: rendererComprehension.packetContentFingerprint,
      getPacketAuthority: () => ({
        state: authority.state || 'ready',
        sessionId: authority.sessionId || 'codex:main',
        packetFingerprint: rendererComprehension.packetContentFingerprint(expectedPacket),
        completionGeneration: authority.completionGeneration === undefined
          ? '2026-08-01T00:00:00.000Z'
          : authority.completionGeneration,
      }),
    });
  }

  test('owned PTY display hides damaged internal blocks independently of packet authority', () => {
    const make = (owned = true) => rendererOutput.createFilter({
      hideOwnedEnvelopes: true,
      isOwnedTerminal: () => owned,
    });
    const alteredContract = COMPREHENSION_CONTRACT.replace('You are', '  You are');
    const malformed = `${PACKET_OPEN}{"detail"dd}${PACKET_CLOSE}`;
    const wrapped = malformed.replace('comprehension-packet', 'comprehension-\r\n  packet')
      .replace(PACKET_CLOSE, '</whitebox-comprehension-\r\n packet>');
    const escaped = `\\${PACKET_OPEN}{broken}\\${PACKET_CLOSE}`;
    for (const raw of [alteredContract, malformed, wrapped, escaped, `${PACKET_OPEN}${'x'.repeat(600000)}${PACKET_CLOSE}`]) {
      const filter = make();
      const visible = splitEveryBoundary(`앞${raw}뒤`).map(chunk => filter.consume(chunk)).join('') + filter.flush();
      assert.equal(visible, '앞뒤');
      assert.equal(filter.hasPending(), false);
    }
    const unfinished = make();
    assert.equal(unfinished.consume(`답변${PACKET_OPEN}{broken`), '답변');
    assert.equal(unfinished.refresh() + unfinished.releasePending(), '');
    assert.equal(unfinished.consume('다음 턴') + unfinished.flush(), '다음 턴');
    const partial = make();
    assert.equal(partial.consume('답변<whitebox-comprehension-pac') + partial.flush(), '답변');
    const external = make(false);
    assert.equal(external.consume(malformed) + external.flush(), malformed);
  });

  test('PTY 표시 필터는 strict authority가 일치하는 계약과 패킷만 ANSI/chunk 경계에서 숨긴다', () => {
    const expectedPacket = packet(3);
    const contract = COMPREHENSION_CONTRACT
      .replace(rendererComprehension.CONTRACT_OPEN, markerWithAnsi(rendererComprehension.CONTRACT_OPEN))
      .replace(rendererComprehension.CONTRACT_CLOSE, markerWithAnsi(rendererComprehension.CONTRACT_CLOSE));
    const packetEnvelope = `${markerWithAnsi(PACKET_OPEN)}${JSON.stringify(expectedPacket)}${markerWithAnsi(PACKET_CLOSE)}`;
    const raw = `\u001b[36m입력 앞 😀\u001b[0m${contract}\n\n원래 요청\r\n최종 답변\r\n${packetEnvelope}\r\n프롬프트 복귀`;
    const replayFilter = authorizedFilter(expectedPacket);
    const replayVisible = replayFilter.consume(raw) + replayFilter.flush();
    const liveFilter = authorizedFilter(expectedPacket);
    const liveVisible = splitEveryBoundary(raw).map(chunk => liveFilter.consume(chunk)).join('') + liveFilter.flush();
    assert.equal(liveVisible, replayVisible, 'live/replay 표시 필터가 같은 raw에 다른 결과를 만들었습니다.');
    assert(!liveVisible.includes('whitebox-comprehension-contract'));
    assert(!liveVisible.includes('whitebox-comprehension-packet'));
    assert(!liveVisible.includes('schemaVersion'));
    assert(liveVisible.includes('\u001b[36m입력 앞 😀\u001b[0m'));
    assert(liveVisible.includes('원래 요청'));
    assert(liveVisible.includes('최종 답변'));
    assert(liveVisible.includes('프롬프트 복귀'));
  });

  test('PTY 표시 필터는 64KiB 상한의 유효 ASCII packet과 정확한 envelope를 수용한다', () => {
    const expectedPacket = maximumAsciiPacket();
    const json = JSON.stringify(expectedPacket);
    const raw = `${PACKET_OPEN}${json}${PACKET_CLOSE}`;

    assert.equal(Buffer.byteLength(json, 'utf8'), MAX_PACKET_BYTES);
    assert.equal(validateComprehensionPacket(expectedPacket).ok, true);
    assert.equal(raw.length, rendererOutput.DEFAULT_MAX_CANDIDATE_PRINTABLE);
    const filter = authorizedFilter(expectedPacket);
    assert.equal(filter.consume(raw) + filter.flush(), '');

    const paddedOverLimit = `${PACKET_OPEN} ${json}${PACKET_CLOSE}`;
    const overLimitFilter = authorizedFilter(expectedPacket);
    assert.equal(overLimitFilter.consume(paddedOverLimit) + overLimitFilter.flush(), paddedOverLimit,
      '원시 payload가 64KiB를 넘은 동일 packet을 숨겼습니다.');
  });

  test('PTY 표시 필터는 pending 후보를 보류하고 ready generation/fingerprint 확인 뒤 tail만 방출한다', () => {
    const expectedPacket = packet(3);
    let state = 'pending';
    const dynamic = rendererOutput.createFilter({
      packetFingerprint: rendererComprehension.packetContentFingerprint,
      getPacketAuthority: () => ({
        state,
        sessionId: 'codex:main',
        packetFingerprint: rendererComprehension.packetContentFingerprint(expectedPacket),
        completionGeneration: 'generation-2',
      }),
    });
    const envelope = `${PACKET_OPEN}${JSON.stringify(expectedPacket)}${PACKET_CLOSE}`;
    assert.equal(dynamic.consume(`본문${envelope}\r\nTAIL`), '본문');
    assert.equal(dynamic.isSuppressing(), true);
    state = 'ready';
    assert.equal(dynamic.refresh(), '\r\nTAIL');
    assert.equal(dynamic.isSuppressing(), false);
  });

  test('PTY 표시 필터는 동일 packet을 다른 session 또는 이미 알려진 generation 권한으로 재사용하지 않는다', () => {
    const expectedPacket = packet(3);
    const envelope = `${PACKET_OPEN}${JSON.stringify(expectedPacket)}${PACKET_CLOSE}`;
    const fingerprint = rendererComprehension.packetContentFingerprint(expectedPacket);
    const authority = {
      state: 'ready',
      sessionId: 'codex:first',
      packetFingerprint: fingerprint,
      completionGeneration: 'generation-1',
    };
    const makeDynamic = () => rendererOutput.createFilter({
      packetFingerprint: rendererComprehension.packetContentFingerprint,
      getPacketAuthority: () => ({ ...authority }),
    });

    const otherSession = makeDynamic();
    assert.equal(otherSession.consume(PACKET_OPEN), '');
    authority.sessionId = 'codex:second';
    assert.equal(otherSession.consume(envelope.slice(PACKET_OPEN.length)), envelope,
      '다른 session의 동일 packet authority가 이전 출력 envelope를 숨겼습니다.');

    authority.sessionId = 'codex:first';
    authority.completionGeneration = 'generation-1';
    const otherGeneration = makeDynamic();
    assert.equal(otherGeneration.consume(PACKET_OPEN), '');
    authority.completionGeneration = 'generation-2';
    assert.equal(otherGeneration.consume(envelope.slice(PACKET_OPEN.length)), envelope,
      '다른 완료 generation의 동일 packet authority가 이전 출력 envelope를 숨겼습니다.');

    authority.state = 'pending';
    authority.completionGeneration = 'generation-2';
    const heldGeneration = makeDynamic();
    assert.equal(heldGeneration.consume(envelope), '');
    authority.state = 'ready';
    authority.completionGeneration = 'generation-3';
    assert.equal(heldGeneration.refresh(), envelope,
      '보류 중이던 동일 packet을 다른 ready generation이 승인했습니다.');

    authority.state = 'pending';
    authority.sessionId = '';
    authority.completionGeneration = '';
    const unidentified = makeDynamic();
    assert.equal(unidentified.consume(envelope), envelope,
      '출력 source identity가 없는 pending packet을 보류하거나 숨겼습니다.');
  });

  test('PTY 표시 필터는 generation 전 pending source를 같은 session의 첫 ready generation에만 연결한다', () => {
    const expectedPacket = packet(3);
    const fingerprint = rendererComprehension.packetContentFingerprint(expectedPacket);
    const authority = {
      state: 'pending',
      sessionId: 'codex:main',
      packetFingerprint: fingerprint,
      completionGeneration: '',
    };
    const dynamic = rendererOutput.createFilter({
      packetFingerprint: rendererComprehension.packetContentFingerprint,
      getPacketAuthority: () => ({ ...authority }),
    });
    const envelope = `${PACKET_OPEN}${JSON.stringify(expectedPacket)}${PACKET_CLOSE}`;
    assert.equal(dynamic.consume(`${envelope}\r\nTAIL`), '');
    authority.state = 'ready';
    authority.completionGeneration = 'generation-1';
    assert.equal(dynamic.refresh(), '\r\nTAIL');
  });

  test('PTY 표시 필터는 invalid, fingerprint mismatch, generation 누락을 원문 그대로 방출한다', () => {
    const expectedPacket = packet(3);
    const validRaw = `앞${PACKET_OPEN}${JSON.stringify(expectedPacket)}${PACKET_CLOSE}뒤`;
    const mismatched = { ...clone(expectedPacket), summary: '다른 완료 결과' };
    const invalidRaw = `앞${markerWithAnsi(PACKET_OPEN)}{"schemaVersion":1,"unsafe":"<img>"}${markerWithAnsi(PACKET_CLOSE)}뒤`;
    const mismatchRaw = `앞${PACKET_OPEN}${JSON.stringify(mismatched)}${PACKET_CLOSE}뒤`;
    const missingGenerationRaw = `앞${PACKET_OPEN}${JSON.stringify(expectedPacket)}${PACKET_CLOSE}뒤`;
    assert.equal(authorizedFilter(expectedPacket).consume(invalidRaw), invalidRaw);
    assert.equal(authorizedFilter(expectedPacket).consume(mismatchRaw), mismatchRaw);
    const unsupported = rendererOutput.createFilter();
    assert.equal(unsupported.consume(validRaw) + unsupported.flush(), validRaw,
      '외부 관측/unsupported PTY는 packet envelope까지 원문 그대로 표시해야 합니다.');
    assert.equal(
      authorizedFilter(expectedPacket, { completionGeneration: '' }).consume(missingGenerationRaw),
      missingGenerationRaw,
    );
  });

  test('PTY 표시 필터는 missing close, 후보 초과, 다음 입력 경계에서 보류 raw를 잃지 않는다', () => {
    const expectedPacket = packet(3);
    const missingRaw = `\u001b[32m보이는 답\u001b[0m${markerWithAnsi(PACKET_OPEN)}{"broken":true}`;
    const missing = authorizedFilter(expectedPacket, { state: 'pending' });
    assert.equal(missing.consume(missingRaw), '\u001b[32m보이는 답\u001b[0m');
    assert.equal(missing.flush(), missingRaw.slice('\u001b[32m보이는 답\u001b[0m'.length));
    assert.equal(missing.hasPending(), false);

    const boundary = authorizedFilter(expectedPacket, { state: 'pending' });
    const held = `${PACKET_OPEN}${JSON.stringify(expectedPacket)}${PACKET_CLOSE}\r\n아직 보류`;
    assert.equal(boundary.consume(held), '');
    assert.equal(boundary.releasePending(), held);
    assert.equal(boundary.consume('다음 사용자 턴') + boundary.flush(), '다음 사용자 턴');

    const overflowRaw = `${PACKET_OPEN}${'x'.repeat(1200)}`;
    const overflow = rendererOutput.createFilter({
      maxCandidatePrintable: 1024,
      maxCandidateRaw: 1100,
      packetFingerprint: rendererComprehension.packetContentFingerprint,
      getPacketAuthority: () => ({ state: 'pending' }),
    });
    assert.equal(overflow.consume(overflowRaw) + overflow.flush(), overflowRaw);
    assert.equal(overflow.hasPending(), false);
  });

  test('PTY 표시 필터는 owned terminal의 정확한 최초 주입 계약만 숨긴다', () => {
    const expectedPacket = packet(3);
    const owned = authorizedFilter(expectedPacket);
    assert.equal(owned.consume(COMPREHENSION_CONTRACT) + owned.flush(), '');
    assert.equal(owned.consume(COMPREHENSION_CONTRACT) + owned.flush(), COMPREHENSION_CONTRACT);
    const unowned = authorizedFilter(expectedPacket, { owned: false });
    assert.equal(unowned.consume(COMPREHENSION_CONTRACT) + unowned.flush(), COMPREHENSION_CONTRACT);
    const modified = COMPREHENSION_CONTRACT.replace('same final response', 'later final response');
    const modifiedFilter = authorizedFilter(expectedPacket);
    assert.equal(modifiedFilter.consume(modified) + modifiedFilter.flush(), modified);
  });

  test('fresh PTY launch provenance는 binding 전 계약 echo만 숨기고 packet 권한은 부여하지 않는다', () => {
    const freshLaunch = {
      type: 'agent',
      backend: 'direct',
      comprehensionContractInjected: true,
      initialPromptFingerprint: 'a'.repeat(64),
      initialPromptFingerprintVersion: 'raw-v1',
      bridgeId: '',
      agentResumeSessionId: '',
      agentForkSourceSessionId: '',
    };
    assert.equal(rendererOutput.hasTrustedContractLaunchProvenance(freshLaunch), true);

    const expectedPacket = packet(3);
    const filter = rendererOutput.createFilter({
      contractBlock: COMPREHENSION_CONTRACT,
      isOwnedTerminal: () => rendererOutput.hasTrustedContractLaunchProvenance(freshLaunch),
      packetFingerprint: rendererComprehension.packetContentFingerprint,
      getPacketAuthority: () => ({ state: 'release' }),
    });
    const rawPacket = envelope(expectedPacket);
    assert.equal(filter.consume(COMPREHENSION_CONTRACT), '');
    assert.equal(filter.consume(rawPacket) + filter.flush(), rawPacket,
      'fresh launch provenance만으로 packet envelope까지 숨겼습니다.');

    for (const untrusted of [
      { ...freshLaunch, comprehensionContractInjected: false },
      { ...freshLaunch, initialPromptFingerprint: 'not-a-fingerprint' },
      { ...freshLaunch, initialPromptFingerprintVersion: '' },
      { ...freshLaunch, backend: 'managed-tmux' },
      { ...freshLaunch, bridgeId: 'external-session' },
      { ...freshLaunch, agentResumeSessionId: 'resume-session' },
      { ...freshLaunch, agentForkSourceSessionId: 'fork-source' },
    ]) {
      assert.equal(rendererOutput.hasTrustedContractLaunchProvenance(untrusted), false);
    }
  });

  test('renderer는 ready 완료 메인 노드만 표시하고 저장 키를 세션과 패킷 생성 내용에 귀속한다', () => {
    const ready = {
      id: 'codex:main', status: 'completed', parentId: null, depth: 0, completionObserved: true,
      comprehensionContractInjected: true,
      completedAt: '2026-08-01T00:00:00.000Z',
      comprehension: { status: 'ready', schemaVersion: 1, packet: packet(3) },
    };
    assert.equal(rendererComprehension.isRenderablePacket(ready.comprehension.packet), true);
    assert.equal(rendererComprehension.isEligibleSession(ready), true);
    assert.equal(rendererComprehension.isEligibleSession({ ...ready, status: 'running' }), false);
    assert.equal(rendererComprehension.isEligibleSession({ ...ready, parentId: 'codex:parent' }), false);
    assert.equal(rendererComprehension.isEligibleSession({ ...ready, depth: 1 }), false);
    assert.equal(rendererComprehension.isEligibleSession({ ...ready, completionObserved: false }), false);
    assert.equal(rendererComprehension.isEligibleSession({ ...ready, comprehensionContractInjected: false }), false);
    assert.equal(rendererComprehension.isEligibleSession({ ...ready, comprehension: { status: 'unsupported' } }), false);
    const key = rendererComprehension.progressStorageKey(ready, ready.comprehension.packet);
    const sameContent = clone(ready.comprehension.packet);
    const reusedIdWithNewContent = { ...clone(ready.comprehension.packet), summary: '새 완료 생성의 설명' };
    assert.match(key, /^whitebox:comprehension:v1:codex%3Amain:packet-1%3A/u);
    assert.equal(rendererComprehension.progressStorageKey(ready, sameContent), key);
    assert.notEqual(rendererComprehension.progressStorageKey(ready, reusedIdWithNewContent), key);
    assert.notEqual(
      rendererComprehension.progressStorageKey({ ...ready, completedAt: '2026-08-01T00:00:01.000Z' }, sameContent),
      key,
      'byte-identical 패킷도 새 완료 세대라면 이전 점수와 자동 표시 상태를 재사용하면 안 됩니다.',
    );
    assert.equal(
      rendererComprehension.packetContentFingerprint(sameContent),
      rendererComprehension.packetContentFingerprint(ready.comprehension.packet),
    );
    assert.equal(rendererComprehension.completionGenerationIdentity(ready), ready.completedAt);
  });
}

async function runStandalone() {
  const tests = [];
  registerComprehensionPacketTests({ test: (name, run) => tests.push({ name, run }) });
  let failures = 0;
  for (const row of tests) {
    try {
      await row.run();
      process.stdout.write(`PASS ${row.name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`FAIL ${row.name}\n${error.stack}\n`);
    }
  }
  if (failures) process.exitCode = 1;
  else process.stdout.write(`PASS ${tests.length} comprehension packet tests\n`);
}

if (require.main === module) runStandalone();

module.exports = { registerComprehensionPacketTests };
