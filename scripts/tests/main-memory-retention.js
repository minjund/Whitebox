'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

// Runs in a fresh `node --expose-gc` so heap measurements are not affected by
// the rest of the regression suite. Each probe keeps 40 short results derived
// from distinct ~1 MB strings; a retained parent costs ~40 MB per probe.
const RETENTION_PROBE = `
const root = process.argv[1];
const { bounded } = require(root + '/src/terminalReviewBudget');
const { addCall, addResult } = require(root + '/src/terminalReviewTools');
const { archiveRequest, recordAnswer } = require(root + '/src/terminalReviewContext');
const { compactText } = require(root + '/src/agentMonitor');
const { detachedPrefix } = require(root + '/src/detachedString');
const parent = i => 'x'.repeat(1024 * 1024) + ' important ' + i + ' tail '.repeat(10);
function measure(make) {
  global.gc(); global.gc();
  const before = process.memoryUsage().heapUsed, kept = [];
  for (let i = 0; i < 40; i++) kept.push(make(parent(i), i));
  global.gc(); global.gc();
  const grown = (process.memoryUsage().heapUsed - before) / 1048576;
  if (!kept.length) throw new Error('nothing kept');
  return Math.round(grown * 10) / 10;
}
const result = {
  control: measure(text => text.slice(0, 400) + '…'),
  bounded: measure(text => bounded(text, 500)),
  detachedPrefix: measure(text => detachedPrefix(text, 400, '…')),
  compactText: measure(text => compactText(text, 1600)),
  toolExcerpt: measure((text, i) => {
    const state = { requestId: 'r' };
    addCall(state, 'call-' + i + text, 'Read', {});
    addResult(state, state.tools[0].id, text, false);
    return state;
  }),
  context: measure((text, i) => {
    const state = { requestId: 'r' + i, request: 'must keep ' + text };
    recordAnswer(state, text); recordAnswer(state, text + ' updated');
    archiveRequest(state);
    // The live state owns request/answer; only the archived copies persist.
    return [state.context, state.conditions, state.updates];
  }),
};
process.stdout.write(JSON.stringify(result));
`;

