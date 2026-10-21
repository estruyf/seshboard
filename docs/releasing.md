# Releasing

How a Switchboard release is prepared and published, and the docs checklist that goes with it. Branches (`dev` and `main`) are in [AGENTS.md](../AGENTS.md#branches). None of this is needed while building a feature: per feature, only the `CHANGELOG.md` line and the `website/src/content/features.json` entry are (see AGENTS.md, Working on a feature).

## Release

Releases are built by `.github/workflows/release.yml`, which runs when a release is published on GitHub. Prepare it on `dev`:

1. Rename the `## [Unreleased]` section of `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD` (or add that section, written for people using the app), and set `version` in `apps/desktop/package.json` to match.
2. Retake the README screenshots with `npm run screenshots` and look at every image in `docs/screenshots` against the README's alt text and the CHANGELOG section. If the tour fails, a view it drives has changed: fix `apps/desktop/src/main/screenshotTour.ts` (or the demo world in `scripts/screenshot-demo.ts`) rather than skipping it. If a released feature belongs in a picture that doesn't show it yet, update the demo world or add a view. Commit the new images with the release.
3. Go through the [docs checklist](#docs-checklist): docs pages, `features.json`, website screenshots and `npm run website:build`. A release is not done until the docs are updated.
4. Merge `dev` into `main` (`git checkout main && git merge --ff-only dev`) and push both.
5. Publish a GitHub release with tag `vX.Y.Z` on `main` (only when the user asks). The notes may be left empty; the workflow fills them from the CHANGELOG section.

**Hotfix.** A fix that can't wait for the next release: commit it on `main`, add its `## [X.Y.Z]` section and version, release it from `main`, then merge `main` back into `dev`.

**Beta.** Lighter, for testing what comes next between releases: publish a GitHub *pre-release* tagged `vX.Y.Z-beta.N` on `dev` (only when the user asks), where `X.Y.Z` is the next release, never one already out (the workflow checks). Leave `## [Unreleased]` and `apps/desktop/package.json` as they are; the version comes from the tag and the notes from Unreleased. Screenshots and the docs checklist wait for the release. Only apps on the Beta channel are offered it (see [building-and-signing.md](building-and-signing.md#channels-and-pre-releases)).

The workflow builds for macOS, Windows and Linux side by side, with the version from the tag: the Mac job signs and notarises the app and checks Gatekeeper accepts it; the Windows job builds the installer, signs it (Azure Trusted Signing through a secretless OpenID Connect login in the `windows-signing` environment, or a `.pfx`) and checks the signatures and their publisher; the Linux jobs (x64 and Arm64 runners) build the AppImage, `.deb` and `.rpm`, which aren't signed. Only when all pass does the publish job attach all the files to the release, the update feeds last, so a release never has one platform without the others. It never attaches an unsigned macOS or Windows build. Run by hand, the workflow is a dry run: every build is made (macOS and Windows signed) and kept as workflow artifacts, and nothing is published. For a Stable release it then pushes the stamped cask (`homebrew/switchboard.rb`) to `estruyf/homebrew-tap`; edit the cask here, never in the tap (see `docs/homebrew.md`). `npm run dist:notarized` is for checking a signed build locally.

The VS Code companion is released separately by `.github/workflows/release-vscode.yml`, to the Visual Studio Marketplace and Open VSX: a GitHub release tagged `vscode-vX.Y.Z` (which `release.yml` skips), a commit on `main` whose message has both `#release` and `#vscode`, or a manual run. Bump `version` in `apps/vscode-extension/package.json` and add a section to `apps/vscode-extension/CHANGELOG.md` first; only release when the user asks. See [vscode-companion.md](vscode-companion.md#releasing-the-extension).

## Docs checklist

The website (`website/`, published at https://switchboard.struyfconsulting.com/) documents every feature. Do these before every release, as step 3 of the release above:

1. For every user-facing change since the last release (the `## [Unreleased]` section of `CHANGELOG.md`), check that its docs page in `website/src/content/docs/` is updated. Add a page if the feature is new, and add it to the sidebar in `website/src/sidebar.mjs`.
2. Update `website/src/content/features.json` (one entry per feature, with the page that covers it) and make sure the coverage test passes: `npx vitest run website` (it is part of `npm run check`). It fails when a palette command, a shortcut, a Settings section or a project tab has no entry, or when an entry points at a page that doesn't exist.
3. On a Mac, run `npm run website:screenshots` and commit the changed images in `website/src/assets/screenshots/`. Look at them: demo data only, no real projects, paths or names. If a screen fails, its `data-*` hooks changed: fix `scripts/website-screenshots.ts` rather than skipping it.
4. Check that `CHANGELOG.md` has the release section and that the Changelog page shows it (`npm run website:dev`, then `/changelog/`).
5. Run `npm run website:build`. It validates every internal link (`starlight-links-validator`) and fails on a broken one or a missing screenshot; it must pass.
6. A release is not done until the docs are updated.

Docs cover macOS and Windows. Shortcuts go through `<Kbd shortcut="…">` (or `keys="mod+…"`), which shows each reader the keys of their platform; words that differ use `<Os mac="Finder" windows="File Explorer" />`, and whole passages for one platform `<OnlyOn os="windows">`. Never type ⌘ or Ctrl in the text for a shortcut.

The keyboard shortcuts page and the changelog page are generated at build time from `apps/ui/src/lib/shortcuts.ts` and `CHANGELOG.md`, so they need no edits. Writing rules for the docs are the same as for the app ([AGENTS.md](../AGENTS.md#ui), Copy): plain short sentences, no em dashes, the exact labels from the UI.
