#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { main: control } = require('./panel-control');
const marker = '# Whitebox panel provider adapter';
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
function install({ directory, runtime = process.execPath, script = __filename, platform = process.platform }) {
  // POSIX adapters affect only Whitebox sessions; all other calls pass through.
  // Windows keeps its existing executable resolution until a native adapter is available.
  if (platform === 'win32') return [];
  fs.mkdirSync(directory, { recursive: true });
  return ['claude', 'codex'].map(provider => {
    const file = path.join(directory, provider);
    if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(marker)) throw new Error(`Cannot replace an unmanaged provider launcher: ${file}`);
    const text = `#!/bin/sh\n${marker}\nELECTRON_RUN_AS_NODE=1 exec ${quote(runtime)} ${quote(script)} ${provider} "$@"\n`;
    fs.writeFileSync(file, text, { mode: 0o755 }); fs.chmodSync(file, 0o755); return file;
  });
}
// Login shells may reorder PATH in user startup files. Set the app-owned path
// after their normal initialization, before accepting the first user command.
function workspaceOptions(options, directory, platform = process.platform) {
  if (platform === 'win32' || options.type !== 'shell' || !String(options.creationId || '').startsWith('workspace:') || options.initialCommand) return options;
  return { ...options, initialCommand: ` export PATH=${quote(directory)}:"$PATH"; export TERM_PROGRAM=Whitebox; clear` };
}
async function createWorkspaceTerminal(manager, options, directory) {
  const prepared = workspaceOptions(options, directory);
  const session = await manager.create(prepared);
  if (prepared !== options && !session.creationUnavailable) {
    const id = require('crypto').createHash('sha256').update(String(options.creationId)).digest('hex');
    const result = await manager.command(session.id, prepared.initialCommand, { deliveryId: `panel-init:${id}` });
    if (result?.ok === false || result?.deliveryState === 'unknown') throw new Error('Whitebox terminal initialization could not be confirmed. The existing session was preserved.');
  }
  return session;
}
function resolveProvider(provider, env = process.env, directory = path.join(require('os').homedir(), '.whitebox/bin')) {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir || path.resolve(dir) === path.resolve(directory)) continue;
    const candidate = path.join(dir, provider);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const fd = fs.openSync(candidate, 'r'), bytes = Buffer.alloc(300);
      let contents;
      try { contents = bytes.subarray(0, fs.readSync(fd, bytes, 0, bytes.length, 0)).toString(); } finally { fs.closeSync(fd); }
      if (contents.includes(marker)) continue;
      return candidate;
    } catch { /* Try the next actual provider installation. */ }
  }
  throw new Error(`${provider} executable was not found outside the Whitebox adapter directory`);
}
function providerArgs(provider, args, server) {
  // Utilities, nested providers and one-shot calls are not interactive panel peers.
  const utility = args.some(arg => ['--help', '-h', '--version', '-v', '-p', '--print'].includes(arg))
    || args.some(arg => ['exec', 'e', 'review', 'mcp', 'plugin', 'plugins', 'login', 'logout', 'app', 'app-server', 'agents', 'update', 'doctor', 'completion'].includes(arg));
  if (utility) return args;
  if (provider === 'claude') {
    const config = JSON.stringify({ mcpServers: { whitebox_panel: { type: 'stdio', ...server } } });
    const result = [...args], existing = result.indexOf('--mcp-config');
    if (existing >= 0) result.splice(existing + 1, 0, config);
    else { const separator = result.indexOf('--'); result.splice(separator < 0 ? result.length : separator, 0, '--mcp-config', config); }
    return result;
  }
  const prefix = 'mcp_servers.whitebox_panel';
  return ['-c', `${prefix}.command=${JSON.stringify(server.command)}`, '-c', `${prefix}.args=${JSON.stringify(server.args)}`, '-c', `${prefix}.env=${'{'}${Object.entries(server.env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(',')}${'}'}`, ...args];
}
async function main(provider, args, options = {}) {
  if (!['claude', 'codex'].includes(provider)) throw new Error('Unsupported provider');
  const env = { ...process.env, ...options.env };
  const executable = resolveProvider(provider, env, options.directory);
  let launchArgs = args;
  if (!env.WHITEBOX_PANEL_BRIDGE_ACTIVE) {
    try {
      const identity = await (options.control || control)(['identify']);
      env.WHITEBOX_SURFACE_ID = identity.surface_id;
      env.WHITEBOX_PANEL_BRIDGE_ACTIVE = '1';
      launchArgs = providerArgs(provider, args, { command: process.execPath, args: [path.join(__dirname, 'panel-mcp.js')], env: { ELECTRON_RUN_AS_NODE: '1', WHITEBOX_SURFACE_ID: identity.surface_id, WHITEBOX_PANEL_DIRECTORY: require('./panel-control').directory(env) } });
    } catch { /* Outside a live Whitebox panel: preserve the original CLI behavior. */ }
  }
  delete env.ELECTRON_RUN_AS_NODE; delete env.WHITEBOX_SOURCE_LAUNCHER;
  const child = (options.spawn || spawn)(executable, launchArgs, { stdio: 'inherit', env });
  for (const signal of ['SIGTERM', 'SIGHUP']) process.once(signal, () => child.kill(signal));
  child.once('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 128 : 1); });
  return child;
}
if (require.main === module) main(process.argv[2], process.argv.slice(3)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { install, workspaceOptions, createWorkspaceTerminal, resolveProvider, providerArgs, main };
