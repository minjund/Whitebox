'use strict';

// Installs the Whitebox terminal guard (bin/terminal-guard-hook.js) for Codex.
// Codex only runs reviewed hooks from hooks.json/config.toml; hooks passed as
// `-c` session flags are ignored, so the guard is registered globally and the
// script itself is a no-op unless WHITEBOX_SURFACE_ID marks a Whitebox PTY.
// Claude receives the same script per session through `--settings`
// (bin/panel-provider.js), so its global settings are not modified.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { atomicWriteWithBackup, enableCodexHooksFeature } = require('./attentionHookInstaller');

const GUARD_MARKER = '--whitebox-terminal-guard';
const GUARD_TIMEOUT_SECONDS = 30;
const GUARD_EVENTS = Object.freeze([
  ['PreToolUse', 'pre_tool_use'],
  ['SessionStart', 'session_start'],
  ['UserPromptSubmit', 'user_prompt_submit'],
]);

function guardScriptPath() {
  const source = path.resolve(__dirname, '..', 'bin', 'terminal-guard-hook.js');
  return source.replace(/([\\/])app\.asar([\\/])/iu, '$1app.asar.unpacked$2');
}

const posixQuote = value => `'${String(value).replace(/'/gu, `'"'"'`)}'`;

function guardCommand(options = {}) {
  const nodeExecutable = path.resolve(options.nodeExecutable || process.execPath);
  const scriptPath = path.resolve(options.scriptPath || guardScriptPath());
  return ['ELECTRON_RUN_AS_NODE=1', posixQuote(nodeExecutable), posixQuote(scriptPath), GUARD_MARKER].join(' ');
}

function isGuardHandler(handler) {
  return Boolean(handler && typeof handler === 'object' && typeof handler.command === 'string' && handler.command.includes(GUARD_MARKER));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// Same identity Codex hashes when it reviews a hook (see codexPermissionHookHash).
function guardHookHash(eventName, handler) {
  const identity = { event_name: eventName, hooks: [{ type: 'command', command: handler.command, timeout: handler.timeout, async: false }] };
  return `sha256:${crypto.createHash('sha256').update(stableJson(identity), 'utf8').digest('hex')}`;
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error?.code === 'ENOENT') return ''; throw error; }
}

// Keeps existing group positions: other tools' trust keys include the group index.
function upsertGuardGroups(config, handler) {
  if (config.hooks === undefined) config.hooks = {};
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw new Error('Codex hooks.json has a non-object hooks field');
  const positions = [];
  for (const [eventName, stateName] of GUARD_EVENTS) {
    if (config.hooks[eventName] === undefined) config.hooks[eventName] = [];
    const groups = config.hooks[eventName];
    if (!Array.isArray(groups)) throw new Error(`Codex hooks.json ${eventName} is not an array`);
    let groupIndex = groups.findIndex(group => Array.isArray(group?.hooks) && group.hooks.some(isGuardHandler));
    if (groupIndex < 0) { groups.push({ hooks: [{ ...handler }] }); groupIndex = groups.length - 1; }
    const hooks = groups[groupIndex].hooks;
    const handlerIndex = hooks.findIndex(isGuardHandler);
    hooks[handlerIndex] = { ...handler };
    // Remove duplicates left by older builds without moving the kept group.
    for (let index = hooks.length - 1; index > handlerIndex; index -= 1) if (isGuardHandler(hooks[index])) hooks.splice(index, 1);
    positions.push({ stateName, groupIndex, handlerIndex });
  }
  return positions;
}

function setTrustedHash(source, key, hash) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source ? source.split(/\r?\n/u) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const header = `[hooks.state.${JSON.stringify(key)}]`;
  const trusted = `trusted_hash = ${JSON.stringify(hash)}`;
  const start = lines.findIndex(line => line.trim() === header);
  if (start < 0) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(header, trusted);
  } else {
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) if (/^\s*\[/u.test(lines[index])) { end = index; break; }
    const assignment = lines.slice(start + 1, end).findIndex(line => /^\s*trusted_hash\s*=/u.test(line));
    if (assignment >= 0) lines[start + 1 + assignment] = trusted; else lines.splice(start + 1, 0, trusted);
  }
  return `${lines.join(eol)}${eol}`;
}

function installCodexTerminalGuard(options = {}) {
  const platform = options.platform || process.platform;
  // The POSIX command form matches the provider adapter, which is POSIX-only.
  if (platform === 'win32') return { installed: false, reason: 'unsupported-platform' };
  const codexHome = options.codexHome || process.env.CODEX_HOME || path.join(options.home || os.homedir(), '.codex');
  const hooksPath = path.resolve(options.hooksPath || path.join(codexHome, 'hooks.json'));
  const configPath = path.resolve(options.configPath || path.join(codexHome, 'config.toml'));
  const hooksSource = readText(hooksPath);
  let config;
  try { config = hooksSource.trim() ? JSON.parse(hooksSource) : {}; } catch { return { installed: false, reason: 'invalid-hooks-json' }; }
  const handler = { type: 'command', command: guardCommand(options), timeout: GUARD_TIMEOUT_SECONDS };
  const positions = upsertGuardGroups(config, handler);
  const nextHooks = `${JSON.stringify(config, null, 2)}\n`;
  const configSource = readText(configPath);
  let nextConfig = enableCodexHooksFeature(configSource).source;
  for (const position of positions) {
    const key = `${hooksPath}:${position.stateName}:${position.groupIndex}:${position.handlerIndex}`;
    nextConfig = setTrustedHash(nextConfig, key, guardHookHash(position.stateName, handler));
  }
  const write = options.write || atomicWriteWithBackup;
  // hooks.json first: a trust entry without its hook is inert, the reverse is not.
  const hooks = nextHooks === hooksSource ? { changed: false } : write(hooksPath, nextHooks, hooksSource);
  const toml = nextConfig === configSource ? { changed: false } : write(configPath, nextConfig, configSource);
  return { installed: true, changed: Boolean(hooks.changed || toml.changed), hooksPath, configPath, positions };
}

module.exports = { GUARD_EVENTS, GUARD_MARKER, guardCommand, guardHookHash, guardScriptPath, installCodexTerminalGuard, isGuardHandler, setTrustedHash, upsertGuardGroups };
