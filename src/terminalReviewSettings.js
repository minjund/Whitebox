'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

function normalizeReviewSettings(value = {}) {
  const model = input => typeof input === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,127}$/u.test(input.trim()) ? input.trim() : '';
  return {
    provider: ['claude', 'codex'].includes(value?.provider) ? value.provider : 'auto',
    models: { claude: model(value?.models?.claude), codex: model(value?.models?.codex) },
  };
}

async function reviewModelCatalog(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  const catalog = { claude: ['fable', 'sonnet', 'opus', 'haiku'].map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })), codex: [] };
  try {
    const file = path.join(home, 'models_cache.json');
    if ((await fs.stat(file)).size > 2 * 1024 * 1024) return catalog;
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    catalog.codex = (Array.isArray(value.models) ? value.models : []).filter(item => item.visibility === 'list'
      && normalizeReviewSettings({ models: { codex: item.slug } }).models.codex).slice(0, 50)
      .map(item => ({ id: item.slug, label: String(item.display_name || item.slug).slice(0, 120) }));
  } catch { /* CLI default and explicit model ID remain available without a cache. */ }
  return catalog;
}

module.exports = { normalizeReviewSettings, reviewModelCatalog };
