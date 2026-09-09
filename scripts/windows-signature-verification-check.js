'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const asar = require('@electron/asar');
const version = require('../package.json').version;

async function runPackagedCheck() {
  const archive = path.join(path.dirname(process.execPath), 'resources', 'app.asar');
  assert.equal(require(path.join(archive, 'package.json')).version, version);
  const { verifyDownloadedInstaller } = require(path.join(archive, 'src', 'updateInstaller.js'));
  const verifier = path.join(path.dirname(archive), 'whitebox-signature-check.exe');
  assert(fs.statSync(verifier).size > 0, 'The native verifier must be packaged beside app.asar');
  const { readWindowsHostProcess } = require(path.join(archive, 'src', 'updateWorkloadScope.js'));
  const identity = await readWindowsHostProcess(process.pid);
  assert.equal(identity.ProcessId, process.pid);
  assert.equal(fs.realpathSync(identity.ExecutablePath).toLowerCase(), fs.realpathSync(process.execPath).toLowerCase());
  assert(identity.CommandLine.includes('--inside-package'));
  assert.match(identity.Started, /^\d{14}\.\d{6}[+-]\d{3}$/);
  const unsigned = process.env.WHITEBOX_SIGNATURE_TEST_UNSIGNED_INSTALLER
    || path.resolve('release', `Whitebox-Setup-${version}.exe`);
  const signed = process.env.WHITEBOX_SIGNATURE_TEST_SIGNED_NODE;
  assert(signed, 'The parent must supply its official signed Node executable');
  const verify = (installerPath, allowUnsignedWindowsUpdates = false) => verifyDownloadedInstaller({
    platform: 'win32', installerPath, allowUnsignedWindowsUpdates,
    environment: { ...process.env, PSModulePath: 'Z:\\whitebox-invalid-module-search-path' },
  });
  assert.deepEqual(await verify(signed), { platform: 'win32', verified: true, unsignedAllowed: false });
  assert.deepEqual(await verify(unsigned, true), { platform: 'win32', verified: false, unsignedAllowed: true });
  await assert.rejects(verify(unsigned), error => error.code === 'UPDATE_INSTALLER_SIGNATURE_INVALID'
    && error.message.includes('NotSigned'));
  const tempRoot = fs.realpathSync(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(tempRoot, 'whitebox-signature-check-'));
  assert.equal(path.dirname(fs.realpathSync(temp)), tempRoot);
  let externalHost;
  try {
    const extracted = path.join(temp, 'external-app');
    for (const entry of asar.listPackage(archive)) {
      const relative = entry.replaceAll('\\', '/').replace(/^\/+/, '');
      if (!/^src\/.*\.js$/.test(relative) && relative !== 'node_modules/node-pty/package.json'
        && relative !== 'package.json') continue;
      const destination = path.resolve(extracted, relative);
      assert(!path.relative(extracted, destination).startsWith('..'), 'Packaged source extraction escaped fixture');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, asar.extractFile(archive, path.normalize(relative)));
    }
    const externalScript = path.join(temp, 'terminalHostDaemon.js');
    const discoveryFile = path.join(temp, 'external-host.json');
    fs.writeFileSync(externalScript, `
      const { EventEmitter } = require('node:events');
      const { TerminalHostServer } = require(${JSON.stringify(path.join(extracted, 'src', 'terminalHost.js'))});
      const manager = new EventEmitter();
      manager.list = () => [{ id: 'external-work', status: 'stopping', terminationUncertain: true }];
      const host = new TerminalHostServer({ manager, discoveryFile: ${JSON.stringify(discoveryFile)},
        onShutdown: () => { throw new Error('External work was incorrectly shut down'); } });
      host.start().then(() => process.send('ready'));
      process.on('message', message => { if (message === 'finish-fixture') { host.dispose(); process.exit(0); } });
    `);
    externalHost = spawn(signed, [externalScript], { windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    let diagnostic = '';
    externalHost.stderr.on('data', bytes => { diagnostic += bytes; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('External fixture did not start: ' + diagnostic)), 15000);
      externalHost.once('error', error => { clearTimeout(timer); reject(error); });
      externalHost.once('message', message => { clearTimeout(timer); message === 'ready' ? resolve() : reject(new Error('Unexpected fixture message')); });
      externalHost.once('exit', () => { clearTimeout(timer); reject(new Error('External fixture exited: ' + diagnostic)); });
    });
    const { TerminalHostClient } = require(path.join(archive, 'src', 'terminalHost.js'));
    const { externalTerminalHost } = require(path.join(archive, 'src', 'updateWorkloadScope.js'));
    const client = new TerminalHostClient({ discoveryFile });
    try {
      await client.connect();
      assert.equal(await externalTerminalHost(client, process.execPath), true);
      client.updateShutdown = true;
      client.dispose({ preserveHost: true });
      client.dispose({ shutdownIfIdle: true });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(externalHost.exitCode, null, 'External host and work must survive update disconnection and app quit');
    } finally { client.dispose({ preserveHost: true }); }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('External fixture cleanup did not finish')), 10000);
      externalHost.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('External fixture failed: ' + diagnostic)); });
      externalHost.send('finish-fixture');
    });
    console.log('PASS packaged external-host ownership: authenticated native identity, preserved running external work, verified fixture cleanup.');
    const bytes = fs.readFileSync(signed);
    const pe = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.readUInt32LE(pe), 0x4550);
    const firstSection = pe + 24 + bytes.readUInt16LE(pe + 20);
    const optional = pe + 24;
    const security = optional + (bytes.readUInt16LE(optional) === 0x20b ? 112 : 96) + 32;
    assert(bytes.readUInt32LE(security) > 0 && bytes.readUInt32LE(security + 4) > 0,
      'Tamper test requires an embedded signature, not a catalog-only system file');
    const codeOffset = bytes.readUInt32LE(firstSection + 20);
    assert(codeOffset > firstSection && codeOffset + 32 < bytes.length);
    bytes[codeOffset + 32] ^= 1;
    const tampered = path.join(temp, 'tampered-signed.exe');
    fs.writeFileSync(tampered, bytes);
    await assert.rejects(verify(tampered, true), error => error.code === 'UPDATE_INSTALLER_SIGNATURE_INVALID'
      && error.message.includes('HashMismatch'));
    bytes.fill(0, bytes.readUInt32LE(security), bytes.readUInt32LE(security) + bytes.readUInt32LE(security + 4));
    const damagedCertificate = path.join(temp, 'damaged-certificate.exe');
    fs.writeFileSync(damagedCertificate, bytes);
    await assert.rejects(verify(damagedCertificate, true), error => error.code === 'UPDATE_INSTALLER_SIGNATURE_INVALID');
    const malformed = path.join(temp, 'malformed.exe');
    fs.writeFileSync(malformed, 'This is not a PE installer');
    await assert.rejects(verify(malformed, true), error => error.code === 'UPDATE_INSTALLER_SIGNATURE_INVALID');
  } finally {
    if (externalHost && externalHost.exitCode === null) {
      const exited = new Promise(resolve => externalHost.once('exit', resolve));
      externalHost.kill();
      await exited;
    }
    assert.equal(path.dirname(fs.realpathSync(temp)), tempRoot);
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    assert.equal(fs.existsSync(temp), false, 'Signature fixture cleanup must complete');
  }
  console.log(`PASS packaged ${version} native Windows signature verification: signed accepted; unsigned policy enforced; tampered, malformed, and damaged certificates rejected; cleanup complete; no PowerShell required.`);
}

if (process.platform !== 'win32') {
  console.log('SKIP Windows-only packaged signature verification');
} else if (process.argv.includes('--inside-package')) {
  runPackagedCheck().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const executable = path.resolve('release', 'win-unpacked', 'Whitebox.exe');
  const child = spawn(executable, [__filename, '--inside-package'], {
    windowsHide: true, stdio: 'inherit', env: {
      ...process.env, ELECTRON_RUN_AS_NODE: '1', WHITEBOX_SIGNATURE_TEST_SIGNED_NODE: process.execPath,
    },
  });
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code === 0 ? 0 : 1; });
}
