'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow, nativeImage } = require('electron');

const root = __dirname;
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const expectedSourceHash = '321a2a5500f2b814a2e62eb73c4b01dc65c7334fe2e6f7d77517239383e26bb1';
const source = fs.readFileSync(path.join(root, 'upstream-panels-top-left.svg'));
if (crypto.createHash('sha256').update(source).digest('hex') !== expectedSourceHash) {
  throw new Error('Pinned upstream SVG checksum mismatch');
}

app.disableHardwareAcceleration();
app.setPath('userData', path.join(root, '.render-profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const deadline = setTimeout(() => app.exit(1), 30000);

function writeIco(frameSizes) {
  const frames = frameSizes.map(size => fs.readFileSync(path.join(root, `whitebox-icon-${size}.png`)));
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const entry = 6 + 16 * index;
    const size = frameSizes[index];
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  const file = Buffer.concat([header, ...frames]);
  fs.writeFileSync(path.join(root, 'whitebox-icon.ico'), file);
  frameSizes.forEach((size, index) => {
    const entry = 6 + 16 * index;
    const length = file.readUInt32LE(entry + 8);
    const offset = file.readUInt32LE(entry + 12);
    const image = nativeImage.createFromBuffer(file.subarray(offset, offset + length));
    const dimensions = image.getSize();
    if (image.isEmpty() || dimensions.width !== size || dimensions.height !== size) {
      throw new Error(`ICO frame ${size} failed decoding`);
    }
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  try {
    await win.loadURL('data:text/html,<html><body></body></html>');
    const svg = fs.readFileSync(path.join(root, 'whitebox-icon.svg')).toString('base64');
    const exports = await win.webContents.executeJavaScript(`(async () => {
      const icon = new Image();
      icon.src = 'data:image/svg+xml;base64,${svg}';
      await icon.decode();
      const files = [];
      for (const size of ${JSON.stringify(sizes)}) {
        const sizedIcon = new Image();
        const sizedSvg = atob('${svg}').replace('width="1024"', 'width="' + size + '"').replace('height="1024"', 'height="' + size + '"');
        sizedIcon.src = 'data:image/svg+xml;base64,' + btoa(sizedSvg);
        await sizedIcon.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        context.drawImage(sizedIcon, 0, 0);
        const cornerAlpha = context.getImageData(0, 0, 1, 1).data[3];
        // Chromium may retain one alpha unit at rounded corners at small sizes.
        if (cornerAlpha > 1) throw new Error('Corner alpha at ' + size + ' pixels: ' + cornerAlpha);
        files.push({ name: 'whitebox-icon-' + size, png: canvas.toDataURL('image/png').split(',')[1] });
      }
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 510;
      const c = canvas.getContext('2d');
      c.fillStyle = '#eceeea'; c.fillRect(0, 0, 400, 510);
      c.fillStyle = '#151b18'; c.fillRect(400, 0, 400, 510);
      for (const [index, color] of ['#202522', '#f6f4ee'].entries()) {
        const cx = index * 400 + 200;
        c.drawImage(icon, cx - 100, 48, 200, 200);
        c.fillStyle = color; c.textAlign = 'center';
        c.font = '600 25px "Segoe UI", sans-serif';
        c.fillText('Whitebox', cx, 294);
        c.globalAlpha = 0.75; c.font = '14px "Malgun Gothic", sans-serif';
        c.fillText('안에서 일어나는 일이 보이는 작업 공간', cx, 325);
        c.globalAlpha = 1;
        const positions = [[16, cx - 120], [24, cx - 60], [32, cx + 8], [48, cx + 82]];
        for (const [size, x] of positions) {
          c.drawImage(icon, x - size / 2, 390 - size / 2, size, size);
          c.globalAlpha = 0.65; c.font = '12px "Segoe UI", sans-serif';
          c.fillText(size + ' px', x, 444); c.globalAlpha = 1;
        }
      }
      files.push({ name: 'preview', png: canvas.toDataURL('image/png').split(',')[1] });
      return files;
    })()`);
    for (const item of exports) {
      const buffer = Buffer.from(item.png, 'base64');
      if (nativeImage.createFromBuffer(buffer).isEmpty()) throw new Error(`Invalid PNG: ${item.name}`);
      fs.writeFileSync(path.join(root, item.name + '.png'), buffer);
    }
    fs.copyFileSync(path.join(root, 'whitebox-icon-1024.png'), path.join(root, 'whitebox-icon.png'));
    writeIco(sizes.filter(size => size <= 256));
    console.log('Verified: pinned source SHA-256, 9 PNG exports, transparent corners, and all 7 ICO frames.');
    app.exit(0);
  } catch (error) {
    console.error(error.stack);
    app.exit(1);
  } finally {
    clearTimeout(deadline);
  }
});

