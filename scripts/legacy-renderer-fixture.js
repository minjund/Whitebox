'use strict';

// Retained component regressions run the historical renderer in a test-only
// response. Production index.html always opens the 2.0 terminal workspace.
// This helper is excluded from desktop packages and never changes source files.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { session, net } = require('electron');

let installed = false;
function installLegacyRendererFixture() {
  if (installed) return;
  const index = path.resolve(__dirname, '../renderer/index.html');
  session.defaultSession.protocol.handle('file', request => {
    if (fileURLToPath(request.url) !== index) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }
    const source = fs.readFileSync(index, 'utf8');
    if (!source.includes('data-workspace="terminal"')) throw new Error('Expected the production terminal workspace');
    return new Response(source.replace(' data-workspace="terminal"', ''), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });
  installed = true;
}

module.exports = { installLegacyRendererFixture };
