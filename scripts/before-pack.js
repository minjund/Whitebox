'use strict';
module.exports = async context => {
  if (context.electronPlatformName === 'win32') {
    if (context.arch !== 1) throw new Error('The Windows native verifier currently requires x64 packaging');
    require('./build-windows-signature-check')();
  }
};
