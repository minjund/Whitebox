'use strict';
// cmux-style terminal control. No model configuration or prompt hooks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');
const COMMANDS = new Set(['identify', 'list-panels', 'read-screen', 'send', 'send-key', 'ask', 'wait']);
function directory(env = process.env) {
  if (env.WHITEBOX_PANEL_DIRECTORY) return env.WHITEBOX_PANEL_DIRECTORY;
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support') : process.platform === 'win32' ? env.APPDATA : env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'Whitebox', 'terminal-collaboration');
}
function ancestors() {
  const text = process.platform === 'win32'
    ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "{0} {1}" -f $_.ProcessId,$_.ParentProcessId }'], { encoding: 'utf8', timeout: 5000 })
    : execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000 });
  const parents = new Map(text.trim().split('\n').map(line => line.trim().split(/\s+/u).map(Number)));
  const pids = []; let pid = process.pid;
  while (pid > 1 && !pids.includes(pid) && pids.length < 64) { pids.push(pid); pid = parents.get(pid); }
  return pids;
}
function request(method, params = {}, options = {}) {
  const discovery = JSON.parse(fs.readFileSync(path.join(options.directory || directory(), 'control.json'), 'utf8'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(discovery.endpoint); let buffer = '', settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : resolve(result); };
    socket.setEncoding('utf8'); socket.setTimeout(10000, () => finish(new Error('Whitebox panel control timed out')));
    socket.on('error', error => finish(error));
    socket.on('close', () => { if (!settled) finish(new Error('Whitebox panel control disconnected')); });
    socket.on('connect', () => socket.write(JSON.stringify({ id: 'cli', token: discovery.token, method, params }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return finish(new Error('Panel response too large'));
      if (!buffer.includes('\n')) return;
      try { const frame = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))); finish(frame.ok ? null : new Error(frame.error || 'Panel command failed'), frame.result); }
      catch (error) { finish(error); }
    });
  });
}
async function main(argv, options = {}) {
  const args = [...argv], op = args.shift(), params = {};
  let json = false;
  for (let i = 0; i < args.length;) {
    if (args[i] === '--') { args.splice(i, 1); break; }
    if (args[i] === '--json') { json = true; args.splice(i, 1); }
    else if (['--surface', '--panel', '--source', '--lines'].includes(args[i])) {
      const key = args[i] === '--source' ? 'sourceId' : args[i] === '--lines' ? 'lines' : 'surface_id';
      if (!args[i + 1]) throw new Error(`Missing ${args[i]} value`);
      params[key] = args[i + 1]; args.splice(i, 2);
    } else i++;
  }
  params.sourceId ||= process.env.WHITEBOX_SURFACE_ID;
  // Existing PTYs created before identity env support use the real caller ancestry.
  if (!params.sourceId) params.ancestorPids = ancestors();
  const methods = { identify: 'system.identify', 'list-panels': 'surface.list', 'read-screen': 'surface.read_text', send: 'surface.send_text', 'send-key': 'surface.send_key', ask: 'surface.ask', wait: 'job.read' };
  if (!methods[op]) throw new Error('Unknown panel command');
  if (op === 'ask') { params.surface_id ||= args.shift(); params.text = args.join(' '); }
  if (op === 'send') params.text = args.join(' ');
  if (op === 'send-key') params.key = args[0];
  if (op === 'wait') params.jobId = args[0];
  const deadline = Date.now() + (op === 'wait' ? Math.max(0, Math.min(60, Number(args[1]) || 0)) * 1000 : 0);
  let result;
  do {
    result = await request(methods[op], params, options);
    if (op !== 'wait' || !['queued', 'sending', 'running'].includes(result.state) || Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 400));
  } while (true);
  if (['failed', 'interrupted'].includes(result.state)) throw new Error(`${result.error || result.state} (job ${result.id})`);
  return !json && op === 'read-screen' ? result.text : result;
}
module.exports = { COMMANDS, main, request, directory };
