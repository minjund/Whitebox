'use strict';
// The CLI must find control.json in profiles migrated from LoadToAgent without
// WHITEBOX_PANEL_DIRECTORY, because those installs keep their legacy userData root.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { directory, directoryCandidates } = require('../bin/panel-control');

module.exports = function panelControlDirectoryTest() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-panel-directory-'));
  try {
    const base = path.join(home, 'Library/Application Support');
    const at = name => path.join(base, name, 'terminal-collaboration');
    const publish = (name, mtime) => {
      fs.mkdirSync(at(name), { recursive: true });
      const file = path.join(at(name), 'control.json');
      fs.writeFileSync(file, '{}');
      fs.utimesSync(file, mtime, mtime);
    };
    const options = { platform: 'darwin', home };
    assert.deepEqual(directoryCandidates({}, 'darwin', home), [at('Whitebox'), at('LoadToAgent'), at('loadtoagent')]);
    assert.equal(directory({}, options), at('Whitebox'), 'falls back to the current brand when nothing is published');
    publish('LoadToAgent', new Date(2026, 0, 1));
    assert.equal(directory({}, options), at('LoadToAgent'), 'finds a legacy profile control file');
    publish('Whitebox', new Date(2025, 0, 1));
    assert.equal(directory({}, options), at('LoadToAgent'), 'prefers the newest published control file');
    publish('Whitebox', new Date(2026, 5, 1));
    assert.equal(directory({}, options), at('Whitebox'));
    assert.equal(directory({ WHITEBOX_PANEL_DIRECTORY: '/explicit' }, options), '/explicit', 'explicit override wins');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
};

if (require.main === module) {
  module.exports();
  console.log('panel control directory test passed');
}