function registerMainMemoryRetentionTests({ test, temp }) {
  test('stored excerpts are detached copies that never retain their megabyte source strings', () => {
    const output = execFileSync(process.execPath, ['--expose-gc', '-e', RETENTION_PROBE, root], { encoding: 'utf8', timeout: 60_000 });
    const result = JSON.parse(output);
    assert(result.control > 20, `control must show retention: ${output}`);
    for (const [name, grownMb] of Object.entries(result)) {
      if (name !== 'control') assert(grownMb < 6, `${name} retained ${grownMb} MB: ${output}`);
    }
  });

  test('detached text is identical, including an emoji cut in half', () => {
    const { detach, detachedPrefix } = require('../../src/detachedString');
    const { bounded } = require('../../src/terminalReviewBudget');
    const { compactText } = require('../../src/agentMonitor');
    const cut = 'a😀b'.slice(0, 2);
    assert.equal(detach(cut), cut);
    assert.equal(detachedPrefix('abc', 10), 'abc');
    assert.equal(detachedPrefix('abcdef', 3, '…'), 'abc…');
    assert.equal(compactText('  hello\u0000 world  ', 4), 'hell…');
    assert.equal(compactText('short'), 'short');
    const long = 'A'.repeat(5000) + 'Z'.repeat(5000);
    const clipped = bounded(long, 600);
    assert(clipped.startsWith('A') && clipped.endsWith('Z') && clipped.length === 600);
    assert.match(clipped, /\[omitted: evidence exceeds budget/);
  });

  test('the review evidence index keeps offsets and digests only, with a bounded record count', () => {
    const { ReviewEvidenceIndex } = require('../../src/terminalReviewEvidence');
    const index = new ReviewEvidenceIndex();
    const secret = 'TRANSCRIPT_BODY_' + 'q'.repeat(4000);
    for (let i = 0; i < 2100; i++) {
      const row = { type: 'assistant', sessionId: 's', message: { role: 'assistant', content: [{ type: 'text', text: `${secret} ${i} must stay` }] } };
      index.add('file.jsonl', { ino: 1 }, 'claude', 's', 'request', row, i * 10, Buffer.from(JSON.stringify(row)));
    }
    const source = index.sources.get('file.jsonl');
    assert.equal(source.records.length, 2048);
    assert.equal(source.omitted, 52);
    assert.doesNotMatch(JSON.stringify(source.records), /TRANSCRIPT_BODY/);
    const manifest = index.manifest('file.jsonl', 'request');
    assert.equal(manifest.records.length, 2048);
    assert.equal(manifest.records[0].critical, true);
  });

  test('token usage tracks a bounded number of API calls without changing totals', () => {
    const { observeClaudeUsage, tokenUsage, MAX_TRACKED_CALLS } = require('../../src/terminalTokenUsage');
    const state = {};
    const row = (id, input, output) => ({ sessionId: 's', type: 'assistant', requestId: id, timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'assistant', usage: { input_tokens: input, output_tokens: output } } });
    for (let i = 0; i < MAX_TRACKED_CALLS * 3; i++) {
      observeClaudeUsage(state, row(`call-${i}`, 10, 1), 's');
      observeClaudeUsage(state, row(`call-${i}`, 10, 2), 's'); // cumulative repeat
    }
    assert.equal(state.tokenCalls.size, MAX_TRACKED_CALLS);
    const usage = tokenUsage(state);
    assert.equal(usage.input, MAX_TRACKED_CALLS * 3 * 10);
    assert.equal(usage.output, MAX_TRACKED_CALLS * 3 * 2);
    assert.equal(usage.partial, false);
    for (let i = 0; i < MAX_TRACKED_CALLS + 5; i++) observeClaudeUsage(state, { ...row(`missing-${i}`, 0, 0), message: { role: 'assistant' } }, 's');
    assert(state.tokenMissing.size <= MAX_TRACKED_CALLS);
    assert.equal(tokenUsage(state).partial, true, 'an evicted unresolved call keeps the total partial');
  });

  test('collaboration keeps active and recent jobs, removes old finished jobs and their requests from disk', async () => {
    const { TerminalCollaboration, RETAINED_FINISHED_JOBS, FINISHED_JOB_GRACE_MS } = require('../../src/terminalCollaboration');
    const directory = path.join(temp, 'collaboration-prune');
    fs.mkdirSync(directory, { recursive: true });
    let now = Date.UTC(2026, 10, 11);
    const id = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const write = (job, request = true) => {
      fs.writeFileSync(path.join(directory, `${job.id}.job.json`), JSON.stringify(job));
      if (request) fs.writeFileSync(path.join(directory, `${job.id}.request.json`), JSON.stringify({ id: job.id, operation: 'ask', sourceId: 'a', targetId: 'b', groupId: 'g', token: 'old', message: 'hi' }));
    };
    const total = RETAINED_FINISHED_JOBS + 60;
    for (let i = 0; i < total; i++) write({ id: id(i), operation: 'ask', state: 'completed', createdAt: now - 60 * 60_000 - (total - i) * 1000, finishedAt: now - 60 * 60_000 - (total - i) * 1000 });
    write({ id: id(900), operation: 'ask', state: 'failed', createdAt: now - 8 * 24 * 60 * 60_000 }); // oldest; pinned by summary chat below
    write({ id: id(901), operation: 'ask', state: 'running', createdAt: now - 9 * 24 * 60 * 60_000, sentAt: now - 9 * 24 * 60 * 60_000 });
    const service = new TerminalCollaboration({ directory, manager: () => ({ list: () => [] }),
      monitor: { scan: () => ({ available: true, processes: [] }) }, activity: { observe: async () => new Map() }, enableControl: false, now: () => now });
    // Restart converts the unfinished job; it stays readable through the grace period.
    assert.equal(service.jobs.get(id(901)).state, 'interrupted');
    assert(service.jobs.size <= RETAINED_FINISHED_JOBS + 1);
    assert.equal(service.jobs.has(id(0)), false, 'oldest finished job beyond the count limit is removed');
    assert.equal(fs.existsSync(path.join(directory, `${id(0)}.job.json`)), false);
    assert.equal(fs.existsSync(path.join(directory, `${id(0)}.request.json`)), false, 'its request can never be replayed');
    assert.equal(service.jobs.has(id(total - 1)), true);

    // A pinned summary job survives; a job finishing now gets a grace period.
    write({ id: id(900), operation: 'ask', state: 'failed', createdAt: now - 8 * 24 * 60 * 60_000 });
    service.jobs.set(id(900), JSON.parse(fs.readFileSync(path.join(directory, `${id(900)}.job.json`), 'utf8')));
    const fresh = { id: id(902), operation: 'summary', state: 'completed', createdAt: now - 20 * 24 * 60 * 60_000 };
    service.jobs.set(fresh.id, fresh); service.save(fresh);
    now += FINISHED_JOB_GRACE_MS + 1000;
    await service.sync({ groups: [], frames: [], summaryJobs: [{ id: id(900) }] });
    assert.equal(service.jobs.has(id(900)), true, 'summary chat still waits for this job');
    assert.equal(service.jobs.has(id(902)), true, 'a job finished in this process is kept through the grace period');
    assert.equal(service.jobs.has(id(901)), false, 'restart-interrupted job past its grace and age is removed');
    now += FINISHED_JOB_GRACE_MS + 1000;
    await service.sync({ groups: [], frames: [], summaryJobs: [] });
    assert.equal(service.jobs.has(id(900)), false);
    assert.equal(service.jobs.has(id(902)), false);
    const finished = [...service.jobs.values()].filter(job => job.state === 'completed').length;
    assert.equal(finished, RETAINED_FINISHED_JOBS);
    const files = fs.readdirSync(directory);
    assert.equal(files.filter(name => name.endsWith('.job.json')).length, service.jobs.size);
    assert.equal(files.filter(name => name.endsWith('.request.json')).length, service.jobs.size, 'no orphan request files remain');
    // Removed requests are not picked up again as new work.
    await service.sync({ groups: [], frames: [] });
    assert.equal(service.jobs.size, RETAINED_FINISHED_JOBS);
  });

  test('an unchanged-frame marker refreshes only the exact stored screen', async () => {
    const { TerminalCollaboration } = require('../../src/terminalCollaboration');
    const directory = path.join(temp, 'collaboration-unchanged-frame');
    let now = 1_000_000;
    const member = { id: 'terminal:1', creationId: 'epoch:1', pid: 4242, status: 'running', outputSequence: 7 };
    const service = new TerminalCollaboration({ directory, manager: () => ({ list: () => [member] }),
      monitor: { scan: () => ({ available: true, processes: [] }) }, activity: { observe: async () => new Map() }, enableControl: false, now: () => now });
    const sync = frames => service.sync({ groups: [{ id: 'group', cwd: directory, members: [member] }], frames });
    await sync([{ id: member.id, creationId: member.creationId, outputSequence: 7, text: 'screen ❯ ', readinessText: 'screen ❯ ' }]);
    const first = service.frames.get(member.id);
    assert.equal(first.at, now);
    now += 9_000;
    await sync([{ id: member.id, creationId: member.creationId, outputSequence: 7, unchanged: true }]);
    assert.equal(service.frames.get(member.id).at, now, 'matching marker makes the stored screen current');
    assert.equal(service.frames.get(member.id).text, 'screen ❯ ');
    const refreshed = now;
    now += 1_000;
    await sync([{ id: member.id, creationId: member.creationId, outputSequence: 8, unchanged: true }]);
    assert.equal(service.frames.get(member.id).at, refreshed, 'a different output sequence is not the stored screen');
    await sync([{ id: member.id, creationId: 'epoch:other', outputSequence: 7, unchanged: true }]);
    assert.equal(service.frames.get(member.id).at, refreshed, 'another terminal epoch never refreshes it');
    await sync([{ id: member.id, creationId: member.creationId, outputSequence: 9, text: 'new screen' }]);
    assert.equal(service.frames.get(member.id).text, 'new screen');
  });

  test('desktop notifications are released on click, failure and close, and the retained set is capped', () => {
    const { AttentionNotifier, MAX_RETAINED_NOTIFICATIONS } = require('../../src/attentionNotifier');
    class FakeNotification extends EventEmitter {
      static created = [];
      constructor(options) { super(); this.options = options; FakeNotification.created.push(this); }
      show() {}
      close() { this.emit('close'); }
    }
    const opened = [];
    const notifier = new AttentionNotifier({ Notification: FakeNotification, isSupported: () => true, onOpen: session => opened.push(session.id) });
    const show = n => notifier.notify({ id: `s${n}`, title: `t${n}`, attention: { summary: 'x' } }, 'attention');
    show(1); show(2); show(3);
    assert.equal(notifier.notifications.size, 3);
    FakeNotification.created[0].emit('click');
    assert.deepEqual(opened, ['s1']);
    FakeNotification.created[1].emit('failed', 'denied');
    assert.equal(notifier.notifications.size, 1);
    FakeNotification.created[2].emit('close');
    assert.equal(notifier.notifications.size, 0);
    for (let i = 0; i < MAX_RETAINED_NOTIFICATIONS + 20; i++) show(100 + i);
    assert.equal(notifier.notifications.size, MAX_RETAINED_NOTIFICATIONS);
    assert(notifier.notifications.has(FakeNotification.created.at(-1)), 'newest notification stays referenced');
    notifier.dispose();
    assert.equal(notifier.notifications.size, 0);
  });
}

module.exports = { registerMainMemoryRetentionTests };
