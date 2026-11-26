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
    assert.deepEqual(byName.deploy, { name: 'deploy', description: 'Deploy the app', source: 'user', insert: '/deploy' });
    assert.deepEqual(byName['frontend:component'], { name: 'frontend:component', description: '', source: 'user', insert: '/frontend:component' }, 'nested commands are namespaced');
    assert.equal(byName['bad name'], undefined, 'invalid names are skipped');
    assert.deepEqual(byName['database-design'], { name: 'database-design', description: 'Database design principles', source: 'skill', insert: '/database-design' });
    assert.equal(byName.empty, undefined, 'a folder without SKILL.md is not a skill');
    assert.deepEqual(byName.release, { name: 'release', description: 'Cut a release', source: 'project', insert: '/release' });
    assert.deepEqual(byName['project:sync'], { name: 'project:sync', description: 'Sync tickets', source: 'plugin', insert: '/project:sync' });
    assert.deepEqual(byName['project:ask'], { name: 'project:ask', description: 'Ask the team', source: 'plugin', insert: '/project:ask' });
    assert.ok(BUILTIN.claude.every(([name]) => byName[name]?.source === 'builtin'), 'built-in commands are always listed');
    assert.ok(!JSON.stringify(claude).includes('SECRET BODY'), 'command bodies never leave the catalog');
    assert.deepEqual(claude.map(item => item.name), [...claude.map(item => item.name)].sort((a, b) => a.localeCompare(b)), 'sorted by name');
    assert.deepEqual(listSlashCommands({ provider: 'claude', home }).find(item => item.name === 'release'), undefined, 'project commands need a cwd');

    const codex = listSlashCommands({ provider: 'codex', cwd, home });
    assert.deepEqual(codex.find(item => item.name === 'standup'), { name: 'standup', description: 'Daily standup', source: 'user', insert: '/prompts:standup' });
    assert.ok(codex.some(item => item.name === 'compact' && item.source === 'builtin'));
    assert.equal(codex.find(item => item.name === 'deploy'), undefined, 'Claude commands are not offered to Codex');
    write(path.join(home, '.codex/skills/grill-me/SKILL.md'), '---\nname: grill-me\ndescription: Grill the plan\n---');
    assert.deepEqual(listSlashCommands({ provider: 'codex', cwd, home }).find(item => item.name === 'grill-me'),
      { name: 'grill-me', description: 'Grill the plan', source: 'skill', insert: '$grill-me' }, 'Codex skills are offered as $name mentions');
    // A plugin turned off in settings.json is not offered; another Claude folder (claude-ubion) has its own list.
    write(path.join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'project@ubion': false } }));
    assert.equal(listSlashCommands({ provider: 'claude', cwd, home }).find(item => item.name === 'project:sync'), undefined, 'disabled plugins are hidden');
    write(path.join(home, '.claude-ubion/skills/khaydarin/SKILL.md'), '---\ndescription: Team knowledge\n---');
    const ubion = listSlashCommands({ provider: 'claude', home, claudeDir: path.join(home, '.claude-ubion') });
    assert.ok(ubion.some(item => item.name === 'khaydarin') && !ubion.some(item => item.name === 'deploy'), 'the Claude folder of the running process is used');
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
