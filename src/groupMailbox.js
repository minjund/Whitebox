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
    const members = group.members.map(member => ({ id: this.memberId(member), provider: member.provider, terminalId: member.terminalId || '', panelId: member.creationId }));
    const temporary = path.join(directory, 'members.tmp');
    fs.writeFileSync(temporary, JSON.stringify({ groupId: group.id, name: group.name, members }), { mode: 0o600 });
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
    return `당신의 작업 공간은 Whitebox AI 그룹 ${JSON.stringify(group.name)} (groupId=${group.id})입니다. 당신의 고유 패널 ID는 ${member.creationId}, 메시지 발신 ID는 ${this.memberId(member)}입니다. 같은 폴더나 같은 AI 이름이어도 다른 그룹/패널은 별개의 세션입니다. 다른 참여 AI를 찾을 때는 아래 members 명령의 이 그룹 명단만 사용하세요. 전역 cmux 목록, 현재 선택된 창, 디렉터리 일치, 화면 순서로 상대를 추정하거나 다른 그룹에 요청을 보내지 마세요. 이 그룹은 Whitebox 관리형 tmux이며 cmux 워크스페이스가 아닙니다. 사용자가 같은 그룹 AI에게 요청하면 새 AI 프로세스를 실행하지 말고 명단의 정확한 ID로 send하세요. 상대가 없거나 모호하면 전송하지 말고 사용자에게 확인하세요. 자기 신원 확인: ${command} self\n다른 참여 AI와 소통할 수 있습니다. 작업 전과 작업 단계가 끝날 때 메시지함을 확인하세요. 참여 AI 목록: ${command} members\n받은 메시지 읽기: ${command} inbox\n메시지 보내기: ${command} send <참여AI_ID> "메시지 내용"\n메시지는 수신 AI가 inbox를 읽을 때 확인합니다. 사용자의 작업 지시를 따라 진행하세요.`;
  }
  delete(group) { if (this.root) fs.rmSync(this.directory(group), { recursive: true, force: true }); }
}
module.exports = { GroupMailbox };
