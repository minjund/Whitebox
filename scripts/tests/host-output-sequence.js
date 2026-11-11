'use strict';

const assert = require('assert');
const path = require('path');
const { TerminalHostClient } = require('../../src/terminalHost');

function frame(message) {
  return Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
}

function registerHostOutputSequenceTests(context) {
  const { test, temp } = context;

  test('host 출력 이벤트가 캐시된 outputSequence를 올려, 답이 끝난 AI가 계속 작업 중으로 보이지 않는다', () => {
    const client = new TerminalHostClient({ discoveryFile: path.join(temp, 'host-output-sequence.json') });
    const seen = [];
    client.on('data', payload => seen.push(payload.outputSequence));
    client.consume(frame({ type: 'event', event: 'state', payload: { sessions: [
      { id: 'terminal:a', creationId: 'c', outputSequence: 5, status: 'running' },
      { id: 'terminal:b', creationId: 'd', outputSequence: 40, status: 'running' },
    ] } }));
    // The final redraw after the last state event, as when an AI finishes a turn.
    client.consume(frame({ type: 'event', event: 'data', payload: { id: 'terminal:a', data: '❯ ', outputSequence: 9 } }));
    assert.deepStrictEqual(seen, [9], '출력은 그대로 전달해야 합니다.');
    assert.equal(client.list().find(item => item.id === 'terminal:a').outputSequence, 9,
      'list()가 마지막 출력 번호를 모르면 요약 모드 전송 대기가 풀리지 않습니다.');
    // Out-of-order or malformed events never move a cached sequence backwards.
    client.consume(frame({ type: 'event', event: 'data', payload: { id: 'terminal:a', data: 'x', outputSequence: 7 } }));
    client.consume(frame({ type: 'event', event: 'data', payload: { id: 'terminal:a', data: 'x', outputSequence: 'bad' } }));
    client.consume(frame({ type: 'event', event: 'data', payload: { id: 'terminal:missing', data: 'x', outputSequence: 99 } }));
    assert.equal(client.list().find(item => item.id === 'terminal:a').outputSequence, 9);
    assert.equal(client.list().find(item => item.id === 'terminal:b').outputSequence, 40);
    assert.equal(client.list().length, 2, '모르는 터미널의 출력으로 목록을 늘리면 안 됩니다.');
  });
}

module.exports = { registerHostOutputSequenceTests };
