'use strict';

const fs = require('fs');
const path = require('path');

const READY_PATH_ENV = 'WHITEBOX_UPDATE_READY_PATH';
const READY_TOKEN_ENV = 'WHITEBOX_UPDATE_READY_TOKEN';
const LEGACY_READY_PATH_ENV = 'LOADTOAGENT_UPDATE_READY_PATH';
const LEGACY_READY_TOKEN_ENV = 'LOADTOAGENT_UPDATE_READY_TOKEN';
const PROFILE_PATH_ENV = 'WHITEBOX_UPDATE_PROFILE_PATH';
const TOKEN_PATTERN = /^[0-9a-f]{48}$/;

function lstatIfPresent(fileSystem, candidate) {
  try {
    return fileSystem.lstatSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function canonicalPath(fileSystem, candidate) {
  const nativeRealpath = fileSystem.realpathSync && fileSystem.realpathSync.native;
  return typeof nativeRealpath === 'function'
    ? nativeRealpath(candidate)
    : fileSystem.realpathSync(candidate);
}

function applyScopedUpdateRelaunchProfile(options = {}) {
  if (!options.request) return { applied: false };
  const fileSystem = options.fileSystem || fs;
  const pathModule = options.pathModule || path;
  const request = options.request;
  // Official older helpers do not carry a profile variable. Their production
  // ready file is still bound to that profile's updates directory. Standalone
  // helper fixtures in other download directories keep the legacy default.
  const readyDirectory = pathModule.dirname(request.readyPath || '');
  const profile = String(options.profilePath || (pathModule.basename(readyDirectory) === 'updates'
    ? pathModule.dirname(readyDirectory) : ''));
  if (!profile) return { applied: false };
  if (!pathModule.isAbsolute(profile) || !pathModule.isAbsolute(request.readyPath || '')
    || !TOKEN_PATTERN.test(request.token || '')
    || pathModule.basename(request.readyPath) !== `install-renderer-ready-${request.token}.json`) {
    throw new Error('업데이트 재실행 프로필 요청이 올바르지 않습니다.');
  }
  const updates = pathModule.join(profile, 'updates');
  for (const directory of [profile, updates]) {
    const state = fileSystem.lstatSync(directory);
    if (!state.isDirectory() || state.isSymbolicLink()) throw new Error('업데이트 재실행 프로필이 실제 디렉터리가 아닙니다.');
  }
  const normalize = value => options.platform === 'win32' ? value.toLowerCase() : value;
  if (normalize(canonicalPath(fileSystem, pathModule.dirname(request.readyPath))) !== normalize(canonicalPath(fileSystem, updates))) {
    throw new Error('업데이트 준비 신호가 재실행 프로필 밖에 있습니다.');
  }
  const userDataPath = canonicalPath(fileSystem, profile);
  options.app.setPath('userData', userDataPath);
  return { applied: true, userDataPath };
}

function applyWindowsUpdateRelaunchProfile(options = {}) {
  const platform = String(options.platform || process.platform);
  if (platform !== 'win32') return { applied: false, reason: 'not-windows' };
  if (!options.request) return { applied: false, reason: 'not-update-relaunch' };

  const pathModule = options.pathModule || path.win32;
  const requestToken = String(options.request.token || '').trim().toLowerCase();
  const requestReadyPath = String(options.request.readyPath || '').trim();
  if (!TOKEN_PATTERN.test(requestToken)
    || !pathModule.isAbsolute(requestReadyPath)
    || pathModule.basename(requestReadyPath) !== `install-renderer-ready-${requestToken}.json`) {
    throw new Error('Windows 업데이트 재실행 요청이 올바르지 않습니다.');
  }

  const electronApp = options.app;
  if (!electronApp
    || typeof electronApp.setPath !== 'function'
    || !electronApp.commandLine
    || typeof electronApp.commandLine.hasSwitch !== 'function') {
    throw new Error('Windows 업데이트 재실행 프로필을 설정할 수 없습니다.');
  }
  if (electronApp.commandLine.hasSwitch('user-data-dir')) {
    return { applied: false, reason: 'explicit-user-data-dir' };
  }

  const fileSystem = options.fileSystem || fs;
  const productName = String(options.productName || 'Whitebox').trim();
  const appDataValue = String((options.environment || process.env).APPDATA || '').trim();
  if (!appDataValue || !pathModule.isAbsolute(appDataValue)) {
    throw new Error('Windows 업데이트 재실행 APPDATA가 절대 경로가 아닙니다.');
  }
  if (!productName
    || productName === '.'
    || productName === '..'
    || pathModule.basename(productName) !== productName) {
    throw new Error('Windows 업데이트 재실행 프로필 이름이 올바르지 않습니다.');
  }

  const appDataState = lstatIfPresent(fileSystem, appDataValue);
  if (!appDataState || !appDataState.isDirectory() || appDataState.isSymbolicLink()) {
    throw new Error('Windows 업데이트 재실행 APPDATA가 실제 디렉터리가 아닙니다.');
  }
  const appDataPath = canonicalPath(fileSystem, appDataValue);
  const requestedUserDataPath = pathModule.join(appDataPath, productName);
  if (!lstatIfPresent(fileSystem, requestedUserDataPath)) {
    fileSystem.mkdirSync(requestedUserDataPath, { mode: 0o700 });
  }
  const userDataState = lstatIfPresent(fileSystem, requestedUserDataPath);
  if (!userDataState || !userDataState.isDirectory() || userDataState.isSymbolicLink()) {
    throw new Error('Windows 업데이트 재실행 userData가 실제 디렉터리가 아닙니다.');
  }
  const userDataPath = canonicalPath(fileSystem, requestedUserDataPath);
  const relativeUserDataPath = pathModule.relative(appDataPath, userDataPath);
  if (!relativeUserDataPath
    || relativeUserDataPath === '..'
    || relativeUserDataPath.startsWith(`..${pathModule.sep}`)
    || pathModule.isAbsolute(relativeUserDataPath)) {
    throw new Error('Windows 업데이트 재실행 userData가 APPDATA 밖을 가리킵니다.');
  }

  electronApp.setPath('appData', appDataPath);
  electronApp.setPath('userData', userDataPath);
  return { applied: true, appDataPath, userDataPath };
}

function readUpdateRelaunchRequest(environment = process.env) {
  for (const [pathKey, tokenKey] of [
    [READY_PATH_ENV, READY_TOKEN_ENV],
    [LEGACY_READY_PATH_ENV, LEGACY_READY_TOKEN_ENV],
  ]) {
    const readyPath = String(environment && environment[pathKey] || '').trim();
    const token = String(environment && environment[tokenKey] || '').trim().toLowerCase();
    if (!path.isAbsolute(readyPath) || !TOKEN_PATTERN.test(token)) continue;
    if (path.basename(readyPath) !== `install-renderer-ready-${token}.json`) continue;
    return { readyPath: path.resolve(readyPath), token };
  }
  return null;
}

async function signalRendererReady(options = {}) {
  const environment = options.environment || process.env;
  const request = options.request
    ? readUpdateRelaunchRequest({
      [READY_PATH_ENV]: options.request.readyPath,
      [READY_TOKEN_ENV]: options.request.token,
    })
    : readUpdateRelaunchRequest(environment);
  if (!request) return { signaled: false, readyPath: '' };

  const pid = Number(options.pid ?? process.pid);
  const version = String(options.version || '').trim();
  if (!Number.isSafeInteger(pid) || pid <= 0 || !version) {
    throw new Error('업데이트 재실행 준비 신호에 필요한 앱 정보를 확인하지 못했습니다.');
  }

  const fileSystem = options.fileSystem || fs;
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const temporaryPath = `${request.readyPath}.${pid}.tmp`;
  const payload = {
    token: request.token,
    pid,
    version,
    rendererReadyAt: now().toISOString(),
  };

  await fileSystem.promises.mkdir(path.dirname(request.readyPath), { recursive: true });
  await fileSystem.promises.rm(temporaryPath, { force: true });
  await fileSystem.promises.writeFile(temporaryPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
  await fileSystem.promises.rm(request.readyPath, { force: true });
  await fileSystem.promises.rename(temporaryPath, request.readyPath);
  delete environment[READY_PATH_ENV];
  delete environment[READY_TOKEN_ENV];
  delete environment[LEGACY_READY_PATH_ENV];
  delete environment[LEGACY_READY_TOKEN_ENV];
  return { signaled: true, readyPath: request.readyPath };
}

module.exports = {
  LEGACY_READY_PATH_ENV,
  LEGACY_READY_TOKEN_ENV,
  READY_PATH_ENV,
  READY_TOKEN_ENV,
  PROFILE_PATH_ENV,
  applyScopedUpdateRelaunchProfile,
  applyWindowsUpdateRelaunchProfile,
  readUpdateRelaunchRequest,
  signalRendererReady,
};
