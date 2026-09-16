'use strict';
// Render the disposable HTML to shareable PNGs. No product processes or data.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..', '..');
app.setPath('userData', path.join(root, 'output', 'sidebar-readability', '.render-profile'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1340, height: 1060, useContentSize: true, show: false,
    backgroundColor: '#111214',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  try {
    for (const view of ['compare', 'a']) {
      await window.loadFile(path.join(__dirname, 'index.html'), { query: { view } });
      await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
      window.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 200));
      const output = path.join(__dirname, `preview-${view}.png`);
      fs.writeFileSync(output, (await window.webContents.capturePage()).toPNG());
      process.stdout.write(`${output}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
});
