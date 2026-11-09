'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listSlashCommands, BUILTIN } = require('../src/slashCommandCatalog');

function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-slash-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-slash-project-'));
  try {
    const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    write(path.join(home, '.claude/commands/deploy.md'), '---\ndescription: "Deploy the app"\n---\nSECRET BODY');
    write(path.join(home, '.claude/commands/frontend/component.md'), 'no frontmatter');
    write(path.join(home, '.claude/commands/bad name.md'), '---\ndescription: ignored\n---');
    write(path.join(home, '.claude/skills/database-design/SKILL.md'), '---\nname: database-design\ndescription: Database design principles\n---');
    write(path.join(home, '.claude/skills/empty/README.md'), 'not a skill');
    write(path.join(cwd, '.claude/commands/release.md'), '---\ndescription: Cut a release\n---');
    write(path.join(home, '.claude/plugins/cache/ubion/project/1.0/commands/sync.md'), '---\ndescription: Sync tickets\n---');
    write(path.join(home, '.claude/plugins/cache/ubion/project/1.0/skills/ask/SKILL.md'), '---\ndescription: Ask the team\n---');
    write(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
      'project@ubion': [{ scope: 'user', installPath: path.join(home, '.claude/plugins/cache/ubion/project/1.0') }],
      'missing@nowhere': [{ scope: 'user', installPath: path.join(home, 'nope') }] } }));
    write(path.join(home, '.codex/prompts/standup.md'), '---\ndescription: Daily standup\n---');

    const claude = listSlashCommands({ provider: 'claude', cwd, home });
    const byName = Object.fromEntries(claude.map(item => [item.name, item]));
    assert.deepEqual(byName.deploy, { name: 'deploy', description: 'Deploy the app', source: 'user' });
    assert.deepEqual(byName['frontend:component'], { name: 'frontend:component', description: '', source: 'user' }, 'nested commands are namespaced');
    assert.equal(byName['bad name'], undefined, 'invalid names are skipped');
    assert.deepEqual(byName['database-design'], { name: 'database-design', description: 'Database design principles', source: 'skill' });
    assert.equal(byName.empty, undefined, 'a folder without SKILL.md is not a skill');
    assert.deepEqual(byName.release, { name: 'release', description: 'Cut a release', source: 'project' });
    assert.deepEqual(byName['project:sync'], { name: 'project:sync', description: 'Sync tickets', source: 'plugin' });
    assert.deepEqual(byName['project:ask'], { name: 'project:ask', description: 'Ask the team', source: 'plugin' });
    assert.ok(BUILTIN.claude.every(([name]) => byName[name]?.source === 'builtin'), 'built-in commands are always listed');
    assert.ok(!JSON.stringify(claude).includes('SECRET BODY'), 'command bodies never leave the catalog');
    assert.deepEqual(claude.map(item => item.name), [...claude.map(item => item.name)].sort((a, b) => a.localeCompare(b)), 'sorted by name');
    assert.deepEqual(listSlashCommands({ provider: 'claude', home }).find(item => item.name === 'release'), undefined, 'project commands need a cwd');

    const codex = listSlashCommands({ provider: 'codex', cwd, home });
    assert.deepEqual(codex.find(item => item.name === 'standup'), { name: 'standup', description: 'Daily standup', source: 'user' });
    assert.ok(codex.some(item => item.name === 'compact' && item.source === 'builtin'));
    assert.equal(codex.find(item => item.name === 'deploy'), undefined, 'Claude commands are not offered to Codex');
    assert.deepEqual(listSlashCommands({ provider: 'shell', cwd, home }), [], 'no catalog for plain shells');
    assert.ok(listSlashCommands({ provider: 'claude', home: path.join(home, 'missing') }).length === BUILTIN.claude.length, 'a missing home still yields built-ins');
    console.log('PASS slash command catalog: built-ins, user/project commands, namespaced folders, skills, installed plugins, Codex prompts, private bodies');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
if (require.main === module) { try { main(); } catch (error) { console.error(error); process.exitCode = 1; } }
module.exports = main;
