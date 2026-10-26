# Memory

Seshboard shows and edits Claude Code's memory. The rule: **nothing is locked into Seshboard.** Everything is written where Claude Code already looks, in the format it already uses, so memory works the same in `claude` in a terminal, the VS Code extension and the desktop app, and keeps working if Seshboard is uninstalled.

## Where memory lives

| What | Where | Loaded |
|---|---|---|
| A project's memory | `<config folder>/projects/<project>/memory/`, for each Claude profile. `<project>` is the repository's root path with every character but letters and digits turned into `-`, so a repository and all its worktrees share one folder. `autoMemoryDirectory` (in the profile's `settings.json` or the project's `.claude/settings.local.json`) moves it. | The first 200 lines or 25 KB of its `MEMORY.md` at the start of every session; the other files when Claude reads them. |
| Personal memory | One folder you choose (Seshboard's app data by default, `~/Library/Application Support/Seshboard/memory`) | Through one `@…/MEMORY.md` line in each profile's `CLAUDE.md` (below). |
| Project instructions | `CLAUDE.md` (root, else `.claude/CLAUDE.md`), `CLAUDE.local.md`, `.claude/rules/*.md`, `CLAUDE.md` in subfolders, `.claude/agent-memory/` | See the load order. |
| Your own instructions | `<config folder>/CLAUDE.md` and `<config folder>/rules/` (`~/.claude/` for the built-in profile) | In every project. |

The committed `.claude/settings.json` can't move a project's memory: a repository you clone shouldn't decide where your private notes go.

## The file format

A memory is a Markdown file with YAML frontmatter, as Claude Code writes it:

```markdown
---
name: sidebar-order
description: Needs you, Working, Pinned, then by day
metadata:
  node_type: memory
  type: project
  originSessionId: 9b9414df-…
  modified: 2026-10-04T14:16:33.977Z
---

The sidebar groups sessions in this order: …
```

- `type` is `user`, `feedback`, `project` or `reference`. Seshboard reads it at the top level or under `metadata`, and writes it under `metadata`.
- Fields Seshboard doesn't know (`node_type`, `aliases`, anything else) are kept as they are when you save.
- `[[name]]` links to another memory by its `name`. A link to a memory that doesn't exist yet is allowed.
- Imported memories add `source: claude-app` and the export's `path` and `updated_at` under `metadata`, so a later import updates them.

`MEMORY.md` is the index: one line per memory, `- [Title](file.md) — hook`. Seshboard adds, changes and removes only the line of the memory you create, rename, move or delete, in the style of the lines already there (the separator after the link, `—`, `:` or `-`). The personal folder's index links its files by full path (`~/…/name.md`), so Claude can open them from any project.

## What loads in a session

The Memory tab's **What loads in a session here** lists, in order, what Claude Code reads at the start of a session in a project (`packages/engine/src/memory/loadOrder.ts`):

1. The profile's `CLAUDE.md`, then the files it imports with `@path` (one level: `@` at the start of a word, outside code, followed by a path relative to the file, `~/…` or absolute).
2. The profile's `rules/*.md`.
3. The project's `CLAUDE.md` (root, else `.claude/CLAUDE.md`) and its imports.
4. `CLAUDE.local.md` and its imports.
5. The project's `.claude/rules/*.md` without `paths:`.
6. The start of `MEMORY.md`: whole lines up to 200 of them and 25 KB, whichever comes first. The rest doesn't load.

Rules limited to some files with `paths:` load **on demand**, when Claude works on matching files; they are listed last. `CLAUDE.md` files in subfolders load when Claude reads files there, and memory files when Claude opens them.

## The personal folder and CLAUDE.md

Claude Code has no memory folder shared by every project, so Seshboard adds one import line to each Claude profile's `CLAUDE.md`, inside a block it owns:

```markdown
<!-- switchboard:memory start -->
@~/Library/Application\ Support/Seshboard/memory/MEMORY.md
<!-- switchboard:memory end -->
```

- Only the index loads; the files are read when Claude needs them, by the full paths in the index.
- The block is added at the end of the file after one blank line, or updated where it is. Nothing else in `CLAUDE.md` changes; **Remove from Claude Code** takes the block (and the blank line before it) out again.
- Spaces in the path are written as `\ `. If Claude Code doesn't read such a path on your setup, choose a folder without spaces.
- Seshboard doesn't use `~/.claude/rules/` (rules load in full in every session), a global `autoMemoryDirectory` (it would merge every project's memory) or settings only its own sessions get (the same project would have different memory in the terminal).
- The settings backup holds the folder's path, never the memories.

