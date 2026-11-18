#!/usr/bin/env node
'use strict';
// repro-check: developer tool for Whitebox itself. Not packaged into the app.
// Launches the real Whitebox app (before-fix and after-fix code) invisibly and
// replays one frozen scenario on each side. Isolation and cleanup are ported
// from earlier manual reproduction experiments.
//
//   node run.js <scenario.js> --before <git-ref|dir> --after <git-ref|dir> [--runs 3] [--keep]
//
// A git ref becomes a temporary worktree of the Whitebox repo (+ npm ci) and is
// removed at the end. A directory is used as is (it must already have node_modules).

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFileSync, spawnSync } = require('child_process');

const HERE = __dirname;
const REPO = process.env.WHITEBOX_REPO || path.resolve(__dirname, '..', '..');
const REAL_HOME = os.userInfo().homedir;
const LIVE_PROFILE = path.join(REAL_HOME, 'Library', 'Application Support');
const UID = os.userInfo().uid;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');

// ---------------------------------------------------------------- arguments
function usage(msg) {
  if (msg) console.error(`오류: ${msg}\n`);
  console.error('사용법: node run.js <시나리오.js> --before <git 태그·커밋·브랜치 또는 폴더> --after <같은 형식> [--runs 3] [--keep]');
  process.exit(2);
}
function parseArgs(argv) {
  const out = { runs: 3, keep: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--before' || a === '--after' || a === '--runs') { if (argv[i + 1] == null) usage(`${a} 뒤에 값이 없습니다`); out[a.slice(2)] = argv[++i]; }
    else if (a === '--keep') out.keep = true;
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('--')) usage(`모르는 옵션 ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1) usage('시나리오 파일 하나를 주세요');
  if (!out.before || !out.after) usage('--before 와 --after 가 둘 다 필요합니다');
  out.runs = Number(out.runs);
  if (!Number.isInteger(out.runs) || out.runs < 1 || out.runs > 10) usage('--runs 는 1~10');
  out.scenario = path.resolve(rest[0]);
  return out;
}

function loadScenario(file) {
  if (!fs.existsSync(file)) usage(`시나리오 파일이 없습니다: ${file}`);
  const sc = require(file);
  const problems = [];
  for (const key of ['name', 'complaint', 'symptom']) if (typeof sc[key] !== 'string' || !sc[key].trim()) problems.push(key);
  if (typeof sc.needsClaude !== 'boolean') problems.push('needsClaude');
  if (typeof sc.steps !== 'function') problems.push('steps');
  if (problems.length) usage(`시나리오에 빠진 칸: ${problems.join(', ')}`);
  return sc;
}

// ---------------------------------------------------------------- cleanup registry
const state = { worktrees: [], wtBase: null, current: null, cleaning: false, batchDir: null };

function git(args, opts = {}) { return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim(); }

function removeWorktrees() {
  for (const wt of state.worktrees.splice(0)) {
    try { git(['worktree', 'remove', '--force', wt]); } catch {}
    try { fs.rmSync(wt, { recursive: true, force: true }); } catch {}
  }
  try { git(['worktree', 'prune']); } catch {}
  if (state.wtBase) { try { fs.rmSync(state.wtBase, { recursive: true, force: true }); } catch {} }
}

// ---------------------------------------------------------------- sides (before/after)
function honorsTestInstance(dir) {
  let main = '';
  try { main = fs.readFileSync(path.join(dir, 'main.js'), 'utf8'); } catch { return false; }
  return /WHITEBOX_TEST_INSTANCE\s*===\s*'1'/.test(main) && /isolatedTestInstance\s*\|\|\s*app\.requestSingleInstanceLock\(/.test(main);
}
function electronBin(dir) { return path.join(dir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'); }

function prepareSide(side, arg, wtBase, batchDir) {
  let dir, kind, sha = '', dirty = false;
  if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
    kind = 'dir';
    dir = fs.realpathSync(arg);
    if (dir.startsWith(LIVE_PROFILE)) throw new Error(`${side}: 실제 앱 프로필 안의 폴더는 쓸 수 없습니다`);
    try { sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
    try { dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0; } catch {}
    if (!honorsTestInstance(dir)) throw new Error(`${side}: 이 코드의 main.js가 WHITEBOX_TEST_INSTANCE를 지원하지 않아 띄우지 않습니다 (${dir})`);
    if (!fs.existsSync(electronBin(dir))) throw new Error(`${side}: ${dir} 에 node_modules가 없습니다. 그 폴더에서 먼저 npm ci 를 하세요`);
  } else {
    kind = 'ref';
    try { sha = git(['rev-parse', '--verify', '--quiet', `${arg}^{commit}`]); } catch { throw new Error(`${side}: '${arg}' 는 폴더도 아니고 Whitebox 저장소의 git 태그·커밋·브랜치도 아닙니다`); }
    // Check the flag on the commit itself before spending time on a worktree.
    let main = '';
    try { main = git(['show', `${sha}:main.js`], { maxBuffer: 64 * 1024 * 1024 }); } catch {}
    const tmpCheck = /WHITEBOX_TEST_INSTANCE\s*===\s*'1'/.test(main) && /isolatedTestInstance\s*\|\|\s*app\.requestSingleInstanceLock\(/.test(main);
    if (!tmpCheck) throw new Error(`${side}: ${arg} 의 main.js가 WHITEBOX_TEST_INSTANCE를 지원하지 않아 띄우지 않습니다`);
    dir = path.join(wtBase, side);
    fs.mkdirSync(wtBase, { recursive: true });
    console.log(`준비: ${side} = ${arg} (${sha.slice(0, 7)}) 임시 워크트리 + npm ci …`);
    git(['worktree', 'add', '--detach', '--quiet', dir, sha]);
    state.worktrees.push(dir);
    const logFile = path.join(batchDir, `npm-${side}.log`);
    const r = spawnSync('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8', timeout: 15 * 60 * 1000 });
    fs.writeFileSync(logFile, (r.stdout || '') + (r.stderr || ''));
    if (r.status !== 0) throw new Error(`${side}: npm ci 실패 (기록: ${logFile})`);
    // npm 11 does not run electron's postinstall here; fetch the binary (from the local cache) as the npm postinstall would.
    if (!fs.existsSync(electronBin(dir))) {
      const e = spawnSync(process.execPath, [path.join(dir, 'node_modules', 'electron', 'install.js')], { cwd: dir, encoding: 'utf8', timeout: 10 * 60 * 1000 });
      fs.appendFileSync(logFile, '\n--- electron install.js ---\n' + (e.stdout || '') + (e.stderr || ''));
    }
    if (!honorsTestInstance(dir)) throw new Error(`${side}: main.js가 WHITEBOX_TEST_INSTANCE를 지원하지 않습니다`);
    if (!fs.existsSync(electronBin(dir))) throw new Error(`${side}: npm ci 뒤에도 Electron이 없습니다 (기록: ${logFile})`);
  }
  const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  return { side, arg, kind, dir, sha, dirty, version };
}

// ---------------------------------------------------------------- real claude (only if the scenario needs it)
function resolveClaude(batchDir) {
  const dirs = (process.env.PATH || '').split(':').filter(d => d && !d.includes('.whitebox'));
  dirs.push(path.join(REAL_HOME, '.local', 'bin'));
  let found = '';
  for (const d of dirs) { const f = path.join(d, 'claude'); try { fs.accessSync(f, fs.constants.X_OK); found = f; break; } catch {} }
  if (!found) throw new Error('claude 명령을 찾지 못했습니다 (~/.whitebox/bin 의 어댑터는 일부러 뺍니다)');
  const real = fs.realpathSync(found);
  if (real.includes('.whitebox')) throw new Error(`claude가 Whitebox 어댑터로 이어집니다: ${real}`);
  let version = path.basename(real);
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wbr-ver-'));
    const r = spawnSync(real, ['--version'], { encoding: 'utf8', env: { HOME: tmpHome, PATH: '/usr/bin:/bin' }, timeout: 20000 });
    version = ((r.stdout || '').match(/\d+\.\d+\.\d+/) || ['0.0.0'])[0];
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
  const bin = path.join(batchDir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync(real, path.join(bin, 'claude'));
  return { bin, real, version };
}

// ---------------------------------------------------------------- one run: isolation
function shortTmpBase() {
  const claudeTmp = `/private/tmp/claude-${UID}`;
  return path.join(fs.existsSync(claudeTmp) ? claudeTmp : `/private/tmp/wbr-${UID}`, 'wbr');
}

function prepareRun(batch, target, runNo) {
  const runDir = path.join(batch.dir, `${target.side}-r${pad(runNo)}`);
  const home = path.join(runDir, 'home');
  const userData = path.join(runDir, 'profile', 'Whitebox');
  const launcher = path.join(runDir, 'launcher');
  const shortTmp = path.join(shortTmpBase(), `${batch.short}${target.side[0]}${pad(runNo)}`);
  fs.rmSync(shortTmp, { recursive: true, force: true });
  for (const d of [home, userData, launcher, shortTmp, path.join(home, 'Library'), path.join(home, 'whitebox-workspace'), path.join(runDir, 'shots')]) fs.mkdirSync(d, { recursive: true });
  // Claude credentials live in the login keychain; expose only that folder.
  fs.symlinkSync(path.join(REAL_HOME, 'Library', 'Keychains'), path.join(home, 'Library', 'Keychains'));
  const trusted = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, projectOnboardingSeenCount: 5 };
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    hasCompletedOnboarding: true, theme: 'dark', lastOnboardingVersion: batch.claude?.version || '2.1.0', numStartups: 20,
    bypassPermissionsModeAccepted: false, hasSeenTasksHint: true, autoUpdates: false,
    projects: { [home]: trusted, [path.join(home, 'whitebox-workspace')]: trusted },
  }, null, 2));
  fs.writeFileSync(path.join(launcher, 'package.json'), JSON.stringify({ name: 'whitebox-ai', productName: 'Whitebox', version: target.version, main: 'main.js' }, null, 2));
  fs.copyFileSync(path.join(HERE, 'lib', 'launcher-main.js'), path.join(launcher, 'main.js'));
  return { target, runNo, runDir, home, userData, launcher, shortTmp, log: path.join(runDir, 'timeline.jsonl') };
}

function isolatedEnv(batch, ctx) {
  const env = {
    HOME: ctx.home, USER: process.env.USER || os.userInfo().username, LOGNAME: process.env.LOGNAME || os.userInfo().username, SHELL: '/bin/zsh',
    LANG: process.env.LANG || 'ko_KR.UTF-8', TMPDIR: ctx.shortTmp + '/',
    PATH: [...(batch.claude ? [batch.claude.bin] : []), '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    WHITEBOX_TEST_INSTANCE: '1', WHITEBOX_BRIDGE_HOME: ctx.home,
    REPRO_APP_ROOT: ctx.target.dir, DISABLE_AUTOUPDATER: '1',
    __CF_USER_TEXT_ENCODING: process.env.__CF_USER_TEXT_ENCODING || '',
  };
  // Keep the terminal multiplexer's default socket dir out of reach (name split on purpose).
  env['TM' + 'UX_TMPDIR'] = ctx.shortTmp;
  return env;
}

function assertIsolation(ctx, env, port) {
  const problems = [];
  for (const p of [ctx.userData, ctx.home, ctx.runDir]) if (p.startsWith(LIVE_PROFILE)) problems.push(`실제 프로필 경로: ${p}`);
  if (env.HOME === REAL_HOME || !env.HOME.startsWith(ctx.runDir)) problems.push('HOME이 이 실행 폴더가 아닙니다');
  if (env.WHITEBOX_TEST_INSTANCE !== '1') problems.push('WHITEBOX_TEST_INSTANCE 없음');
  if (env.PATH.includes('.whitebox')) problems.push('PATH에 실제 앱의 어댑터가 있습니다');
  for (const key of Object.keys(env)) if (/^(CLAUDE|WHITEBOX_PANEL|WHITEBOX_SURFACE|CMUX|ANTHROPIC)/.test(key)) problems.push(`넘어온 변수 ${key}`);
  if (!honorsTestInstance(ctx.target.dir)) problems.push('main.js가 WHITEBOX_TEST_INSTANCE를 지원하지 않습니다');
  if (!(port > 1024)) problems.push('디버그 포트 없음');
  if (problems.length) throw new Error('격리 검사 실패: ' + problems.join('; '));
  return { userData: ctx.userData, home: env.HOME, tmp: env.TMPDIR, port, singleInstanceLock: 'skipped (WHITEBOX_TEST_INSTANCE=1)' };
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

async function launch(batch, ctx) {
  const port = await reservePort();
  const env = isolatedEnv(batch, ctx);
  const isolation = assertIsolation(ctx, env, port);
  const electron = electronBin(ctx.target.dir);
  const out = fs.openSync(path.join(ctx.runDir, 'electron.log'), 'a');
  const child = spawn(electron, [ctx.launcher, `--remote-debugging-port=${port}`, `--user-data-dir=${ctx.userData}`], {
    cwd: ctx.runDir, env, stdio: ['ignore', out, out], detached: false,
  });
  const t = ctx.target;
  fs.writeFileSync(path.join(ctx.runDir, 'isolation.json'), JSON.stringify({
    ...isolation, pid: child.pid, electron, launcher: ctx.launcher, at: stamp(),
    target: { side: t.side, arg: t.arg, kind: t.kind, dir: t.dir, sha: t.sha, dirty: t.dirty, version: t.version },
    claude: batch.claude ? { real: batch.claude.real, version: batch.claude.version } : null,
  }, null, 2));
  return { child, port };
}

async function connect(port, child) {
  let target;
  for (let i = 0; i < 240 && !target; i++) {
    if (child.exitCode != null) throw new Error('Electron이 시작 중에 꺼졌습니다 (electron.log 확인)');
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
      target = list.find(item => item.type === 'page' && /index\.html/.test(item.url || ''));
    } catch {}
    if (!target) await pause(250);
  }
  if (!target) throw new Error('앱 화면(renderer)에 붙지 못했습니다');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let seq = 0; const pending = new Map();
  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('eval: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
    return result.result.value;
  };
  return { evaluate, send, close: () => socket.close() };
}

// ---------------------------------------------------------------- scenario helper API
const RENDERER_HELPERS = `(() => {
  if (window.__repro) return true;
  window.__repro = {
    id: () => window.WhiteboxWorkspace?.getState().activeId || '',
    text: id => { try { return window.WhiteboxTerminal.readTerminal(id || window.__repro.id()) || ''; } catch (e) { return ''; } },
    write: (id, text) => window.whitebox.terminalWrite(id || window.__repro.id(), text, { deliveryId: crypto.randomUUID() }),
  };
  return true;
})()`;

function makeApi(ctx, cdp, shots) {
  const t0 = Date.now();
  const logStream = fs.createWriteStream(ctx.log, { flags: 'a' });
  const toExpr = (fnOrExpr, args) => typeof fnOrExpr === 'function' ? `(${fnOrExpr.toString()})(...${JSON.stringify(args)})` : String(fnOrExpr);
  const ensure = () => cdp.evaluate(RENDERER_HELPERS);
  const ev = async (fnOrExpr, ...args) => { await ensure(); return cdp.evaluate(toExpr(fnOrExpr, args)); };
  const waitFor = async (fnOrExpr, label, timeoutMs = 30000, ...args) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) { try { if (await ev(fnOrExpr, ...args)) return true; } catch {} await pause(250); }
    throw new Error(`시간 초과: ${label}`);
  };
  const page = {
    eval: ev,
    waitFor,
    click: sel => ev(s => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel),
    fill: (sel, text) => ev((s, v) => { const el = document.querySelector(s); if (!el) return false; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); return true; }, sel, text),
    text: sel => ev(s => { const el = document.querySelector(s); return el ? el.textContent : null; }, sel),
    visible: sel => ev(s => { const el = document.querySelector(s); return Boolean(el && el.getClientRects().length > 0 && !el.closest('[hidden]')); }, sel),
    shot: async name => {
      try {
        const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(ctx.runDir, 'shots', `${String(name).replace(/[^\w.-]+/g, '_')}.png`);
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        shots.push(file);
        return file;
      } catch (e) { return 'shot-failed: ' + e.message; }
    },
  };
  const api = {
    side: ctx.target.side, run: ctx.runNo, version: ctx.target.version, runDir: ctx.runDir,
    sleep: pause,
    log: entry => logStream.write(JSON.stringify({ at: stamp(), s: Math.round((Date.now() - t0) / 1000), ...entry }) + '\n'),
    activeId: () => ev('window.__repro.id()'),
    terminalText: id => ev((i) => window.__repro.text(i), id || ''),
    type: (id, text) => ev((i, t) => window.__repro.write(i, t).then(() => true), id, text),
    enter: id => ev(i => window.__repro.write(i, '\r').then(() => true), id),
    newShell: async () => {
      const before = await ev('window.__repro.id()');
      await ev('window.WhiteboxWorkspace.createTerminal().then(() => true)');
      await waitFor(b => window.__repro.id() && window.__repro.id() !== b, '새 터미널', 30000, before);
      const id = await ev('window.__repro.id()');
      await waitFor(i => window.__repro.text(i).trim().length > 0, '셸 프롬프트', 30000, id);
      await pause(800);
      api.log({ ev: 'new-shell', id });
      return id;
    },
    newClaude: async ({ model = 'haiku', args = '' } = {}) => {
      if (!ctx.claudeAllowed) throw new Error('이 시나리오는 needsClaude: false 라서 claude를 켤 수 없습니다');
      const id = await api.newShell();
      const command = `claude --model ${model}${args ? ' ' + args : ''}`;
      await api.type(id, command + '\r');
      api.log({ ev: 'claude-launch', id, command });
      await waitFor(i => /\? for shortcuts|bypass permissions|for shortcuts|Try "/i.test(window.__repro.text(i)), 'Claude 입력칸', 90000, id);
      return id;
    },
    close: () => logStream.end(),
  };
  return { page, api };
}

// ---------------------------------------------------------------- process cleanup 
function psRows() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return out.split('\n').map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(m => ({ pid: +m[1], ppid: +m[2], cmd: m[3] }));
}
function cwdMap() {
  const map = new Map();
  let out = '';
  try { out = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-d', 'cwd', '-u', String(UID), '-Fpn'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { out = e.stdout || ''; }
  let pid = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid) map.set(pid, line.slice(1));
  }
  return map;
}
function protectedPids(rows) {
  // This runner and its ancestors (the Claude session, the live app's terminal) are never touched.
  const by = new Map(rows.map(r => [r.pid, r]));
  const out = new Set([process.pid]);
  let cur = by.get(process.ppid); out.add(process.ppid);
  for (let i = 0; cur && i < 50; i++) { out.add(cur.pid); cur = by.get(cur.ppid); }
  return out;
}
const under = (p, dir) => p === dir || p.startsWith(dir + '/');
function namesRun(cmd, ctx) {
  return [ctx.runDir, ctx.shortTmp].some(d => cmd.includes(d + '/') || cmd.includes(d + ' ') || cmd.endsWith(d));
}
function runProcesses(ctx, extraRoots = []) {
  const rows = psRows();
  const cwd = cwdMap();
  const guard = protectedPids(rows);
  const children = new Map();
  for (const r of rows) { if (!children.has(r.ppid)) children.set(r.ppid, []); children.get(r.ppid).push(r.pid); }
  const alive = new Set(rows.map(r => r.pid));
  const roots = new Set(extraRoots.filter(p => p && alive.has(p)));
  for (const r of rows) {
    if (guard.has(r.pid)) continue;
    const c = cwd.get(r.pid) || '';
    if (namesRun(r.cmd, ctx) || under(c, ctx.runDir) || under(c, ctx.shortTmp)) roots.add(r.pid);
  }
  const all = new Set();
  const walk = pid => { if (all.has(pid)) return; all.add(pid); for (const ch of children.get(pid) || []) walk(ch); };
  roots.forEach(walk);
  const by = new Map(rows.map(r => [r.pid, r]));
  const kill = [], spared = [];
  for (const pid of all) {
    if (guard.has(pid)) continue;
    const c = cwd.get(pid) || '';
    // Never anything that works in the real profile (the live app's Terminal Host).
    if (under(c, LIVE_PROFILE)) { spared.push(pid); continue; }
    kill.push({ pid, cmd: (by.get(pid)?.cmd || '').slice(0, 90), cwd: c });
  }
  return { kill, spared };
}
async function cleanupRun(ctx, electronPid) {
  const killed = new Set();
  for (const round of [0, 1]) {
    const { kill } = runProcesses(ctx, round === 0 ? [electronPid] : []);
    for (const p of kill) { try { process.kill(p.pid, 'SIGTERM'); killed.add(p.pid); } catch {} }
    await pause(round === 0 ? 3000 : 1500);
  }
  let left = runProcesses(ctx).kill;
  for (const p of left) { try { process.kill(p.pid, 'SIGKILL'); killed.add(p.pid); } catch {} }
  if (left.length) await pause(1500);
  left = runProcesses(ctx);
  return { killed: killed.size, leftovers: left.kill.map(p => `${p.pid} ${p.cmd}`), spared: left.spared };
}

// ---------------------------------------------------------------- run counting
function countPrompts(home) {
  let prompts = 0;
  const projects = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(projects)) return 0;
  for (const p of fs.readdirSync(projects)) for (const f of fs.readdirSync(path.join(projects, p))) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(projects, p, f), 'utf8').split('\n')) {
      if (!line) continue;
      try { const e = JSON.parse(line); if (e.type === 'user' && !e.isMeta && typeof e.message?.content === 'string' && !e.message.content.startsWith('<')) prompts++; } catch {}
    }
  }
  return prompts;
}
function countAnalysis(userData) {
  try { return (fs.readFileSync(path.join(userData, 'terminal-reviews.json'), 'utf8').match(/"analysisUsage":\{"input":[1-9]/g) || []).length; } catch { return 0; }
}
function trimRun(ctx) {
  // Keep timeline, result, isolation, electron.log, shots, Claude transcripts. Drop the heavy profile.
  const projects = path.join(ctx.home, '.claude', 'projects');
  if (fs.existsSync(projects)) fs.cpSync(projects, path.join(ctx.runDir, 'claude-transcripts'), { recursive: true });
  try { fs.unlinkSync(path.join(ctx.home, 'Library', 'Keychains')); } catch {}
  for (const d of [ctx.home, path.join(ctx.runDir, 'profile'), ctx.launcher]) fs.rmSync(d, { recursive: true, force: true });
}
function removeShortTmp(ctx) { try { fs.rmSync(ctx.shortTmp, { recursive: true, force: true }); } catch {} }

// ---------------------------------------------------------------- one run
async function runOnce(batch, sc, target, runNo, keep) {
  const ctx = prepareRun(batch, target, runNo);
  ctx.claudeAllowed = Boolean(batch.claude);
  const shots = [];
  const t0 = Date.now();
  let result = { symptom: null, note: '' }, child = null, cdp = null, api = null;
  state.current = { ctx, child: null };
  try {
    const launched = await launch(batch, ctx);
    child = launched.child; state.current.child = child;
    cdp = await connect(launched.port, child);
    await cdp.send('Page.enable').catch(() => {});
    const made = makeApi(ctx, cdp, shots);
    api = made.api;
    await made.page.waitFor('Boolean(window.WhiteboxWorkspace && window.WhiteboxTerminal)', '앱 준비', 60000);
    await pause(1500);
    const limit = (sc.timeoutSec || 300) * 1000;
    let timer;
    const out = await Promise.race([
      sc.steps(made.page, api),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`시나리오 시간 초과 (${limit / 1000}초)`)), limit); }),
    ]).finally(() => clearTimeout(timer));
    if (!out || ![true, false, null].includes(out.symptom)) result = { symptom: null, note: `시나리오가 symptom을 true/false/null로 돌려주지 않았습니다: ${JSON.stringify(out)}`.slice(0, 300) };
    else result = { ...out, note: out.note || '' };
  } catch (error) {
    result = { symptom: null, error: true, note: `하네스 오류: ${error.message || error}` };
    try { if (cdp) shots.push(await (async () => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); const f = path.join(ctx.runDir, 'shots', 'error.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f; })()); } catch {}
  }
  result.seconds = Math.round((Date.now() - t0) / 1000);
  try { api?.log({ ev: 'result', result }); api?.close(); } catch {}
  try { cdp?.close(); } catch {}
  try { child?.kill('SIGTERM'); } catch {}
  await pause(2000);
  const cleanup = await cleanupRun(ctx, child?.pid);
  state.current = null;
  const verdict = result.symptom === true ? 'Y' : result.symptom === false ? 'N' : '?';
  const record = {
    side: target.side, run: runNo, verdict, symptom: result.symptom, note: result.note, seconds: result.seconds,
    target: { arg: target.arg, kind: target.kind, sha: target.sha, dirty: target.dirty, version: target.version },
    prompts: countPrompts(ctx.home), analysisCalls: countAnalysis(ctx.userData),
    shots, cleanup, runDir: ctx.runDir, extra: Object.fromEntries(Object.entries(result).filter(([k]) => !['symptom', 'note', 'seconds'].includes(k))),
  };
  fs.writeFileSync(path.join(ctx.runDir, 'result.json'), JSON.stringify(record, null, 2));
  if (cleanup.leftovers.length || cleanup.spared.length) {
    const err = new Error(`정리 실패: 시험 프로세스가 남았습니다 → ${[...cleanup.leftovers, ...cleanup.spared.map(p => `${p} (실제 프로필 폴더에서 돌아서 건드리지 않음)`)].join(' | ')}`);
    err.fatal = true; err.record = record;
    throw err;
  }
  removeShortTmp(ctx);
  if (!keep) trimRun(ctx);
  return record;
}

// ---------------------------------------------------------------- verdict
function decide(rows) {
  const count = side => {
    const r = rows.filter(x => x.side === side);
    return { Y: r.filter(x => x.verdict === 'Y').length, N: r.filter(x => x.verdict === 'N').length, U: r.filter(x => x.verdict === '?').length };
  };
  const b = count('before'), a = count('after');
  let verdict, why;
  if (a.Y >= 1) { verdict = '안 고쳐짐'; why = '고친 쪽(after)에서도 증상이 보였습니다.'; }
  else if (b.Y + b.N >= 1 && b.Y === 0) { verdict = '재현 못 함'; why = '고치기 전(before)에서도 증상이 한 번도 안 보였습니다. 시나리오가 증상을 못 일으킨 것이니, 고쳤는지는 이걸로 알 수 없습니다.'; }
  else if (b.Y >= 1 && a.N >= 1) { verdict = '고쳐짐'; why = '고치기 전에는 증상이 보였고, 고친 뒤에는 한 번도 안 보였습니다.'; }
  else { verdict = '판정 불가'; why = '판정할 수 있는 실행이 모자랍니다 (오류·시간 초과).'; }
  return { before: b, after: a, verdict, why };
}

function printTable(sc, targets, rows, d, batchDir) {
  const lab = t => `${t.arg}${t.kind === 'dir' ? ' (폴더)' : ''}${t.arg === 'v' + t.version ? '' : ' · v' + t.version}${t.sha ? ' · ' + t.sha.slice(0, 7) : ''}${t.dirty ? ' · 커밋 안 한 변경 있음' : ''}`;
  const lines = [];
  lines.push('');
  lines.push(`판정표 · ${sc.name}`);
  lines.push(`증상: ${sc.symptom}`);
  lines.push('');
  lines.push('          증상 있음(Y) | 증상 없음(N) | 판정 불가 | 코드');
  for (const side of ['before', 'after']) {
    const c = d[side];
    lines.push(`${side.padEnd(8)} ${String(c.Y).padStart(6)}       | ${String(c.N).padStart(6)}       | ${String(c.U).padStart(5)}     | ${lab(targets[side])}`);
  }
  lines.push('');
  lines.push(`결론: ${d.verdict}`);
  lines.push(`  ${d.why}`);
  lines.push('');
  lines.push('실행별:');
  for (const r of rows) lines.push(`  ${r.side}-r${pad(r.run)}  ${r.verdict}  ${String(r.seconds).padStart(3)}초  프롬프트 ${r.prompts} · 앱 분석 ${r.analysisCalls}  ${r.note}`);
  lines.push('');
  lines.push('화면 사진:');
  for (const r of rows) for (const s of r.shots) lines.push(`  ${s}`);
  lines.push('');
  lines.push(`기록 폴더: ${batchDir}`);
  const text = lines.join('\n');
  console.log(text);
  fs.writeFileSync(path.join(batchDir, 'verdict.txt'), text + '\n');
}

// ---------------------------------------------------------------- main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sc = loadScenario(opts.scenario);
  if (!fs.existsSync(path.join(REPO, '.git'))) usage(`Whitebox 저장소가 없습니다: ${REPO} (WHITEBOX_REPO 로 바꿀 수 있음)`);
  const now = new Date();
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const batchDir = path.join(HERE, 'runs', `${ts}-${sc.name.replace(/[^\w-]+/g, '_')}`);
  fs.mkdirSync(batchDir, { recursive: true });
  state.batchDir = batchDir;
  const wtBase = path.join(os.tmpdir(), 'whitebox-repro', ts);
  state.wtBase = wtBase;
  const batch = { dir: batchDir, short: ts.slice(9), claude: null };

  console.log(`시나리오: ${sc.name} · ${sc.needsClaude ? '실제 Claude(Haiku) 사용' : 'AI 안 씀'} · 쪽마다 ${opts.runs}번`);
  console.log(`불만: ${sc.complaint}`);
  console.log(`증상: ${sc.symptom}`);
  const targets = {};
  targets.before = prepareSide('before', opts.before, wtBase, batchDir);
  targets.after = prepareSide('after', opts.after, wtBase, batchDir);
  if (sc.needsClaude) batch.claude = resolveClaude(batchDir);
  fs.writeFileSync(path.join(batchDir, 'batch.json'), JSON.stringify({ scenario: opts.scenario, name: sc.name, complaint: sc.complaint, symptom: sc.symptom, runs: opts.runs, targets, claude: batch.claude, startedAt: stamp() }, null, 2));

  const rows = [];
  for (let n = 1; n <= opts.runs; n++) {
    for (const side of ['before', 'after']) {
      process.stdout.write(`실행: ${side} ${n}/${opts.runs} … `);
      const r = await runOnce(batch, sc, targets[side], n, opts.keep);
      rows.push(r);
      console.log(`${r.verdict} (${r.seconds}초) ${r.note}`);
    }
  }
  removeWorktrees();
  const d = decide(rows);
  fs.writeFileSync(path.join(batchDir, 'summary.json'), JSON.stringify({ name: sc.name, verdict: d, rows, finishedAt: stamp() }, null, 2));
  printTable(sc, targets, rows, d, batchDir);
}

async function emergency(reason) {
  if (state.cleaning) return;
  state.cleaning = true;
  console.error(`\n중단: ${reason} — 이번 실행의 프로세스와 임시 워크트리를 정리합니다`);
  if (state.current) { try { state.current.child?.kill('SIGTERM'); } catch {} try { const c = await cleanupRun(state.current.ctx, state.current.child?.pid); if (c.leftovers.length) console.error('남은 프로세스:', c.leftovers.join(' | ')); removeShortTmp(state.current.ctx); } catch {} }
  removeWorktrees();
}
process.on('SIGINT', () => emergency('Ctrl-C').then(() => process.exit(130)));
process.on('SIGTERM', () => emergency('SIGTERM').then(() => process.exit(143)));

main().catch(async error => {
  console.error(`\n오류: ${error.message || error}`);
  await emergency('오류');
  if (state.batchDir) console.error(`기록 폴더: ${state.batchDir}`);
  console.error('결론: 판정 불가');
  process.exit(1);
});
