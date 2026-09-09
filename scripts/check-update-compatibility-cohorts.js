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
  const recent = [
    {"version":"1.7.6","size":85321320,"sha256":"0fda64f5cf6e051c70e417b39489797125720d84b31e8422c3d168faa3d7f341"},
    {"version":"1.7.8","size":85325513,"sha256":"ff3d775449c6a670e0a3cc9f28f9af0e2dfdf371f500cdaa5d5daff03d7f5311"},
    {"version":"1.7.9","size":85325656,"sha256":"ff68ea266100f683354f9020b9560b51ebf001efc520fa1a997d00b44a43ac81"},
    {"version":"1.7.11","size":85327244,"sha256":"f126797cdcae732d99225b3df7613bafa983b9dbc870d0068f368d8f7ac73178"},
    {"version":"1.7.12","size":85335488,"sha256":"07610ac268a0932d70eaeb44a61a775daed9482b7409d53aa46dc6200200e75d"},
    {"version":"1.7.13","size":85244079,"sha256":"5e731d5b7434634f421ca32f40a36101b469d06286ecded690eba5afe5fe18bd"},
    {"version":"1.7.14","size":85246819,"sha256":"aaa2cb066fcefccf9fff36ff3757b04b3df2df4be8b2a430c5f69c28d7d0a187"},
    {"version":"1.7.15","size":85266395,"sha256":"f2ae2cecd39b1bd324735f92dde348d1f6fd8e6ddf1616d1054b514d0a0d583f"},
    {"version":"1.7.16","size":85268679,"sha256":"896e2e950a492234dc463865f087ae9ab4184ce20558bfdf7a92e934bf009e04"},
    {"version":"1.8.2","size":85298702,"sha256":"de9389e3e11a00e8d9ac8d4c31935b097c75b1cf8c4f285073177d67330291ae"},
    {"version":"1.8.3","size":85299286,"sha256":"8ff9f8895183f45fdc76d14e1413ea741a9b938645920f2629743c42d1931347"},
    { version: '1.8.4', size: 85300893, sha256: '79a922dc265aaeab7a5d7d30cd763d0446eba6f162eae703e2c714b05b12955d' },
    { version: '1.8.5', size: 85301431, sha256: '7b769ba143c4d70eb312a88b8994f963737cda49ff621b0070ea3231eb1666c2' },
    { version: '1.8.1', size: 85298672, sha256: 'd62511bc82dfdab4b4b851cc0c180f4ac0d04aa2baef0f82145e246c1aa2dd91' },
    { version: '1.8.6', size: 85301256, sha256: '401254235581031ffdc14e3bcbc7d8bb315c9300a3e9ccd575e9ffb15a4e443a' },
    { version: '1.8.7', size: 85302264, sha256: '1a0d8ddf8ee4f373e5620ffa416cc697ae034c8e38090502034984462b861047' },
    { version: '1.8.8', size: 85303444, sha256: '25d9406df0a3c27ce1f5846fcb9965b42f73727caf109b4be11b50b2af39810a' },
    { version: '1.8.9', size: 85321051, sha256: '8b95949603129c66431ac11c4e1ba9a2fb559b56ca3b8e616fa00dff96b0eb0e' },
    { version: '1.8.10', size: 85320539, sha256: '88d145fc4a1a6217f798bd0359751b4bba7d0e9615fe4e49e0bff845478114e3' },
    { version: '1.8.11', size: 85400839, sha256: 'f6a46fe7b7293f78b86864a3a5a81e37cfc9dcf79d1a559968214edfdabe79e5' },
  ].map(value => validateCohort({ ...value,
    url: `https://github.com/minjund/Whitebox/releases/download/v${value.version}/Whitebox-Setup-${value.version}.exe`,
    env: `WHITEBOX_V${value.version.replaceAll('.', '')}_INSTALLER`, installMode: 'automatic',
  }, { expectedInstallMode: 'automatic', label: `recent ${value.version}` }));
  const cohorts = [...validated.frozen, ...recent];
  const duplicate = cohorts.find(value => value.version === validated.previousFixed.version);
  if (duplicate) {
    for (const key of COHORT_KEYS) {
      if (duplicate[key] !== validated.previousFixed[key]) throw new Error(`Pinned recent cohort differs from previousFixed: ${key}`);
    }
  } else cohorts.push(validated.previousFixed);
  return cohorts;
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
