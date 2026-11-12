'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
if (process.platform !== 'darwin') throw new Error('Official Mac cohort checks require macOS');
for (const version of ['1.7.3', '1.8.4', '1.8.5', '1.8.6', '2.0.1', '2.0.6', '2.0.7', '2.0.8', '2.0.9', '2.0.10', '2.0.11', '2.0.12', '2.0.13', '2.0.14', '2.0.15', '2.0.16', '2.0.17', '2.0.18', '2.0.19', '2.0.20', '2.0.21', '2.0.22', '2.0.23', '2.0.24', '2.0.25', '2.0.26', '2.0.27', '2.0.28', '2.0.29', '2.0.30', '2.0.31', '2.0.32']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'mac-packaged-update-button.js')], {
    env: { ...process.env, WHITEBOX_MAC_SOURCE_VERSION: version }, stdio: 'inherit', timeout: 240000,
  });
  if (result.error || result.status !== 0) throw new Error(`Official Mac ${version} cohort failed: ${result.error || result.status}`);
  console.log(`PASS official Mac ${version} -> candidate on ${process.arch}`);
}
