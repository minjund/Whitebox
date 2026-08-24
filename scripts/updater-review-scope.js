'use strict';

const fs = require('fs');

const SENSITIVE_PATH_PATTERNS = Object.freeze([
  /^(?:main|preload)\.js$/,
  /^package(?:-lock)?\.json$/,
  /^build(?:\/|$)/,
  /^src\/(?:update[^/]*|macUpdateHelper|diagnostics)\.js$/,
  /^src\/ipc(?:\/|$)/,
  /^renderer\/(?:app[^/]*\.js|index\.html|i18n-messages\.js)$/,
  /^scripts\/(?:after-pack|windows-artifact-check|windows-[^/]*update[^/]*|mac-update-integration-test|package-content-check|check-legacy-update-channel|check-update-compatibility-cohorts|legacy-update-bridge\.config|legacy-update-compatibility|release-asset-contract|updater-review-scope)\.js$/,
  /^scripts\/update-compatibility-cohorts\.json$/,
  /^scripts\/tests\/core-update-workspace\.js$/,
  /^\.github\/workflows\/(?:legacy-update-bridge|legacy-update-channel-canary|release|v173-update-compatibility)\.yml$/,
  /^\.github\/pull_request_template\.md$/,
  /^\.github\/CODEOWNERS$/,
  /^(?:AGENTS|CONTRIBUTING)\.md$/,
  /^docs\/(?:LEGACY-UPDATE-BRIDGE|RELEASING|UPDATE-COMPATIBILITY-AUDIT-[^/]+)\.md$/,
]);

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function parseNameStatus(input) {
  const entries = [];
  for (const rawLine of String(input || '').split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const fields = rawLine.split('\t');
    const status = String(fields.shift() || '').trim();
    if (!/^(?:[ACDMRTUXB]|[RC]\d{1,3})$/.test(status)) {
      throw new Error(`Unsupported git name-status record: ${rawLine}`);
    }
    const expectedPaths = /^[RC]/.test(status) ? 2 : 1;
    if (fields.length !== expectedPaths || fields.some(value => !normalizePath(value))) {
      throw new Error(`Malformed git name-status record: ${rawLine}`);
    }
    entries.push({ status, paths: fields.map(normalizePath) });
  }
  return entries;
}

function isUpdaterSensitivePath(file) {
  const normalized = normalizePath(file);
  return Boolean(normalized) && SENSITIVE_PATH_PATTERNS.some(pattern => pattern.test(normalized));
}

function classifyNameStatus(input) {
  const entries = parseNameStatus(input);
  const paths = [...new Set(entries.flatMap(entry => entry.paths))];
  const matched = paths.filter(isUpdaterSensitivePath);
  return {
    sensitive: matched.length > 0,
    matched,
    paths,
  };
}

function main() {
  const result = classifyNameStatus(fs.readFileSync(0, 'utf8'));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  SENSITIVE_PATH_PATTERNS,
  classifyNameStatus,
  isUpdaterSensitivePath,
  normalizePath,
  parseNameStatus,
};
