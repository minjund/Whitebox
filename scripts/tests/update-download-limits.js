'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { UpdateManager } = require('../../src/updateManager');

const DOWNLOAD_ROOT = 'https://github.com/minjund/Whitebox/releases/download/v3.1.0/';

function asset(name, size, payload = Buffer.alloc(0)) {
  return {
    name,
    size,
    url: `${DOWNLOAD_ROOT}${name}`,
    digest: `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`,
  };
}

function managerWithAsset(options, updateAsset) {
  const manager = new UpdateManager({
    currentVersion: '3.0.0',
    platform: 'win32',
    arch: 'x64',
    installType: 'desktop',
    ...options,
  });
  manager.state = { ...manager.state, status: 'available', asset: updateAsset };
  return manager;
}

function registerUpdateDownloadLimitTests(context) {
  const { test, temp } = context;

  test('조회와 다운로드는 직렬화되고 동일 파일 새로고침은 준비 상태를 보존한다', async () => {
    const payload = Buffer.from('verified installer');
    const item = { ...asset('Whitebox-Setup-3.1.0.exe', payload.length, payload), state: 'uploaded' };
    item.browser_download_url = item.url;
    const release = { tag_name: 'v3.1.0', assets: [item] };
    let finishCheck;
    let checks = 0;
    let files = 0;
    const manager = new UpdateManager({ currentVersion: '3.0.0', platform: 'win32', arch: 'x64',
      downloadsDir: path.join(temp, 'serialized-refresh'),
      fetch: async (url, options) => {
        if (url.includes('/latest')) {
          checks++;
          assert.equal(options.cache, 'no-store');
          if (checks === 1) await new Promise(resolve => { finishCheck = resolve; });
          return new Response(JSON.stringify(release));
        }
        files++;
        return new Response(payload);
      },
    });
    const checking = manager.check();
    while (!finishCheck) await new Promise(resolve => setImmediate(resolve));
    const downloading = manager.download();
    assert.equal(files, 0);
    finishCheck();
    await checking;
    const ready = await downloading;
    assert.equal(ready.status, 'downloaded');
    const refreshed = await manager.check();
    assert.equal(refreshed.status, 'downloaded');
    assert.equal(refreshed.downloadedPath, ready.downloadedPath);
    assert.equal(files, 1);
    manager.setState({ status: 'installing' });
    await manager.check();
    assert.equal(checks, 2);
    assert.equal(manager.getState().status, 'installing');
  });

  test('백그라운드 확인 실패는 마지막 성공 시각을 유지하며 오래된 파일 설치를 차단한다', async () => {
    let calls = 0;
    const manager = managerWithAsset({downloadsDir: path.join(temp, 'stale-refresh'), fetch: async () => {
      calls++;
      return new Response('offline', { status: 503 });
    }}, asset('Whitebox-Setup-3.1.0.exe', 4, Buffer.from('test')));
    const checkedAt = '2020-01-01T00:00:00.000Z';
    manager.setState({ checkedAt, latestVersion: '3.1.0' });
    await manager.check({surfaceError: false});
    assert.equal(manager.getState().checkedAt, checkedAt);
    assert.match(manager.getState().checkError, /HTTP 503/);
    await assert.rejects(manager.download(), /HTTP 503/);
    assert.equal(calls, 2);
    assert.equal(manager.getState().downloadedPath, '');
  });

  test('오래된 설치 선택을 갱신하고 다운로드 중 조회와 서버 버전 역행을 차단한다', async () => {
    const payload = Buffer.from('new version');
    const digest = 'sha256:' + crypto.createHash('sha256').update(payload).digest('hex');
    let version = '3.2.0';
    let releaseChecks = 0;
    let finishDownload;
    const manager = managerWithAsset({downloadsDir: path.join(temp, 'newer-selection'), fetch: async url => {
      if (url.includes('/latest')) {
        releaseChecks++;
        const name = `Whitebox-Setup-${version}.exe`;
        return new Response(JSON.stringify({tag_name: 'v'+version, assets: [{name, state:'uploaded', size:payload.length, digest,
          browser_download_url:`https://github.com/minjund/Whitebox/releases/download/v${version}/${name}`}]}));
      }
      assert(url.includes('/v3.2.0/'), 'must download the newly discovered version');
      await new Promise(resolve => { finishDownload = resolve; });
      return new Response(payload);
    }}, asset('Whitebox-Setup-3.1.0.exe', 4, Buffer.from('test')));
    manager.setState({latestVersion:'3.1.0', checkedAt:'2020-01-01T00:00:00.000Z'});
    const download = manager.download();
    while (!finishDownload) await new Promise(resolve => setImmediate(resolve));
    await manager.check();
    assert.equal(releaseChecks, 1);
    finishDownload();
    const result = await download;
    assert.equal(result.latestVersion, '3.2.0');
    assert.equal(result.status, 'downloaded');
    version = '3.1.0';
    await manager.check({surfaceError:false});
    assert.equal(manager.getState().latestVersion, '3.2.0');
    assert.equal(manager.getState().downloadedPath, result.downloadedPath);
    assert.match(manager.getState().checkError, /오래된 버전/);
  });

  test('주기적 확인은 새 릴리스를 찾고 설치 중에는 멈추며 종료 시 타이머를 해제한다', async () => {
    let busy = true;
    let calls = 0;
    const manager = new UpdateManager({currentVersion: '3.0.0', platform: 'win32', arch: 'x64',
      isInstallBusy: () => busy, fetch: async () => {
        calls++;
        return new Response(JSON.stringify({tag_name: 'v3.2.0', assets: []}));
      }});
    manager.startPeriodicChecks(10);
    try {
      await new Promise(resolve => setTimeout(resolve, 35));
      assert.equal(calls, 0);
      busy = false;
      const deadline = Date.now() + 2000;
      while (manager.getState().latestVersion !== '3.2.0') {
        assert(Date.now() < deadline, 'periodic check did not discover release');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally { manager.stopPeriodicChecks(); }
    if (manager.checkPromise) await manager.checkPromise;
    const stopped = calls;
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(calls, stopped);
    assert.equal(manager.periodicCheckTimer, null);
  });

  test('업데이트 확인은 응답 본문이 멈추면 제한 시간 안에 중단한다', async () => {
    const downloadsDir = path.join(temp, 'update-cache-cleanup');
    const activeInstaller = path.join(downloadsDir, 'Whitebox-Setup-3.0.0.exe');
    const staleInstaller = path.join(downloadsDir, 'Whitebox-Setup-2.9.0.exe');
    const staleDownload = path.join(downloadsDir, 'Whitebox-3.1.0-portable.exe.download');
    const futureInstaller = path.join(downloadsDir, 'Whitebox-Setup-3.1.0.exe');
    const unknownFile = path.join(downloadsDir, 'Whitebox-Setup-latest.exe');
    const nestedDirectory = path.join(downloadsDir, 'Whitebox-Setup-2.8.0.exe');
    const nestedInstaller = path.join(nestedDirectory, 'Whitebox-Setup-2.7.0.exe');
    const protectedTarget = path.join(temp, 'protected-update-target.exe');
    const linkedInstaller = path.join(downloadsDir, 'Whitebox-Setup-2.6.0.exe');
    fs.mkdirSync(nestedDirectory, { recursive: true });
    fs.writeFileSync(activeInstaller, 'active installer');
    fs.writeFileSync(staleInstaller, 'stale installer');
    fs.writeFileSync(staleDownload, 'partial installer');
    fs.writeFileSync(futureInstaller, 'future installer');
    fs.writeFileSync(unknownFile, 'not an app-owned versioned artifact');
    fs.writeFileSync(nestedInstaller, 'nested installer');
    fs.writeFileSync(protectedTarget, 'protected symlink target');
    let linked = false;
    try {
      fs.symlinkSync(protectedTarget, linkedInstaller, 'file');
      linked = true;
    } catch (error) {
      if (!error || !['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
    }
    let requestSignal = null;
    let readerCancelled = false;
    const manager = new UpdateManager({
      currentVersion: '3.0.0',
      platform: 'win32',
      arch: 'x64',
      downloadsDir,
      checkTimeoutMs: 20,
      fetch: async (_url, options) => {
        requestSignal = options.signal;
        return {
          ok: true,
          headers: { get: () => null },
          body: {
            getReader: () => ({
              read: () => new Promise((resolve, reject) => {
                if (requestSignal.aborted) {
                  reject(Object.assign(new Error('fixture aborted'), { name: 'AbortError' }));
                  return;
                }
                requestSignal.addEventListener('abort', () => {
                  reject(Object.assign(new Error('fixture aborted'), { name: 'AbortError' }));
                }, { once: true });
              }),
              cancel: async () => { readerCancelled = true; },
            }),
          },
        };
      },
    });
    manager.state = { ...manager.state, status: 'downloaded', downloadedPath: activeInstaller };

    const state = await manager.check();

    assert.equal(state.status, 'error');
    assert.match(state.error, /시간이 초과/);
    assert.equal(requestSignal.aborted, true);
    assert.equal(readerCancelled, true);
    assert.equal(state.downloadedPath, activeInstaller);
    assert.equal(fs.existsSync(activeInstaller), true);
    assert.equal(fs.existsSync(staleInstaller), false);
    assert.equal(fs.existsSync(staleDownload), false);
    assert.equal(fs.existsSync(futureInstaller), true);
    assert.equal(fs.existsSync(unknownFile), true);
    assert.equal(fs.statSync(nestedDirectory).isDirectory(), true);
    assert.equal(fs.existsSync(nestedInstaller), true);
    assert.equal(fs.readFileSync(protectedTarget, 'utf8'), 'protected symlink target');
    if (linked) assert.equal(fs.lstatSync(linkedInstaller).isSymbolicLink(), true);

    const linkedRootTarget = path.join(temp, 'linked-update-root-target');
    const linkedRootArtifact = path.join(linkedRootTarget, 'Whitebox-Setup-2.5.0.exe');
    const linkedRoot = path.join(temp, 'linked-update-root');
    fs.mkdirSync(linkedRootTarget, { recursive: true });
    fs.writeFileSync(linkedRootArtifact, 'protected linked-root artifact');
    let linkedRootCreated = false;
    try {
      fs.symlinkSync(linkedRootTarget, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
      linkedRootCreated = true;
    } catch (error) {
      if (!error || !['EPERM', 'EACCES', 'EINVAL', 'ENOTSUP', 'UNKNOWN'].includes(error.code)) throw error;
    }
    if (linkedRootCreated) {
      const linkedRootManager = new UpdateManager({
        currentVersion: '3.0.0',
        platform: 'win32',
        arch: 'x64',
        downloadsDir: linkedRoot,
        fetch: async () => { throw new Error('linked-root fixture'); },
      });
      await linkedRootManager.check();
      assert.equal(fs.readFileSync(linkedRootArtifact, 'utf8'), 'protected linked-root artifact');
    }
  });

  test('업데이트 확인은 길이 헤더가 없는 과대 응답 본문을 중단한다', async () => {
    let requestSignal = null;
    let readerCancelled = false;
    let reads = 0;
    const manager = new UpdateManager({
      currentVersion: '3.0.0',
      platform: 'win32',
      arch: 'x64',
      maxCheckBytes: 16,
      fetch: async (_url, options) => {
        requestSignal = options.signal;
        return {
          ok: true,
          headers: { get: () => null },
          body: {
            getReader: () => ({
              read: async () => {
                reads += 1;
                return reads === 1
                  ? { done: false, value: Buffer.alloc(17, 0x20) }
                  : { done: true, value: undefined };
              },
              cancel: async () => { readerCancelled = true; },
            }),
          },
        };
      },
    });

    const state = await manager.check();

    assert.equal(state.status, 'error');
    assert.match(state.error, /최대 크기/);
    assert.equal(reads, 1);
    assert.equal(requestSignal.aborted, true);
    assert.equal(readerCancelled, true);
  });

  test('업데이트 다운로드는 크기 상한·공식 크기·시간 제한을 쓰기 전에 강제한다', async () => {
    const downloadsDir = path.join(temp, 'bounded-update-downloads');
    let fetchCalls = 0;
    const oversized = managerWithAsset({
      downloadsDir,
      maxDownloadBytes: 4,
      fetch: async () => { fetchCalls += 1; },
    }, asset('oversized.exe', 5));
    await assert.rejects(oversized.download(), /최대 크기/);
    assert.equal(fetchCalls, 0);
    assert.equal(fs.existsSync(path.join(downloadsDir, 'oversized.exe.download')), false);

    let overrunCancelled = false;
    const expectedPayload = Buffer.from('safe');
    const existingInstaller = path.join(downloadsDir, 'Whitebox-Setup-3.1.0.exe');
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.writeFileSync(existingInstaller, 'previous verified installer', 'utf8');
    const overrun = managerWithAsset({
      downloadsDir,
      maxDownloadBytes: 32,
      fetch: async () => ({
        ok: true,
        headers: { get: name => String(name).toLowerCase() === 'content-length' ? String(expectedPayload.length) : null },
        body: {
          getReader: () => ({
            read: async () => ({ done: false, value: Buffer.from('unsafe') }),
            cancel: async () => { overrunCancelled = true; },
          }),
        },
      }),
    }, asset('Whitebox-Setup-3.1.0.exe', expectedPayload.length, expectedPayload));
    await assert.rejects(overrun.download(), /공식 파일.*보다 큽니다/);
    assert.equal(overrunCancelled, true);
    assert.equal(fs.readFileSync(existingInstaller, 'utf8'), 'previous verified installer');
    assert.equal(fs.existsSync(`${existingInstaller}.download`), false);

    let timeoutSignal = null;
    let timeoutCancelled = false;
    const timeoutPayload = Buffer.from('wait');
    const timedOut = managerWithAsset({
      downloadsDir,
      maxDownloadBytes: 32,
      downloadTimeoutMs: 20,
      fetch: async (_url, options) => {
        timeoutSignal = options.signal;
        return {
          ok: true,
          headers: { get: name => String(name).toLowerCase() === 'content-length' ? String(timeoutPayload.length) : null },
          body: {
            getReader: () => ({
              read: () => new Promise((resolve, reject) => {
                if (timeoutSignal.aborted) {
                  reject(Object.assign(new Error('fixture aborted'), { name: 'AbortError' }));
                  return;
                }
                timeoutSignal.addEventListener('abort', () => {
                  reject(Object.assign(new Error('fixture aborted'), { name: 'AbortError' }));
                }, { once: true });
              }),
              cancel: async () => { timeoutCancelled = true; },
            }),
          },
        };
      },
    }, asset('timeout.exe', timeoutPayload.length, timeoutPayload));
    await assert.rejects(timedOut.download(), /시간이 초과/);
    assert.equal(timeoutSignal.aborted, true);
    assert.equal(timeoutCancelled, true);
    assert.equal(fs.existsSync(path.join(downloadsDir, 'timeout.exe.download')), false);
    assert.equal(timedOut.getState().status, 'available');
  });
}

module.exports = { registerUpdateDownloadLimitTests };
