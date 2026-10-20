# CLAUDE.md

@AGENTS.md

AGENTS.md (imported above, so there is no need to read it again) has the architecture, commands, conventions and how to keep a feature's runs short (Working on a feature). The UI rules in `.claude/rules/ui.md` load by themselves when you work in `apps/ui`. Open the detail they point to (`docs/ui-patterns.md`, the subsystem docs) only for the area you change.

## While building a feature

- Run the related tests (`npx vitest run <files>`), the typecheck and `npm run smoke -- --only "<step label>"` after each step. The full `npm run check` and `npm run smoke` run once, at the end; the full smoke from a terminal with no Claude session in this repository.
- Per feature, the docs need only its `CHANGELOG.md` line and its entry in `website/src/content/features.json` (the coverage test in `npm run check` requires it). Pages and screenshots wait for the release.

## Releases

Before every release, go through [docs/releasing.md](docs/releasing.md): the release steps and the docs checklist (docs pages, `features.json`, website screenshots, `npm run website:build`). A release is not done until the docs are updated.
