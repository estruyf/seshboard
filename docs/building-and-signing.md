# Building, signing and notarisation

How to package Switchboard as a Mac app, and how to sign and notarise it with an Apple Developer ID so it opens on any Mac without warnings. Windows has [its own section](#windows): an installer, signed with Authenticode. So does [Linux](#linux): an AppImage, a `.deb` and an `.rpm`, unsigned.

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
- `app.asar` holds only `out`, `node_modules` and `package.json`: `npm run dist` fails if anything else got in through a `files` pattern.
- Electron is pinned to an exact version, which electron-builder needs.

## Windows

### Building the installer

Needs Windows 10 or 11, Node 24+ and npm 11+. `npm run dist` builds for the OS it runs on, so the same commands work:

```bash
npm install
npm run dist
```

This builds `apps/desktop/dist/Switchboard-<version>-setup.exe`, one installer for both x64 and Arm64 that installs the build matching the PC, with its `.blockmap` and the update feed `latest.yml`. The unpacked apps are in `dist/win-unpacked` (x64) and `dist/win-arm64-unpacked`.

The installer needs no administrator: it installs for the current user in `%LOCALAPPDATA%\Programs\switchboard`, with a Start menu and desktop shortcut, and the in-app updater installs updates the same way. Uninstalling (Settings › Apps) keeps your data in `%APPDATA%\Switchboard`, and removes the `switchboard://` link handler the app registers when it starts. `npm run dist:preview` makes an installer without an update feed, as on macOS.

### Opening an unsigned build

Without a code signing certificate the installer and app are unsigned. They run, but on other PCs Windows SmartScreen stops the installer with "Windows protected your PC": choose **More info**, then **Run anyway**.

### Signing

Windows checks an Authenticode signature. Code signing certificates can no longer be exported as a file (since 2023 their keys have to stay in hardware or a cloud service), so the release workflow supports two ways:

- **[Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/)** (recommended): Microsoft signs in the cloud for a monthly fee. You need an Azure subscription, a Trusted Signing account with a *public trust* certificate profile (which verifies your identity), and an app registration with the *Trusted Signing Certificate Profile Signer* role on it.
- **A certificate as a `.pfx` file**, if you have one that can still be exported. electron-builder signs with it through `WIN_CSC_LINK`.

To sign locally with Azure Trusted Signing, set the variables from [Signing secrets](#signing-secrets) in the environment before `npm run dist`; [`scripts/dist.mjs`](../apps/desktop/scripts/dist.mjs) passes them to electron-builder. Check the result in PowerShell:

```powershell
Get-AuthenticodeSignature apps/desktop/dist/Switchboard-*-setup.exe, apps/desktop/dist/win-unpacked/Switchboard.exe
```

The status should be `Valid`. Once the installed app is signed, the in-app updater only installs an update signed by the same publisher.

### What's in the Windows package

- The same configuration as macOS ([`electron-builder.yml`](../apps/desktop/electron-builder.yml) → `win` and `nsis`), with `build/icon.ico` made by `npm run icon` (which on Windows makes only the `.ico`).
- `node-pty`'s Windows binaries (`prebuilds/win32-x64` and `win32-arm64`, with ConPTY) instead of the macOS ones.
- [`build/installer.nsh`](../apps/desktop/build/installer.nsh) adds to the installer: uninstalling removes the `switchboard://` link handler, except during an update.
- `scripts/dist.mjs` names the package `switchboard` for the installer (`extraMetadata.name`, in a config file it writes for Windows builds that extends the one asked for: `scripts/windowsBuildConfig.mjs`), so it installs to `Programs\switchboard` rather than a folder named after the npm workspace. The data folder comes from the product name, so it stays `Switchboard`.

## Linux

### Building the packages

Needs Linux on x64 or Arm64, Node 24+ and npm 11+, git, and what compiles a Node module (`build-essential` and `python3` on Debian and Ubuntu): `node-pty` has no Linux prebuilds, so `npm install` compiles it for this machine. The `.rpm` also needs `rpmbuild` (the `rpm` package on Debian and Ubuntu, `rpm-tools` on Arch). The same commands work:

```bash
npm install
npm run dist
```

This builds, for this machine's architecture only (a build for the other one needs `node-pty` compiled for it, so the release builds each on its own runner):

- `Switchboard-<version>-x86_64.AppImage` (`arm64` on Arm);
- `Switchboard-<version>-amd64.deb` (`arm64`), named `switchboard` in apt, installed in `/opt/Switchboard`, with an AppArmor profile so Electron's sandbox starts on Ubuntu 24.04 and later;
- `Switchboard-<version>-x86_64.rpm` (`aarch64`), named `switchboard` in dnf;
- the update feed `latest-linux.yml` (`latest-linux-arm64.yml` on Arm), which lists all three.

Without `rpmbuild`, [`scripts/dist.mjs`](../apps/desktop/scripts/dist.mjs) says so and builds the AppImage and the `.deb`. electron-builder makes the `.deb` and `.rpm` with its own copy of `fpm`, which needs `libcrypt.so.1`: on Arch that is the `libxcrypt-compat` package. The unpacked app is in `dist/linux-unpacked` (`linux-arm64-unpacked`).

The desktop entry is `switchboard.desktop`, after `desktopName` in `apps/desktop/package.json`, which Electron also gives the window as its app id, so the desktop links the window to the entry and its icon. The `.deb` and `.rpm` register `switchboard://` through the entry.

### Updates

electron-updater updates each package the way it was installed: the AppImage replaces itself (it knows where from `$APPIMAGE`), and the `.deb` and `.rpm` download the new package and install it with `pkexec` (it asks for the password). Which one is in `resources/package-type`, written by the build. A copy run from the unpacked folder can't update, and **Settings → About** says so.

### Signing

Linux packages aren't signed: the release attaches them as they are, next to the signed macOS and Windows builds.

## Releasing (automated in GitHub Actions)

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs when a release is published on GitHub. To release:

1. Add a `## [X.Y.Z] - YYYY-MM-DD` section to [`CHANGELOG.md`](../CHANGELOG.md), written for people using the app.
2. Retake the README screenshots with `npm run screenshots` (see [README screenshots](development.md#readme-screenshots)) and look at each one: does it still match the app and the README text, and does it show what this release changed? A failing run means a view in the tour has changed; fix the tour instead of keeping the old pictures. Commit the images with the CHANGELOG and push.
3. On GitHub, create a release with a new tag `vX.Y.Z` (Releases → Draft a new release) and publish it. You can leave the notes empty.

The workflow then builds for macOS, Windows and Linux side by side, and publishes them together. The macOS job:

1. runs the typecheck and unit tests;
2. builds the app on an Apple Silicon runner, with the version taken from the tag;
3. signs it with your Developer ID, and notarises and staples it;
4. checks the signature, that Gatekeeper accepts it as notarised, and the update feed (`latest-mac.yml`).

The Windows job, on a Windows runner:

1. runs the typecheck and unit tests there too;
2. logs in to Azure without a stored secret (in the GitHub environment `windows-signing`, see [Signing secrets](#signing-secrets));
3. builds the installer with the version from the tag, signed with Azure Trusted Signing or the `.pfx` (it fails when neither is set up);
4. checks that the installer and both apps carry a valid signature by the publisher the app checks updates against (`scripts/checkWindowsSignatures.mjs`, matching the way the in-app updater does). A publisher that didn't match would make every installed copy of the release refuse all later updates, and no later release could fix that. It also checks the update feed (`latest.yml`).

The Linux job runs on an x64 and an Arm64 Ubuntu runner:

1. runs the typecheck and unit tests there too;
2. builds the AppImage, `.deb` and `.rpm` with the version from the tag;
3. checks that there is one of each, that the `.deb` is called `switchboard` and holds the app in `/opt/Switchboard`, and that the update feed (`latest-linux.yml` or `latest-linux-arm64.yml`) lists all three.

Only when all of them have passed, the publish job:

1. attaches `Switchboard-X.Y.Z-arm64.dmg`, the `.zip` and its `.blockmap`, `Switchboard-X.Y.Z-setup.exe` and its `.blockmap`, and the Linux AppImages, `.deb`s and `.rpm`s to the release, then the update feeds last, so a feed never points at a file that isn't there yet;
2. fails if a `latest*.yml` ended up on a draft or pre-release;
3. fills in the release notes from the CHANGELOG section, if you left them empty. The in-app updater shows these notes (cleaned up and shortened) for the new version;
4. for a Stable release, stamps the Homebrew cask with the version and the `.zip`'s checksum and pushes it to [estruyf/homebrew-tap](https://github.com/estruyf/homebrew-tap) (see [Homebrew](homebrew.md)).

When any build fails, nothing is attached: the release never offers one platform without the others. Fix the cause and re-run the failed jobs (the publish job runs once both pass).

**Dry run.** Actions → Release → *Run workflow* builds, signs (and notarises) and checks every build with a version like `X.Y.Z-dryrun.N`, and keeps them as workflow artifacts (`release-mac`, `release-windows`, `release-linux-x64`, `release-linux-arm64`) for a week. There is no publish job: nothing is attached, no feed is written and the Homebrew tap is left alone. Use it after changing a certificate, a secret or a variable, before a real release.

Everyone on the Stable channel is offered the release within a few hours, or straight away with **Check for Updates…**.

### Channels and pre-releases

- **Stable:** a normal (not pre-release) release with a version like `v1.2.3`. Its feeds are `latest-mac.yml`, `latest.yml` (Windows) and `latest-linux.yml` and `latest-linux-arm64.yml`, and the updater finds them on the repository's latest release.
- **Beta:** a *pre-release* tagged like `v1.3.0-beta.1`. The workflow builds it with `-c.publish.channel=beta`, so its feeds are `beta-mac.yml`, `beta.yml` and `beta-linux*.yml`. Apps on the Beta channel look at the newest release or beta pre-release, whichever was published last: they read `beta-mac.yml` from a beta, and fall back to `latest-mac.yml` on a release. So Beta users get each beta and each release. A beta version published as a normal release fails the workflow. Its release notes come from the `## [Unreleased]` section of `CHANGELOG.md`, which keeps sections for releases only.
- **Any other pre-release** (`v1.2.3-rc.1`, say) gets the `.dmg`, `.zip`, installer and Linux packages but no feed, so no one is updated to it. A pre-release version published as a normal release fails the workflow, since Stable users would be offered it.

Each comes from its own branch, and the workflow fails otherwise (`.github/scripts/release-branch.sh`): a release from `main`, a beta from `dev`. `main` holds only what was released; work lands on `dev` and is merged into `main` for a release.

A beta is always for a version after the latest release, and the workflow checks that too: after `v1.2.0`, the betas are `v1.3.0-beta.N` (or `v1.2.1-beta.N`). Beta users get the newest entry on the releases page, so a beta for `1.2.0` published after `v1.2.0` would be what they are offered, and it is older than what they run. Neither channel ever goes back to an older version: someone who leaves Beta while on `v1.3.0-beta.2` stays on it until `v1.3.0` is out.

On macOS only arm64 is built. If an Intel build is added, both architectures must go into one `latest-mac.yml` (a `files` entry each) rather than two feeds overwriting each other. On Windows one installer holds both architectures, so `latest.yml` names a single file.

Nothing is attached unsigned: without the secrets below the run fails. To retry, re-run the failed jobs from the Actions tab.

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

For Windows, set up one of the two ways below. **Azure Trusted Signing** takes these repository *variables* (Settings → Secrets and variables → Actions → Variables), which aren't secret:

| Variable | What it is |
|---|---|
| `AZURE_SIGNING_ENDPOINT` | The account's endpoint for its region, such as `https://weu.codesigning.azure.net` |
| `AZURE_SIGNING_ACCOUNT` | The Trusted Signing account's name |
| `AZURE_SIGNING_PROFILE` | The certificate profile's name |
| `AZURE_SIGNING_PUBLISHER` | The publisher in the certificate (its common name, such as your name or company), exactly as it appears there. The updater checks updates against it |

and these secrets, for the app registration that may sign (it needs the *Trusted Signing Certificate Profile Signer* role on the account):

| Secret | What it is |
|---|---|
| `AZURE_TENANT_ID` | The directory (tenant) ID |
| `AZURE_CLIENT_ID` | The app registration's application (client) ID |
| `AZURE_SUBSCRIPTION_ID` | The subscription that holds the Trusted Signing account |

There is no client secret. The Windows job runs in the GitHub environment `windows-signing` (created on its first run) and logs in with GitHub's OpenID Connect token, which Azure accepts through a federated credential on the app registration. Add it under Certificates & secrets → Federated credentials as *Other issuer*: issuer `https://token.actions.githubusercontent.com`, subject `repo:estruyf@2900833/switchboard@1405532462:environment:windows-signing`, audience `api://AzureADTokenExchange`. GitHub sends the subject with the owner's and repository's IDs, which is why the *GitHub Actions* template's `repo:estruyf/switchboard:…` doesn't match; an `AADSTS700213` error in the Azure login step prints the subject GitHub sent.

**A `.pfx` certificate** takes `WIN_CERTIFICATE_PFX_BASE64`, the `.pfx` base64-encoded (in PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes('cert.pfx')) | Set-Clipboard`), and `WIN_CERTIFICATE_PASSWORD`, its password. When both ways are set up, Azure Trusted Signing is used.

### Testing the packaged app

```bash
npm run smoke:packaged
```

Runs the smoke test (see [Development](development.md)) against `dist/mac-arm64/Switchboard.app` instead of the development build, or on Windows against `dist/win-unpacked/Switchboard.exe` (`win-arm64-unpacked` on an Arm PC), or on Linux against `dist/linux-unpacked/switchboard` (`linux-arm64-unpacked`).

## Testing updates with the mock server

[`apps/desktop/scripts/mock-update-server.ts`](../apps/desktop/scripts/mock-update-server.ts) serves an update feed on `http://localhost:8484`. Starting Switchboard with `SWITCHBOARD_MOCK_UPDATES=1` points the updater at it instead of GitHub (set `SWITCHBOARD_MOCK_UPDATES_URL` for another port). Nothing is published.

**The check and the UI**, with a made-up feed (works from a development build too):

```bash
npm run mock-updates -w @switchboard/desktop -- --fake 9.9.9
SWITCHBOARD_MOCK_UPDATES=1 npm run dev
```

Settings → About → *Check for Updates* finds v9.9.9 with its release notes, and the update message shows in the window's corner. Downloading fails, since there is no build behind a fake feed. The fake feed answers as both `latest-mac.yml` and `latest.yml`, so it works on Windows too; `--fake 9.9.9-beta.1` serves `beta-mac.yml` and `beta.yml` for the Beta channel. The smoke test runs one check against the mock feed when `SWITCHBOARD_MOCK_UPDATES=1` is set (it never downloads).

**The whole flow** (download, restart, *Updated to vX*) needs two signed builds, since Squirrel.Mac only installs an update signed by the same Developer ID:

1. Build the newer version and keep its `dist` folder: `npm pkg set version=0.0.9 -w @switchboard/desktop && npm run dist`, then move `apps/desktop/dist` to, say, `/tmp/switchboard-0.0.9`.
2. Build and install the current version as usual (put `version` back first).
3. Serve the newer one: `npm run mock-updates -w @switchboard/desktop -- --dir /tmp/switchboard-0.0.9`.
4. Open the installed app with the mock feed: `SWITCHBOARD_MOCK_UPDATES=1 /Applications/Switchboard.app/Contents/MacOS/Switchboard`.

On Windows the whole flow also works with unsigned builds, as the updater checks the publisher only when the installed app is signed. Build the newer version and move its `dist` folder aside, build and install the current one with its `Switchboard-<version>-setup.exe`, serve the newer folder with `--dir`, and start `%LOCALAPPDATA%\Programs\switchboard\Switchboard.exe` with `SWITCHBOARD_MOCK_UPDATES=1` set. Uninstall it from Settings › Apps afterwards.

`SWITCHBOARD_DISABLE_AUTO_UPDATE=1` turns updates off for a run, with that reason shown in Settings → About. `Switchboard --version` prints the version and exits.
