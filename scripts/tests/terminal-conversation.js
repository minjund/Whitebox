'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TerminalConversation, chatRows, cleanUserText } = require('../../src/terminalConversation');

const tests = [
  {
    name: 'chat rows keep what the person typed, drop injected context and collapse the repeated last prompt',
    run() {
      assert.equal(cleanUserText('<system-reminder>hook text</system-reminder>고쳐 줘'), '고쳐 줘');
      assert.equal(cleanUserText('<command-message>x</command-message><command-name>/model</command-name><command-args>opus</command-args>'), '/model opus');
      assert.equal(cleanUserText('<local-command-caveat>caveat</local-command-caveat>'), '');
      const rows = chatRows([
        { id: 'u1', role: 'user', text: 'reply grape', timestamp: 't1' },
        { id: 'session:3', role: 'user', text: 'reply grape', timestamp: 't9' },
        { id: 's', role: 'system', text: 'SessionStart hook additional context' },
        { id: 'a1', role: 'assistant', text: 'GRAPE', timestamp: 't2' },
        { id: 't1', role: 'tool', title: 'Bash', text: 'x'.repeat(900), timestamp: 't3' },
        { id: 'u2', role: 'user', text: '<system-reminder>only injected</system-reminder>', timestamp: 't4' },
        { id: 'u3', role: 'user', text: 'reply grape', timestamp: 't5' },
      ]);
      assert.deepEqual(rows.map(row => [row.role, row.text.slice(0, 11)]), [['user', 'reply grape'], ['assistant', 'GRAPE'], ['tool', 'xxxxxxxxxxx'], ['user', 'reply grape']],
        'a repeat right after the request is collapsed; the same words after a reply are a new turn');
      assert.equal(rows[2].text.length, 600, 'tool text is bounded');
      assert.equal(rows[2].title, 'Bash');
    },
  },
  {
    name: 'a chat pane reads only its own terminal\'s Claude/Codex transcript and reparses it only when it changed',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-conversation-'));
      const file = path.join(directory, 'log.jsonl');
      fs.writeFileSync(file, 'x');
      let parses = 0;
      const live = { id: 'terminal:a', creationId: 'workspace:a', pid: 10, status: 'running' };
      let provider = 'codex';
      const reader = new TerminalConversation({
        manager: () => ({ get: async id => (id === live.id ? live : null) }),
        monitor: { scan: () => ({ available: true, processes: [{ pid: 20, ancestorPids: [10], provider }] }) },
        completion: { observe: async () => ({ available: true, state: 'idle', source: { file } }) },
        parsers: { codex: () => { parses++; return { messages: [{ id: 'u', role: 'user', text: 'hi' }, { id: 'a', role: 'assistant', text: 'hello' }] }; } },
      });
      await assert.rejects(reader.read({ id: '../x', creationId: 'workspace:a' }));
      assert.deepEqual(await reader.read({ id: 'terminal:a', creationId: 'workspace:other' }), { available: false, reason: 'session' }, 'another terminal generation is refused');
      const first = await reader.read({ id: 'terminal:a', creationId: 'workspace:a' });
      assert.equal(first.available, true);
      assert.deepEqual(first.messages.map(row => row.text), ['hi', 'hello']);
      const again = await reader.read({ id: 'terminal:a', creationId: 'workspace:a', revision: first.revision });
      assert.equal(again.unchanged, true, 'an unchanged transcript sends no rows');
      await reader.read({ id: 'terminal:a', creationId: 'workspace:a' });
      assert.equal(parses, 1, 'an unchanged file is not parsed again');
      fs.appendFileSync(file, 'y');
      await reader.read({ id: 'terminal:a', creationId: 'workspace:a', revision: first.revision });
      assert.equal(parses, 2, 'a grown file is parsed again');
      provider = 'gemini';
      assert.equal((await reader.read({ id: 'terminal:a', creationId: 'workspace:a' })).reason, 'provider', 'only Claude and Codex terminals have a chat');
      fs.rmSync(directory, { recursive: true, force: true });
    },
  },
];

module.exports = { registerTerminalConversationTests: context => {
  for (const item of tests) context.test(item.name, item.run);
} };
