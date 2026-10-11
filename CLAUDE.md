# CLAUDE.md

Read [AGENTS.md](AGENTS.md) first: it has the architecture, commands, conventions and design system for Switchboard. This file adds the release checklist.

## Release checklist

The website (`website/`, published at https://switchboard.struyfconsulting.com/) documents every feature. Do these before every release, next to the steps under Releases in AGENTS.md:

1. For every user-facing change since the last release (the `## [Unreleased]` section of `CHANGELOG.md`), check that its docs page in `website/src/content/docs/` is updated. Add a page if the feature is new, and add it to the sidebar in `website/src/sidebar.mjs`.
2. Update `website/src/content/features.json` (one entry per feature, with the page that covers it) and make sure the coverage test passes: `npx vitest run website` (it is part of `npm run check`). It fails when a palette command, a shortcut, a Settings section or a project tab has no entry, or when an entry points at a page that doesn't exist.
3. On a Mac, run `npm run website:screenshots` and commit the changed images in `website/src/assets/screenshots/`. Look at them: demo data only, no real projects, paths or names. If a screen fails, its `data-*` hooks changed: fix `scripts/website-screenshots.ts` rather than skipping it.
4. Check that `CHANGELOG.md` has the release section and that the Changelog page shows it (`npm run website:dev`, then `/changelog/`).
5. Run `npm run website:build`. It validates every internal link (`starlight-links-validator`) and fails on a broken one or a missing screenshot; it must pass.
6. A release is not done until the docs are updated.

Docs cover macOS and Windows. Shortcuts go through `<Kbd shortcut="…">` (or `keys="mod+…"`), which shows each reader the keys of their platform; words that differ use `<Os mac="Finder" windows="File Explorer" />`, and whole passages for one platform `<OnlyOn os="windows">`. Never type ⌘ or Ctrl in the text for a shortcut.

The keyboard shortcuts page and the changelog page are generated at build time from `apps/ui/src/lib/shortcuts.ts` and `CHANGELOG.md`, so they need no edits. Writing rules for the docs are the same as for the app (AGENTS.md, Copy): plain short sentences, no em dashes, the exact labels from the UI.
