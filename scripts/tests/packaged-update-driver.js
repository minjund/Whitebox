'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { waitForPackagedRenderer } = require('../packaged-update-button');
const { probeWindowsProcessIds, waitForOwnedProcessIdsExit } = require('../windows-process-exit-check');

function registerPackagedUpdateDriverTests({ test }) {
  test('immutable 1.8.28 missing start record requires exact official bytes and a fresh independently authenticated helper', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'windows-v173-update-integration.js'), 'utf8');
    const extract = name => {
      const match = source.match(new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm'));
      assert(match, name); return match[0];
    };
    const validate = vm.runInNewContext(extract('assertImmutable1828IdentityReceipt') + '\n' + extract('assertImmutable1828StartReceipt')
      + '\n(payload) => { const p=JSON.parse(payload); return assertImmutable1828StartReceipt(p.lines,p.receipt,p.expected); }', { assert, crypto: require('node:crypto') });
    const fixture = () => {
      const image = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      const nonce = 'f'.repeat(48), tokenHash = require('node:crypto').createHash('sha256').update(nonce).digest('hex');
      const expected = { sourceVersion:'1.8.28', parentPid:7720, version:'2.0.16', helperPid:2176, bootstrapPid:7120,
        imagePath:image, startedAtMs:2000, acknowledgedAtMs:4000, tokenHash, relaunchPid:8096, helperPath:'C:\\fresh\\helper.ps1',
        executable:'C:\\fresh\\Whitebox.exe', helperArgs:[image,'-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass',
          '-File','C:\\fresh\\helper.ps1','-InstallerPath','C:\\fresh\\Whitebox-Setup-2.0.16.exe','-ParentPid','7720',
          '-AppPath','C:\\fresh\\Whitebox.exe','-ExpectedVersion','2.0.16','-LogPath','C:\\fresh\\install-update.log',
          '-ReadyPath','C:\\fresh\\ready.json','-RendererReadyPath','C:\\fresh\\renderer.json','-RendererReadyToken',nonce] };
      const identity = { pid:2176,parentPid:7120,executablePath:image,createdAtMs:2100,
        commandLine:expected.helperArgs.map(value=>'"'+value+'"').join(' ') };
      const receipt = { installer:{name:'Whitebox-Setup-1.8.28.exe',size:95397289,sha256:'7fc94cd9a60db6481873d49435dcd2801bdeca7a1ff78568e1fbb855cad46442'},
        moduleSha256:'99ed9e50ed30b72e8df3334763de2801680dd43cf229039f2bbf42d2f00dd793',
        scriptHashes:{helper:'576db0c440f16f0eb9bbf546d1543a7bda522026e1a1489981c57bfafd2576b4',bootstrap:'ec57a934bda98f3dcdab6a065511f7d81569427177cb0e7382d090627e7e76d9'},
        callbackCount:1,bootstrapExitCode:0,bootstrapSignalCode:null,readySignal:{helperPid:2176,tokenHash:expected.tokenHash},
        pidSidecar:{helperPid:2176,tokenHash:expected.tokenHash},boundaryStops:[],boundaryInstalls:[],parentAliveAtAcknowledgement:true,
        helperRoster:[2176],identities:[{...identity},{...identity}] };
      const lines = ['helperSpawned=true;pid=2176;at=1970-01-01T00:00:02.2000000Z','readyObserved=true;elapsedMs=441;helperPid=2176',
        '=2.0.16','allAppProcessesStopped=true','exitCode=0',`candidate=${expected.executable};version=2.0.16`,
        `relaunchPath=${expected.executable};installedVersion=2.0.16;expectedVersion=2.0.16`,'relaunchStarted=true;attempt=1;pid=8096',
        'windowRestored=true;pid=8096;handle=3015012','rendererReady=true;attempt=1;pid=8096','relaunchReady=true;attempt=1;pid=8096'];
      return {lines,receipt,expected};
    };
    assert.equal(validate(JSON.stringify(fixture())),true);
    const bare = fixture();
    bare.receipt.identities.forEach(identity => { identity.commandLine = bare.expected.helperArgs.join(' '); });
    assert.equal(validate(JSON.stringify(bare)), true, 'native unquoted argument spellings preserve the same exact command');
    const changes = [
      p=>p.expected.sourceVersion='1.8.27',p=>p.receipt.installer.name='Whitebox-Setup-1.8.29.exe',p=>p.receipt.installer.size++,p=>p.receipt.installer.sha256='0'.repeat(64),
      p=>p.receipt.moduleSha256='0'.repeat(64),p=>p.receipt.scriptHashes.helper='0'.repeat(64),p=>p.receipt.scriptHashes.bootstrap='0'.repeat(64),
      p=>p.receipt.callbackCount=0,p=>p.receipt.callbackCount=2,p=>p.receipt.bootstrapExitCode=1,p=>p.receipt.bootstrapExitCode=null,p=>p.receipt.bootstrapSignalCode='SIGTERM',
      p=>p.receipt.readySignal.helperPid++,p=>p.receipt.readySignal.tokenHash='0'.repeat(64),p=>p.receipt.pidSidecar.tokenHash='0'.repeat(64),
      p=>p.receipt.boundaryStops=['allAppProcessesStopped=true'],p=>p.receipt.boundaryInstalls=['exitCode=0'],p=>p.receipt.parentAliveAtAcknowledgement=false,
      p=>p.receipt.helperRoster=[],p=>p.receipt.helperRoster.push(9999),p=>p.receipt.identities.pop(),p=>p.receipt.identities[1].createdAtMs++,
      p=>p.receipt.identities.forEach(i=>i.parentPid++),p=>p.receipt.identities.forEach(i=>i.createdAtMs=1999),p=>p.receipt.identities.forEach(i=>i.createdAtMs=4001),
      p=>p.receipt.identities.forEach(i=>i.executablePath='C:\\foreign\\powershell.exe'),p=>p.receipt.identities.forEach(i=>i.commandLine+=' -Extra'),
      p=>p.receipt.identities.forEach(i=>i.commandLine=i.commandLine.replace('"7720"','"7721"')),p=>p.receipt.identities.forEach(i=>i.commandLine=i.commandLine.replace('"2.0.16"','"2.0.15"')),
      p=>p.lines[0]='helperSpawned=true;pid=2177;at=1970-01-01T00:00:02.200Z',p=>p.lines[0]='helperSpawned=true;pid=2176;at=1970-01-01T00:00:01.000Z',
      p=>p.lines[1]='readyObserved=true;elapsedMs=60001;helperPid=2176',p=>p.lines[1]='readyObserved=true;elapsedMs=441;helperPid=2177',
      p=>p.lines[2]='Version=2.0.16',p=>p.lines[2]='=2.0.15',p=>p.lines[3]='allAppProcessesStopped=false',p=>p.lines[4]='exitCode=1',
      p=>p.lines[5]='candidate=C:\\foreign\\Whitebox.exe;version=2.0.16',p=>p.lines[6]=p.lines[6].replace('installedVersion=2.0.16','installedVersion=2.0.15'),
      p=>p.lines[7]='relaunchStarted=true;attempt=2;pid=8096',p=>p.lines[8]='windowRestored=true;pid=8096;handle=0',
      p=>p.lines[9]='rendererReady=true;attempt=1;pid=8097',p=>p.lines[10]='relaunchReady=false;attempt=1;pid=8096',
      p=>p.lines.push('bootstrapReadyTimeout=true'),p=>p.lines.splice(2,0,p.lines[0]),p=>p.lines.splice(4,1),p=>[p.lines[3],p.lines[4]]=[p.lines[4],p.lines[3]],
    ];
    changes.forEach((change,index)=>{const p=fixture();change(p);assert.throws(()=>validate(JSON.stringify(p)),undefined,'invalid immutable receipt '+index);});
    assert.match(source,/SOURCE_VERSION === '1\.8\.28' \? \{ immutableSource:/u,'only the pinned first-hop source may request this witness');
    assert.match(source,/assertImmutable1828IdentityReceipt\(immutableStart\.receipt, immutableStart\.expected\)/u,'the real identity proof is validated even when the historical text log is intact');
  });

  test('owned process cleanup requires two consecutive observed absences after termination', async () => {
    const observations = [[908], [], [908], [], []];
    let probes = 0;
    await waitForOwnedProcessIdsExit([908], {
      pollMs: 1,
      probe: async pids => {
        assert.deepEqual(pids, [908]);
        probes += 1;
        return observations.shift();
      },
    });
    assert.equal(probes, 5, 'A disappearing/reappearing PID must reset absence evidence');
    const failure = new Error('CIM unavailable');
    await assert.rejects(waitForOwnedProcessIdsExit([908], { probe: () => { throw failure; } }), error => error === failure);
    await assert.rejects(waitForOwnedProcessIdsExit([908], { timeoutMs: 5, pollMs: 1, probe: () => [908] }), /Timed out/);
    await assert.rejects(waitForOwnedProcessIdsExit([908], { probe: () => [909] }), /unrequested PID/);
    await assert.rejects(waitForOwnedProcessIdsExit([908], { probe: () => ['908'] }), /integer PIDs/);
  });

  test('Windows exit probes reject failed, malformed, duplicate, and unrelated PID evidence', () => {
    const probe = result => probeWindowsProcessIds([908], { spawn: (command, args, options) => {
      assert.equal(command, 'powershell.exe');
      assert(args.at(-1).includes("-Filter 'ProcessId = 908' -ErrorAction Stop"));
      assert.equal(options.windowsHide, true);
      return result;
    } });
    assert.deepEqual(probe({ status: 0, stdout: '[908]' }), [908]);
    assert.deepEqual(probe({ status: 0, stdout: '[]' }), []);
    assert.throws(() => probe({ status: 1, stdout: '[]', stderr: 'CIM denied' }), /CIM denied/);
    const failure = new Error('Process query timed out');
    assert.throws(() => probe({ error: failure, status: null, stdout: '[]' }), error => error === failure);
    for (const stdout of ['', '{}', 'null', '["908"]', '[908,908]', '[909]']) {
      assert.throws(() => probe({ status: 0, stdout }), undefined, stdout);
    }
    assert.throws(() => probeWindowsProcessIds([0]), /integer PIDs/);
  });

  test('both Windows drivers await owned PID exit before strict path verification and propagate cleanup failures', async () => {
    for (const filename of ['windows-v173-update-integration.js', 'windows-legacy-update-bridge-integration.js']) {
      const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
      const aliveDefinition = source.match(/function processAlive\(pid\) \{[\s\S]*?\n\}/)[0];
      const lookupFailure = new Error('Parent process query failed');
      const aliveContext = { powershell: 'powershell.exe', probeWindowsProcessIds: () => { throw lookupFailure; } };
      const alive = vm.runInNewContext('(' + aliveDefinition + ')', aliveContext);
      assert.throws(() => alive(908), error => error === lookupFailure);
      aliveContext.probeWindowsProcessIds = () => [908];
      assert.equal(alive(908), true);
      aliveContext.probeWindowsProcessIds = () => [];
      assert.equal(alive(908), false);
      const waitDefinition = source.match(/async function waitForProcessExit\([^)]*\) \{[\s\S]*?\n\}/)[0];
      const wait = vm.runInNewContext('(' + waitDefinition + ')', {
        powershell: 'powershell.exe', probeWindowsProcessIds,
        waitForOwnedProcessIdsExit: async pids => {
          assert.deepEqual(Array.from(pids), [908]);
          throw lookupFailure;
        },
      });
      await assert.rejects(wait(908), error => error === lookupFailure);
      const start = source.indexOf('async function stopProcessesUnderDirectory(');
      assert(start >= 0, filename);
      const definition = source.slice(start, source.indexOf('\nfunction perUserUninstallRegistryEntries', start));
      let scan = 0;
      let exited = false;
      const events = [];
      const context = {
        runningProcessesUnderDirectory() {
          events.push('scan');
          if (++scan === 1) return [{ pid: 908, executablePath: 'installed/Whitebox.exe' }];
          if (!exited) throw new Error('Executable path was unavailable for guarded PID 908');
          return [];
        },
        stopProcessTree(pid) { assert.equal(pid, 908); events.push('stop'); },
        async waitForOwnedProcessIdsExit(pids) {
          assert.deepEqual(Array.from(pids), [908]);
          events.push('wait');
          await Promise.resolve();
          exited = true;
        },
      };
      const stop = vm.runInNewContext(`(${definition})`, context);
      await stop('installed', 'Installed-path');
      assert.deepEqual(events, ['scan', 'stop', 'wait', 'scan'], filename);

      const failed = new Error('Owned PID did not exit');
      scan = 0;
      context.waitForOwnedProcessIdsExit = async () => { throw failed; };
      await assert.rejects(stop('installed', 'Installed-path'), error => error === failed);
      assert.equal(scan, 1, 'A failed exit check must never advance to a clean path scan');

      scan = 0;
      const ambiguous = new Error('Executable path was unavailable for guarded PID 909');
      context.waitForOwnedProcessIdsExit = async () => {};
      context.runningProcessesUnderDirectory = () => {
        if (++scan === 1) return [{ pid: 908, executablePath: 'installed/Whitebox.exe' }];
        throw ambiguous;
      };
      await assert.rejects(stop('installed', 'Installed-path'), error => error === ambiguous);
    }
  });

  test('packaged renderer readiness uses synchronous reads and never accepts debugger failure or timeout', async () => {
    let probes = 0;
    let expressionUnderTest;
    await waitForPackagedRenderer({ evaluate: async (expression, options) => {
      expressionUnderTest = expression;
      assert.equal(options.awaitPromise, false, 'The bootstrap context must not retain an Inspector awaitPromise');
      assert.match(expression, /^Boolean\(typeof process !== 'undefined'/);
      return ++probes === 3;
    } }, { pollMs: 1 });
    assert.equal(probes, 3);
    for (const context of [{}, { process: {} }, { process: { mainModule: {
      loaded: false, require() { throw new Error('Electron lazy exports are still initializing'); },
    } } }]) {
      assert.equal(vm.runInNewContext(expressionUnderTest, context), false);
    }
    const windows = [];
    const readyContext = { process: { mainModule: { loaded: true, require(name) {
      assert.equal(name, 'electron');
      return { BrowserWindow: { getAllWindows: () => windows } };
    } } } };
    assert.equal(vm.runInNewContext(expressionUnderTest, readyContext), false);
    windows.push({ webContents: { getURL: () => 'file:///app/splash.html' } });
    assert.equal(vm.runInNewContext(expressionUnderTest, readyContext), false);
    windows.push({ webContents: { getURL: () => 'file:///app/renderer/index.html' } });
    assert.equal(vm.runInNewContext(expressionUnderTest, readyContext), true);
    const failure = new Error('Promise was collected');
    let failedProbes = 0;
    await assert.rejects(waitForPackagedRenderer({ evaluate: async () => {
      failedProbes += 1;
      throw failure;
    } }, { pollMs: 1 }), error => error === failure);
    assert.equal(failedProbes, 1, 'A failed debugger evaluation is not retried or counted as readiness');
    await assert.rejects(waitForPackagedRenderer({ evaluate: async () => false }, { timeoutMs: 0, pollMs: 1 }), /Packaged renderer did not open/);
  });
}

module.exports = { registerPackagedUpdateDriverTests };
