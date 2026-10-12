'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function registerWindowFocusPolicyTests({ test }) {
  const main = fs.readFileSync(require.resolve('../../main.js'), 'utf8');
  test('알림 실패는 본 창을 자동으로 열지 않고 사용자의 알림 클릭만 열도록 유지한다', () => {
    const source = main.slice(main.indexOf('function createAttentionNotifier()'), main.indexOf('function notifyTerminalPrompt('));
    let shown = 0;
    const context = { AttentionNotifier: class { constructor(options) { Object.assign(this, options); } },
      DESKTOP_NOTIFICATIONS_ENABLED: true, Notification: { isSupported: () => true }, providerList: () => [],
      mainText: key => key, openAttentionSession: () => { shown += 1; },
      mainWindow: { isDestroyed: () => false, show() { throw new Error('automatic show'); }, focus() { throw new Error('automatic focus'); }, flashFrame() { throw new Error('automatic flash'); } } };
    vm.createContext(context); vm.runInContext(source, context);
    const notifier = context.createAttentionNotifier();
    for (const event of ['completed', 'attention']) notifier.onFallback({ id: 'task' }, event);
    assert.equal(shown, 0);
    notifier.onOpen({ id: 'task' }, 'completed'); assert.equal(shown, 1);
  });
  test('업데이트 재실행과 중복 ready 이벤트는 본 창의 포커스를 가져오지 않는다', () => {
    const source = main.slice(main.indexOf('  const showWindow = () => {'), main.indexOf('  const showFallback =', main.indexOf('  const showWindow = () => {')));
    for (const update of [false, true]) {
      const calls = []; let visible = false;
      const context = { pendingUpdateRelaunch: update ? {} : null, mainWindow: { isDestroyed: () => false, isVisible: () => visible,
        show() { calls.push('show'); visible = true; }, showInactive() { calls.push('showInactive'); visible = true; }, focus() { calls.push('focus'); } } };
      vm.createContext(context); vm.runInContext(source + '\nshowWindow(); showWindow();', context);
      assert.deepEqual(calls, update ? ['showInactive'] : ['show', 'focus']);
    }
  });
  test('입력 필요 상태 갱신도 창을 자동 활성화하지 않는다', () => {
    const source = main.slice(main.indexOf('function publishTerminalPromptResolution('), main.indexOf('function refreshMonitor('));
    const context = { popupText: v => String(v || ''), terminalPromptResolutionKey: () => 'key', pendingTerminalPromptResolutions: new Map(),
      flushTerminalPromptResolutions: () => true, showMainWindow() { throw new Error('automatic window activation'); } };
    vm.createContext(context); vm.runInContext(source, context);
    assert.equal(context.publishTerminalPromptResolution({ sessionId: 'task', terminalId: 'terminal', targetId: 'terminal', fingerprint: 'prompt', requiresText: true }), true);
  });
}
module.exports = { registerWindowFocusPolicyTests };
