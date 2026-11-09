#!/usr/bin/env bash
# Install the latest Whitebox release on macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/minjund/Whitebox/main/scripts/install-macos.sh | bash
#
# Downloads the DMG for this Mac's architecture from the latest GitHub release,
# checks its size and SHA-256 against the release metadata, copies Whitebox.app
# into WHITEBOX_INSTALL_DIR (default: /Applications) and removes the quarantine
# attribute.
set -euo pipefail

REPO="minjund/Whitebox"
INSTALL_DIR="${WHITEBOX_INSTALL_DIR:-/Applications}"
APP_NAME="Whitebox.app"

say() { printf '==> %s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer only supports macOS."
for tool in curl hdiutil ditto shasum xattr osascript; do
  command -v "$tool" >/dev/null 2>&1 || fail "Required command not found: $tool"
done

# Apple Silicon reports x86_64 under Rosetta; ask the hardware instead.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
  ARCH="arm64"
else
  ARCH="x64"
fi

if pgrep -f "$INSTALL_DIR/$APP_NAME/Contents/MacOS/" >/dev/null 2>&1; then
  fail "Whitebox is running from $INSTALL_DIR. Quit it first, or update from Settings > General inside the app."
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/whitebox-install.XXXXXX")"
MOUNT_POINT="$WORK_DIR/mount"
cleanup() {
  if [ -d "$MOUNT_POINT" ]; then hdiutil detach "$MOUNT_POINT" -quiet >/dev/null 2>&1 || true; fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

say "Looking up the latest Whitebox release"
curl -fsSL -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/releases/latest" -o "$WORK_DIR/release.json" \
  || fail "Could not read the latest release from GitHub."

# Prints: version, asset name, download URL, size, sha256 (one per line).
ASSET_INFO="$(osascript -l JavaScript - "$WORK_DIR/release.json" "$ARCH" "$REPO" <<'JXA'
function run(argv) {
  ObjC.import('Foundation');
  const raw = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
  const release = JSON.parse(raw);
  if (release.draft || release.prerelease) throw new Error('The latest release is not a published stable release.');
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Unexpected release tag: ' + release.tag_name);
  const name = 'Whitebox-' + version + '-' + argv[1] + '.dmg';
  const asset = (release.assets || []).find(item => item.name === name);
  if (!asset) throw new Error('Release ' + release.tag_name + ' has no ' + name + '.');
  const prefix = 'https://github.com/' + argv[2] + '/releases/download/' + release.tag_name + '/';
  if (asset.state !== 'uploaded' || asset.browser_download_url !== prefix + name) throw new Error('Unexpected asset location for ' + name + '.');
  const digest = String(asset.digest || '');
  if (!/^sha256:[0-9a-f]{64}$/i.test(digest)) throw new Error('Release metadata has no SHA-256 digest for ' + name + '.');
  return [version, name, asset.browser_download_url, String(asset.size), digest.slice(7).toLowerCase()].join('\n');
}
JXA
)" || fail "Could not find a macOS $ARCH installer in the latest release."

VERSION="$(sed -n 1p <<<"$ASSET_INFO")"
ASSET_NAME="$(sed -n 2p <<<"$ASSET_INFO")"
ASSET_URL="$(sed -n 3p <<<"$ASSET_INFO")"
ASSET_SIZE="$(sed -n 4p <<<"$ASSET_INFO")"
ASSET_SHA256="$(sed -n 5p <<<"$ASSET_INFO")"
DMG="$WORK_DIR/$ASSET_NAME"

say "Downloading $ASSET_NAME"
curl -fL --progress-bar "$ASSET_URL" -o "$DMG" || fail "Download failed."

say "Verifying size and SHA-256"
[ "$(stat -f %z "$DMG")" = "$ASSET_SIZE" ] || fail "Downloaded size does not match the release metadata."
[ "$(shasum -a 256 "$DMG" | awk '{print $1}')" = "$ASSET_SHA256" ] || fail "Downloaded SHA-256 does not match the release metadata."

say "Installing Whitebox $VERSION into $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" || fail "Could not create $INSTALL_DIR."
[ -w "$INSTALL_DIR" ] || fail "No write permission for $INSTALL_DIR. Try WHITEBOX_INSTALL_DIR=\"\$HOME/Applications\"."
mkdir -p "$MOUNT_POINT"
hdiutil attach "$DMG" -nobrowse -readonly -noautoopen -mountpoint "$MOUNT_POINT" -quiet \
  || fail "Could not open the DMG."
[ -d "$MOUNT_POINT/$APP_NAME" ] || fail "$APP_NAME was not found in the DMG."
rm -rf "${INSTALL_DIR:?}/$APP_NAME"
ditto "$MOUNT_POINT/$APP_NAME" "$INSTALL_DIR/$APP_NAME"
hdiutil detach "$MOUNT_POINT" -quiet >/dev/null 2>&1 || true

# Whitebox is an ad-hoc signed build; drop Gatekeeper's quarantine flag.
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

say "Installed $INSTALL_DIR/$APP_NAME ($VERSION)"
printf '    Open it with: open "%s/%s"\n' "$INSTALL_DIR" "$APP_NAME"
