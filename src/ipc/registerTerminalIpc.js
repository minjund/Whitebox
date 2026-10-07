'use strict';

function registerTerminalIpc({ ipcMain, requireTrustedSender, trustedSender, manager, groupStoreFile, isCmuxEnabled = () => false, cmuxClient, onCmuxInventory = () => {}, isProviderVisible = () => true, listWslDistros, sendError }) {
  const { CmuxClient } = require('../cmuxClient');
  const cmux = cmuxClient || new CmuxClient();
  for (const operation of ['list', 'read', 'frame', 'focus', 'input', 'arrange']) {
    ipcMain.handle(`cmux:${operation}`, (event, ...args) => {
      requireTrustedSender(event);
      if (!isCmuxEnabled()) {
        cmux.entries = [];
        if (operation === 'list') return { installed: false, enabled: false, entries: [], groups: [] };
        throw new Error('설정에서 cmux 플러그인을 연결하세요.');
      }
      if (operation === 'list') return cmux.list().then(result => {
        // A settings change can overtake an in-flight native inventory read.
        if (!isCmuxEnabled()) { cmux.entries = []; return { installed: false, enabled: false, entries: [], groups: [] }; }
        onCmuxInventory(result);
        return { ...result, enabled: true };
      });
      return cmux[operation](...args);
    });
  }
  let groups;
  const presentedTerminals = new Set();
  const tmuxPresentation = new (require('../managedTmuxRuntime').ManagedTmuxRuntime)();
  const executePresentation = require('util').promisify(require('child_process').execFile);
  async function presentGroups(result) {
    // Existing long-lived hosts may predate the embedded presentation default.
    // Change only the exact managed session, leaving user tmux defaults alone.
    await Promise.all(result.flatMap(group => group.members).map(async member => {
      const terminal = member.terminal;
      if (!terminal || terminal.backend !== 'managed-tmux' || !terminal.managedTmuxSession || !terminal.tmuxSocket || presentedTerminals.has(terminal.id)) return;
      const command = tmuxPresentation.command(terminal, ['set-option', '-t', terminal.managedTmuxSession, 'status', 'off']);
      try {
        await executePresentation(command.file, command.args, { timeout: 5000, windowsHide: true });
        presentedTerminals.add(terminal.id);
      } catch (_) { /* A newly spawning session is retried on the next inventory. */ }
    }));
    return result;
  }
  for (const operation of ['list', 'create', 'add', 'remove', 'delete', 'rename']) {
    ipcMain.handle(`terminal-groups:${operation}`, (event, ...args) => {
      requireTrustedSender(event);
      if (!groups) {
        const { TerminalGroups } = require('../terminalGroups');
        groups = new TerminalGroups({ manager, storeFile: groupStoreFile, isProviderVisible });
      }
      const result = groups[operation](...args);
      return operation === 'list' ? result.then(presentGroups) : result;
    });
  }
  ipcMain.handle('terminals:list', event => {
    requireTrustedSender(event);
    return manager() ? manager().list().filter(session => !session.transient && (session.type !== 'agent' || isProviderVisible(session.provider))) : [];
  });
  ipcMain.handle('wsl:list-distros', event => {
    requireTrustedSender(event);
    return listWslDistros();
  });
  ipcMain.handle('terminals:get', async (event, id) => {
    requireTrustedSender(event);
    const session = manager() ? await manager().get(id, true) : null;
    return session && (session.transient || (session.type === 'agent' && !isProviderVisible(session.provider))) ? null : session;
  });
  ipcMain.handle('terminals:create', (event, options) => {
    requireTrustedSender(event);
    if (options && options.type === 'agent' && !isProviderVisible(options.provider)) throw new Error('설정에서 숨긴 AI는 실행할 수 없습니다.');
    return requireManager(manager).create(options || {});
  });
  ipcMain.handle('terminals:write', async (event, id, data, options) => {
    requireTrustedSender(event);
    try {
      const result = await Promise.resolve(requireManager(manager).write(id, data, options || {}));
      return { terminalWriteEnvelope: 1, ok: true, result };
    } catch (error) {
      return {
        terminalWriteEnvelope: 1,
        ok: false,
        error: {
          message: String(error?.message || error || '명령창 입력 전송 실패'),
          code: String(error?.code || ''),
          deliveryId: String(error?.deliveryId || ''),
          deliveryState: ['rejected', 'unknown'].includes(error?.deliveryState)
            ? error.deliveryState
            : '',
        },
      };
    }
  });
  ipcMain.handle('terminals:command', (event, id, command, options) => {
    requireTrustedSender(event);
    return requireManager(manager).command(id, command, options || {});
  });
  ipcMain.handle('terminals:respond', (event, id, choiceKey) => {
    requireTrustedSender(event);
    return requireManager(manager).respond(id, choiceKey);
  });
  ipcMain.handle('terminals:resize', (event, id, cols, rows) => {
    requireTrustedSender(event);
    return requireManager(manager).resize(id, cols, rows);
  });
  for (const operation of ['signal', 'restart', 'reconnect', 'detach', 'stop', 'close', 'retire']) {
    ipcMain.handle(`terminals:${operation}`, (event, ...args) => {
      requireTrustedSender(event);
      return requireManager(manager)[operation](...args);
    });
  }
}

function requireManager(getManager) {
  const terminalManager = getManager();
  if (!terminalManager) throw new Error('명령창 기능이 아직 준비되지 않았습니다.');
  return terminalManager;
}

module.exports = { registerTerminalIpc };
