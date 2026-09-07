'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
if (process.platform !== 'darwin') throw new Error('Official Mac cohort checks require macOS');
for (const version of ['1.7.3', '1.8.4', '1.8.5']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'mac-packaged-update-button.js')], {
    env: { ...process.env, WHITEBOX_MAC_SOURCE_VERSION: version }, stdio: 'inherit', timeout: 240000,
  });
  if (result.error || result.status !== 0) throw new Error(`Official Mac ${version} cohort failed: ${result.error || result.status}`);
  console.log(`PASS official Mac ${version} -> candidate on ${process.arch}`);
}
