# Homebrew

`brew install --cask estruyf/tap/seshboard` installs the same signed, notarised `.zip` the release page has, and puts `Seshboard.app` in `/Applications`.

The cask is [`homebrew/seshboard.rb`](../homebrew/seshboard.rb), and this repository is where it is edited. [`homebrew/publish-cask.sh`](../homebrew/publish-cask.sh) stamps it with a version and a checksum and copies it into [estruyf/homebrew-tap](https://github.com/estruyf/homebrew-tap), so the tap holds a generated file. Never edit it there: the next release overwrites the change.

The cask was called `switchboard` before the app was renamed. The publish script writes `cask_renames.json` in the tap (`"switchboard": "seshboard"`) and removes `Casks/switchboard.rb`, so `brew upgrade` moves existing installs to the new name and `brew install --cask estruyf/tap/switchboard` still resolves. Keep the rename in the tap.

The cask uses the `.zip`, not the `.dmg`. The `.dmg` is for people dragging the app to Applications; the `.zip` is what the in-app updater installs from, so it is on every release anyway, and Homebrew doesn't have to mount anything.

## What the cask says, and why

- **`auto_updates true`.** Seshboard updates itself from the release feed (see [Building and signing](building-and-signing.md)), so `brew upgrade` skips it instead of reinstalling over a copy the app may already have replaced. `brew upgrade --cask estruyf/tap/seshboard`, or `brew upgrade --greedy`, updates it through Homebrew anyway; both work because the tap moves on every release.
- **`depends_on arch: :arm64`.** Only an Apple Silicon build is released. If an Intel build is added, the cask needs an `arch` block with a URL and checksum for each.
- **`depends_on macos: :ventura`.** `LSMinimumSystemVersion` is 13.0, Electron's floor. The in-app updater has no floor of its own, so this has to move when an Electron upgrade raises it. Check with `plutil -p Seshboard.app/Contents/Info.plist | grep LSMinimum`.
- **`uninstall quit:`** so an upgrade doesn't replace the bundle under a running copy.
- **`zap trash:`** lists Seshboard's own files: its app data, the updater caches, preferences and saved window state. Sessions live in `~/.claude`, which belongs to Claude Code, so `brew uninstall --zap` never touches them.

## Every release

Nothing by hand. For a Stable release (published, not a pre-release), the last step of the [release workflow](../.github/workflows/release.yml) hashes the `.zip` it just notarised (the exact bytes attached to the release, so it can't race the CDN), stamps the cask and pushes it to the tap. Pre-releases, nightlies included, are skipped: a cask carries one version, and it should be the one `releases/latest` returns.

The push uses the `HOMEBREW_TAP_TOKEN` repository secret: a fine-grained personal access token scoped to `estruyf/homebrew-tap` alone, with **Contents: read and write**. The built-in `GITHUB_TOKEN` can't be used, since it has no access to other repositories. Without the secret the workflow warns and carries on, so a missing token delays the tap rather than failing a release.

## By hand

If a release missed the tap, or to seed it:

```bash
VERSION=0.0.7 HOMEBREW_TAP_TOKEN=<token> ./homebrew/publish-cask.sh --push
```

Without `--push` the script stamps the cask and prints it, which shows what would land. With no `ZIP=` and no matching file in `apps/desktop/dist`, it downloads the release asset. `brew style homebrew/seshboard.rb` lints the cask; outside a tap it also reports missing Sorbet and frozen-string comments, which casks don't use.

## homebrew-cask

`brew install --cask seshboard`, with no tap, would need a pull request to [homebrew-cask](https://github.com/Homebrew/homebrew-cask). `brew audit --new` requires the repository to be at least 30 days old with 75 stars (or 30 forks or watchers), and three times that for a self-submission. The tap is a complete install path on its own; people who installed from it keep getting updates there.
