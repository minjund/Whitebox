'use strict';

const fs = require('fs');
const path = require('path');
class GroupMailbox {
  constructor(storeFile) { this.root = storeFile ? `${storeFile}.mailboxes` : ''; }
  memberId(member) { return member.creationId.replace(/^group:/, '').replace(/[^a-zA-Z0-9_-]/g, '_'); }
  directory(group) { return path.join(this.root, group.id); }
  sync(group) {
    if (!this.root) return;
    const directory = this.directory(group);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(__dirname, '../bin/group-message.js'), path.join(directory, 'group-message.cjs'));
    const members = group.members.map(member => ({ id: this.memberId(member), provider: member.provider }));
    const temporary = path.join(directory, 'members.tmp');
    fs.writeFileSync(temporary, JSON.stringify({ name: group.name, members }), { mode: 0o600 });
    fs.renameSync(temporary, path.join(directory, 'members.json'));
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !members.some(member => member.id === entry.name)) fs.rmSync(path.join(directory, entry.name), { recursive: true, force: true });
    }
  }
  instructions(group, member) {
    if (!this.root) return '';
    let helper = path.join(this.directory(group), 'group-message.cjs');
    if (group.distro && /^[a-z]:[\\/]/i.test(helper)) helper = `/mnt/${helper[0].toLowerCase()}${helper.slice(2).replace(/\\/g, '/')}`;
    const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
    const command = `node ${quote(helper)} ${quote(this.memberId(member))}`;
    return `당신은 ${group.name} AI 그룹의 참여 AI입니다. 다른 참여 AI와 소통할 수 있습니다. 작업 전과 작업 단계가 끝날 때 메시지함을 확인하세요. 참여 AI 목록: ${command} members\n받은 메시지 읽기: ${command} inbox\n메시지 보내기: ${command} send <참여AI_ID> "메시지 내용"\n메시지는 수신 AI가 inbox를 읽을 때 확인합니다. 사용자의 작업 지시를 따라 진행하세요.`;
  }
  delete(group) { if (this.root) fs.rmSync(this.directory(group), { recursive: true, force: true }); }
}
module.exports = { GroupMailbox };
