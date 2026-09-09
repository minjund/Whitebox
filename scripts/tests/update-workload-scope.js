'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { externalTerminalHost, isExternalWindowsHost, readWindowsHostProcess } = require('../../src/updateWorkloadScope');
const { TerminalHostServer, TerminalHostClient, requiresUpdateShutdown } = require('../../src/terminalHost');

function registerUpdateWorkloadScopeTests({ test, temp }) {
  test('업데이트 소유권은 실행 파일과 실행 경로를 함께 확인하며 외부 명령창을 보존한다', async () => {
    const appPath = 'C:\\Apps\\Whitebox\\Whitebox.exe';
    const external = { ProcessId: 123, ExecutablePath: 'D:\\dev\\electron.exe',
      CommandLine: '"D:\\dev\\electron.exe" "D:\\dev\\src\\terminalHostDaemon.js"', Started: '20260909010000.000000+000' };
    assert.equal(isExternalWindowsHost(external, appPath), true);
    assert.equal(isExternalWindowsHost({ ...external, ExecutablePath: 'c:\\apps\\whitebox\\Whitebox.exe' }, appPath), false);
    assert.equal(isExternalWindowsHost({ ...external, CommandLine: 'electron "C:/Apps/Whitebox/resources/app.asar/src/terminalHostDaemon.js"' }, appPath), false);
    assert.equal(isExternalWindowsHost({ ...external, ExecutablePath: 'C:\\Apps\\Whitebox-old\\Whitebox.exe' }, appPath), true);
    let verified = 0;
    const client = { connected: true, discovery: { pid: 123 }, verifyHost: async () => { verified += 1; } };
    assert.equal(await externalTerminalHost(client, appPath, { platform: 'win32', inspect: async () => external,
      canonicalize: value => path.win32.resolve(value) }), true);
    assert.equal(verified, 1);
    let probes = 0;
    await assert.rejects(externalTerminalHost(client, appPath, { platform: 'win32', inspect: async () =>
      ({ ...external, Started: String(++probes) }) }), /바뀌었습니다/);
    await assert.rejects(readWindowsHostProcess(123, async () => { throw new Error('private command line'); }),
      error => error.message.includes('확인하지 못했습니다') && !error.message.includes('private command'));
    await assert.rejects(readWindowsHostProcess(123, async () => ({ stdout: '{}' })), /확인하지 못했습니다/);
  });

  test('외부 과거 기록은 업데이트를 막지 않고 현재 호스트 소유 종료 불확실성은 차단한다', async () => {
    const external = { id: 'external-stale', status: 'stopping', terminationUncertain: true, updateOwned: false };
    assert.equal(requiresUpdateShutdown(external), false);
    assert.equal(requiresUpdateShutdown({ ...external, updateOwned: true }), true);
    assert.equal(requiresUpdateShutdown({ ...external, updateOwned: undefined }), true);
    const manager = new EventEmitter();
    manager.list = () => [external];
    let shutdown = false;
    const discoveryFile = path.join(temp, `update-owned-host-${Date.now()}.json`);
    const server = new TerminalHostServer({ manager, discoveryFile, idleShutdownMs: 5,
      capabilities: { forceStopForUpdate: 1, scopedUpdateShutdown: 1 },
      onShutdown: options => { assert.equal(options.updateOnly, true); shutdown = true; } });
    const client = new TerminalHostClient({ discoveryFile, processExists: () => !shutdown });
    try {
      await server.start();
      await client.connect();
      await client.shutdownForUpdate([], 1_000);
      assert.equal(shutdown, true);
      assert.equal(manager.list()[0], external, 'The stale record must not be deleted or changed to stopped');
    } finally { client.dispose(); server.dispose(); }
  });
}

module.exports = { registerUpdateWorkloadScopeTests };
