'use strict';

const bridgeConfig = require('./legacy-update-bridge.config');

const LEGACY_RELEASE_API = 'https://api.github.com/repos/minjund/LodeToAgent/releases/latest';
const CURRENT_RELEASE_API = 'https://api.github.com/repos/minjund/Whitebox/releases/latest';
const LEGACY_REPOSITORY_DOWNLOAD_PREFIX = '/minjund/LodeToAgent/releases/download/';
const BRIDGE_V1623_MAX_UPDATE_BYTES = 2 * 1024 * 1024 * 1024;
const LEGACY_UPDATE_BRIDGE_VERSION = bridgeConfig.extraMetadata.version;
const LEGACY_UPDATE_BRIDGE_ASSET = `LoadToAgent-Setup-${LEGACY_UPDATE_BRIDGE_VERSION}.exe`;

function legacyV163NormalizeVersion(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^refs\/tags\//i, '')
    .replace(/^v/i, '');
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    raw: normalized,
    core: match.slice(1, 4),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function legacyV163CompareVersions(left, right) {
  const a = legacyV163NormalizeVersion(left);
  const b = legacyV163NormalizeVersion(right);
  if (!a || !b) throw new Error('비교할 버전 형식이 올바르지 않습니다.');
  for (let index = 0; index < 3; index += 1) {
    const leftPart = BigInt(a.core[index]);
    const rightPart = BigInt(b.core[index]);
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart == null) return -1;
    if (bPart == null) return 1;
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return BigInt(aPart) > BigInt(bPart) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart > bPart ? 1 : -1;
  }
  return 0;
}

function legacyV163HasTrustedDigest(asset) {
  return /^sha256:[0-9a-f]{64}$/i.test(String(asset && asset.digest || ''));
}

// Frozen compatibility contract from v1.6.3. Do not broaden it: this models
// the binary already installed on users' machines and guards the release
// channel that must remain compatible with that exact code.
function legacyV163TrustedDownloadUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith(LEGACY_REPOSITORY_DOWNLOAD_PREFIX);
  } catch (_invalidDownloadUrl) {
    return false;
  }
}

// This is the updater contract packaged into the immutable 1.6.23 bridge. It
// is intentionally independent from src/updateManager so future updater
// changes cannot make the live-channel canary pass a path that the published
// bridge would not actually choose.
function bridgeV1623TrustedDownloadUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && ['Whitebox', 'LodeToAgent'].some(repository => (
        url.pathname.startsWith(`/minjund/${repository}/releases/download/`)
      ));
  } catch (_invalidDownloadUrl) {
    return false;
  }
}

function legacyV163AssetScore(asset, options = {}) {
  const name = String(asset && asset.name || '');
  const lower = name.toLowerCase();
  const version = String(options.version || '').toLowerCase();
  if (!name || asset.state && asset.state !== 'uploaded' || !legacyV163TrustedDownloadUrl(asset.browser_download_url)) return -1;
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasExactVersion = new RegExp(`(?:^|[-_.])${escapedVersion}(?:[-_.]|$)`).test(lower);
  if (!version || !hasExactVersion) return -1;
  const hasArm64 = /(?:^|[-_.])arm64(?:[-_.]|$)/.test(lower);
  const hasX64 = /(?:^|[-_.])(?:x64|amd64)(?:[-_.]|$)/.test(lower);
  const hasIa32 = /(?:^|[-_.])(?:ia32|x86)(?:[-_.]|$)/.test(lower);
  let score = 12;
  if (options.platform === 'win32') {
    if (!lower.endsWith('.exe')) return -1;
    if (options.arch === 'arm64' && !hasArm64) return -1;
    if (options.arch === 'x64' && (hasArm64 || hasIa32)) return -1;
    if (options.arch === 'ia32' && !hasIa32) return -1;
    if (lower.includes('setup')) score += 100;
    else if (lower.includes('portable')) score += 70;
    else score += 30;
    if (options.arch === 'arm64' && hasArm64) score += 25;
    if (options.arch === 'x64' && hasX64) score += 25;
    if (options.arch === 'ia32' && hasIa32) score += 25;
    return score;
  }
  if (options.platform === 'darwin') {
    if (!lower.endsWith('.dmg')) return -1;
    if (options.arch === 'arm64' && !hasArm64) return -1;
    if (options.arch === 'x64' && !hasX64) return -1;
    score += 90;
    if (options.arch === 'arm64') score += 30;
    if (options.arch === 'x64') score += 30;
    return score;
  }
  return -1;
}

