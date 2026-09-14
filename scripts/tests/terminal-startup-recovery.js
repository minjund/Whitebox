'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { AGENT_PROVIDERS, launchSpec, normalizeLaunchOptions } = require('../../src/terminalManager');
const { sharedCodexAgentProviders } = require('../../src/terminalHostDaemon');
const { TerminalHostClient, TerminalHostServer, verifyHostDiscovery } = require('../../src/terminalHost');

function registerTerminalStartupRecoveryTests({ test, root, temp }) {
  test('Codex 새 작업·재개·분기는 모든 PTY 경로에서 시작 업데이트 화면을 건너뛴다', () => {
    const updateOverride = ['-c', 'check_for_update_on_startup=false'];
    for (const platform of ['win32', 'darwin', 'linux']) {
      const providers = sharedCodexAgentProviders({ remoteArguments: () => ['--remote', 'ws://127.0.0.1:45123'] }, platform);
      for (const agentProviders of [AGENT_PROVIDERS, providers]) {
        for (const sessionBackend of ['direct', 'managed-tmux']) {
          for (const args of [[], ['resume', 'saved-session'], ['fork', 'source-session']]) {
            const options = {
              type: 'agent', provider: 'codex', cwd: root, args,
              sessionBackend, managedTmuxSession: 'startup-test', tmuxSocket: 'startup-test',
              distro: platform === 'win32' && sessionBackend === 'managed-tmux' ? 'Ubuntu' : '',
            };
            const spec = launchSpec(options, platform, agentProviders);
            const index = spec.args.indexOf(updateOverride[1]);
            assert.ok(index > 0, `${platform}/${sessionBackend}/${args[0] || 'new'} lacks the update override`);
            assert.deepStrictEqual(spec.args.slice(index - 1, index + 1), updateOverride);
            assert.equal(spec.args.filter(value => value === updateOverride[1]).length, 1);
            if (args.length) assert.ok(index < spec.args.indexOf(args[0]), 'override must precede the subcommand');
            assert.strictEqual(options.args, args, 'provider policy must not mutate launch identity or saved args');
          }
        }
      }
    }
    const wsl = launchSpec({
      type: 'agent', provider: 'codex', cwd: '/tmp', distro: 'Ubuntu',
      sessionBackend: 'direct', args: ['resume', 'wsl-session'],
    }, 'win32');
    assert.deepStrictEqual(wsl.args.slice(-4), [...updateOverride, 'resume', 'wsl-session']);
    const claude = launchSpec(normalizeLaunchOptions({
      type: 'agent', provider: 'claude', cwd: root, sessionBackend: 'direct',
    }, 'linux'), 'linux');
    assert.ok(!claude.args.includes(updateOverride[1]));
  });

  test('동일 protocol의 이전 PTY runtime은 열린 명령창을 보존하며 새 작업과 재연결을 허용한다', async () => {
    class Manager extends EventEmitter {
      constructor() {
        super();
        this.sessions = [{ id: 'terminal:existing', status: 'running', replay: 'existing work' }];
        this.writes = [];
      }
      list() { return this.sessions.map(session => ({ ...session })); }
      get(id) { return this.list().find(session => session.id === id); }
      create(options) {
        const session = { ...options, id: 'terminal:new', status: 'running' };
        this.sessions.push(session);
        this.emit('state', { change: 'created', session, sessions: this.list() });
        return session;
      }
      write(id, data) { this.writes.push({ id, data }); return { ok: true }; }
    }
    const manager = new Manager();
    const discoveryFile = path.join(temp, 'busy-wire-compatible-host.json');
    const host = new TerminalHostServer({
      manager, discoveryFile, runtime: 'node-pty-1.1.0',
      token: 'startup-recovery-test-token',
    });
    let replacements = 0;
    let terminations = 0;
    const clientOptions = {
      discoveryFile, expectedRuntime: 'node-pty-1.2.0-beta.14',
      spawnHost: () => { replacements += 1; throw new Error('must keep the existing host'); },
      terminateHost: () => { terminations += 1; },
    };
    const client = new TerminalHostClient(clientOptions);
    const secondClient = new TerminalHostClient(clientOptions);
    try {
      await host.start();
      const discoveryBefore = fs.readFileSync(discoveryFile, 'utf8');
      await Promise.all([client.connect(), secondClient.connect()]);
      assert.equal(client.connected, true);
      assert.equal((await client.get('terminal:existing')).replay, 'existing work');
      const created = await client.create({ type: 'agent', provider: 'codex', args: [], cwd: root });
      assert.equal(created.id, 'terminal:new');
      await secondClient.write('terminal:existing', 'continue\r');
      assert.deepStrictEqual(manager.writes, [{ id: 'terminal:existing', data: 'continue\r' }]);
      assert.equal((await client.listFresh()).length, 2);
      client.resetSocket();
      await client.connect();
      assert.equal((await client.listFresh()).length, 2);
      assert.equal(fs.readFileSync(discoveryFile, 'utf8'), discoveryBefore);
      assert.equal(replacements, 0);
      assert.equal(terminations, 0);
      assert.equal(manager.sessions[0].status, 'running');
      // Another app window may keep the daemon alive after all PTYs exit.
      // Its empty registry is no reason to block a new task or replace it.
      manager.sessions = [];
      client.resetSocket();
      await client.connect();
      assert.equal((await client.listFresh()).length, 0);
      assert.equal((await client.create({ type: 'agent', provider: 'codex', args: [], cwd: root })).status, 'running');
      assert.equal(replacements, 0);
      assert.equal(terminations, 0);
    } finally {
      client.dispose();
      secondClient.dispose();
      host.dispose();
    }
  });

  test('runtime 재사용도 인증 후 바뀐 protocol과 알 수 없는 runtime을 우회하지 않는다', async () => {
    const manager = new EventEmitter();
    manager.list = () => [{ id: 'terminal:active', status: 'running' }];
    for (const runtime of ['unknown-driver', 'node-pty-1.1.0']) {
      const discoveryFile = path.join(temp, `runtime-guard-${runtime}.json`);
      const host = new TerminalHostServer({ manager, discoveryFile, runtime });
      let spawned = 0;
      const client = new TerminalHostClient({
        discoveryFile,
        spawnHost: () => { spawned += 1; },
        verifyHost: async discovery => {
          const ready = await verifyHostDiscovery(discovery);
          if (runtime === 'node-pty-1.1.0') {
            fs.writeFileSync(discoveryFile, JSON.stringify({ ...discovery, protocol: 12 }));
          }
          return ready;
        },
      });
      try {
        await host.start();
        await assert.rejects(client.create({ type: 'agent', provider: 'codex', args: ['fork', 'source'] }), error =>
          error.code === (runtime === 'unknown-driver'
            ? 'TERMINAL_HOST_REPLACEMENT_DEFERRED_ACTIVE_SESSIONS'
            : 'WHITEBOX_INCOMPATIBLE_TERMINAL_HOST'));
        assert.equal(client.connected, false);
        assert.equal(spawned, 0);
      } finally {
        client.dispose();
        host.dispose();
      }
    }
  });
}

module.exports = { registerTerminalStartupRecoveryTests };
