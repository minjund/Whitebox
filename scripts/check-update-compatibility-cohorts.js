'use strict';

const fs = require('fs');
const path = require('path');

const COHORT_MANIFEST_PATH = path.join(__dirname, 'update-compatibility-cohorts.json');
const LATEST_STABLE_RELEASE_API = 'https://api.github.com/repos/minjund/Whitebox/releases/latest';
const MAX_RELEASE_RESPONSE_BYTES = 2 * 1024 * 1024;
const FROZEN_COHORTS = Object.freeze([
  Object.freeze({ version: '1.7.3', installMode: 'manual' }),
  Object.freeze({ version: '1.7.4', installMode: 'manual' }),
  Object.freeze({ version: '1.7.5', installMode: 'automatic' }),
]);
const FROZEN_VERSIONS = Object.freeze(FROZEN_COHORTS.map(cohort => cohort.version));
const COHORT_KEYS = Object.freeze(['env', 'installMode', 'sha256', 'size', 'url', 'version']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function compareStableVersions(left, right) {
  const parse = value => {
    const match = String(value || '').match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    if (!match) throw new Error(`Compatibility cohort version must be stable SemVer: ${value}`);
    return match.slice(1).map(Number);
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function validateCohort(value, options) {
  const { expectedInstallMode, expectedVersion, label } = options;
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, COHORT_KEYS, label);
  compareStableVersions(value.version, value.version);
  if (expectedVersion && value.version !== expectedVersion) {
    throw new Error(`${label}.version must remain ${expectedVersion}`);
  }
  if (!Number.isSafeInteger(value.size) || value.size <= 0) {
    throw new Error(`${label}.size must be a positive safe integer`);
  }
  if (!/^[0-9a-f]{64}$/.test(value.sha256)) {
    throw new Error(`${label}.sha256 must be one lowercase SHA-256 digest`);
  }
  if (!/^WHITEBOX_V[0-9]+_INSTALLER$/.test(value.env)) {
    throw new Error(`${label}.env must be a safe WHITEBOX installer environment variable`);
  }
  if (value.installMode !== expectedInstallMode) {
    throw new Error(`${label}.installMode must be ${expectedInstallMode}`);
  }
  const installerName = `Whitebox-Setup-${value.version}.exe`;
  const expectedUrl = `https://github.com/minjund/Whitebox/releases/download/v${value.version}/${installerName}`;
  if (value.url !== expectedUrl) {
    throw new Error(`${label}.url must be the exact official ${installerName} release URL`);
  }
  return { ...value };
}

function validateCohortManifest(value) {
  if (!isPlainObject(value)) throw new Error('Compatibility cohort manifest must be an object');
  assertExactKeys(value, ['frozen', 'previousFixed'], 'Compatibility cohort manifest');
  if (!Array.isArray(value.frozen) || value.frozen.length !== FROZEN_VERSIONS.length) {
    throw new Error(`Compatibility cohort manifest must contain exactly ${FROZEN_VERSIONS.length} frozen cohorts`);
  }
  const frozen = value.frozen.map((cohort, index) => {
    const expected = FROZEN_COHORTS[index];
    return validateCohort(cohort, {
      expectedInstallMode: expected.installMode,
      expectedVersion: expected.version,
      label: `frozen[${index}]`,
    });
  });
  const previousFixed = validateCohort(value.previousFixed, {
    expectedInstallMode: 'automatic',
    label: 'previousFixed',
  });
  if (compareStableVersions(previousFixed.version, frozen[frozen.length - 1].version) <= 0) {
    throw new Error('previousFixed.version must be newer than every frozen cohort');
  }
  const cohorts = [...frozen, previousFixed];
  for (const property of ['version', 'url', 'env']) {
    if (new Set(cohorts.map(cohort => cohort[property])).size !== cohorts.length) {
      throw new Error(`Compatibility cohort ${property} values must be unique`);
    }
  }
  return { frozen, previousFixed };
}

function readCohortManifest(manifestPath = COHORT_MANIFEST_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`Unable to read compatibility cohort manifest ${manifestPath}: ${error.message}`);
  }
  return validateCohortManifest(parsed);
}

function cohortList(manifest) {
  const validated = validateCohortManifest(manifest);
  return [...validated.frozen];
}

