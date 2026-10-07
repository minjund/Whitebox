#!/usr/bin/env node
'use strict';

// Copied beside a group's private mailbox so it also works outside app.asar.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
function run(directory, senderId, operation, args = []) {
  const roster = JSON.parse(fs.readFileSync(path.join(directory, 'members.json'), 'utf8'));
  if (!roster.members.some(member => member.id === senderId)) throw new Error('This AI is no longer a member of the group.');
  if (operation === 'startup') {
    const document = JSON.parse(fs.readFileSync(path.join(directory, `${senderId}.startup.json`), 'utf8'));
    if (document.groupId !== roster.groupId || document.panelId !== roster.members.find(member => member.id === senderId).panelId) throw new Error('Startup identity changed.');
    return document;
  }
  if (operation === 'self') return { groupId: roster.groupId, name: roster.name, ...roster.members.find(member => member.id === senderId) };
  if (operation === 'members') return { ...roster, selfId: senderId };
  if (operation === 'send') {
    const [recipientId, ...words] = args;
    if (!roster.members.some(member => member.id === recipientId)) throw new Error('Recipient is not a member of this group.');
    const text = words.join(' ').trim();
    if (!text || text.length > 65536) throw new Error('Message must contain 1–65536 characters.');
    const message = { id: randomUUID(), senderId, recipientId, sentAt: new Date().toISOString(), text };
    const inbox = path.join(directory, recipientId);
    fs.mkdirSync(inbox, { recursive: true, mode: 0o700 });
    const temporary = path.join(inbox, `${message.id}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(message), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, path.join(inbox, `${message.id}.json`));
    return { ok: true, messageId: message.id };
  }
  if (operation === 'inbox') {
    const inbox = path.join(directory, senderId);
    if (!fs.existsSync(inbox)) return [];
    const messages = [];
    for (const file of fs.readdirSync(inbox).filter(file => /^[a-f0-9-]+\.json$/.test(file)).sort()) {
      const source = path.join(inbox, file);
      messages.push(JSON.parse(fs.readFileSync(source, 'utf8')));
      fs.unlinkSync(source);
    }
    return messages;
  }
  throw new Error('Use self, members, send <recipientId> <message>, or inbox.');
}
if (require.main === module) {
  try {
    const [senderId, operation, ...args] = process.argv.slice(2);
    process.stdout.write(`${JSON.stringify(run(__dirname, senderId, operation, args))}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { run };
