'use strict';

const assert = require('assert');

const IMMUTABLE_V163_BOOTSTRAP_TIMEOUT_ERROR = 'bootstrapError=업데이트 설치 도우미가 10초 안에 준비되지 않았습니다.';
const IMMUTABLE_V163_BOOTSTRAP_EXIT_ZERO_ERROR = 'bootstrapError=업데이트 설치 도우미가 준비 전에 종료되었습니다. 코드: 0';
const IMMUTABLE_V163_HELPER_STAGE_COUNT = 8;
const MAX_SIGNED_INT64 = 9223372036854775807n;

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  assert(Number.isSafeInteger(parsed) && parsed > 0, `${label} was not a positive safe integer: ${value}`);
  return parsed;
}

function parsePositiveInt64Decimal(value, label) {
  assert.equal(typeof value, 'string', `${label} was not a primitive decimal string.`);
  assert.match(value, /^[1-9]\d*$/, `${label} was not a positive decimal string: ${value}`);
  assert(BigInt(value) <= MAX_SIGNED_INT64, `${label} exceeded signed Int64 range: ${value}`);
  return value;
}

function parseImmutableV163FirstHopLog(rawLog, options = {}) {
  assert.equal(typeof rawLog, 'string', 'Immutable v1.6.3 raw log must be a primitive string.');
  assert.equal(typeof options.executable, 'string', 'Immutable v1.6.3 expected executable must be a primitive string.');
  assert.equal(typeof options.version, 'string', 'Immutable v1.6.3 expected version must be a primitive string.');
  assert.equal(typeof options.outcome, 'string', 'Immutable v1.6.3 expected outcome must be a primitive string.');
  assert.equal(typeof options.parentPid, 'number', 'Immutable v1.6.3 parent PID must be a primitive number.');
  const expectedParentPid = parsePositiveInteger(options.parentPid, 'Immutable v1.6.3 parent PID');
  const expectedExecutable = options.executable;
  const expectedVersion = options.version;
  const expectedOutcome = options.outcome;
  assert(expectedExecutable, 'Immutable v1.6.3 expected executable was missing.');
  assert.equal(expectedVersion, '1.6.23', 'Immutable v1.6.3 first-hop parser target changed.');
  assert(['acknowledged', 'bootstrap-race'].includes(expectedOutcome),
    `Immutable v1.6.3 first-hop parser outcome was invalid: ${expectedOutcome}`);

  const raw = rawLog;
  assert(raw.startsWith('\uFEFF'), 'Immutable v1.6.3 first-hop log lost its UTF-8 BOM.');
  assert(raw.endsWith('\r\n'), 'Immutable v1.6.3 first-hop log lost its terminal CRLF.');
  const body = raw.slice(1, -2);
  assert(body && !body.includes('\uFEFF'), 'Immutable v1.6.3 first-hop log contained a misplaced BOM.');
  assert.equal(body.replace(/\r\n/g, '').includes('\r') || body.replace(/\r\n/g, '').includes('\n'), false,
    'Immutable v1.6.3 first-hop log contained a non-CRLF line ending.');
  const lines = body.split('\r\n');

  let bootstrapError = '';
  if (String(lines[lines.length - 1] || '').startsWith('bootstrapError=')) {
    bootstrapError = lines.pop();
  }
  if (expectedOutcome === 'acknowledged') {
    assert.equal(bootstrapError, '', 'Acknowledged immutable v1.6.3 log contained a bootstrap error.');
    assert.equal(lines.length, IMMUTABLE_V163_HELPER_STAGE_COUNT,
      'Acknowledged immutable v1.6.3 log was not the complete official helper sequence.');
  } else {
    assert([
      IMMUTABLE_V163_BOOTSTRAP_TIMEOUT_ERROR,
      IMMUTABLE_V163_BOOTSTRAP_EXIT_ZERO_ERROR,
    ].includes(bootstrapError), `Immutable v1.6.3 bootstrap-race error was not an exact official marker: ${bootstrapError || '(missing)'}`);
    assert(lines.length >= 1 && lines.length <= IMMUTABLE_V163_HELPER_STAGE_COUNT,
      `Immutable v1.6.3 bootstrap-race helper prefix length was invalid: ${lines.length}`);
    if (bootstrapError === IMMUTABLE_V163_BOOTSTRAP_EXIT_ZERO_ERROR) {
      assert.equal(lines.length, IMMUTABLE_V163_HELPER_STAGE_COUNT,
        'A naturally exited immutable v1.6.3 helper must have completed its full success sequence.');
    }
  }

  const expectedStart = `helperStarted=true;parentPid=${expectedParentPid};expectedVersion=${expectedVersion}`;
  assert.equal(lines[0], expectedStart, 'Immutable v1.6.3 helper-start record changed.');
  if (lines.length >= 2) assert.equal(lines[1], 'exitCode=0', 'Immutable v1.6.3 NSIS exit record changed.');
  if (lines.length >= 3) {
    assert.equal(lines[2], `candidate=${expectedExecutable};version=${expectedVersion}`,
      'Immutable v1.6.3 installed candidate record changed.');
  }
  if (lines.length >= 4) {
    assert.equal(lines[3], `relaunchPath=${expectedExecutable};installedVersion=${expectedVersion};expectedVersion=${expectedVersion}`,
      'Immutable v1.6.3 relaunch-path record changed.');
  }

  let relaunchPid = 0;
  let windowHandle = '';
  if (lines.length >= 5) {
    const match = String(lines[4]).match(/^relaunchStarted=true;attempt=1;pid=(\d+)$/);
    assert(match, `Immutable v1.6.3 relaunch-start record changed: ${lines[4]}`);
    relaunchPid = parsePositiveInteger(match[1], 'Immutable v1.6.3 relaunch PID');
  }
  if (lines.length >= 6) {
    const match = String(lines[5]).match(/^windowRestored=true;pid=(\d+);handle=([1-9]\d*)$/);
    assert(match, `Immutable v1.6.3 window-restored record changed: ${lines[5]}`);
    assert.equal(parsePositiveInteger(match[1], 'Immutable v1.6.3 window PID'), relaunchPid,
      'Immutable v1.6.3 window-restored record identified another process.');
    windowHandle = parsePositiveInt64Decimal(match[2], 'Immutable v1.6.3 window handle');
  }
  if (lines.length >= 7) {
    assert.equal(lines[6], `rendererReady=true;attempt=1;pid=${relaunchPid}`,
      'Immutable v1.6.3 renderer-ready record changed.');
  }
  if (lines.length >= 8) {
    assert.equal(lines[7], `relaunchReady=true;attempt=1;pid=${relaunchPid}`,
      'Immutable v1.6.3 relaunch-ready record changed.');
  }

  const expectedLines = [
    expectedStart,
    'exitCode=0',
    `candidate=${expectedExecutable};version=${expectedVersion}`,
    `relaunchPath=${expectedExecutable};installedVersion=${expectedVersion};expectedVersion=${expectedVersion}`,
    `relaunchStarted=true;attempt=1;pid=${relaunchPid}`,
    `windowRestored=true;pid=${relaunchPid};handle=${windowHandle}`,
    `rendererReady=true;attempt=1;pid=${relaunchPid}`,
    `relaunchReady=true;attempt=1;pid=${relaunchPid}`,
  ].slice(0, lines.length);
  const expectedRaw = `\uFEFF${[...expectedLines, ...(bootstrapError ? [bootstrapError] : [])].join('\r\n')}\r\n`;
  assert.equal(raw, expectedRaw,
    'Immutable v1.6.3 first-hop log was not an exact BOM/CRLF official helper prefix.');

  return Object.freeze({
    rawLog: raw,
    outcome: expectedOutcome,
    helperStage: lines.length,
    bootstrapError,
    relaunchPid,
    windowHandle,
  });
}

module.exports = {
  IMMUTABLE_V163_BOOTSTRAP_EXIT_ZERO_ERROR,
  IMMUTABLE_V163_BOOTSTRAP_TIMEOUT_ERROR,
  IMMUTABLE_V163_HELPER_STAGE_COUNT,
  parseImmutableV163FirstHopLog,
};
