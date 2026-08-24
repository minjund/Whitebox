'use strict';

const { validateManifest } = require('./contracts');

const OPENCODE_MANIFEST = validateManifest({
  apiVersion: 1,
  id: 'builtin.opencode',
  version: '1.0.0',
  name: 'OpenCode',
  source: { id: 'opencode', label: 'OpenCode' },
  platforms: ['win32', 'darwin', 'linux'],
  capabilities: {
    history: { list: true, detail: true },
    live: true,
    control: { start: true, sendInstruction: true, stop: false, archive: false, delete: true },
  },
});

const OMO_MANIFEST = validateManifest({
  apiVersion: 1,
  id: 'builtin.omo',
  version: '1.0.0',
  name: 'Oh My OpenAgent',
  source: { id: 'omo', label: 'OMO · OpenCode' },
  platforms: ['win32', 'darwin', 'linux'],
  capabilities: {
    history: { list: true, detail: true },
    live: true,
    control: { start: true, sendInstruction: true, stop: false, archive: false, delete: true },
  },
});

const ASIDE_MANIFEST = validateManifest({
  apiVersion: 1,
  id: 'builtin.aside',
  version: '1.0.0',
  name: 'Aside Browser',
  source: { id: 'aside', label: 'Aside Browser' },
  platforms: ['darwin'],
  capabilities: {
    history: { list: true, detail: true },
    live: true,
    // Aside does not publish a fixed MCP tool schema. The control host enables
    // only actions proved by tools/list at runtime.
    control: { start: true, sendInstruction: true, stop: false, archive: false, delete: false },
  },
});

function bundledSourceDefinitions(options = {}) {
  return [
    {
      manifest: OPENCODE_MANIFEST,
      createMonitor(context) {
        const adapter = require('./bundled/opencode');
        if (typeof adapter.createOpenCodeMonitorPlugin === 'function') return adapter.createOpenCodeMonitorPlugin(context);
        if (typeof adapter.OpenCodeHistoryMonitor === 'function') return new adapter.OpenCodeHistoryMonitor(context);
        throw new Error('OpenCode monitor adapter를 불러오지 못했습니다.');
      },
    },
    {
      manifest: ASIDE_MANIFEST,
      createMonitor(context) {
        const adapter = require('./bundled/aside');
        if (typeof adapter.createAsideHistoryMonitor === 'function') return adapter.createAsideHistoryMonitor(context);
        if (typeof adapter.AsideHistoryMonitor === 'function') return new adapter.AsideHistoryMonitor(context);
        return null;
      },
    },
  ].map(definition => ({ ...definition, options }));
}

module.exports = { ASIDE_MANIFEST, OMO_MANIFEST, OPENCODE_MANIFEST, bundledSourceDefinitions };
