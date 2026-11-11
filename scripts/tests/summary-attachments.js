'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const {
  SummaryAttachments, validateImage, detectImageType, messageWithAttachments, wslPath, payloadWithAttachments,
  MAX_ATTACHMENT_BYTES, ATTACHMENT_MAX_AGE_MS,
} = require('../../src/summaryAttachments');
const { TerminalCollaboration } = require('../../src/terminalCollaboration');
const vm = require('vm');

function loadPreloadApi(root, invoke) {
  let exposed = null;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'preload.js'), 'utf8'), {
    require: name => {
      if (name !== 'electron') throw new Error(`unexpected preload dependency: ${name}`);
      return { ipcRenderer: { invoke, on() {}, removeListener() {} },
        contextBridge: { exposeInMainWorld(key, value) { if (key === 'whitebox') exposed = value; } } };
    },
  }, { filename: 'preload.js' });
  return exposed;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-summary-attachments-')); }

function registerSummaryAttachmentTests({ test, root }) {
  test('summary image attachments accept only real PNG/JPEG/GIF/WebP bytes within the size cap', () => {
    assert.equal(detectImageType(PNG), 'png');
    assert.equal(detectImageType(JPEG), 'jpg');
    assert.equal(detectImageType(GIF), 'gif');
    assert.equal(detectImageType(WEBP), 'webp');
    assert.equal(validateImage({ type: 'image/png', data: new Uint8Array(PNG) }).type, 'image/png');
    // The declared type never decides: the file signature does.
    assert.equal(validateImage({ type: 'image/jpeg', data: PNG }).ext, 'png');
    assert.throws(() => validateImage({ type: 'image/png', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }), error => error.code === 'ATTACHMENT_NOT_IMAGE');
    assert.throws(() => validateImage({ type: 'text/plain', data: PNG }), error => error.code === 'ATTACHMENT_NOT_IMAGE');
    assert.throws(() => validateImage({ type: 'image/png', data: 'iVBORw0KGgo=' }), error => error.code === 'ATTACHMENT_EMPTY');
    assert.throws(() => validateImage({ type: 'image/png', data: new Uint8Array() }), error => error.code === 'ATTACHMENT_EMPTY');
    const huge = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1); PNG.copy(huge);
    assert.throws(() => validateImage({ type: 'image/png', data: huge }), error => error.code === 'ATTACHMENT_TOO_LARGE');
    const limit = Buffer.alloc(MAX_ATTACHMENT_BYTES); PNG.copy(limit);
    assert.equal(validateImage({ data: limit }).ext, 'png');
  });

  test('summary attachments are saved privately under the app directory and only by their own IDs', () => {
    const directory = path.join(temp(), 'summary-attachments');
    try {
      const store = new SummaryAttachments({ directory });
      const saved = store.save({ type: 'image/png', data: new Uint8Array(PNG) });
      assert.match(saved.id, /^[a-f0-9-]{36}\.png$/u);
      assert.equal(path.dirname(saved.path), path.resolve(directory));
      assert.deepEqual(fs.readFileSync(saved.path), PNG);
      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(saved.path).mode & 0o777, 0o600);
        assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
      }
      assert.deepEqual(store.resolve([saved.id]), [saved.path]);
      // No other file can be named through an ID.
      for (const id of ['../secret.png', `${randomUUID()}.svg`, '/etc/passwd', `${saved.id}/..`, saved.id.toUpperCase()]) {
        assert.equal(store.file(id), null, id);
      }
      fs.writeFileSync(path.join(directory, 'note.txt'), 'keep');
      assert.throws(() => store.resolve(['note.txt']), error => error.code === 'ATTACHMENT_MISSING');
      assert.throws(() => store.resolve([`${randomUUID()}.png`]), error => error.code === 'ATTACHMENT_MISSING');
      assert.throws(() => store.resolve(Array.from({ length: 6 }, () => saved.id)), error => error.code === 'ATTACHMENT_COUNT');
      assert.deepEqual(store.remove([saved.id, '../note.txt']), { removed: 1 });
      assert.equal(fs.existsSync(saved.path), false);
      assert.equal(fs.existsSync(path.join(directory, 'note.txt')), true, 'removal never reaches other files');
    } finally { fs.rmSync(path.dirname(directory), { recursive: true, force: true }); }
  });

  test('summary attachments older than seven days are pruned at startup and newer ones kept', () => {
    const directory = temp();
    try {
      let now = Date.now();
      const store = new SummaryAttachments({ directory, now: () => now });
      const old = store.save({ data: PNG }), fresh = store.save({ data: JPEG });
      const past = new Date(now - ATTACHMENT_MAX_AGE_MS - 60_000);
      fs.utimesSync(old.path, past, past);
      fs.writeFileSync(path.join(directory, 'unrelated.png'), PNG);
      fs.utimesSync(path.join(directory, 'unrelated.png'), past, past);
      assert.deepEqual(store.prune(), { removed: 1 });
      assert.equal(fs.existsSync(old.path), false);
      assert.equal(fs.existsSync(fresh.path), true);
      assert.equal(fs.existsSync(path.join(directory, 'unrelated.png')), true);
      assert.deepEqual(new SummaryAttachments({ directory: path.join(directory, 'missing') }).prune(), { removed: 0 });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  test('every provider receives the request text followed by one line per attached image path', async () => {
    const directory = temp();
    try {
      const store = new SummaryAttachments({ directory });
      const a = store.save({ data: PNG }), b = store.save({ data: GIF });
      assert.equal(messageWithAttachments('화면 확인해줘', ['/x/a.png', '/x/b.gif']), '화면 확인해줘\n\n첨부 이미지: /x/a.png\n첨부 이미지: /x/b.gif');
      assert.equal(messageWithAttachments('', ['/x/a.png'], 'Attached image'), 'Attached image: /x/a.png');
      assert.equal(wslPath('C:\\Users\\me\\AppData\\Roaming\\Whitebox\\summary-attachments\\a.png'), '/mnt/c/Users/me/AppData/Roaming/Whitebox/summary-attachments/a.png');
      const base = { operation: 'summary-send', id: randomUUID(), targetId: 'terminal:1', message: '이 화면 봐줘' };
      assert.deepEqual(await payloadWithAttachments(base, { store }), base, 'a request without images is unchanged');
      const sent = await payloadWithAttachments({ ...base, attachments: [a.id, b.id] }, { store, label: '첨부 이미지' });
      assert.equal(sent.attachments, undefined);
      assert.equal(sent.message, `이 화면 봐줘\n\n첨부 이미지: ${a.path}\n첨부 이미지: ${b.path}`);
      const wsl = await payloadWithAttachments({ ...base, attachments: [a.id] }, { store, platform: 'win32', shell: async () => 'wsl', label: 'L' });
      assert.equal(wsl.message, `이 화면 봐줘\n\nL: ${wslPath(a.path)}`);
      store.remove([b.id]);
      await assert.rejects(payloadWithAttachments({ ...base, attachments: [a.id, b.id] }, { store }), /찾지 못했어요/);

      // The composed text passes the guarded delivery unchanged for each AI CLI.
      for (const provider of ['claude', 'codex', 'gemini', 'grok']) {
        const session = { id: 'terminal:chat', creationId: 'workspace:test', pid: 100, status: 'running', outputSequence: 1 };
        const writes = [];
        const manager = { list: () => [session], get: async id => id === session.id ? session : null, rawWriteDeliverySupported: () => true,
          write: async (id, data) => { writes.push(data); return { ok: true, deliveryState: 'accepted' }; }, respond: async () => {} };
        const prompt = { claude: '> ', codex: '› Ask Codex to do anything', gemini: '> Type your message', grok: '> ' }[provider];
        const collaboration = new TerminalCollaboration({ directory: path.join(directory, provider), manager: () => manager, enableControl: false,
          activity: { observe: async () => new Map() }, completion: { observe: async () => ({ available: false }) },
          monitor: { scan: () => ({ available: true, processes: [{ pid: 101, ancestorPids: [session.pid], provider }] }) } });
        await collaboration.sync({ groups: [{ id: 'panel', cwd: directory, members: [session] }],
          frames: [{ id: session.id, creationId: session.creationId, outputSequence: 1, text: prompt, inputDraft: '' }] });
        const payload = await payloadWithAttachments({ ...base, id: randomUUID(), groupId: 'panel', targetId: session.id,
          targetCreationId: session.creationId, targetProviderPid: 101, targetProvider: provider, attachments: [a.id] }, { store });
        const result = await collaboration.summarySend({ ...payload, sendNow: true });
        assert.equal(result.ok, true, `${provider}: ${JSON.stringify(result)}`);
        assert.equal(result.job.request, `이 화면 봐줘\n\n첨부 이미지: ${a.path}`);
        assert.ok(writes[0].includes(`첨부 이미지: ${a.path}`), provider);
      }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  test('screenshot bytes cross the preload as plain bytes and every save and send goes through trusted main handlers', async () => {
    const calls = [];
    const api = loadPreloadApi(root, async (channel, payload) => { calls.push([channel, payload]); return { ok: true }; });
    const bytes = new Uint8Array([9, ...PNG, 9]).subarray(1, PNG.length + 1);
    await api.summaryAttachmentSave({ type: 'image/png', data: bytes, path: '/etc/passwd', name: '../x' });
    await api.summaryAttachmentSave({ type: 'image/png', data: 'not bytes' });
    await api.summaryAttachmentRemove(['a.png', 7]);
    assert.equal(calls[0][0], 'summary-attachments:save');
    assert.deepEqual(Object.keys(calls[0][1]).sort(), ['data', 'type'], 'only the type and the bytes cross');
    assert.deepEqual(Buffer.from(calls[0][1].data), PNG, 'the exact selected bytes, not the whole backing buffer');
    assert.equal(calls[1][1].data, null);
    assert.deepEqual(calls[2], ['summary-attachments:remove', ['a.png', '7']]);
    const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.match(main, /handleTrusted\('summary-attachments:save', payload => summaryAttachments\(\)\.save\(payload\)\)/u);
    assert.match(main, /handleTrusted\('summary-attachments:remove', ids => summaryAttachments\(\)\.remove\(ids\)\)/u);
    assert.match(main, /terminalCollaboration\.summarySend\(await summaryPayloadWithAttachments\(payload\)\)/u);
    assert.match(main, /summaryAttachments\(\)\.prune\(\)/u);
  });
}

module.exports = { registerSummaryAttachmentTests };
