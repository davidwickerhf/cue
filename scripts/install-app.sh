#!/bin/sh
# Builds Cue.app, signs it with a stable identity and installs it in /Applications.
#
# macOS remembers keychain access ("Always Allow" for Cue Safe Storage) per
# signing identity, so a stable identity means no new prompt after each
# rebuild. Uses the first Apple Development identity, or CUE_SIGN_IDENTITY.
set -e
cd "$(dirname "$0")/.."
IDENTITY="${CUE_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*\([0-9A-F]\{40\}\) "Apple Development.*/\1/p' | head -1)}"
[ -n "$IDENTITY" ] || IDENTITY="-"
npm run package
osascript -e 'quit app "Cue"' >/dev/null 2>&1 || true
sleep 1
rm -rf /Applications/Cue.app
cp -R release/mac-arm64/Cue.app /Applications/
codesign --force --deep --sign "$IDENTITY" /Applications/Cue.app
codesign --verify --deep --strict /Applications/Cue.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Cue.app
echo "Installed /Applications/Cue.app (signed with ${IDENTITY})"
