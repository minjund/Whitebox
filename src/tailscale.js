'use strict';
// Reads the local Tailscale state through its CLI. The phone page listens only
// on this computer's Tailscale address and lets in only devices signed in as
// the same Tailscale user (tailscale whois), so no pairing step is needed.
const fs = require('fs');
const { execFile } = require('child_process');

const CANDIDATES = {
  darwin: ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale'],
  win32: [`${process.env.ProgramFiles || 'C:\\Program Files'}\\Tailscale\\tailscale.exe`, `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Tailscale\\tailscale.exe`],
  linux: ['/usr/bin/tailscale', '/usr/local/bin/tailscale']
};

function findCli({ platform = process.platform, exists = fs.existsSync } = {}) {
  return (CANDIDATES[platform] || []).find(file => exists(file)) || '';
}

// state: 'missing' (not installed), 'stopped' (installed, not running or
// signed out), 'running'.
function parseStatus(json) {
  const status = typeof json === 'string' ? JSON.parse(json) : json;
  if (!status || status.BackendState !== 'Running' || !status.Self) return { state: 'stopped', backend: status?.BackendState || '' };
  const ipv4 = (status.Self.TailscaleIPs || []).find(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) || '';
  const dnsName = String(status.Self.DNSName || '').replace(/\.$/, '');
  return {
    state: ipv4 ? 'running' : 'stopped',
    ip: ipv4,
    dnsName: status.CurrentTailnet?.MagicDNSEnabled === false ? '' : dnsName,
    shortName: dnsName.split('.')[0] || '',
    userId: status.Self.UserID == null ? '' : String(status.Self.UserID)
  };
}

function parseWhois(json) {
  const who = typeof json === 'string' ? JSON.parse(json) : json;
  return {
    userId: who?.UserProfile?.ID == null ? '' : String(who.UserProfile.ID),
    device: String(who?.Node?.ComputedName || who?.Node?.Hostinfo?.Hostname || who?.Node?.Name || '').replace(/\.$/, '').split('.')[0],
    os: String(who?.Node?.Hostinfo?.OS || '')
  };
}

class Tailscale {
  constructor({ platform = process.platform, exists = fs.existsSync, run = execFile, whoisTtlMs = 60000, now = Date.now } = {}) {
    this.platform = platform;
    this.exists = exists;
    this.run = run;
    this.whoisTtlMs = whoisTtlMs;
    this.now = now;
    this.cache = new Map();
  }
  cli() { return findCli({ platform: this.platform, exists: this.exists }); }
  call(args) {
    const cli = this.cli();
    if (!cli) return Promise.reject(Object.assign(new Error('Tailscale is not installed'), { code: 'TAILSCALE_MISSING' }));
    return new Promise((resolve, reject) => {
      // The Mac app's binary is also its CLI, but without a terminal in the
      // environment (an app opened from Finder) it tries to start the GUI
      // and fails; TAILSCALE_BE_CLI makes it act as the CLI.
      this.run(cli, args, { timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, TAILSCALE_BE_CLI: '1' } }, (error, stdout) => {
        if (error) reject(error); else resolve(String(stdout));
      });
    });
  }
  async status() {
    if (!this.cli()) return { state: 'missing' };
    try { return parseStatus(await this.call(['status', '--json'])); }
    catch { return { state: 'stopped' }; }
  }
  // Who is behind a Tailscale address. Cached briefly; failures are not cached.
  async whois(ip) {
    const hit = this.cache.get(ip);
    if (hit && this.now() - hit.at < this.whoisTtlMs) return hit.value;
    const value = parseWhois(await this.call(['whois', '--json', ip]));
    this.cache.set(ip, { at: this.now(), value });
    return value;
  }
}

module.exports = { Tailscale, findCli, parseStatus, parseWhois };
