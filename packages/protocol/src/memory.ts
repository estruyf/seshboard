import { z } from 'zod';

/** One file in a project's auto memory folder (not `MEMORY.md`, the index). */
export const MemoryFile = z.object({
  path: z.string(),
  /** The `name:` in its frontmatter, else the file name without `.md`. */
  name: z.string(),
  description: z.string().nullable(),
  /** `user`, `feedback`, `project` or `reference` as Claude Code writes them (top level or under `metadata`); null when missing. */
  type: z.string().nullable(),
  modified: z.number(),
  bytes: z.number(),
  /** The Claude profile whose folder holds it; null for the personal folder. */
  profileId: z.string().nullable(),
  /** The session that wrote it (`metadata.originSessionId`, which Claude Code adds). */
  originSessionId: z.string().nullable(),
  /** Where it came from (`metadata.source`: `claude-app`, `seshboard`, `switchboard` before the rename), when it says. */
  source: z.string().nullable(),
  /** A sync tool's conflicted copy (`name 2.md`, `name (conflicted copy).md`): the path of the memory it stands for. */
  conflictOf: z.string().nullable(),
});
export type MemoryFile = z.infer<typeof MemoryFile>;

/**
 * Something to look at in a memory folder. `staleReference`: a memory names a file, script or target the project no
 * longer has (`refs`). `duplicate`: two memories say the same (`memoryPaths` has both). `indexMismatch`: files missing
 * from MEMORY.md (`memoryPaths`) or lines pointing at missing files (`refs`). `overLimit`: MEMORY.md past what loads
 * (`linesNotLoaded`). `old`: unchanged for 180 days (only shown).
 */
export const HealthFinding = z.object({
  kind: z.enum(['staleReference', 'duplicate', 'indexMismatch', 'overLimit', 'old']),
  memoryPaths: z.array(z.string()),
  detail: z.string(),
  refs: z.array(z.string()).optional(),
  indexPath: z.string().optional(),
  linesNotLoaded: z.number().optional(),
});
export type HealthFinding = z.infer<typeof HealthFinding>;

/** A memory found by search (or written in a session): where it is and, for a search, the matching text. */
export const MemoryHit = z.object({
  path: z.string(),
  /** The project whose memory it is; null for the personal folder. */
  root: z.string().nullable(),
  profileId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.string().nullable(),
  modified: z.number(),
  /** The session that wrote it, when it says. */
  origin: z.string().nullable(),
  /** The match with the found words between \u0002 and \u0003 (empty when not from a search). */
  snippet: z.string(),
});
export type MemoryHit = z.infer<typeof MemoryHit>;

/** The personal memory folder (loaded in every project) and whether each profile's CLAUDE.md loads it. */
export const PersonalMemory = z.object({
  dir: z.string(),
  /** Where it is when you haven't chosen a folder (inside the app's data). */
  defaultDir: z.string(),
  exists: z.boolean(),
  memories: z.array(MemoryFile),
  indexLines: z.number(),
  indexBytes: z.number(),
  /** When the folder is synced or shared (iCloud Drive, Dropbox, Google Drive, OneDrive, a git repository): which. */
  synced: z.string().nullable(),
  /** Per Claude profile: its CLAUDE.md, whether the block is there, and whether it points at this folder. */
  profiles: z.array(z.object({ profileId: z.string(), claudeMd: z.string(), installed: z.boolean(), upToDate: z.boolean() })),
});
export type PersonalMemory = z.infer<typeof PersonalMemory>;

/** `claude-md`: CLAUDE.md at the root or in `.claude/`. `local`: a CLAUDE.local.md. `rule`: a file in `.claude/rules/`. `subfolder`: CLAUDE.md in a subfolder. `agent-memory`: a subagent's memory in `.claude/agent-memory/`. */
export const InstructionKind = z.enum(['claude-md', 'local', 'rule', 'subfolder', 'agent-memory']);
export type InstructionKind = z.infer<typeof InstructionKind>;

/** A file of project instructions Claude Code loads. */
export const InstructionFile = z.object({
  path: z.string(),
  kind: InstructionKind,
  /** A rule's `paths:` frontmatter: it only loads for files that match. */
  paths: z.array(z.string()).optional(),
  /** Committed with the project (not CLAUDE.local.md, and not ignored by git). */
  shared: z.boolean(),
  bytes: z.number(),
});
export type InstructionFile = z.infer<typeof InstructionFile>;

export const MemoryList = z.object({
  /** The folder new memories go to (the project's profile), or null when none could be worked out. */
  memoryDir: z.string().nullable(),
  memories: z.array(MemoryFile),
  instructions: z.array(InstructionFile),
  /** The lines of that folder's `MEMORY.md` (0 when there is none). Claude Code reads the first 200. */
  indexLines: z.number(),
});
export type MemoryList = z.infer<typeof MemoryList>;