function selectLegacyV163ReleaseAsset(assets, options = {}) {
  const resolvedOptions = options || {};
  return (Array.isArray(assets) ? assets : [])
    .map((asset, index) => ({ asset, index, score: legacyV163AssetScore(asset, resolvedOptions) }))
    .filter(item => item.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.asset || null;
}

function bridgeV1623AssetScore(asset, options = {}) {
  const name = String(asset && asset.name || '');
  const lower = name.toLowerCase();
  const version = String(options.version || '').toLowerCase();
  if (!name || asset.state && asset.state !== 'uploaded' || !bridgeV1623TrustedDownloadUrl(asset.browser_download_url)) return -1;
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasExactVersion = new RegExp(`(?:^|[-_.])${escapedVersion}(?:[-_.]|$)`).test(lower);
  if (!version || !hasExactVersion) return -1;
  const hasArm64 = /(?:^|[-_.])arm64(?:[-_.]|$)/.test(lower);
  const hasX64 = /(?:^|[-_.])(?:x64|amd64)(?:[-_.]|$)/.test(lower);
  const hasIa32 = /(?:^|[-_.])(?:ia32|x86)(?:[-_.]|$)/.test(lower);
  let score = 12;
  if (options.platform === 'win32') {
    if (!lower.endsWith('.exe')) return -1;
    if (options.arch === 'arm64' && !hasArm64) return -1;
    if (options.arch === 'x64' && (hasArm64 || hasIa32)) return -1;
    if (options.arch === 'ia32' && !hasIa32) return -1;
    if (lower.includes('setup')) score += 100;
    else if (lower.includes('portable')) score += 70;
    else score += 30;
    if (options.arch === 'arm64' && hasArm64) score += 25;
    if (options.arch === 'x64' && hasX64) score += 25;
    if (options.arch === 'ia32' && hasIa32) score += 25;
    return score;
  }
  if (options.platform === 'darwin') {
    if (!lower.endsWith('.dmg')) return -1;
    if (options.arch === 'arm64' && !hasArm64) return -1;
    if (options.arch === 'x64' && !hasX64) return -1;
    score += 90;
    if (options.arch === 'arm64') score += 30;
    if (options.arch === 'x64') score += 30;
    return score;
  }
  return -1;
}

function selectBridgeV1623ReleaseAsset(assets, options = {}) {
  const resolvedOptions = options || {};
  return (Array.isArray(assets) ? assets : [])
    .map((asset, index) => ({ asset, index, score: bridgeV1623AssetScore(asset, resolvedOptions) }))
    .filter(item => item.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.asset || null;
}

function bridgeV1623AutomaticInstallPlatform(options = {}) {
  const fileName = String(options.fileName || '');
  return options.platform === 'win32'
    && options.installType === 'desktop'
    && /^(?:Whitebox|LoadToAgent)-Setup-[0-9A-Za-z.-]+\.exe$/i.test(fileName)
    ? 'win32'
    : '';
}

function legacyV163AutomaticInstallPlatform(options = {}) {
  const fileName = String(options.fileName || '');
  return options.platform === 'win32'
    && options.installType === 'desktop'
    && /^LoadToAgent-Setup-[0-9A-Za-z.-]+\.exe$/i.test(fileName)
    ? 'win32'
    : '';
}

function stableReleaseVersion(release, label) {
  const version = legacyV163NormalizeVersion(release && release.tag_name);
  if (!version || release?.draft || release?.prerelease) {
    throw new Error(`${label} 릴리스가 공개된 정식 SemVer 릴리스가 아닙니다.`);
  }
  return version.raw;
}

function exactUploadedAsset(release, repository, name) {
  const tag = String(release && release.tag_name || '');
  const expectedUrl = `https://github.com/minjund/${repository}/releases/download/${tag}/${name}`;
  return (Array.isArray(release && release.assets) ? release.assets : []).find(asset => (
    asset
    && asset.name === name
    && asset.state === 'uploaded'
    && asset.browser_download_url === expectedUrl
    && Number.isSafeInteger(asset.size)
    && asset.size > 0
    && asset.size <= BRIDGE_V1623_MAX_UPDATE_BYTES
  )) || null;
}

function validateLegacyUpdatePath(options = {}) {
  const bridgeRelease = options.bridgeRelease;
  const currentRelease = options.currentRelease;
  if (!currentRelease) throw new Error('Whitebox 최신 릴리스가 없어 두 단계 업데이트 경로를 검증할 수 없습니다.');
  const bridgeVersion = stableReleaseVersion(bridgeRelease, '레거시 브리지');
  if (bridgeRelease?.tag_name !== `v${LEGACY_UPDATE_BRIDGE_VERSION}`) {
    throw new Error(`레거시 브리지 태그가 v${LEGACY_UPDATE_BRIDGE_VERSION}이 아닙니다: ${bridgeRelease?.tag_name || ''}`);
  }
  if (bridgeVersion !== LEGACY_UPDATE_BRIDGE_VERSION) {
    throw new Error(`레거시 브리지 버전이 ${LEGACY_UPDATE_BRIDGE_VERSION}이 아닙니다: ${bridgeVersion}`);
  }
  if (legacyV163CompareVersions(bridgeVersion, '1.6.22') <= 0) {
    throw new Error('레거시 브리지는 마지막 구형 클라이언트보다 높은 버전이어야 합니다.');
  }
  if (bridgeRelease.immutable !== true) {
    throw new Error('레거시 브리지 릴리스가 GitHub immutable release로 잠겨 있지 않습니다.');
  }
  if (!Array.isArray(bridgeRelease.assets) || bridgeRelease.assets.length !== 1) {
    throw new Error('레거시 브리지 릴리스에는 고정된 Windows Setup 자산 하나만 있어야 합니다.');
  }

  const bridgeAsset = selectLegacyV163ReleaseAsset(bridgeRelease.assets, {
    platform: 'win32',
    arch: 'x64',
    version: bridgeVersion,
  });
  if (!bridgeAsset) throw new Error('v1.6.3이 선택할 수 있는 Windows 브리지 설치 파일이 없습니다.');
  if (bridgeAsset.name !== LEGACY_UPDATE_BRIDGE_ASSET) {
    throw new Error(`브리지 설치 파일 이름이 고정 계약과 다릅니다: ${bridgeAsset.name}`);
  }
  if (bridgeAsset !== exactUploadedAsset(bridgeRelease, 'LodeToAgent', LEGACY_UPDATE_BRIDGE_ASSET)) {
    throw new Error('브리지 설치 파일의 상태, 크기 또는 canonical URL이 고정 계약과 다릅니다.');
  }
  if (!legacyV163HasTrustedDigest(bridgeAsset)) throw new Error('브리지 설치 파일에 신뢰할 SHA-256 digest가 없습니다.');
  if (legacyV163AutomaticInstallPlatform({
    platform: 'win32',
    installType: 'desktop',
    fileName: bridgeAsset.name,
  }) !== 'win32') {
    throw new Error('v1.6.3이 브리지 설치 파일을 자동 설치 대상으로 인식하지 못합니다.');
  }

  const currentVersion = stableReleaseVersion(currentRelease, 'Whitebox 최신');
  if (options.expectedCurrentTag && currentRelease.tag_name !== options.expectedCurrentTag) {
    throw new Error(`Whitebox latest 태그가 방금 게시한 태그와 다릅니다: ${currentRelease.tag_name}`);
  }
  if (legacyV163CompareVersions(currentVersion, bridgeVersion) <= 0) {
    throw new Error(`Whitebox 최신 버전(${currentVersion})이 브리지(${bridgeVersion})보다 높지 않습니다.`);
  }
  const expectedAutomaticAsset = `Whitebox-Setup-${currentVersion}.exe`;
  const expectedManualBridgeAsset = `Whitebox-Manual-Setup-${currentVersion}-x64.exe`;
  const automaticAsset = exactUploadedAsset(currentRelease, 'Whitebox', expectedAutomaticAsset);
  const manualBridgeAsset = exactUploadedAsset(currentRelease, 'Whitebox', expectedManualBridgeAsset);
  const selectedCurrentAsset = selectBridgeV1623ReleaseAsset(currentRelease.assets, {
    platform: 'win32',
    arch: 'x64',
    version: currentVersion,
  });
  if (!automaticAsset || !legacyV163HasTrustedDigest(automaticAsset)
    || bridgeV1623AutomaticInstallPlatform({
      platform: 'win32',
      installType: 'desktop',
      fileName: automaticAsset.name,
    }) !== 'win32') {
    throw new Error('수정된 Whitebox에서 자동 설치할 canonical Setup 파일과 digest가 없습니다.');
  }
  if (!manualBridgeAsset || selectedCurrentAsset !== manualBridgeAsset
    || !legacyV163HasTrustedDigest(manualBridgeAsset)
    || bridgeV1623AutomaticInstallPlatform({
      platform: 'win32',
      installType: 'desktop',
      fileName: manualBridgeAsset.name,
    }) !== '') {
    throw new Error('동결된 Whitebox 브리지에서 수동으로 열 안전한 Windows 설치 파일과 digest가 없습니다.');
  }
  if (manualBridgeAsset.size !== automaticAsset.size
    || String(manualBridgeAsset.digest).toLowerCase() !== String(automaticAsset.digest).toLowerCase()) {
    throw new Error('수동 Windows 설치 별칭이 canonical Setup과 동일한 검증 바이트가 아닙니다.');
  }

  return {
    bridgeVersion,
    bridgeAsset: bridgeAsset.name,
    currentVersion,
    currentAsset: manualBridgeAsset.name,
    automaticAsset: automaticAsset.name,
  };
}

module.exports = {
  CURRENT_RELEASE_API,
  BRIDGE_V1623_MAX_UPDATE_BYTES,
  LEGACY_RELEASE_API,
  LEGACY_UPDATE_BRIDGE_ASSET,
  LEGACY_UPDATE_BRIDGE_VERSION,
  bridgeV1623AssetScore,
  bridgeV1623AutomaticInstallPlatform,
  bridgeV1623TrustedDownloadUrl,
  legacyV163CompareVersions,
  legacyV163HasTrustedDigest,
  legacyV163NormalizeVersion,
  legacyV163AssetScore,
  legacyV163AutomaticInstallPlatform,
  legacyV163TrustedDownloadUrl,
  selectBridgeV1623ReleaseAsset,
  selectLegacyV163ReleaseAsset,
  validateLegacyUpdatePath,
};
