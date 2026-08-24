'use strict';

const {
  CURRENT_RELEASE_API,
  LEGACY_RELEASE_API,
  LEGACY_UPDATE_BRIDGE_VERSION,
  validateLegacyUpdatePath,
} = require('./legacy-update-compatibility');
const { assertReleaseAssetSelections } = require('./release-asset-contract');

const BRIDGE_V1623_MAX_CHECK_BYTES = 2 * 1024 * 1024;

async function readBoundedReleaseJson(response, url) {
  const rawLength = Number(response.headers && response.headers.get('content-length') || 0);
  const contentLength = Number.isSafeInteger(rawLength) && rawLength > 0 ? rawLength : 0;
  if (contentLength > BRIDGE_V1623_MAX_CHECK_BYTES) {
    throw new Error(`GitHub release API response exceeds the bridge limit: ${url}`);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error(`GitHub release API returned no readable stream: ${url}`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    const chunk = Buffer.from(result.value);
    if (chunk.length > BRIDGE_V1623_MAX_CHECK_BYTES - total) {
      await reader.cancel().catch(() => {});
      throw new Error(`GitHub release API response exceeds the bridge limit: ${url}`);
    }
    chunks.push(chunk);
    total += chunk.length;
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8').replace(/^\uFEFF/, ''));
  } catch (_invalidJson) {
    throw new Error(`GitHub release API returned invalid JSON: ${url}`);
  }
}

async function fetchRelease(fetchImpl, url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Whitebox-legacy-update-channel-check',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub release API failed (${response.status}): ${url}`);
    return await readBoundedReleaseJson(response, url);
  } finally {
    clearTimeout(timer);
  }
}

async function probePublicAsset(fetchImpl, asset) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(asset.browser_download_url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'Whitebox-legacy-update-channel-check' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Public release asset probe failed (${response.status}): ${asset.browser_download_url}`);
    const contentLength = Number(response.headers && response.headers.get('content-length') || 0);
    if (!Number.isSafeInteger(contentLength) || contentLength !== asset.size) {
      throw new Error(`Public release asset size mismatch: ${asset.browser_download_url}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function checkLegacyUpdateChannel(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const expectedCurrentTag = options.expectedCurrentTag || process.env.EXPECTED_CURRENT_TAG || '';
  const requestedDelay = Number(options.retryDelayMs);
  const retryDelayMs = Number.isFinite(requestedDelay) && requestedDelay >= 0 ? requestedDelay : 5_000;
  const waitForBridge = options.waitForBridge === true || process.env.WAIT_FOR_LEGACY_BRIDGE === 'true';
  const bridgeReleasePromise = (async () => {
    let release = null;
    const attempts = waitForBridge ? 7 : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      release = await fetchRelease(fetchImpl, options.legacyApiUrl || LEGACY_RELEASE_API, '');
      if (!waitForBridge || release.tag_name === `v${LEGACY_UPDATE_BRIDGE_VERSION}` || attempt === attempts) break;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
    return release;
  })();
  const currentReleasePromise = (async () => {
    let release = null;
    const attempts = expectedCurrentTag ? 7 : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      release = await fetchRelease(
        fetchImpl,
        options.currentApiUrl || CURRENT_RELEASE_API,
        '',
      );
      if (!expectedCurrentTag || release.tag_name === expectedCurrentTag || attempt === attempts) break;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
    return release;
  })();
  const [bridgeRelease, currentRelease] = await Promise.all([bridgeReleasePromise, currentReleasePromise]);
  const result = validateLegacyUpdatePath({
    bridgeRelease,
    currentRelease,
    expectedCurrentTag,
  });
  assertReleaseAssetSelections(currentRelease.assets, result.currentVersion);
  if (options.probeAssets !== false) {
    const bridgeAsset = bridgeRelease.assets.find(asset => asset.name === result.bridgeAsset);
    await Promise.all([
      probePublicAsset(fetchImpl, bridgeAsset),
      ...currentRelease.assets.map(asset => probePublicAsset(fetchImpl, asset)),
    ]);
  }
  return result;
}

if (require.main === module) {
  checkLegacyUpdateChannel()
    .then(result => {
      process.stdout.write(`Legacy update channel verified: ${result.bridgeVersion} (${result.bridgeAsset}) -> ${result.currentVersion} (${result.currentAsset}; fixed clients ${result.automaticAsset})\n`);
    })
    .catch(error => {
      process.stderr.write(`${error.stack || error}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  BRIDGE_V1623_MAX_CHECK_BYTES,
  checkLegacyUpdateChannel,
  fetchRelease,
  probePublicAsset,
  readBoundedReleaseJson,
};
