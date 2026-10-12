'use strict';

// Packaged PTYs must outlive replacement of the GUI installation. Keep their
// executable, native addons and app.asar together in a versioned private copy.
// A live host pins this copy; it is never removed as update-helper cleanup.
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function digestFile(file, fileSystem = fs) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fileSystem.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function prepareTerminalHostRuntime(options) {
  if (!options.isPackaged) return { executable: options.executable, script: options.script };
  const fileSystem = options.fileSystem || fs;
  const platform = options.platform || process.platform;
  const executable = path.resolve(options.executable);
  const sourceRoot = platform === 'darwin'
    ? path.resolve(path.dirname(executable), '../../..') // Helper.app -> outer Contents
    : path.dirname(executable);
  // The Mac host executable is Contents/Frameworks/Whitebox Helper.app/
  // Contents/MacOS/Whitebox Helper. Copy the complete outer application.
  const installRoot = platform === 'darwin' ? path.resolve(sourceRoot, '../..') : sourceRoot;
  const archive = path.join(installRoot, platform === 'darwin' ? 'Contents/Resources/app.asar' : 'resources/app.asar');
  const archiveHash = await digestFile(archive, fileSystem);
  const runtimeRoot = path.resolve(options.runtimeRoot);
  const relativeRuntime = path.relative(installRoot, runtimeRoot);
  if (!relativeRuntime || (!relativeRuntime.startsWith(`..${path.sep}`) && relativeRuntime !== '..' && !path.isAbsolute(relativeRuntime))) {
    throw new Error('명령창 실행 환경은 앱 설치 위치 밖에 있어야 합니다.');
  }
  await fileSystem.promises.mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const rootState = await fileSystem.promises.lstat(runtimeRoot);
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) throw new Error('명령창 실행 환경 폴더가 올바르지 않습니다.');
  const canonicalRoot = await fileSystem.promises.realpath(runtimeRoot);
  const canonicalInstall = await fileSystem.promises.realpath(installRoot);
  const relativeCanonical = path.relative(canonicalInstall, canonicalRoot);
  if (!relativeCanonical || (!relativeCanonical.startsWith(`..${path.sep}`) && relativeCanonical !== '..' && !path.isAbsolute(relativeCanonical))) {
    throw new Error('명령창 실행 환경이 앱 설치 위치를 가리킵니다.');
  }
  // NSIS closes processes by the GUI executable's image name, even when they
  // run outside the installation. A separate host image must survive that step.
  const hostImage = platform === 'win32' ? 'WhiteboxTerminalHost.exe' : null;
  const identity = crypto.createHash('sha256').update(JSON.stringify([archiveHash, platform, hostImage, options.arch || process.arch, options.electronVersion || process.versions.electron])).digest('hex');
  const target = path.join(canonicalRoot, identity);
  const relativeExecutable = path.relative(installRoot, executable);
  const relativeScript = path.relative(installRoot, path.resolve(options.script));
  for (const value of [relativeExecutable, relativeScript]) {
    if (!value || value === '..' || value.startsWith(`..${path.sep}`) || path.isAbsolute(value)) throw new Error('명령창 실행 파일이 앱 설치 위치 밖에 있습니다.');
  }
  const runtimeExecutable = hostImage ? path.join(path.dirname(relativeExecutable), hostImage) : relativeExecutable;
  const targetArchive = path.join(target, path.relative(installRoot, archive));
  async function validate() {
    const state = await fileSystem.promises.lstat(target);
    if (!state.isDirectory() || state.isSymbolicLink()) throw new Error('명령창 실행 환경이 올바르지 않습니다.');
    if (await digestFile(targetArchive, fileSystem) !== archiveHash) throw new Error('명령창 실행 환경의 앱 파일 검증에 실패했습니다.');
    await fileSystem.promises.access(path.join(target, runtimeExecutable), fileSystem.constants.X_OK);
  }
  try { await validate(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A missing file in an existing cache must fail closed, not overwrite a
    // directory that may already contain a running host.
    try { await fileSystem.promises.lstat(target); throw new Error('명령창 실행 환경이 불완전합니다.'); }
    catch (existingError) { if (existingError.code !== 'ENOENT') throw existingError; }
    const staged = path.join(canonicalRoot, `.preparing-${crypto.randomUUID()}`);
    try {
      await fileSystem.promises.cp(installRoot, staged, { recursive: true, verbatimSymlinks: true, mode: fileSystem.constants.COPYFILE_FICLONE });
      if (runtimeExecutable !== relativeExecutable) {
        await fileSystem.promises.rename(path.join(staged, relativeExecutable), path.join(staged, runtimeExecutable));
      }
      await fileSystem.promises.rename(staged, target);
      await validate();
    } finally { await fileSystem.promises.rm(staged, { recursive: true, force: true }); }
  }
  return { executable: path.join(target, runtimeExecutable), script: path.join(target, relativeScript) };
}

module.exports = { prepareTerminalHostRuntime };
