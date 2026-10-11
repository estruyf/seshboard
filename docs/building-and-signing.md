# Building, signing and notarisation

How to package Switchboard as a Mac app, and how to sign and notarise it with an Apple Developer ID so it opens on any Mac without warnings. The Windows installer is built and signed in the release workflow (see [Windows](#windows)).

[← Back to the README](../README.md)

## Building the app

Needs macOS on Apple Silicon, Node 24+ and npm 11+.

```bash
npm install
npm run dist
```

This builds `apps/desktop/dist/mac-arm64/Switchboard.app` and `apps/desktop/dist/Switchboard-<version>-arm64.dmg`. Open the `.dmg` and drag Switchboard to Applications.

It also writes what the in-app updater needs: `Switchboard-<version>-arm64-mac.zip` (Squirrel.Mac installs from the zip, not the `.dmg`), its `.blockmap`, and the update feed `latest-mac.yml`. Inside the app, `Contents/Resources/app-update.yml` tells the updater where to look (the GitHub releases of `estruyf/switchboard`, from the `publish` section of `electron-builder.yml`). electron-builder never uploads anything itself (`--publish never`); the release workflow does.

### Preview builds

For a build that must never update or be offered as an update (a test build from a pull request, say), use:

```bash
npm run dist:preview
```

It uses [`electron-builder.preview.yml`](../apps/desktop/electron-builder.preview.yml), which is the normal configuration with `publish: null`: the app has no `app-update.yml` (Settings → About says updates are off) and no `latest-mac.yml` is written.

Switchboard uses your installed Claude Code (`claude` on your PATH) and its login; it doesn't ship its own copy.

### Opening an unsigned build

Without a Developer ID certificate, the build is unsigned. On the Mac that built it, it opens normally. If you copy it to another Mac, macOS blocks the first launch: right-click the app and choose **Open**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Switchboard.app
```

## Signing and notarisation

With an Apple Developer ID, the app is signed with the hardened runtime and notarised by Apple.

1. **Signing identity.** `security find-identity -v -p codesigning` must list your `Developer ID Application` certificate. It needs its private key in the keychain (made from a certificate request on this Mac, or imported as a `.p12`) and Apple's [Developer ID G2 intermediate](https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer). With that in place, `npm run dist` signs automatically.
2. **Notarisation credentials, once.** Create an app-specific password at [account.apple.com](https://account.apple.com) (Sign-In and Security → App-Specific Passwords), then store it in your keychain:

   ```bash
   xcrun notarytool store-credentials switchboard-notary --apple-id you@example.com --team-id YOURTEAMID
   ```

   It prompts for the password; nothing is written to the repository.
3. **Build:**

   ```bash
   npm run dist:notarized
   ```

   This signs the app, sends it to Apple's notary service (usually a few minutes), and staples the ticket to the app.

### Checking the result

```bash
spctl -a -vv apps/desktop/dist/mac-arm64/Switchboard.app
xcrun stapler validate apps/desktop/dist/mac-arm64/Switchboard.app
```

`spctl` should say `accepted` and `source=Notarized Developer ID`.

The `.dmg` itself isn't signed or notarised (electron-builder doesn't by default). That's fine for installing: the app inside carries its own stapled ticket.

### What's in the package

The configuration is in [`apps/desktop/electron-builder.yml`](../apps/desktop/electron-builder.yml), and the hardened-runtime entitlements in [`apps/desktop/build/entitlements.mac.plist`](../apps/desktop/build/entitlements.mac.plist). Electron's V8 needs JIT and unsigned executable memory; nothing else is opted out of.

- The Agent SDK's bundled `claude` binary is left out; the user's own `claude` is used.
- `node-pty` is unpacked from the asar archive, because its native helper must be executable.
- Electron is pinned to an exact version, which electron-builder needs.

## Releasing (automated in GitHub Actions)

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs when a release is published on GitHub. To release:

1. Add a `## [X.Y.Z] - YYYY-MM-DD` section to [`CHANGELOG.md`](../CHANGELOG.md), written for people using the app.
2. Retake the README screenshots with `npm run screenshots` (see [README screenshots](development.md#readme-screenshots)) and look at each one: does it still match the app and the README text, and does it show what this release changed? A failing run means a view in the tour has changed; fix the tour instead of keeping the old pictures. Commit the images with the CHANGELOG and push.
3. On GitHub, create a release with a new tag `vX.Y.Z` (Releases → Draft a new release) and publish it. You can leave the notes empty.

The workflow then:

1. runs the typecheck and unit tests;
2. builds the app on an Apple Silicon runner, with the version taken from the tag;
3. signs it with your Developer ID, and notarises and staples it;
4. checks the signature and that Gatekeeper accepts it as notarised;
5. attaches `Switchboard-X.Y.Z-arm64.dmg`, the `.zip` and its `.blockmap` to the release, then the update feed (`latest-mac.yml`) last, so the feed never points at a file that isn't there yet;
6. fails if a `latest*.yml` ended up on a draft or pre-release;
7. fills in the release notes from the CHANGELOG section, if you left them empty. The in-app updater shows these notes (cleaned up and shortened) for the new version.
8. for a Stable release, stamps the Homebrew cask with the version and the `.zip`'s checksum and pushes it to [estruyf/homebrew-tap](https://github.com/estruyf/homebrew-tap) (see [Homebrew](homebrew.md)).

Everyone on the Stable channel is offered the release within a few hours, or straight away with **Check for Updates…**.

### Channels and pre-releases

- **Stable:** a normal (not pre-release) release with a version like `v1.2.3`. Its feed is `latest-mac.yml`, and the updater finds it as the repository's latest release.
- **Nightly:** a *pre-release* tagged like `v1.2.3-nightly.20261006.1`. The workflow builds it with `-c.publish.channel=nightly`, so its feed is `nightly-mac.yml`, which only apps on the Nightly channel look for. A nightly version published as a normal release fails the workflow. There is no scheduled nightly workflow yet; publish one by hand when you want to.
- **Any other pre-release** (`v1.2.3-beta.1`, say) gets the `.dmg` and `.zip` but no feed, so no one is updated to it. A pre-release version published as a normal release fails the workflow, since Stable users would be offered it.

Only arm64 is built. If an Intel build is added, both architectures must go into one `latest-mac.yml` (a `files` entry each) rather than two feeds overwriting each other.

Nothing is attached unsigned: without the secrets below the run fails. To retry, re-run the failed workflow run from the Actions tab.

### Signing secrets

Add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | What it is |
|---|---|
| `MAC_CERTIFICATE_P12_BASE64` | Your *Developer ID Application* certificate **with its private key**, exported from Keychain Access as a `.p12`, then base64-encoded: `base64 -i DeveloperID.p12 \| pbcopy` |
| `MAC_CERTIFICATE_PASSWORD` | The password you gave the `.p12` when exporting it. Leave it out if the `.p12` has no password |
| `APPLE_ID` | The Apple ID of your developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for it ([account.apple.com](https://account.apple.com) → Sign-In and Security → App-Specific Passwords) |
| `APPLE_TEAM_ID` | Your team ID (the 10 characters in brackets after your name in the certificate) |
| `HOMEBREW_TAP_TOKEN` | A fine-grained token with *Contents: read and write* on `estruyf/homebrew-tap` only. Without it the release still succeeds and the tap keeps the previous version (see [Homebrew](homebrew.md)) |

`MAC_CERTIFICATE_PASSWORD` may be left out only if the `.p12` was exported without a password.

### Windows

The `windows` job in the same workflow builds one NSIS installer, `Switchboard-X.Y.Z-setup.exe`, that holds both the x64 and the arm64 app and installs the one that matches the PC. It runs next to the Mac job, with the same version and channel:

1. logs in to Azure with OpenID Connect (no client secret in the repository);
2. builds with `npm run dist:win`, passing the Trusted Signing settings as `-c.win.azureSignOptions.*`, so electron-builder signs the app, the installer and the uninstaller as it makes them (the checksums in the update feed are of the signed files);
3. checks every `.exe` has a valid Authenticode signature;
4. attaches the installer and its `.blockmap`, then the update feed (`latest.yml`, or `nightly.yml` for a nightly) last.

The in-app updater on Windows reads `latest.yml` or `nightly.yml`; the Mac's `-mac.yml` feeds are separate, so the two builds never overwrite each other. Without the settings below the job fails, and nothing is attached unsigned. If one of the two jobs fails, the other still attaches its files: re-run the failed job from the Actions tab.

`npm run dist:win` on a Windows PC builds the same installer unsigned.

The Azure side, once: a Trusted Signing account with a certificate profile, and an app registration with a federated credential for this repository (GitHub Actions, entity type *Environment*, environment `windows-signing`; the job runs in that GitHub environment, which is created on its first run) that has the *Trusted Signing Certificate Profile Signer* role on the account.

| Setting | Kind | What it is |
|---|---|---|
| `AZURE_CLIENT_ID` | Secret | The app registration's client (application) ID |
| `AZURE_TENANT_ID` | Secret | Your Microsoft Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Secret | The subscription that holds the Trusted Signing account |
| `TRUSTED_SIGNING_ENDPOINT` | Variable | The account's endpoint, like `https://weu.codesigning.azure.net/` |
| `TRUSTED_SIGNING_ACCOUNT_NAME` | Variable | The Trusted Signing account's name |
| `CERTIFICATE_PROFILE_NAME` | Variable | The certificate profile's name |

Secrets go under Settings → Secrets and variables → Actions → *Secrets*, the three names under *Variables* (or put all six on the `windows-signing` environment).

### Testing the packaged app

```bash
npm run smoke:packaged
```

Runs the smoke test (see [Development](development.md)) against `dist/mac-arm64/Switchboard.app` instead of the development build.

## Testing updates with the mock server

[`apps/desktop/scripts/mock-update-server.ts`](../apps/desktop/scripts/mock-update-server.ts) serves an update feed on `http://localhost:8484`. Starting Switchboard with `SWITCHBOARD_MOCK_UPDATES=1` points the updater at it instead of GitHub (set `SWITCHBOARD_MOCK_UPDATES_URL` for another port). Nothing is published.

**The check and the UI**, with a made-up feed (works from a development build too):

```bash
npm run mock-updates -w @switchboard/desktop -- --fake 9.9.9
SWITCHBOARD_MOCK_UPDATES=1 npm run dev
```

Settings → About → *Check for Updates* finds v9.9.9 with its release notes, and the update message shows in the window's corner. Downloading fails, since there is no build behind a fake feed. `--fake 9.9.9-nightly.20261006.1` serves `nightly-mac.yml` for the Nightly channel. The smoke test runs one check against the mock feed when `SWITCHBOARD_MOCK_UPDATES=1` is set (it never downloads).

**The whole flow** (download, restart, *Updated to vX*) needs two signed builds, since Squirrel.Mac only installs an update signed by the same Developer ID:

1. Build the newer version and keep its `dist` folder: `npm pkg set version=0.0.9 -w @switchboard/desktop && npm run dist`, then move `apps/desktop/dist` to, say, `/tmp/switchboard-0.0.9`.
2. Build and install the current version as usual (put `version` back first).
3. Serve the newer one: `npm run mock-updates -w @switchboard/desktop -- --dir /tmp/switchboard-0.0.9`.
4. Open the installed app with the mock feed: `SWITCHBOARD_MOCK_UPDATES=1 /Applications/Switchboard.app/Contents/MacOS/Switchboard`.

`SWITCHBOARD_DISABLE_AUTO_UPDATE=1` turns updates off for a run, with that reason shown in Settings → About. `Switchboard --version` prints the version and exits.
