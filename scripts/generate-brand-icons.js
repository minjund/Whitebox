'use strict';

// Run with: npx --no-install electron scripts/generate-brand-icons.js
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, nativeImage } = require('electron');

const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'src/assets/lucide');
const provenance = JSON.parse(fs.readFileSync(path.join(vendor, 'source.json'), 'utf8'));
for (const [name, metadata] of Object.entries(provenance.files)) {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(vendor, name))).digest('hex');
  assert.equal(digest, metadata.sha256, `Vendored Lucide ${name} must match the pinned source`);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-icon-render-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

async function run() {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  const svg = fs.readFileSync(path.join(root, 'src/assets/whitebox-icon.svg'));
  const svgUrl = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  try {
    await window.loadURL('data:text/html,<html><body></body></html>');
    const rendered = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify(svgUrl)};
      await image.decode();
      return ${JSON.stringify([...sizes, 1024])}.map(size => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      });
    })()`);
    const images = rendered.map(data => Buffer.from(data, 'base64'));
    const master = images.pop();
    assert.deepEqual(nativeImage.createFromBuffer(master).getSize(), { width: 1024, height: 1024 });
    fs.writeFileSync(path.join(root, 'build/icon.png'), master);

    const directory = Buffer.alloc(6 + 16 * sizes.length);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(sizes.length, 4);
    let offset = directory.length;
    sizes.forEach((size, index) => {
      assert.deepEqual(nativeImage.createFromBuffer(images[index]).getSize(), { width: size, height: size });
      const entry = 6 + index * 16;
      directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
      directory.writeUInt16LE(1, entry + 4);
      directory.writeUInt16LE(32, entry + 6);
      directory.writeUInt32LE(images[index].length, entry + 8);
      directory.writeUInt32LE(offset, entry + 12);
      offset += images[index].length;
    });
    const iconPath = path.join(root, 'build/icon.ico');
    fs.writeFileSync(iconPath, Buffer.concat([directory, ...images]));
    assert.equal(nativeImage.createFromPath(iconPath).isEmpty(), false);
    console.log(`Generated licensed Whitebox icon: PNG 1024; ICO ${sizes.join(', ')}.`);
  } finally {
    window.destroy();
  }
}

const deadline = setTimeout(() => {
  console.error('Icon rendering timed out');
  app.exit(1);
}, 30_000);

app.whenReady().then(run).then(() => {
  clearTimeout(deadline);
  app.quit();
}, error => {
  clearTimeout(deadline);
  console.error(error.stack);
  app.exit(1);
});

app.on('quit', () => {
  // Only remove this run's freshly created profile within the OS temp directory.
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(profile));
  if (/^whitebox-icon-render-[^\\/]+$/.test(relative)) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
});
