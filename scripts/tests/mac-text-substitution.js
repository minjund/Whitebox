'use strict';

const assert = require('assert');
const { MAC_TEXT_SUBSTITUTION_DEFAULTS, disableMacTextSubstitutions } = require('../../src/macTextSubstitution');

function registerMacTextSubstitutionTests(context) {
  const { test } = context;

  test('macOS 텍스트 자동 치환(스페이스 두 번 마침표 등)은 앱 설정에서만 끄고, 다른 OS는 건드리지 않는다', () => {
    const writes = [];
    const systemPreferences = { setUserDefault: (key, type, value) => writes.push([key, type, value]) };
    const disabled = disableMacTextSubstitutions({ platform: 'darwin', systemPreferences });
    assert.ok(MAC_TEXT_SUBSTITUTION_DEFAULTS.includes('NSAutomaticPeriodSubstitutionEnabled'),
      '빠르게 친 한글 음절을 "."으로 바꾸는 마침표 자동 입력을 반드시 꺼야 합니다.');
    assert.deepStrictEqual(disabled, [...MAC_TEXT_SUBSTITUTION_DEFAULTS]);
    assert.deepStrictEqual(writes, MAC_TEXT_SUBSTITUTION_DEFAULTS.map(key => [key, 'boolean', false]));
    for (const platform of ['win32', 'linux']) {
      writes.length = 0;
      assert.deepStrictEqual(disableMacTextSubstitutions({ platform, systemPreferences }), []);
      assert.equal(writes.length, 0);
    }
    const failing = { setUserDefault: key => { if (key === 'NSAutomaticDashSubstitutionEnabled') throw new Error('denied'); } };
    const partial = disableMacTextSubstitutions({ platform: 'darwin', systemPreferences: failing });
    assert.ok(partial.includes('NSAutomaticPeriodSubstitutionEnabled') && !partial.includes('NSAutomaticDashSubstitutionEnabled'),
      '설정 하나가 실패해도 나머지는 끕니다.');
  });
}

module.exports = { registerMacTextSubstitutionTests };
