'use strict';

const OPENCODE_PLUGIN_ID = 'builtin.opencode';

// Keep this raw manifest aligned with src/sourcePlugins/bundled.js. The host
// validates and freezes its own copy; this copy keeps the adapter independently
// testable without importing the registry back into itself.
const OPENCODE_MANIFEST = Object.freeze({
  apiVersion: 1,
  id: OPENCODE_PLUGIN_ID,
  version: '1.0.0',
  name: 'OpenCode',
  label: 'OpenCode',
  shortLabel: 'OpenCode',
  description: 'OpenCode sessions stored locally on this computer.',
  trust: 'bundled',
  kind: 'source-monitor',
  mark: 'OC',
  accent: '#0f766e',
  platforms: Object.freeze(['win32', 'darwin', 'linux']),
  transport: 'local-read-only',
  source: Object.freeze({ id: 'opencode', label: 'OpenCode' }),
  orchestrator: 'opencode',
  clientKind: 'opencode',
  capabilities: Object.freeze({
    history: Object.freeze({ list: true, detail: true }),
    live: true,
    control: Object.freeze({
      start: true,
      sendInstruction: true,
      stop: false,
      archive: false,
      delete: true,
    }),
  }),
  presentation: Object.freeze({
    conversationSurface: 'transcript',
    workSurface: 'timeline',
    artifactSurface: 'list',
  }),
});

module.exports = {
  OPENCODE_MANIFEST,
  OPENCODE_PLUGIN_ID,
};