function validateLatestStableRelease(manifest, release) {
  const validated = validateCohortManifest(manifest);
  const expected = validated.previousFixed;
  if (!isPlainObject(release) || release.draft !== false || release.prerelease !== false) {
    throw new Error('GitHub latest release must be a published stable release');
  }
  const expectedTag = `v${expected.version}`;
  if (release.tag_name !== expectedTag) {
    throw new Error(`previousFixed ${expectedTag} does not match public latest stable ${release.tag_name || '<missing>'}`);
  }
  if (!Array.isArray(release.assets)) throw new Error(`Public latest stable ${expectedTag} has no asset list`);
  const expectedName = `Whitebox-Setup-${expected.version}.exe`;
  const matchingAssets = release.assets.filter(asset => isPlainObject(asset) && asset.name === expectedName);
  if (matchingAssets.length !== 1) {
    throw new Error(`Public latest stable ${expectedTag} must contain exactly one ${expectedName}`);
  }
  const asset = matchingAssets[0];
  if (asset.state !== 'uploaded') throw new Error(`Public latest stable asset is not uploaded: ${expectedName}`);
  if (asset.browser_download_url !== expected.url) {
    throw new Error(`Public latest stable asset URL does not match previousFixed: ${expectedName}`);
  }
  if (asset.size !== expected.size) {
    throw new Error(`Public latest stable asset size does not match previousFixed: ${expectedName}`);
  }
  if (asset.digest !== `sha256:${expected.sha256}`) {
    throw new Error(`Public latest stable asset digest does not match previousFixed: ${expectedName}`);
  }
  return {
    version: expected.version,
    tagName: expectedTag,
    assetName: expectedName,
    url: expected.url,
    size: expected.size,
    sha256: expected.sha256,
  };
}

async function readBoundedReleaseJson(response, url) {
  const rawLength = Number(response.headers && response.headers.get('content-length') || 0);
  const contentLength = Number.isSafeInteger(rawLength) && rawLength > 0 ? rawLength : 0;
  if (contentLength > MAX_RELEASE_RESPONSE_BYTES) {
    throw new Error(`GitHub latest release response exceeds ${MAX_RELEASE_RESPONSE_BYTES} bytes: ${url}`);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error(`GitHub latest release API returned no readable stream: ${url}`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    const chunk = Buffer.from(result.value);
    if (chunk.length > MAX_RELEASE_RESPONSE_BYTES - total) {
      await reader.cancel().catch(() => {});
      throw new Error(`GitHub latest release response exceeds ${MAX_RELEASE_RESPONSE_BYTES} bytes: ${url}`);
    }
    chunks.push(chunk);
    total += chunk.length;
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8').replace(/^\uFEFF/, ''));
  } catch (_invalidJson) {
    throw new Error(`GitHub latest release API returned invalid JSON: ${url}`);
  }
}

async function fetchLatestStableRelease(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const url = options.apiUrl || LATEST_STABLE_RELEASE_API;
  const token = options.token || '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Whitebox-update-compatibility-cohort-check',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub latest stable release API failed (${response.status}): ${url}`);
    return await readBoundedReleaseJson(response, url);
  } finally {
    clearTimeout(timer);
  }
}

async function checkUpdateCompatibilityCohorts(options = {}) {
  const manifest = options.manifest || readCohortManifest(options.manifestPath);
  const release = options.release === undefined
    ? await fetchLatestStableRelease(options)
    : options.release;
  return validateLatestStableRelease(manifest, release);
}

if (require.main === module) {
  checkUpdateCompatibilityCohorts()
    .then(result => {
      process.stdout.write(`Update compatibility cohorts verified: previousFixed ${result.tagName} (${result.assetName}, ${result.sha256})\n`);
    })
    .catch(error => {
      process.stderr.write(`${error.stack || error}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  COHORT_MANIFEST_PATH,
  FROZEN_VERSIONS,
  LATEST_STABLE_RELEASE_API,
  MAX_RELEASE_RESPONSE_BYTES,
  checkUpdateCompatibilityCohorts,
  cohortList,
  fetchLatestStableRelease,
  readBoundedReleaseJson,
  readCohortManifest,
  validateCohortManifest,
  validateLatestStableRelease,
};
