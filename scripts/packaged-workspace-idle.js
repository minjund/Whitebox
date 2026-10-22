'use strict';

// Test-only preparation for the low-level, idle-parent updater scenario.
// The later packaged-button scenario separately preserves a live workspace PTY.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TerminalHostClient } = require('../src/terminalHost');

async function idleCandidateWorkspace({ profiles, roots, assertHostOwned, waitForExit }) {
  let closed = 0;
  for (const profile of profiles) {
    const discoveryFile = path.join(profile, 'terminal-host.json');
    if (!fs.existsSync(discoveryFile)) continue;
    assert(!fs.lstatSync(discoveryFile).isSymbolicLink(), 'Test host discovery must not be a link');
    const real = fs.realpathSync(discoveryFile);
    assert(roots.some(root => {
      const relative = path.relative(fs.realpathSync(root), real);
      return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
    }), 'Test host must be inside the fresh integration roots');
    const host = new TerminalHostClient({ discoveryFile });
    try {
      await host.connect();
      assertHostOwned(host.discovery.pid);
      const sessions = (await host.listFresh()).filter(session => ['starting', 'running', 'stopping'].includes(session.status));
      for (const session of sessions) {
        assert(['shell', 'powershell', 'cmd'].includes(session.type)
          && session.creationId?.startsWith('workspace:'), 'Idle fixture may close only its workspace startup shells');
        assert(Number.isSafeInteger(session.pid) && session.pid > 0, 'Test shell must have a known PID');
      }
      for (const session of sessions) {
        const current = await host.get(session.id);
        assert.equal(current.creationId, session.creationId);
        assert.equal(current.pid, session.pid);
        await host.close(session.id);
        await waitForExit(session.pid);
        closed++;
      }
      assert.equal((await host.listFresh()).filter(session => ['starting', 'running', 'stopping'].includes(session.status)).length, 0,
        'Low-level updater parent must actually be idle before the graceful window-close scenario');
    } finally { host.dispose(); }
  }
  console.log(`PASS idle-parent fixture closed ${closed} authenticated workspace startup shells; live-PTY preservation remains a separate packaged-button scenario`);
}

module.exports = { idleCandidateWorkspace };
