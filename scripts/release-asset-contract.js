'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MAX_UPDATE_BYTES, normalizeVersion, selectReleaseAsset } = require('../src/updateManager');

function expectedReleaseAssetNames(version) {
  const value = String(version || '');
  const parsed = normalizeVersion(value);
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value)
    || !parsed
    || parsed.raw !== value) throw new Error(`Stable release version is invalid: ${version}`);
  return [
    `Whitebox-Setup-${value}.exe`,
    `Whitebox-Manual-Setup-${value}-x64.exe`,
    `Whitebox-${value}-portable.exe`,
    `Whitebox-${value}-arm64.dmg`,
    `Whitebox-${value}-x64.dmg`,
    `Whitebox-${value}-arm64.zip`,
    `Whitebox-${value}-x64.zip`,
  ];
}

function releaseAssetUrl(version, name) {
  return `https://github.com/minjund/Whitebox/releases/download/v${version}/${name}`;
}

// GitHub serves draft release assets from an `untagged-<id>` path and rewrites
// them to the canonical tag path only when the release is published.
const DRAFT_RELEASE_ASSET_URL = /^https:\/\/github\.com\/minjund\/Whitebox\/releases\/download\/untagged-[0-9a-f]+\/([^/?#]+)$/;

function isDraftReleaseAssetUrl(url, name) {
  const match = DRAFT_RELEASE_ASSET_URL.exec(String(url || ''));
  return Boolean(match) && match[1] === String(name || '');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fixtureReleaseAssets(version) {
  const names = expectedReleaseAssetNames(version);
  return names.map((name, index) => {
    const canonicalPair = /^(?:Whitebox-Setup-|Whitebox-Manual-Setup-)/.test(name);
    const seed = canonicalPair ? `canonical-${version}` : name;
    return {
      name,
      size: canonicalPair ? 85_000_000 : 80_000_000 + index,
      state: 'uploaded',
      digest: `sha256:${crypto.createHash('sha256').update(seed).digest('hex')}`,
      browser_download_url: releaseAssetUrl(version, name),
    };
  });
}

function selectionDecoys(version) {
  const canonical = fixtureReleaseAssets(version)[0];
  const wrongVersion = version === '9.9.9' ? '9.9.8' : '9.9.9';
  return [
    { ...canonical, name: `Whitebox-Pro-Setup-${version}.exe`, browser_download_url: releaseAssetUrl(version, `Whitebox-Pro-Setup-${version}.exe`) },
    { ...canonical, browser_download_url: `https://github.com/minjund/Whitebox/releases/download/v${wrongVersion}/${canonical.name}` },
    { ...canonical, browser_download_url: `https://github.com/minjund/Whitebox/releases/download/v${version}/different.exe` },
    { ...canonical, browser_download_url: `https://example.com/${canonical.name}` },
    { ...canonical, name: `Whitebox-Setup-${wrongVersion}.exe`, browser_download_url: releaseAssetUrl(wrongVersion, `Whitebox-Setup-${wrongVersion}.exe`) },
    { ...canonical, state: 'new' },
    { ...canonical, state: undefined },
    { ...canonical, size: 0 },
    { ...canonical, size: String(canonical.size) },
    { ...canonical, size: MAX_UPDATE_BYTES + 1 },
    { ...canonical, digest: '' },
    { ...canonical, digest: `sha256:${'g'.repeat(64)}` },
    { ...canonical, name: `Whitebox-Setup-${version}-arm64.exe`, browser_download_url: releaseAssetUrl(version, `Whitebox-Setup-${version}-arm64.exe`) },
    { ...canonical, name: `Whitebox-Manual-Setup-${version}-x64.exe`, browser_download_url: releaseAssetUrl(version, `Whitebox-Manual-Setup-${version}-x64.exe`) },
    { ...canonical, name: `Whitebox-${version}-portable.exe`, browser_download_url: releaseAssetUrl(version, `Whitebox-${version}-portable.exe`) },
  ];
}

function assertAssetShape(asset, version, options = {}) {
  assert(asset && typeof asset === 'object', 'Release asset must be an object.');
  assert.equal(asset.state, 'uploaded', `Release asset is not uploaded: ${asset.name || '<missing>'}`);
  assert(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= MAX_UPDATE_BYTES,
    `Release asset size is invalid: ${asset.name || '<missing>'}`);
  assert.match(String(asset.digest || ''), /^sha256:[0-9a-f]{64}$/, `Release asset digest is invalid: ${asset.name || '<missing>'}`);
  if (options.expectDraft === true) {
    assert(isDraftReleaseAssetUrl(asset.browser_download_url, asset.name),
      `Draft release asset URL is not a GitHub draft download URL for its own name: ${asset.name}`);
    return;
  }
  assert.equal(asset.browser_download_url, releaseAssetUrl(version, asset.name), `Release asset URL is not canonical: ${asset.name}`);
}

function assertCompleteReleaseAssetSet(assets, version, options = {}) {
  const expected = expectedReleaseAssetNames(version).sort();
  const actual = (Array.isArray(assets) ? assets : []).map(asset => String(asset && asset.name || '')).sort();
  assert.deepStrictEqual(actual, expected, 'Release must contain exactly the seven canonical desktop assets.');
  for (const asset of assets) assertAssetShape(asset, version, options);
  const canonical = assets.find(asset => asset.name === `Whitebox-Setup-${version}.exe`);
  const manual = assets.find(asset => asset.name === `Whitebox-Manual-Setup-${version}-x64.exe`);
  assert.strictEqual(manual.size, canonical.size, 'Manual Windows alias size differs from canonical Setup.');
  assert.strictEqual(manual.digest, canonical.digest, 'Manual Windows alias digest differs from canonical Setup.');
  return assets;
}

function assertReleaseAssetSelections(assets, version, selector = selectReleaseAsset) {
  assertCompleteReleaseAssetSet(assets, version);
  const candidates = [...selectionDecoys(version), ...assets];
  const expectations = [
    [{ platform: 'win32', arch: 'x64', version }, `Whitebox-Setup-${version}.exe`],
    [{ platform: 'darwin', arch: 'arm64', version }, `Whitebox-${version}-arm64.dmg`],
    [{ platform: 'darwin', arch: 'x64', version }, `Whitebox-${version}-x64.dmg`],
  ];
  for (const [options, expectedName] of expectations) {
    assert.equal(selector(candidates, options)?.name, expectedName, `Automatic selection mismatch for ${options.platform}/${options.arch}.`);
  }
  for (const decoy of selectionDecoys(version)) {
    for (const [options] of expectations) {
      assert.equal(selector([decoy], options), null, `Decoy was selectable for ${options.platform}/${options.arch}: ${decoy.name}`);
    }
  }
  assert.equal(selector(assets, { platform: 'win32', arch: 'arm64', version }), null);
  assert.equal(selector(assets, { platform: 'win32', arch: 'ia32', version }), null);
  assert.equal(selector(assets, { platform: 'linux', arch: 'x64', version }), null);
  return true;
}

function assetsFromDirectory(directory, version) {
  const root = path.resolve(directory);
  const names = fs.readdirSync(root).filter(name => fs.statSync(path.join(root, name)).isFile()).sort();
  assert.deepStrictEqual(names, expectedReleaseAssetNames(version).sort(), 'Local release asset directory has an unexpected file set.');
  return names.map(name => {
    const file = path.join(root, name);
    return {
      name,
      size: fs.statSync(file).size,
      state: 'uploaded',
      digest: `sha256:${sha256(file)}`,
      browser_download_url: releaseAssetUrl(version, name),
    };
  });
}

function assertRemoteReleaseMatchesLocal(release, localAssets, version, options = {}) {
  assert(release && typeof release === 'object', 'GitHub release metadata is missing.');
  assert.equal(release.tag_name, `v${version}`, 'GitHub release tag does not match the package version.');
  if (options.expectDraft !== undefined) assert.equal(release.draft, options.expectDraft, 'GitHub release draft state is incorrect.');
  assert.equal(release.prerelease, false, 'GitHub release must not be a prerelease.');
  const expectDraft = options.expectDraft === true;
  const remoteAssets = assertCompleteReleaseAssetSet(release.assets, version, { expectDraft });
  // Publication rewrites draft asset URLs to the canonical tag path, so the
  // selection contract is checked against that published shape.
  const publishedShape = expectDraft
    ? remoteAssets.map(asset => ({ ...asset, browser_download_url: releaseAssetUrl(version, asset.name) }))
    : remoteAssets;
  assertReleaseAssetSelections(publishedShape, version);
  for (const local of localAssets) {
    const remote = remoteAssets.find(asset => asset.name === local.name);
    assert(remote, `GitHub release is missing ${local.name}.`);
    assert.strictEqual(remote.size, local.size, `GitHub release size differs from local bytes: ${local.name}`);
    assert.strictEqual(String(remote.digest || '').toLowerCase(), local.digest, `GitHub release digest differs from local bytes: ${local.name}`);
    if (!expectDraft) {
      assert.strictEqual(remote.browser_download_url, local.browser_download_url, `GitHub release URL differs from the canonical URL: ${local.name}`);
    }
  }
  return true;
}

function main() {
  const version = String(process.env.WHITEBOX_RELEASE_VERSION || require('../package.json').version);
  const directory = process.env.WHITEBOX_RELEASE_ASSET_DIR || path.join(__dirname, '..', 'release-assets');
  const assets = assetsFromDirectory(directory, version);
  assertReleaseAssetSelections(assets, version);
  if (process.env.WHITEBOX_RELEASE_JSON) {
    const release = JSON.parse(fs.readFileSync(path.resolve(process.env.WHITEBOX_RELEASE_JSON), 'utf8').replace(/^\uFEFF/, ''));
    assertRemoteReleaseMatchesLocal(release, assets, version, {
      expectDraft: process.env.WHITEBOX_EXPECT_DRAFT === 'true'
        ? true
        : process.env.WHITEBOX_EXPECT_DRAFT === 'false' ? false : undefined,
    });
  }
  process.stdout.write(`Complete release asset contract verified: v${version}, ${assets.length} assets.\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertCompleteReleaseAssetSet,
  assertRemoteReleaseMatchesLocal,
  assertReleaseAssetSelections,
  assetsFromDirectory,
  expectedReleaseAssetNames,
  fixtureReleaseAssets,
  isDraftReleaseAssetUrl,
  releaseAssetUrl,
  selectionDecoys,
};
