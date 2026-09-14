'use strict';

function bindWindowNavigation(window) {
  // Electron delivers mouse back buttons and OS browser commands here.
  // The renderer owns the app's surfaces; Chromium history is not the app history.
  window.on('app-command', (_event, command) => {
    if (command === 'browser-backward' && !window.webContents.isDestroyed()) {
      window.webContents.send('app:navigate-back');
    }
  });
}

module.exports = { bindWindowNavigation };
