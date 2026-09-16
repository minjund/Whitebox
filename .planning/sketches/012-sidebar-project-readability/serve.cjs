'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..', '..');
const routes = new Map([
  ['/', path.join(__dirname, 'index.html')],
  ['/index.html', path.join(__dirname, 'index.html')],
  ['/themes/default.css', path.join(__dirname, '..', 'themes', 'default.css')],
  ['/build/icon.png', path.join(root, 'build', 'icon.png')],
]);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const file = routes.get(pathname);
  if (!file) { response.writeHead(404); response.end('Not found'); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(500); response.end('Read error'); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store' });
    response.end(data);
  });
}).listen(Number(process.env.SKETCH_PORT) || 4312, '127.0.0.1', function () {
  process.stdout.write(`Sidebar sketch: http://127.0.0.1:${this.address().port}/\n`);
});
