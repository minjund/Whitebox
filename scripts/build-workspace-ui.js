'use strict';

const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const reactModules = path.dirname(path.dirname(require.resolve('react/package.json')));
esbuild.buildSync({
  entryPoints: [path.join(root, 'renderer/workspace-affectui-source.tsx')],
  outfile: path.join(root, 'renderer/workspace-affectui.js'),
  bundle: true,
  minify: true,
  jsx: 'automatic',
  nodePaths: [reactModules],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'eof',
});
console.log('Built local workspace affectUI controls.');
