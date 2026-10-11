import { memoryMeta, splitFrontmatter } from '@switchboard/protocol/client';

/** Where memory lives, to tell a memory write from any other file edit. */
export interface MemoryFolders {
  /** The home folder, for paths written with `~/`. */
  home: string | null;
  /** Every Claude profile's config folder (`~/.claude` and the ones you added). */
  configDirs: readonly string[];
  /** The personal memory folder. */
  personalDir: string | null;
}

/** A tool call that saved a memory: which file, its name and type (when the call says), and whether it is personal. */
export interface MemoryWrite {
  path: string;
  name: string;
  type: string | null;
  personal: boolean;
}

const WRITES = new Set(['Write', 'Edit', 'MultiEdit']);
/** `<config folder>/projects/<project>/memory/<file>.md`, the part after the config folder. */
const PROJECT_MEMORY = /^projects\/[^/]+\/memory\/[^/]+\.md$/;
/** The same, when the config folders aren't known yet: a `.claude*` folder. */
const ANY_MEMORY = /\/\.claude[^/]*\/projects\/[^/]+\/memory\/[^/]+\.md$/;

/**
 * The memory a Write or Edit saved, or null for any other tool call. A write to MEMORY.md (the index) alone isn't one:
 * it stays a normal file edit. Project memory of every profile counts (a worktree's too: it shares the repository's
 * folder), and so does the personal folder.
 */
export function memoryWriteOf(name: string, input: unknown, folders: MemoryFolders): MemoryWrite | null {
  if (!WRITES.has(name) || !input || typeof input !== 'object') return null;
  const raw = (input as { file_path?: unknown }).file_path;
  if (typeof raw !== 'string' || !raw.endsWith('.md')) return null;
  const path = raw.startsWith('~/') && folders.home ? `${folders.home}${raw.slice(1)}` : raw;
  const file = path.slice(path.lastIndexOf('/') + 1);
  if (file === 'MEMORY.md') return null;
  const dir = path.slice(0, path.lastIndexOf('/'));
  const personal = !!folders.personalDir && dir === folders.personalDir;
  const project = folders.configDirs.length
    ? folders.configDirs.some((configDir) => path.startsWith(`${configDir}/`) && PROJECT_MEMORY.test(path.slice(configDir.length + 1)))
    : ANY_MEMORY.test(path);
  if (!personal && !project) return null;
  // A Write carries the whole file: its frontmatter says the name and type.
  const content = (input as { content?: unknown }).content;
  const meta = typeof content === 'string' ? memoryMeta(splitFrontmatter(content).data) : null;
  return { path, name: meta?.name ?? file.slice(0, -3), type: meta?.type ?? null, personal };
}