A sync tool can leave two versions of a file. Seshboard recognises Dropbox's `name (… conflicted copy …).md`, iCloud's `name 2.md` and Google Drive's `name (1).md` next to `name.md`, and asks which to keep; the other goes to the Trash.

## Search, links and health

Memory stays plain Markdown in these folders; nothing in Seshboard's database is the source of truth.

- **Search** keeps a full-text index of memory files next to the conversations, in the cache database (`memory_fts`, `packages/engine/src/memory/memorySearch.ts`). It reads a file again only when its modified time or size changes, drops files that are gone, and can be thrown away and rebuilt. It refreshes after any change Seshboard or the folder watcher sees.
- **Links** are `[[name]]` or `[[name|label]]` in a memory's text, outside code (`packages/engine/src/memory/links.ts`). A name resolves in the memory's own folder first, then in the personal folder; one that resolves nowhere is "not written yet". Renaming a memory can rewrite the links to it, and only those.
- **Health** (`packages/engine/src/memory/health.ts`) looks for:
  - stale references: names in backticks (or plain words with a `/` and a file type) that look like paths in the repository, `npm run <script>` and `make <target>`, checked against `git ls-files`, the file system, `package.json` and the `Makefile`. Identifiers, function names, flags, URLs and globs are never checked, to keep false alarms out;
  - duplicates: the same name in two folders, or nearly the same description (70% of the words) or text (80%);
  - `MEMORY.md` against its folder: files without a line, lines for files that are gone;
  - an index past 200 lines or 25 KB;
  - memories not changed for 180 days (shown only).

  Results are kept until a file in those folders or the repository's `HEAD` changes. Every fix is one you start; Tidy with Claude… only fills in New session.
- **Remember this** writes a memory with `originSessionId` (the session) and `source: seshboard` (`switchboard` before the rename) under `metadata`, as Claude Code itself records where a memory came from.

## Importing from the Claude app

The Claude app's data export is a manifest with one download link per category. Seshboard reads only `memories` and `projects` (`packages/engine/src/memory/claudeExport.ts`, `memoryImport.ts`); `conversations` is never opened. It accepts `memories-000.zip` (and `projects-000.zip`), the unzipped folder, `memories/<account>.json`, the older single `memories.json` array, or the manifest, in which case it looks for the zips next to it (their links need your claude.ai login, so you download them).

| Export path | Type | Goes to |
|---|---|---|
| `/profile.md`, `/preferences.md` | `user` | Personal |
| `/people/*`, `/topics/*` | `reference` | Personal |
| `/areas/<name>.md` | `project` | The project with that name, else Personal |
| `/projects/<uuid>/*` | `project` | A project you pick (skipped by default) |

Name, description and aliases are kept; `sources` (links to claude.ai conversations) is dropped. File names are the last part of the path, with the folders in front when two collide (`projects-website-overview.md`). The export is undocumented and has changed before, so the reader skips what it doesn't recognise rather than failing.

Pasted text from the app is split into one memory per heading, else per bullet, else per paragraph. It is only ever written to files, never sent to Claude.

## Safety

- Seshboard writes only inside memory folders, the marked block in each profile's `CLAUDE.md`, and instruction files you edit or share into. It never runs a git command that stages, commits or pushes.
- Deleting goes to the Trash, checked again in the main process (`apps/desktop/src/main/trashGuard.ts`): a memory file directly in its folder, never `MEMORY.md`, never through a link.
- The import and Share with the team check text for tokens, keys and passwords (`packages/engine/src/memory/secrets.ts`) and leave such entries unticked.
- Seshboard never sets `CLAUDE_CONFIG_DIR` for the built-in profile.
