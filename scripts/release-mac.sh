#!/bin/sh
# Builds the macOS release: Cue.app for Apple Silicon and Intel, signed with a
# Developer ID, notarised and stapled, as zip (for the updater) and dmg, plus
# latest-mac.yml. See docs/RELEASING.md for the accounts and credentials.
#
#   npm run release:mac                 build into release/
#   PUBLISH=always npm run release:mac  also upload to a draft GitHub release (GH_TOKEN)
#
# Signing identity: CSC_LINK + CSC_KEY_PASSWORD (a .p12, as in CI), CSC_NAME, or
# the first "Developer ID Application" certificate in the keychain.
# Notarisation: APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or
# APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or
# APPLE_KEYCHAIN_PROFILE (a profile saved with `xcrun notarytool store-credentials`).
# Without them the build is signed but not notarised, and says so.
# Credentials are only checked for presence here; nothing is printed.
set -e
cd "$(dirname "$0")/.."

if [ "$(uname)" != "Darwin" ]; then
	echo "release:mac runs on macOS only." >&2
	exit 1
fi

# --- Signing identity -------------------------------------------------------
if [ -n "$CSC_LINK" ]; then
	echo "Signing: certificate from CSC_LINK"
elif [ -n "$CSC_NAME" ]; then
	echo "Signing: identity CSC_NAME"
elif security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
	echo "Signing: $(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application[^"]*\)".*/\1/p' | head -1)"
else
	cat >&2 <<'MSG'
No "Developer ID Application" certificate found (keychain, CSC_LINK or CSC_NAME).
A release must be signed with one: macOS blocks other builds and the updater
refuses them. See docs/RELEASING.md. For a local, unsigned build use:
  npm run package
MSG
	exit 1
fi

# --- Notarisation -----------------------------------------------------------
NOTARIZE=true
if [ -n "$APPLE_API_KEY" ] && [ -n "$APPLE_API_KEY_ID" ] && [ -n "$APPLE_API_ISSUER" ]; then
	echo "Notarisation: App Store Connect API key"
elif [ -n "$APPLE_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
	echo "Notarisation: Apple ID with an app-specific password"
elif [ -n "$APPLE_KEYCHAIN_PROFILE" ]; then
	echo "Notarisation: notarytool keychain profile"
else
	NOTARIZE=false
	cat <<'MSG'
Notarisation: SKIPPED. No credentials in the environment
  (APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER or
   APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID or APPLE_KEYCHAIN_PROFILE).
  The app is signed, but Gatekeeper will warn on first launch. Not for publishing.
MSG
	# Half-set variables make electron-builder fail; drop them when skipping.
	unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER
fi

# --- Build ------------------------------------------------------------------
npm run build
npm run build:native
[ -f build/native/cue-vision ] || echo "warning: cue-vision was not built; on-device vision will be unavailable in this release." >&2

npx electron-builder --mac --publish "${PUBLISH:-never}" -c.mac.notarize=$NOTARIZE

# --- Check ------------------------------------------------------------------
for app in release/mac-arm64/Cue.app release/mac/Cue.app; do
	[ -d "$app" ] || continue
	codesign --verify --deep --strict "$app"
	echo "$app: signature OK ($(codesign -dv "$app" 2>&1 | sed -n 's/^Authority=\(Developer ID Application.*\)/\1/p'))"
	if [ "$NOTARIZE" = true ]; then
		xcrun stapler validate "$app"
		spctl --assess --type execute --verbose=2 "$app"
	fi
done
ls -1 release/*.zip release/*.dmg release/latest-mac.yml 2>/dev/null
[ "$NOTARIZE" = true ] || echo "Reminder: this build is NOT notarised."
