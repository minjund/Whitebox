'use strict';
// Run with ELECTRON_RUN_AS_NODE=1 electron scripts/terminal-host-update-persistence.js.
// Uses the built candidate's real daemon, Electron helper and node-pty; never
// connects to a user's profile or opens a GUI window.
const assert = require('node:assert/strict');
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { prepareTerminalHostRuntime } = require('../src/terminalHostRuntime');
const { launchTerminalHost, resolveTerminalHostExecutable, TerminalHostClient } = require('../src/terminalHost');
const { externalTerminalHost } = require('../src/updateWorkloadScope');
if (process.platform !== 'darwin' || !process.versions.electron) throw new Error('Requires macOS Electron Node mode and a built candidate');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function wait(check, label) { const deadline = Date.now() + 15000; while (!await check()) { if (Date.now() >= deadline) throw new Error('Timed out: ' + label); await pause(50); } }
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-persistent-pty-')));
const installed = path.join(root, 'Applications/Whitebox.app');
const discoveryFile = path.join(root, 'profile/terminal-host.json');
let client, terminalId = '', hostPid = 0, terminalPid = 0;
(async () => {
  const source = path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Whitebox.app');
  await fs.promises.mkdir(path.dirname(installed), { recursive: true });
  await fs.promises.cp(source, installed, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
  const guiExecutable = path.join(installed, 'Contents/MacOS/Whitebox');
  const runtime = await prepareTerminalHostRuntime({ isPackaged: true, executable: resolveTerminalHostExecutable({ executable: guiExecutable }),
    script: path.join(installed, 'Contents/Resources/app.asar/src/terminalHostDaemon.js'), runtimeRoot: path.join(root, 'profile/terminal-runtimes') });
  hostPid = launchTerminalHost({ ...runtime, discoveryFile, storeFile: path.join(root, 'profile/terminal-sessions.json'), bridgeHome: path.join(root, 'bridge') });
  client = new TerminalHostClient({ discoveryFile, connectTimeoutMs: 15000 });
  await wait(() => fs.existsSync(discoveryFile), 'host discovery');
  await client.connect();
  assert.equal(client.discovery.pid, hostPid);
  assert.equal(await externalTerminalHost(client, guiExecutable), true);
  const terminal = await client.create({ type: 'shell', cwd: root });
  terminalId = terminal.id; terminalPid = terminal.pid;
  await client.command(terminalId, 'n=0; while [ "$n" -lt 30 ]; do n=$((n+1)); printf "TICK:%s\\n" "$n"; sleep 0.1; done');
  await wait(async () => (await client.get(terminalId)).replay.includes('TICK:1\r\n'), 'first heartbeat');
  client.dispose({ preserveHost: true });
  // Perform the same physical bundle swap as the Mac helper. The old runtime
  // must continue independently, even after the old installation is removed.
  await fs.promises.rename(installed, installed + '.old');
  await fs.promises.cp(source, installed, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
  await fs.promises.rm(installed + '.old', { recursive: true, force: true });
  assert(alive(hostPid)); assert(alive(terminalPid));
  client = new TerminalHostClient({ discoveryFile });
  await client.connect();
  assert.equal(client.discovery.pid, hostPid);
  const continued = await client.get(terminalId);
  assert.equal(continued.pid, terminalPid); assert.equal(continued.status, 'running');
  await wait(async () => (await client.get(terminalId)).replay.includes('TICK:30\r\n'), 'continuous work after installation replacement');
  console.log('PASS packaged macOS PTY kept its host PID, shell PID, replay and ongoing command across installation replacement and client reconnect');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    if (client && hostPid && alive(hostPid)) {
      await wait(() => fs.existsSync(discoveryFile), 'cleanup host discovery');
      await client.connect();
      if (terminalId) await client.close(terminalId);
      client.dispose({ shutdownIfIdle: true });
      await wait(() => !alive(hostPid) && (!terminalPid || !alive(terminalPid)), 'test workload and host cleanup');
    }
    if (!hostPid || !alive(hostPid)) {
      await fs.promises.rm(root, { recursive: true, force: true });
      console.log('PASS isolated host, PTY and test-directory cleanup');
    } else throw new Error('Host still alive; diagnostics retained at ' + root);
  } catch (error) { console.error(error); process.exitCode = 1; }
});
