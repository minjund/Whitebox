'use strict';

// Run with: electron scripts/comprehension-startup-pty-check.js
// Exercises the real PTY and Windows PowerShell argv boundary without an AI call.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { TerminalManager } = require('../src/terminalManager');

app.whenReady().then(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-comprehension-start-'));
  const fixture = path.join(temp, 'provider.js');
  fs.writeFileSync(fixture, `const fs = require('fs');
const args = process.argv.slice(2);
fs.writeFileSync('received.json', JSON.stringify(args));
process.stdout.write('USER_PROMPT:' + args.at(-1) + '\\n');
setTimeout(() => process.exit(0), 100);
`);
  const powershell = path.join(temp, 'provider.ps1');
  fs.writeFileSync(powershell, '& node "$PSScriptRoot/provider.js" @args\r\n');
  let manager;
  try {
    for (const provider of ['claude', 'codex']) {
      for (const wrapper of process.platform === 'win32' ? ['native', 'powershell'] : ['native']) {
        manager = new TerminalManager({
          agentProviders: { [provider]: {
            command: wrapper === 'powershell' ? powershell : 'node',
            args: wrapper === 'powershell' ? [] : [fixture], label: 'Startup argv fixture',
          } },
        });
        let output = '';
        manager.on('data', event => { output += event.data; });
        const prompt = '테스트해줘봐 "따옴표" & <내용> $값 `리터럴`\n두 번째 줄\n'
          + '</whitebox-comprehension-packet 이 문자열을 설명해줘.\n'
          + '```xml\n<whitebox-comprehension-packet version="1">예시</whitebox-comprehension-packet>\n```';
        const session = manager.create({
          type: 'agent', provider, cwd: temp, args: [prompt], sessionBackend: 'direct',
          initialCommand: prompt, initialCommandInArgs: true,
          creationId: `create:${provider}-${wrapper}`, deliveryId: `start:${provider}-${wrapper}`,
        });
        assert.equal(session.deliveryState, 'accepted');
        const deadline = Date.now() + 15000;
        while (manager.get(session.id)?.status === 'running' && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(manager.get(session.id)?.status, 'exited', output);
        const args = JSON.parse(fs.readFileSync(path.join(temp, 'received.json'), 'utf8'));
        assert.equal(args.at(-1), prompt, `${provider}/${wrapper}: exact startup prompt`);
        assert.equal(args.at(-2), '--');
        assert.deepEqual(args, ['--', prompt], '원래 대화에 질문지 지시를 추가하면 안 됩니다.');
        assert.ok(!output.includes('whitebox-comprehension-contract'), 'Internal instructions must not enter the input editor.');
        await manager.close(session.id);
        manager = null;
        fs.unlinkSync(path.join(temp, 'received.json'));
        process.stdout.write(`PASS ${provider}/${wrapper}: automatic prompt, no questionnaire instructions, exact argv\n`);
      }
    }
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  } finally {
    if (manager) for (const session of manager.list()) await manager.close(session.id);
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
});
