'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const output = __dirname;
const previous = path.resolve(output, '../app-icon-concepts-20260911');
const names = ['status-control', 'connected-control'];
for (const name of ['LICENSE.txt', 'lucide-panels-top-left.svg']) {
  fs.copyFileSync(path.join(previous, name), path.join(output, name));
}
app.disableHardwareAcceleration();
app.setPath('userData', path.join(output, '.render-profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  try {
    await win.loadURL('data:text/html,<html><body></body></html>');
    const sources = names.map(name => `data:image/svg+xml;base64,${fs.readFileSync(path.join(output, name + '.svg')).toString('base64')}`);
    const exports = await win.webContents.executeJavaScript(`(async () => {
      const images = await Promise.all(${JSON.stringify(sources)}.map(async source => { const img = new Image(); img.src = source; await img.decode(); return img; }));
      const names = ${JSON.stringify(names)};
      const exports = [];
      images.forEach((image, index) => {
        [16, 32, 64, 256, 1024].forEach(size => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
          canvas.getContext('2d').drawImage(image, 0, 0, size, size);
          exports.push({ name: names[index] + '-' + size, data: canvas.toDataURL('image/png').split(',')[1] });
        });
      });
      const board = document.createElement('canvas'); board.width = 880; board.height = 480;
      const c = board.getContext('2d'); c.fillStyle = '#e9ebe9'; c.fillRect(0, 0, board.width, board.height);
      images.forEach((image, index) => {
        const cx = index === 0 ? 230 : 650;
        c.drawImage(image, cx - 112, 38, 224, 224);
        c.fillStyle = '#202522'; c.textAlign = 'center'; c.font = '700 23px "Malgun Gothic", sans-serif';
        c.fillText(index === 0 ? 'A1 · 한눈에 보고, 바로 개입' : 'A2 · 연결된 AI를 한곳에서', cx, 309);
        c.fillStyle = '#59645e'; c.font = '16px "Malgun Gothic", sans-serif';
        c.fillText(index === 0 ? '작업 상태 + 터미널 조작' : '여러 AI의 연결 + 터미널 조작', cx, 339);
        c.drawImage(image, cx - 92, 388, 16, 16);
        c.drawImage(image, cx - 52, 380, 32, 32);
        c.drawImage(image, cx + 6, 372, 48, 48);
        c.fillStyle = '#78817b'; c.font = '12px "Segoe UI", sans-serif';
        c.fillText('16', cx - 84, 446); c.fillText('32', cx - 36, 446); c.fillText('48', cx + 30, 446);
      });
      exports.push({ name: 'comparison', data: board.toDataURL('image/png').split(',')[1] });
      return exports;
    })()`);
    for (const item of exports) fs.writeFileSync(path.join(output, item.name + '.png'), Buffer.from(item.data, 'base64'));
    console.log('Exported two A refinements, small-size icons, comparison, and retained source notices.');
    app.exit(0);
  } catch(error) { console.error(error.stack); app.exit(1); }
  finally { clearTimeout(deadline); }
});
