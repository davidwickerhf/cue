# Releasing Cue

Cue is built with [electron-builder](https://www.electron.build) and published to
[GitHub Releases](https://github.com/davidwickerhf/cue/releases), which is also where
installed copies look for updates ([electron-updater](https://www.electron.build/auto-update)).

| Platform | Files | Updates itself |
| --- | --- | --- |
| macOS (Apple Silicon, Intel) | `Cue-mac-arm64.zip`, `Cue-mac-x64.zip`, `Cue-mac-*.dmg`, `latest-mac.yml` | Yes, when signed with a Developer ID |
| Windows (x64) | `Cue-win-x64-setup.exe`, `latest.yml` | Yes |
| Linux (x64) | `Cue-linux-x86_64.AppImage`, `Cue-linux-amd64.deb`, `latest-linux.yml` | AppImage only |

The `*.blockmap` files let the updater download only what changed. Upload them with the rest.

## What the maintainer needs

### Apple (macOS signing and notarisation)

1. **Apple Developer Program membership** (99 USD a year) at
   [developer.apple.com/programs](https://developer.apple.com/programs/). A free Apple ID
   only gives "Apple Development" certificates: macOS warns about them and **the updater
   refuses them** (Squirrel.Mac only installs updates signed with a Developer ID). Releases
   from 0.2.2 on are signed with the team's Developer ID (team `SFV7BRH9JN`) and notarised
   with the App Store Connect key "Cue Notarization"; the repository secrets below are set.
2. **A "Developer ID Application" certificate** in your login keychain. In Xcode:
   Settings → Accounts → your team → Manage Certificates → + → Developer ID Application.
   (Or create one at developer.apple.com → Certificates with a CSR from Keychain Access.)
   Check it is there: `security find-identity -v -p codesigning` lists
   `Developer ID Application: <Your Name> (<TEAMID>)`.
3. **Your team ID**: the 10 characters in brackets above, also on
   [developer.apple.com/account](https://developer.apple.com/account) → Membership details.
4. **Notarisation credentials**, one of:
   - **App Store Connect API key** (recommended): [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
     → Users and Access → Integrations → Team Keys → +, role *Developer*. Download the `.p8`
     (only possible once) and note the **Key ID** and **Issuer ID**.
   - **A notarytool keychain profile** for releasing from your Mac:
     `xcrun notarytool store-credentials cue-notary --key AuthKey_XXXXXXXXXX.p8 --key-id <Key ID> --issuer <Issuer ID>`,
     then `APPLE_KEYCHAIN_PROFILE=cue-notary npm run release:mac`.
   - **App-specific password**: [appleid.apple.com](https://appleid.apple.com) → Sign-In and
     Security → App-Specific Passwords → +. Used with your Apple ID email and team ID.

### GitHub

- **Publishing from CI** uses the workflow's built-in `GITHUB_TOKEN`; nothing to create.
- **Publishing from your Mac** (`PUBLISH=always`) needs `GH_TOKEN`: a fine-grained token for
  `davidwickerhf/cue` with *Contents: read and write* (or a classic token with `repo`).

### Windows (optional)

An Authenticode code-signing certificate (`.p12`/`.pfx`). Without one the installer works but
SmartScreen shows "Windows protected your PC" until the download builds reputation. Updates work
either way.

## Repository secrets (GitHub → Settings → Secrets and variables → Actions)

| Secret | Value |
| --- | --- |
| `MAC_CERTIFICATE_P12` | The Developer ID Application certificate with its private key, exported from Keychain Access as `.p12`, base64: `base64 -i cert.p12 \| pbcopy` |
| `MAC_CERTIFICATE_PASSWORD` | The password chosen when exporting the `.p12` |
| `APPLE_API_KEY_P8` | Contents of `AuthKey_XXXXXXXXXX.p8` (the whole text, including the BEGIN/END lines) |
| `APPLE_API_KEY_ID` | The key's Key ID |
| `APPLE_API_ISSUER` | The Issuer ID shown above the keys list |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Instead of the three API key secrets |
| `WIN_CERTIFICATE_P12`, `WIN_CERTIFICATE_PASSWORD` | Optional Windows signing certificate (base64) and password |

Missing secrets don't fail the build: the Mac build is then unsigned or not notarised and the
workflow prints a warning. Don't publish such a Mac build as a release people update to.

## Repository variable (GitHub → Settings → Secrets and variables → Actions → Variables)

| Variable | Value |
| --- | --- |
| `CUE_POSTHOG_KEY` | The PostHog project token (`phc_…`, EU project) for opt-in anonymous usage reporting. It is a public, write-only key, so it is a variable, not a secret. The release build bundles it (`vite.config.ts`); without it the app never reports usage. Local builds leave it out unless `CUE_POSTHOG_KEY` is set in the environment. |

## Releasing from CI (normal path)

1. Bump `version` in `package.json` (and `package-lock.json`: `npm version 0.2.0 --no-git-tag-version`).
2. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.
3. [`.github/workflows/release.yml`](../.github/workflows/release.yml) runs on macOS 14, Windows
   and Ubuntu. Each job typechecks, runs the tests, builds and uploads its files to a **draft**
   release `v0.2.0`. The Mac job signs with `MAC_CERTIFICATE_P12` and notarises when the Apple
   secrets are present.
4. When all three jobs succeed, the `publish` job publishes the draft. Edit the release notes
   afterwards if you like. If a job fails, the draft stays a draft: fix, delete the draft and the
   tag, and tag again.

Running the workflow by hand (Actions → Release → Run workflow) builds everything without
publishing and keeps the files as workflow artifacts.

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs the typecheck and tests on Ubuntu
and macOS for every pull request and push to `main`.

## Releasing the Mac build from your Mac

```sh
# Notarisation with an API key (or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID)
export APPLE_API_KEY=~/keys/AuthKey_XXXXXXXXXX.p8 APPLE_API_KEY_ID=XXXXXXXXXX APPLE_API_ISSUER=xxxxxxxx-...
npm run release:mac                        # builds into release/
PUBLISH=always GH_TOKEN=... npm run release:mac   # also uploads to the draft release
```

[`scripts/release-mac.sh`](../scripts/release-mac.sh) stops if no Developer ID certificate is
found (keychain, `CSC_LINK` or `CSC_NAME`), skips notarisation with a clear message when no Apple
credentials are set, builds the arm64 and x64 apps, signs them (hardened runtime,
[`build/entitlements.mac.plist`](../build/entitlements.mac.plist)) including the bundled ffmpeg and
`cue-vision`, notarises and staples the apps, packs zip and dmg and writes `latest-mac.yml`. It
then checks each app with `codesign --verify`, `stapler validate` and `spctl --assess`.
Credentials are read from the environment only; keep them out of shell history and the repo.

`npm run package` and `npm run install:app` are unchanged: an unsigned local build, then signed
with your Apple Development identity for `/Applications`.

## Things to know

- **The first Developer ID release has to be installed by hand.** Copies signed ad hoc or with
  an Apple Development certificate (0.1.x) can't update themselves; they log why in
  `~/Library/Logs/Cue/updates.log` and Settings → General → Updates says so. From the first
  Developer ID release on, Cue can download and install signed updates according to the
  user's update preferences, as long as the same team signs them.
- **Updates are off** in development (`npm run dev`), when `CUE_USER_DATA` is set, when
  `CUE_DISABLE_UPDATES` is set, and for the Linux `.deb`. Settings → General →
  "Check for updates automatically" controls scheduled checks; Help/Cue → Check for Updates…
  still works when it is off. A discovered update stays undownloaded until the user chooses
  Download. "Download and install updates automatically" is an opt-in that gives standing
  consent for future downloads and installs them on the next normal quit. Changing this
  setting after a download begins applies to later updates.
- **ffmpeg per platform.** `ffmpeg-static` downloads the ffmpeg for the OS and CPU that ran
  `npm install`. In CI each job installs its own. When packing for another target (the Intel Mac
  build on an Apple Silicon runner, or Linux/Windows from a Mac), the electron-builder hooks in
  [`scripts/builder/`](../scripts/builder) put that target's ffmpeg in place (downloaded once through
  ffmpeg-static's installer, cached in `node_modules/.cache/cue-ffmpeg`) and restore the host's after.
- **cue-vision** (on-device vision, macOS only) is built by `npm run build:native` as a universal
  binary for macOS 12+. Windows and Linux builds don't include it; the features that need it say so.
- **Building other platforms on a Mac.** `npx electron-builder --win --dir` and
  `npx electron-builder --linux --dir` (and `--linux deb`) work on Apple Silicon. The NSIS
  installer and the AppImage need x86_64 tools (Rosetta 2), so build those in CI.
- **Linux AppImage** needs `libfuse2` on Ubuntu 22.04 and later (`sudo apt install libfuse2`). On
  Ubuntu 24.04, AppArmor may block Chromium's sandbox in an AppImage; the `.deb` installs the
  sandbox helper properly.
- **Checking a Mac build by hand:**
  `codesign -dv --verbose=2 Cue.app` (Authority should be Developer ID Application),
  `xcrun stapler validate Cue.app`, `spctl --assess --type execute -vv Cue.app`.
  A failed notarisation prints a submission ID; `xcrun notarytool log <id> --key ... --key-id ... --issuer ...`
  explains it.
