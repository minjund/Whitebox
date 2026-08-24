'use strict';

const packageMetadata = require('../package.json');

// Published v1.6.3-v1.6.14 and v1.6.16-v1.6.22 only trust releases served by
// the original repository and can only install/relaunch the original Windows
// product identity. This one-
// time package deliberately keeps that identity while carrying the current,
// rename-aware updater. It must remain lower than the canonical Whitebox
// release so the relaunched bridge immediately offers the second hop.
const LEGACY_UPDATE_BRIDGE_VERSION = '1.6.23';
const base = packageMetadata.build;

module.exports = {
  ...base,
  appId: 'com.wincube.loadtoagent',
  productName: 'LoadToAgent',
  executableName: 'LoadToAgent',
  directories: {
    ...base.directories,
    output: 'release-legacy-update-bridge',
  },
  extraMetadata: {
    name: 'loadtoagent',
    productName: 'LoadToAgent',
    version: LEGACY_UPDATE_BRIDGE_VERSION,
  },
  win: {
    ...base.win,
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
  },
  nsis: {
    ...base.nsis,
    guid: 'c5e80817-3fef-5203-be10-660aa7355425',
    artifactName: 'LoadToAgent-Setup-${version}.exe',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    runAfterFinish: false,
  },
};
