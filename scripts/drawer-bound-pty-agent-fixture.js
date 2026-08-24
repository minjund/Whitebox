'use strict';

const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const launchArguments = process.argv.slice(2);
const launchArgumentsHash = crypto.createHash('sha256')
  .update(JSON.stringify(launchArguments), 'utf8')
  .digest('hex')
  .slice(0, 24);

process.stdout.write('WHITEBOX_DRAWER_BOUND_PTY_READY\r\n');
process.stdout.write(`WHITEBOX_DRAWER_BOUND_PTY_ARGV_${launchArgumentsHash}\r\n`);

rl.on('line', line => {
  const command = String(line || '').trim();
  if (!command.startsWith('LTA_DRAWER_ECHO:')) {
    process.stdout.write(`UNEXPECTED_DRAWER_COMMAND:${command}\r\n`);
    return;
  }
  const encoded = command.slice('LTA_DRAWER_ECHO:'.length);
  try {
    process.stdout.write(`${Buffer.from(encoded, 'base64url').toString('utf8')}\r\n`);
  } catch (_invalidPayload) {
    process.stdout.write('INVALID_DRAWER_MARKER\r\n');
  }
});

const finish = () => {
  rl.close();
  process.exit(0);
};

process.on('SIGTERM', finish);
process.on('SIGHUP', finish);
