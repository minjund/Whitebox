'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareTerminalHostRuntime } = require('../../src/terminalHostRuntime');
const { externalTerminalHost, isExternalDarwinHost, readDarwinHostProcess } = require('../../src/updateWorkloadScope');

function registerTerminalHostRuntimeTests({ test, temp }) {
  test('독립 명령창 runtime은 설치 교체 후에도 실행 파일과 코드 및 native addon을 보존한다', async () => {
    for (const platform of ['win32', 'darwin']) {
      const install = path.join(temp, `independent-${platform}`, 'Whitebox.app');
      const executable = path.join(install, platform === 'darwin' ? 'Contents/Frameworks/Whitebox Helper.app/Contents/MacOS/Whitebox Helper' : 'Whitebox.exe');
      const resources = path.join(install, platform === 'darwin' ? 'Contents/Resources' : 'resources');
      fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.mkdirSync(resources, { recursive: true });
      fs.writeFileSync(executable, 'executable', { mode: 0o755 });
      fs.writeFileSync(path.join(resources, 'app.asar'), 'original app');
      fs.mkdirSync(path.join(resources, 'app.asar.unpacked'), { recursive: true });
      fs.writeFileSync(path.join(resources, 'app.asar.unpacked', 'pty.node'), 'native addon');
      const options = { isPackaged: true, platform, executable, script: path.join(resources, 'app.asar/src/terminalHostDaemon.js'), runtimeRoot: path.join(temp, `runtimes-${platform}`) };
      const runtime = await prepareTerminalHostRuntime(options);
      assert(!runtime.executable.startsWith(install + path.sep));
      assert.deepEqual(await prepareTerminalHostRuntime(options), runtime);
      const runtimeArchive = runtime.script.slice(0, runtime.script.indexOf('app.asar') + 'app.asar'.length);
      fs.writeFileSync(path.join(resources, 'app.asar'), 'candidate app');
      const candidate = await prepareTerminalHostRuntime(options);
      assert.notEqual(candidate.executable, runtime.executable);
      fs.rmSync(install, { recursive: true, force: true });
      assert.equal(fs.readFileSync(runtime.executable, 'utf8'), 'executable');
      assert.equal(fs.readFileSync(runtimeArchive, 'utf8'), 'original app');
      assert.equal(fs.readFileSync(path.join(path.dirname(runtimeArchive), 'app.asar.unpacked', 'pty.node'), 'utf8'), 'native addon');
    }
  });

  test('독립 runtime은 손상된 캐시를 덮어쓰지 않고 설치 내부 캐시도 거부한다', async () => {
    const install = path.join(temp, 'runtime-cache-errors'); fs.mkdirSync(path.join(install, 'resources'), { recursive: true });
    const executable = path.join(install, 'Whitebox.exe'); fs.writeFileSync(executable, 'exe', { mode: 0o755 });
    fs.writeFileSync(path.join(install, 'resources/app.asar'), 'app');
    const options = { isPackaged: true, platform: 'win32', executable, script: path.join(install, 'resources/app.asar/src/terminalHostDaemon.js'), runtimeRoot: path.join(temp, 'cache-errors') };
    await assert.rejects(prepareTerminalHostRuntime({ ...options, runtimeRoot: path.join(install, 'cache') }), /설치 위치 밖/);
    const runtime = await prepareTerminalHostRuntime(options);
    fs.rmSync(runtime.executable);
    await assert.rejects(prepareTerminalHostRuntime(options), /불완전/);
    assert(!fs.existsSync(runtime.executable));
  });

  test('macOS 보존 호스트는 인증과 실행 파일 매핑 및 두 번의 프로세스 신원 확인을 요구한다', async () => {
    const runtime = { executable: '/profile/runtime/Whitebox Helper', script: '/profile/runtime/app.asar/src/terminalHostDaemon.js' };
    const appPath = '/Applications/Whitebox.app/Contents/MacOS/Whitebox';
    assert.equal(isExternalDarwinHost(runtime, appPath, value => value), true);
    assert.equal(isExternalDarwinHost({ ...runtime, script: '/Applications/Whitebox.app/Contents/Resources/app.asar/src/terminalHostDaemon.js' }, appPath, value => value), false);
    const identity = { ProcessId: 123, Started: 'Oct 12', ExecutablePath: runtime.executable, CommandLine: runtime.script };
    const client = { discovery: { pid: 123, hostRuntime: runtime }, connected: true, verifyHost: async () => ({ hostRuntime: runtime }) };
    const options = { platform: 'darwin', inspect: async () => identity, canonicalize: value => value };
    assert.equal(await externalTerminalHost(client, appPath, options), true);
    let probes = 0;
    await assert.rejects(externalTerminalHost(client, appPath, { ...options, inspect: async () => ({ ...identity, Started: String(++probes) }) }), /바뀌었습니다/);
    client.verifyHost = async () => ({ hostRuntime: { ...runtime, script: 'changed' } });
    await assert.rejects(externalTerminalHost(client, appPath, options), /실행 경로/);
    delete client.discovery.hostRuntime;
    assert.equal(await externalTerminalHost(client, appPath, options), false);
    await assert.rejects(readDarwinHostProcess(123, runtime, async () => ({ stdout: 'other process' })), /확인하지 못했습니다/);
    assert.deepEqual(await readDarwinHostProcess(123, runtime, async file => ({ stdout: file === '/bin/ps' ? 'Oct 12' : 'n' + runtime.executable })), identity);
  });
}
module.exports = { registerTerminalHostRuntimeTests };
