'use strict';
// Opt-in: creates one isolated shell workspace and removes only that workspace.
const assert = require('assert/strict');
const { CmuxClient } = require('../src/cmuxClient');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  if (!process.argv.includes('--run')) throw new Error('Run explicitly with --run against local cmux.');
  const client = new CmuxClient(); let workspace, window;
  try {
    const name = `Whitebox 연결 검증 ${Date.now()}`;
    await client.call(['--json', '--id-format', 'uuids', 'new-workspace', '--name', name, '--cwd', '/tmp', '--command', '/bin/sh -i', '--focus', 'false']);
    const created = (await client.list()).groups.find(group => group.title === name);
    assert.ok(created, 'Created test workspace must be discoverable');
    workspace = created.members[0].cmuxTarget.workspace;
    window = created.members[0].cmuxTarget.window;
    const inventory = async () => {
      const value = await client.list();
      const group = value.groups.find(group => group.members[0]?.cmuxTarget.workspace === workspace);
      if (group) window = group.members[0].cmuxTarget.window;
      return group;
    };
    let group = await inventory(); assert.equal(group.members.length, 1);
    const first = group.members[0].id;
    await client.input(first, "printf 'WHITEBOX_CMUX_INPUT_OK\\n'\r");
    let output = '';
    for (let i = 0; i < 30; i++) { output = await client.read(first); if (output.includes('WHITEBOX_CMUX_INPUT_OK\n')) break; await delay(100); }
    assert.match(output, /WHITEBOX_CMUX_INPUT_OK/);
    await client.arrange(first, { action: 'split', direction: 'right' });
    group = await inventory(); assert.equal(group.members.length, 2); assert.ok(group.layout);
    const second = group.members.find(member => member.id !== first).id;
    // Exercise two simultaneously visible native terminals, including control
    // keys and Unicode. Markers exist only in output, not in echoed commands.
    await Promise.all([
      client.input(first, "discard-this\x15printf 'WB_%s\\n' 'FIRST_INPUT'\r"),
      client.input(second, "printf 'WB_%s\\n' 'SECOND_한글_INPUT'\r"),
    ]);
    let outputs = [];
    for (let i = 0; i < 30; i++) {
      outputs = await Promise.all([client.read(first), client.read(second)]);
      if (outputs[0].includes('WB_FIRST_INPUT') && outputs[1].includes('WB_SECOND_한글_INPUT')) break;
      await delay(100);
    }
    assert.ok(outputs[0].includes('WB_FIRST_INPUT'));
    assert.ok(outputs[1].includes('WB_SECOND_한글_INPUT'));
    assert.ok(!outputs[0].includes('WB_SECOND_한글_INPUT') && !outputs[1].includes('WB_FIRST_INPUT'), 'input must never cross surfaces');
    console.log('✓ cmux 두 패널의 독립 입력·Enter·Ctrl+U·한글 출력');
    await client.arrange(first, { action: 'resize', direction: 'right', amount: 35 });
    await client.arrange(first, { action: 'swap', targetId: second });
    group = await inventory(); assert.equal(group.members.length, 2);
    await client.arrange(first, { action: 'move', targetId: second, direction: 'tab' });
    group = await inventory(); assert.equal(new Set(group.members.map(member => member.paneId)).size, 1);
    await client.arrange(first, { action: 'move', targetId: second, direction: 'down' });
    group = await inventory(); assert.equal(new Set(group.members.map(member => member.paneId)).size, 2);
    await client.arrange(second, { action: 'close' });
    group = await inventory(); assert.equal(group.members.length, 1); assert.equal(group.members[0].id, first);
    console.log('✓ cmux 실제 독립 셸: 입력·분할·맞바꾸기·크기 변경·탭 합치기·다시 분할·종료');
  } finally {
    if (workspace) {
      await client.call(['close-workspace', '--force', '--workspace', workspace, ...(window ? ['--window', window] : [])]);
      let remains = true;
      for (let i = 0; i < 30 && remains; i++) {
        const after = await client.list();
        remains = after.groups.some(group => group.members[0]?.cmuxTarget.workspace === workspace);
        if (remains) await delay(100);
      }
      assert.equal(remains, false);
      console.log('✓ 검증용 cmux 작업 정리 완료');
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