/** Where a shared memory goes. */
export const ShareTarget = z.discriminatedUnion('kind', [
  /** The existing CLAUDE.md (root first, else `.claude/CLAUDE.md`), or a new root CLAUDE.md. */
  z.object({ kind: z.literal('claude-md') }),
  /** `.claude/rules/<file>.md`, existing or new; `paths` is written as frontmatter for a new one. */
  z.object({
    kind: z.literal('rule'),
    file: z.string().min(1).max(200),
    paths: z.array(z.string().min(1).max(500)).max(50).optional(),
  }),
  /** CLAUDE.local.md at the root: only for you. */
  z.object({ kind: z.literal('local') }),
]);
export type ShareTarget = z.infer<typeof ShareTarget>;

/**
 * `sameHeading`: the target has a section with this heading already. `alreadyThere`: the exact text is in it.
 * `secrets`: the text looks like it holds a token, key or password (`detail` says what). `localNotIgnored`: git
 * would commit CLAUDE.local.md. `targetDirty`: the target has uncommitted changes.
 */
export const ShareWarningKind = z.enum(['sameHeading', 'alreadyThere', 'secrets', 'localNotIgnored', 'targetDirty']);
export type ShareWarningKind = z.infer<typeof ShareWarningKind>;
export const ShareWarning = z.object({ kind: ShareWarningKind, detail: z.string().nullable() });
export type ShareWarning = z.infer<typeof ShareWarning>;

export const SharePreview = z.object({
  targetPath: z.string(),
  exists: z.boolean(),
  before: z.string(),
  after: z.string(),
  /** A unified diff of before and after. */
  diff: z.string(),
  warnings: z.array(ShareWarning),
});
export type SharePreview = z.infer<typeof SharePreview>;

/**
 * One file Claude Code loads in a session, in load order. `kind`: the profile's CLAUDE.md (`user`), its rules
 * (`user-rule`), the project's CLAUDE.md (`project`), CLAUDE.local.md (`local`), a project rule (`rule`), something a
 * CLAUDE.md imports with `@` (`import`), or MEMORY.md (`memory`).
 */
export const LoadEntry = z.object({
  path: z.string(),
  kind: z.enum(['user', 'user-rule', 'project', 'local', 'rule', 'import', 'memory']),
  scope: z.enum(['personal', 'project', 'local']),
  when: z.enum(['launch', 'on-demand']),
  bytes: z.number(),
  lines: z.number(),
  /** MEMORY.md: how much of it loads (the first 200 lines or 25 KB). */
  loaded: z.object({ lines: z.number(), bytes: z.number() }).optional(),
  /** A rule that loads on demand: the paths it is for. */
  paths: z.array(z.string()).optional(),
  /** An import: the file that imports it. */
  importedFrom: z.string().optional(),
});
export type LoadEntry = z.infer<typeof LoadEntry>;

/**
 * One memory an import would write. `target`: `personal`, a project root, or `skip`. `status`: not imported before
 * (`new`), or imported before and the export's copy is `newer`, the `same` or `older` (by `updated_at`).
 */
export const ImportEntry = z.object({
  id: z.string(),
  /** The export's path (`/topics/writing.md`); null for pasted text. */
  exportPath: z.string().nullable(),
  fileName: z.string(),
  name: z.string(),
  description: z.string(),
  type: z.string(),
  target: z.string(),
  /** The Claude project it belongs to (by name when the export has `projects`, else its uuid). */
  claudeProject: z.string().nullable(),
  /** The name of an existing memory it looks like (same name, or nearly the same description). */
  duplicateOf: z.string().nullable(),
  /** Its text looks like it holds a token, key or password: left unticked. */
  secret: z.boolean(),
  /** An area with no Seshboard project of that name: it goes to Personal unless you pick one. */
  noProject: z.boolean(),
  status: z.enum(['new', 'newer', 'same', 'older']),
  checked: z.boolean(),
  /** The start of its text. */
  excerpt: z.string(),
});
export type ImportEntry = z.infer<typeof ImportEntry>;

export const MemoryImportPreview = z.object({
  /** Hands the read entries to `memory.import`; valid until the next preview. */
  token: z.string(),
  entries: z.array(ImportEntry),
  /** Projects an entry can go to. */
  projects: z.array(z.object({ root: z.string(), name: z.string() })),
  /** The personal MEMORY.md's lines now. */
  personalIndexLines: z.number(),
});
export type MemoryImportPreview = z.infer<typeof MemoryImportPreview>;

/** A memory Copy for Claude app can pick: from the personal folder or a project. */
export const ExportCandidate = z.object({ path: z.string(), name: z.string(), description: z.string().nullable(), type: z.string().nullable(), where: z.string(), root: z.string().nullable() });
export type ExportCandidate = z.infer<typeof ExportCandidate>;

/** What a section copied to memory would write (or wrote). */
export const SectionCopy = z.object({
  path: z.string(),
  /** The name it gets: the one asked for, or with `-2`, `-3` … when that file exists. */
  name: z.string(),
  content: z.string(),
  /** The line it adds to MEMORY.md. */
  indexLine: z.string(),
  /** MEMORY.md's lines afterwards. */
  indexLines: z.number(),
});
export type SectionCopy = z.infer<typeof SectionCopy>;
