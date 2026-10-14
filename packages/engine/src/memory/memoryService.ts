import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, parse, relative, resolve } from 'node:path';
import {
  countLines,
  memoryFileText,
  memoryIndexLine,
  memoryMeta,
  parseSections,
  RpcError,
  sameHeading,
  sectionBody,
  slugify,
  splitFrontmatter,
  validMemoryName,
  type LoadEntry,
  type ExportCandidate,
  type ImportEntry,
  type MemoryImportPreview,
  type HealthFinding,
  type MemoryList,
  type PersonalMemory,
  type SectionCopy,
  type SharePreview,
  type ShareTarget,
  type ShareWarning,
  isSameOrInside,
} from '@switchboard/protocol';
import { git } from '../git/gitChanges.ts';
import { ignoredPaths, isInside, listInstructionFiles, listMemoryFiles, memoryDirFor, statQuiet } from './folders.ts';
import { importedFileText, similar, textForClaudeApp, type Candidate } from './claudeExport.ts';
import { loadOrder, memoryIndexCut } from './loadOrder.ts';
import { duplicates, indexMismatch, makeTargetsOf, oldMemories, staleReferences } from './health.ts';
import { resolveLinks, rewriteLinks, type LinkedMemory, type LinkMap } from './links.ts';
import { blockLine, conflictBase, importLine, syncedBy, tildePath, withBlock, withoutBlock } from './personal.ts';
import { findSecrets } from './secrets.ts';
import { editMemoryFile } from './frontmatterEdit.ts';
import { appendIndexLine, containsText, placeSection, removeIndexLine, restoreIndexLine, rulePathsFrontmatter, shareBody, styledIndexLine, unifiedDiff, updateIndexLine, parseIndexLine } from './textEdit.ts';

/** Where a memory file may go to the Trash: its own memory folder, or (undoing a new instruction file) the project. */
export type MemoryTrashScope = { memoryDir: string } | { instructionsRoot: string };

export interface MemoryServiceOptions {
  /** Every Claude profile's id and config folder, the project's own profile first. */
  profiles(root: string): Array<{ id: string; configDir: string }>;
  /** The main repository a project's folder belongs to (a worktree's, or the folder itself outside git). */
  repoRoot?(root: string): string;
  /** The personal memory folder, loaded in every project; null while there is none. */
  personalDir?(): string | null;
  /** Where the personal folder is until one is chosen. */
  personalDefault?: string;
  /** Remembers a chosen personal folder. */
  savePersonalDir?(dir: string): void;
  /** Every Claude profile, for the block in each one's CLAUDE.md. */
  allProfiles?(): Array<{ id: string; configDir: string }>;
  /** The home folder (`~`), for paths Claude Code reads. */
  home?: string;
  trash(paths: string[], scope: MemoryTrashScope): Promise<void>;
}

export interface ShareRequest {
  root: string;
  memoryPath: string;
  target: ShareTarget;
  heading: string;
  placement: 'add' | 'replace';
}

/** What `memory.undoShare` needs to put the last share back. */
interface UndoRecord {
  token: string;
  root: string;
  targetPath: string;
  /** The target before the share; null when the share made it. */
  before: string | null;
  after: string;
  memory: { path: string; content: string; index: { path: string; line: string; at: number } | null } | null;
}

const MEMORY_INDEX = 'MEMORY.md';
/** A rule's name: folders and a file name of letters, digits, `.`, `_` and `-` (no `..`). */
const RULE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Where an imported memory came from: `metadata.source`, the export's `path` and its `updated_at`. */
function exportMeta(text: string): { source: string | null; exportPath: string | null; updatedAt: string | null } {
  const data = splitFrontmatter(text).data;
  const meta = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? (data.metadata as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return { source: str(meta.source), exportPath: str(meta.path), updatedAt: str(meta.updated_at) };
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * A project's memory and instructions: reading them, sharing a memory into the instructions (with a preview and an
 * undo), and copying a section of the instructions into memory. It writes only inside the project and its memory
 * folders, and never runs a git command that changes anything.
 */
export class MemoryService {
  private last: UndoRecord | null = null;
  /** Health per project (`''` for the personal folder), until a file or the repository's HEAD changes. */
  private readonly healthCache = new Map<string, { signature: string; findings: HealthFinding[] }>();
  /** The candidates of the last import preview, for `applyImport`. */
  private imports: { token: string; candidates: Map<string, Candidate> } | null = null;
  /** Memories moved to the Trash, by undo token: their text and MEMORY.md line, to put back. */
  private readonly removed = new Map<string, { path: string; content: string; index: { path: string; line: string; at: number } | null }>();

  constructor(private readonly options: MemoryServiceOptions) {}

  /** The project's memory folders with their profile, the project's own profile first (whether they exist or not). */
  folders(root: string): Array<{ dir: string; profileId: string }> {
    const repoRoot = this.options.repoRoot?.(root) ?? root;
    const seen = new Set<string>();
    return this.options.profiles(root).flatMap((profile) => {
      const dir = resolve(memoryDirFor(profile.configDir, root, repoRoot));
      if (seen.has(dir)) return [];
      seen.add(dir);
      return [{ dir, profileId: profile.id }];
    });
  }

  /** The project's memory folders, one per profile, the project's own profile first. */
  dirs(root: string): string[] {
    return this.folders(root).map((f) => f.dir);
  }

  async list(root: string): Promise<MemoryList> {
    const dirs = this.dirs(root);
    const memories = this.folders(root)
      .flatMap((f) => listMemoryFiles(f.dir, f.profileId))
      .sort((a, b) => b.modified - a.modified);
    const home = dirs[0] ?? null;
    const index = home ? readText(join(home, MEMORY_INDEX)) : null;
    return { memoryDir: home, memories, instructions: await listInstructionFiles(root), indexLines: index ? countLines(index) : 0 };
  }

  /** The memory folders a request may touch: the project's (for `root`) and the personal folder. */
  private memoryFolders(root: string | null): string[] {
    const personal = this.options.personalDir?.() ?? null;
    return [...(root ? this.dirs(root) : []), ...(personal ? [resolve(personal)] : [])];
  }

  /** A memory file (not the index) right inside one of those folders, and a regular file. Returns its folder. */
  private memoryFileDir(root: string | null, path: string): string {
    const dir = dirname(path);
    if (resolve(path) !== path || !path.endsWith('.md') || basename(path) === MEMORY_INDEX || !this.memoryFolders(root).includes(dir)) throw new RpcError('FORBIDDEN', 'That isn’t a memory Switchboard can change');
    const stat = statQuiet(path);
    if (!stat) throw new RpcError('NOT_FOUND', `${basename(path)} is gone`);
    if (!stat.isFile()) throw new RpcError('FORBIDDEN', `${basename(path)} is a link; Switchboard doesn’t write through it`);
    return dir;
  }

  /** Where a new memory goes: the personal folder (`root` null), or the project's folder of a profile (its own by default). */
  private targetFolder(root: string | null, profileId?: string | null): string {
    if (root === null) {
      const personal = this.options.personalDir?.() ?? null;
      if (!personal) throw new RpcError('NOT_FOUND', 'There is no personal memory folder yet');
      return resolve(personal);
    }
    const folders = this.folders(root);
    const folder = profileId ? folders.find((f) => f.profileId === profileId) : folders[0];
    if (!folder) throw new RpcError('NOT_FOUND', 'No memory folder for this project and profile');
    return folder.dir;
  }

  /**
   * Writes a new memory in Claude Code's format (the type under `metadata`) and adds its MEMORY.md line, in the style
   * of the lines already there. A name that's taken is refused (NAME_TAKEN): nothing is ever overwritten.
   */
  create(params: { root: string | null; profileId?: string | null; name: string; type: string; description: string; body: string; metadata?: Record<string, string> }): { path: string } {
    if (!validMemoryName(params.name)) throw new RpcError('INVALID', 'A name can only have letters, digits, “.”, “_” and “-”');
    const dir = this.targetFolder(params.root, params.profileId);
    const file = `${params.name}.md`;
    const path = join(dir, file);
    if (existsSync(path)) throw new RpcError('NAME_TAKEN', `There is a memory called ${params.name} already`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, memoryFileText({ name: params.name, description: params.description, type: params.type, body: params.body, metadata: params.metadata }), { flag: 'wx' });
    const indexPath = join(dir, MEMORY_INDEX);
    const index = readText(indexPath) ?? '';
    // The personal index is read from every project, so it links its files by full path.
    const link = params.root === null ? tildePath(path, this.home) : file;
    writeFileSync(indexPath, appendIndexLine(index, styledIndexLine(index, params.name, link, params.description)));
    return { path };
  }

  /**
   * Saves a memory's description, type and body, keeping every other frontmatter field. When the file changed on disk
   * since it was read (`expectedModified`), it refuses (CHANGED) unless `force`. A new description also becomes the
   * hook of its MEMORY.md line.
   */
  write(params: { root: string | null; path: string; description: string; type: string; body: string; expectedModified: number | null; force: boolean }): { modified: number } {
    const dir = this.memoryFileDir(params.root, params.path);
    const before = readText(params.path) ?? '';
    const modified = statSync(params.path).mtimeMs;
    if (params.expectedModified !== null && !params.force && Math.abs(modified - params.expectedModified) > 1) throw new RpcError('CHANGED', `${basename(params.path)} changed on disk since you opened it`);
    const old = memoryMeta(splitFrontmatter(before).data);
    writeFileSync(params.path, editMemoryFile(before, { description: params.description, type: params.type }, params.body));
    if ((old.description ?? '') !== params.description.replace(/\s+/g, ' ').trim()) {
      const indexPath = join(dir, MEMORY_INDEX);
      const index = readText(indexPath);
      const updated = index === null ? null : updateIndexLine(index, basename(params.path), { hook: params.description });
      if (updated !== null && updated !== index) writeFileSync(indexPath, updated);
    }
    return { modified: statSync(params.path).mtimeMs };
  }

  /** The memories `links` and Rename look at: the project's folders (every profile) and the personal one. */
  private linkedMemories(root: string | null): LinkedMemory[] {
    return this.memoryFolders(root).flatMap((dir) =>
      listMemoryFiles(dir, null).map((m) => ({ path: m.path, name: m.name, body: splitFrontmatter(readText(m.path) ?? '').body })),
    );
  }

  /** Every memory's `[[name]]` links (resolved in its own folder, then the personal one) and what links to it. */
  links(root: string | null): LinkMap {
    return resolveLinks(this.linkedMemories(root), this.personalDirOrNull());
  }

  /**
   * Renames a memory: its file, its `name:` and its MEMORY.md line (the title too when it was the old name). With
   * `updateLinks`, the `[[old]]` links to it in other memories follow (only those; nothing else in them changes).
   */
  rename(params: { root: string | null; path: string; name: string; updateLinks?: boolean }): { path: string; updatedLinks: string[] } {
    const dir = this.memoryFileDir(params.root, params.path);
    if (!validMemoryName(params.name)) throw new RpcError('INVALID', 'A name can only have letters, digits, “.”, “_” and “-”');
    const file = `${params.name}.md`;
    const next = join(dir, file);
    if (next === params.path) return { path: next, updatedLinks: [] };
    if (existsSync(next)) throw new RpcError('NAME_TAKEN', `There is a memory called ${params.name} already`);
    const oldName = memoryMeta(splitFrontmatter(readText(params.path) ?? '').data).name ?? basename(params.path, '.md');
    const linking = params.updateLinks ? (this.links(params.root)[params.path]?.backlinks ?? []) : [];
    const text = readText(params.path) ?? '';
    renameSync(params.path, next);
    writeFileSync(next, editMemoryFile(text, { name: params.name }));
    const indexPath = join(dir, MEMORY_INDEX);
    const index = readText(indexPath);
    const updated = index === null ? null : updateIndexLine(index, basename(params.path), { file });
    if (updated !== null) writeFileSync(indexPath, updated);
    const updatedLinks: string[] = [];
    for (const path of linking) {
      if (path === params.path) continue;
      const before = readText(path);
      if (before === null) continue;
      const after = rewriteLinks(before, oldName, params.name);
      if (after !== before) {
        writeFileSync(path, after);
        updatedLinks.push(path);
      }
    }
    return { path: next, updatedLinks };
  }

  /** Moves a memory to the Trash and takes out its MEMORY.md line. The token undoes it (`restore`). */
  async remove(params: { root: string | null; path: string }): Promise<{ undoToken: string }> {
    const dir = this.memoryFileDir(params.root, params.path);
    const content = readText(params.path) ?? '';
    await this.options.trash([params.path], { memoryDir: dir });
    const indexPath = join(dir, MEMORY_INDEX);
    const index = readText(indexPath);
    const removed = index === null ? null : removeIndexLine(index, basename(params.path));
    if (removed) writeFileSync(indexPath, removed.text);
    const undoToken = randomUUID();
    this.removed.set(undoToken, { path: params.path, content, index: removed ? { path: indexPath, line: removed.line, at: removed.at } : null });
    // A handful of deletes can be undone; older tokens lapse.
    while (this.removed.size > 20) this.removed.delete(this.removed.keys().next().value!);
    return { undoToken };
  }

  /** Puts a removed memory and its MEMORY.md line back. */
  restore(token: string): { path: string } {
    const record = this.removed.get(token);
    if (!record) throw new RpcError('EXPIRED', 'That can’t be undone any more');
    if (existsSync(record.path)) throw new RpcError('CHANGED', `There is a new ${basename(record.path)}; nothing was put back`);
    mkdirSync(dirname(record.path), { recursive: true });
    writeFileSync(record.path, record.content, { flag: 'wx' });
    if (record.index) writeFileSync(record.index.path, restoreIndexLine(readText(record.index.path) ?? '', record.index.line, record.index.at));
    this.removed.delete(token);
    return { path: record.path };
  }

  private get home(): string {
    return this.options.home ?? homedir();
  }

  /** The personal folder, its memories and index, and whether each profile's CLAUDE.md loads it. */
  personal(): PersonalMemory {
    const dir = resolve(this.options.personalDir?.() ?? this.options.personalDefault ?? join(this.home, '.switchboard-memory'));
    const index = readText(join(dir, MEMORY_INDEX)) ?? '';
    const line = importLine(dir, this.home);
    return {
      dir,
      defaultDir: this.options.personalDefault ?? dir,
      exists: existsSync(dir),
      memories: listMemoryFiles(dir, null),
      indexLines: countLines(index),
      indexBytes: Buffer.byteLength(index),
      synced: syncedBy(dir, this.home, (d) => existsSync(join(d, '.git'))),
      profiles: (this.options.allProfiles?.() ?? []).map((p) => {
        const claudeMd = join(p.configDir, 'CLAUDE.md');
        const found = blockLine(readText(claudeMd) ?? '');
        return { profileId: p.id, claudeMd, installed: found !== null, upToDate: found === line };
      }),
    };
  }

  /** The block as it goes into CLAUDE.md (for Show the line). */
  blockText(): string {
    return withBlock('', importLine(this.personal().dir, this.home)).trimEnd();
  }

  /** What adding the block changes in each profile's CLAUDE.md, before anything is written. */
  blockPreview(): Array<{ profileId: string; path: string; exists: boolean; diff: string }> {
    const line = importLine(this.personal().dir, this.home);
    return (this.options.allProfiles?.() ?? []).map((p) => {
      const path = join(p.configDir, 'CLAUDE.md');
      const before = readText(path);
      const after = withBlock(before ?? '', line);
      return { profileId: p.id, path, exists: before !== null, diff: unifiedDiff(before ?? '', after, tildePath(path, this.home), before === null) };
    });
  }

  /**
   * Loads the personal folder in every profile: the marked block with one `@…/MEMORY.md` line in each profile's
   * CLAUDE.md (made when missing), and the folder and its MEMORY.md made when missing. Nothing else in CLAUDE.md changes.
   */
  installBlock(): void {
    const dir = this.personal().dir;
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, MEMORY_INDEX))) writeFileSync(join(dir, MEMORY_INDEX), '');
    const line = importLine(dir, this.home);
    for (const p of this.options.allProfiles?.() ?? []) {
      const path = join(p.configDir, 'CLAUDE.md');
      const before = readText(path);
      const after = withBlock(before ?? '', line);
      if (after !== before) {
        mkdirSync(p.configDir, { recursive: true });
        writeFileSync(path, after);
      }
    }
  }

  /** Remove from Claude Code: takes the block out of every profile's CLAUDE.md. The memory files stay. */
  removeBlock(): void {
    for (const p of this.options.allProfiles?.() ?? []) {
      const path = join(p.configDir, 'CLAUDE.md');
      const before = readText(path);
      if (before !== null && blockLine(before) !== null) writeFileSync(path, withoutBlock(before));
    }
  }

  /** Points the personal folder somewhere else; a block already in CLAUDE.md follows it (it is Switchboard's own line). */
  setPersonalDir(dir: string): PersonalMemory {
    // Not a drive's or the disk's root (`/`, `C:\`), nor the home folder itself (compared as Windows does there, without regard to case).
    const isHome = isSameOrInside(dir, this.home) && isSameOrInside(this.home, dir);
    if (resolve(dir) !== dir || dir === parse(dir).root || isHome) throw new RpcError('INVALID', 'Choose a folder of its own for personal memory');
    const installed = this.personal().profiles.some((p) => p.installed);
    this.options.savePersonalDir?.(dir);
    if (installed) this.installBlock();
    return this.personal();
  }

  /**
   * Moves a memory between the project's folder and the personal one: the file and both MEMORY.md lines (out of one,
   * into the other, keeping its title and hook). A name taken in the other folder is refused (NAME_TAKEN).
   */
  async move(params: { root: string; path: string; to: 'personal' | 'project'; profileId?: string | null }): Promise<{ path: string }> {
    const from = this.memoryFileDir(params.root, params.path);
    const to = this.targetFolder(params.to === 'personal' ? null : params.root, params.profileId);
    if (from === to) return { path: params.path };
    const file = basename(params.path);
    const next = join(to, file);
    if (existsSync(next)) throw new RpcError('NAME_TAKEN', `There is a memory called ${file.replace(/\.md$/, '')} there already`);
    const content = readText(params.path) ?? '';
    const fromIndexPath = join(from, MEMORY_INDEX);
    const fromIndex = readText(fromIndexPath);
    const removed = fromIndex === null ? null : removeIndexLine(fromIndex, file);
    const old = removed ? parseIndexLine(removed.line.trimEnd()) : null;
    mkdirSync(to, { recursive: true });
    try {
      renameSync(params.path, next);
    } catch (error) {
      // Another volume (a synced folder on an external disk): copy it, then the original goes to the Trash.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw new RpcError('MOVE_FAILED', `Couldn't move it: ${(error as Error).message}`);
      writeFileSync(next, content, { flag: 'wx' });
      await this.options.trash([params.path], { memoryDir: from });
    }
    if (removed) writeFileSync(fromIndexPath, removed.text);
    const toIndexPath = join(to, MEMORY_INDEX);
    const toIndex = readText(toIndexPath) ?? '';
    const hook = old?.hook || (memoryMeta(splitFrontmatter(content).data).description ?? '');
    const link = to === this.personalDirOrNull() ? tildePath(next, this.home) : file;
    writeFileSync(toIndexPath, appendIndexLine(toIndex, styledIndexLine(toIndex, old?.title || file.replace(/\.md$/, ''), link, hook)));
    return { path: next };
  }

  /**
   * Copies a project memory into the same project's folder of another Claude profile, with a MEMORY.md line there. A name
   * that's taken there gets `-2`, `-3`, …; the copy's `name:` follows.
   */
  copyToProfile(params: { root: string; path: string; profileId: string }): { path: string } {
    this.memoryFileDir(params.root, params.path);
    const to = this.folders(params.root).find((f) => f.profileId === params.profileId)?.dir;
    if (!to) throw new RpcError('NOT_FOUND', 'That profile has no folder for this project');
    if (to === dirname(params.path)) throw new RpcError('INVALID', 'It is in that profile already');
    const stem = basename(params.path, '.md');
    let name = stem;
    for (let n = 2; existsSync(join(to, `${name}.md`)); n++) name = `${stem}-${n}`;
    const content = readText(params.path) ?? '';
    const next = join(to, `${name}.md`);
    mkdirSync(to, { recursive: true });
    writeFileSync(next, name === stem ? content : editMemoryFile(content, { name }), { flag: 'wx' });
    const sourceIndex = readText(join(dirname(params.path), MEMORY_INDEX)) ?? '';
    const line = sourceIndex.split(/\r?\n/).map(parseIndexLine).find((l) => l && (l.link === basename(params.path) || l.link.endsWith(`/${basename(params.path)}`)));
    const indexPath = join(to, MEMORY_INDEX);
    const index = readText(indexPath) ?? '';
    const hook = line?.hook || (memoryMeta(splitFrontmatter(content).data).description ?? '');
    writeFileSync(indexPath, appendIndexLine(index, styledIndexLine(index, line && line.title !== stem ? line.title : name, `${name}.md`, hook)));
    return { path: next };
  }

  /**
   * Saves an instruction file of the project (CLAUDE.md, a rule, CLAUDE.local.md, agent memory). Only files the project's
   * list has; CHANGED when it changed on disk after `expectedModified` unless `force`. Nothing is staged.
   */
  async writeInstruction(params: { root: string; path: string; content: string; expectedModified: number | null; force: boolean }): Promise<{ modified: number; changedInGit: boolean }> {
    const { instructions } = await this.list(params.root);
    const file = instructions.find((i) => i.path === params.path);
    if (!file) throw new RpcError('FORBIDDEN', 'Only this project’s instruction files can be saved here');
    this.assertWritable(params.root, params.path);
    const modified = statSync(params.path).mtimeMs;
    if (params.expectedModified !== null && !params.force && Math.abs(modified - params.expectedModified) > 1) throw new RpcError('CHANGED', `${basename(params.path)} changed on disk since you opened it`);
    writeFileSync(params.path, params.content);
    const changedInGit = file.shared && (await this.isDirty(params.root, relative(params.root, params.path)));
    return { modified: statSync(params.path).mtimeMs, changedInGit };
  }

  /** A sync conflict: keep this copy (it replaces the memory it stands for) or the other one (this copy goes). Both to the Trash. */
  async resolveConflict(params: { root: string | null; path: string; keep: 'this' | 'other' }): Promise<{ path: string }> {
    const dir = this.memoryFileDir(params.root, params.path);
    const base = conflictBase(basename(params.path), (name) => existsSync(join(dir, name)));
    if (!base) throw new RpcError('NOT_FOUND', 'That isn’t a conflicted copy any more');
    const original = join(dir, base);
    if (params.keep === 'other') {
      await this.options.trash([params.path], { memoryDir: dir });
      return { path: original };
    }
    const content = readText(params.path) ?? '';
    await this.options.trash([original], { memoryDir: dir });
    renameSync(params.path, original);
    writeFileSync(original, editMemoryFile(content, { name: base.replace(/\.md$/, '') }));
    return { path: original };
  }

  /** For each project: how many memories it has and how full its MEMORY.md is (its own profile's folder). */
  overview(roots: readonly string[]): Array<{ root: string; memories: number; indexLines: number }> {
    return roots.map((root) => {
      const folders = this.folders(root);
      const index = folders[0] ? readText(join(folders[0].dir, MEMORY_INDEX)) : null;
      return { root, memories: folders.reduce((n, f) => n + listMemoryFiles(f.dir, f.profileId).length, 0), indexLines: index ? countLines(index) : 0 };
    });
  }

  /**
   * What importing these candidates would do: where each goes (an area to the project with its name, a Claude project's
   * files skipped until you pick a project), whether it was imported before (by its export path) and is newer now, and
   * what to look at (a duplicate, something like a secret). Remembered under a token for `applyImport`.
   */
  planImport(candidates: Candidate[], projects: Array<{ root: string; name: string }>, claudeProjects: Map<string, string> = new Map()): MemoryImportPreview {
    const personalDir = this.personal().dir;
    const folderOf = (target: string) => (target === 'personal' ? personalDir : target === 'skip' ? null : (this.dirs(target)[0] ?? null));
    const known = new Map<string, Array<{ path: string; name: string; description: string; source: string | null; exportPath: string | null; updatedAt: string | null }>>();
    const memoriesIn = (dir: string) => {
      let found = known.get(dir);
      if (!found) {
        found = listMemoryFiles(dir, null).map((m) => {
          const meta = exportMeta(readText(m.path) ?? '');
          return { path: m.path, name: m.name, description: m.description ?? '', ...meta };
        });
        known.set(dir, found);
      }
      return found;
    };
    const entries = candidates.map((c): ImportEntry => {
      let target = 'personal';
      let noProject = false;
      if (c.suggestion.kind === 'claude-project') target = 'skip';
      if (c.suggestion.kind === 'area') {
        const area = slugify(c.suggestion.name);
        const match = projects.find((p) => slugify(p.name) === area || slugify(basename(p.root)) === area);
        if (match) target = match.root;
        else noProject = true;
      }
      const dir = folderOf(target);
      const existing = dir ? memoriesIn(dir) : [];
      const before = c.id.startsWith('paste:') ? undefined : existing.find((m) => m.source === 'claude-app' && m.exportPath === c.id);
      const status = !before ? 'new' : !c.updatedAt || !before.updatedAt || c.updatedAt === before.updatedAt ? 'same' : c.updatedAt > before.updatedAt ? 'newer' : 'older';
      const others = [...existing, ...(dir === personalDir ? [] : memoriesIn(personalDir))].filter((m) => m !== before);
      const duplicate = others.find((m) => m.name.toLowerCase() === c.name.toLowerCase() || similar(m.description, c.description));
      const secret = findSecrets(`${c.description}\n${c.body}`).length > 0;
      return {
        id: c.id,
        exportPath: c.id.startsWith('paste:') ? null : c.id,
        fileName: c.fileName,
        name: c.name,
        description: c.description,
        type: c.type,
        target,
        claudeProject: c.suggestion.kind === 'claude-project' ? (claudeProjects.get(c.suggestion.uuid) ?? c.suggestion.uuid) : null,
        duplicateOf: duplicate?.name ?? null,
        secret,
        noProject,
        status,
        checked: target !== 'skip' && (status === 'new' || status === 'newer') && !secret && !duplicate,
        excerpt: c.body.slice(0, 280),
      };
    });
    const token = randomUUID();
    this.imports = { token, candidates: new Map(candidates.map((c) => [c.id, c])) };
    const index = readText(join(personalDir, MEMORY_INDEX)) ?? '';
    return { token, entries, projects, personalIndexLines: countLines(index) };
  }

  /**
   * Writes the picked entries: a new file (its name made unique in that folder) with a MEMORY.md line, or, for one
   * imported before from the same export path, the file updated in place and its line's hook. Never anything else.
   */
  applyImport(token: string, picks: Array<{ id: string; target: string; type: string }>, roots: readonly string[]): { created: number; updated: number } {
    if (!this.imports || this.imports.token !== token) throw new RpcError('EXPIRED', 'Preview the import again');
    let created = 0;
    let updated = 0;
    const personalDir = this.personal().dir;
    for (const pick of picks) {
      const c = this.imports.candidates.get(pick.id);
      if (!c || pick.target === 'skip') continue;
      if (pick.target !== 'personal' && !roots.includes(pick.target)) throw new RpcError('FORBIDDEN', 'Import only into your projects or Personal');
      const dir = pick.target === 'personal' ? personalDir : this.dirs(pick.target)[0];
      if (!dir) continue;
      mkdirSync(dir, { recursive: true });
      const text = importedFileText(c, slugify(pick.type), c.id.startsWith('paste:') ? 'claude-app-paste' : 'claude-app');
      const indexPath = join(dir, MEMORY_INDEX);
      const index = readText(indexPath) ?? '';
      const before = c.id.startsWith('paste:') ? undefined : listMemoryFiles(dir, null).find((m) => {
        const meta = exportMeta(readText(m.path) ?? '');
        return meta.source === 'claude-app' && meta.exportPath === c.id;
      });
      if (before) {
        writeFileSync(before.path, text);
        const next = updateIndexLine(index, basename(before.path), { hook: c.description });
        if (next !== null && next !== index) writeFileSync(indexPath, next);
        updated++;
        continue;
      }
      const stem = c.fileName.replace(/\.md$/, '');
      let file = `${stem}.md`;
      for (let n = 2; existsSync(join(dir, file)) || stem.toLowerCase() === 'memory'; n++) file = `${stem}-${n}.md`;
      writeFileSync(join(dir, file), text, { flag: 'wx' });
      const link = dir === personalDir ? tildePath(join(dir, file), this.home) : file;
      writeFileSync(indexPath, appendIndexLine(index, styledIndexLine(index, c.name, link, c.description)));
      created++;
    }
    return { created, updated };
  }

  /** Memories Copy for Claude app can pick: the personal folder's, then each project's (its own profile). */
  exportCandidates(projects: Array<{ root: string; name: string }>): ExportCandidate[] {
    const personal = this.personal().memories.filter((m) => !m.conflictOf).map((m) => ({ path: m.path, name: m.name, description: m.description, type: m.type, where: 'Personal', root: null }));
    const projectMemories = projects.flatMap((p) => this.folders(p.root).slice(0, 1).flatMap((f) => listMemoryFiles(f.dir, f.profileId).map((m) => ({ path: m.path, name: m.name, description: m.description, type: m.type, where: p.name, root: p.root }))));
    return [...personal, ...projectMemories];
  }

  /** One plain-text block of these memories for the Claude app. Only memory files of these projects or the personal folder. */
  exportText(paths: readonly string[], roots: readonly string[]): string {
    const allowed = new Set([this.personal().dir, ...roots.flatMap((r) => this.dirs(r))]);
    const memories = paths.map((path) => {
      if (resolve(path) !== path || !allowed.has(dirname(path)) || basename(path) === MEMORY_INDEX) throw new RpcError('FORBIDDEN', 'Only memory files can be copied');
      const { data, body } = splitFrontmatter(readText(path) ?? '');
      const meta = memoryMeta(data);
      return { name: meta.name ?? basename(path, '.md'), description: meta.description, body };
    });
    return textForClaudeApp(memories);
  }

  /**
   * What to look at in the project's memory folders and the personal one (`root` null: the personal one only): stale
   * references (project memory only, checked against git's files, the file system, package.json scripts and Makefile
   * targets), duplicates, MEMORY.md against its folder, an index past what loads, and memories untouched for 180 days.
   * Kept until a file in those folders or the repository's HEAD changes.
   */
  async health(root: string | null, now = Date.now()): Promise<HealthFinding[]> {
    const folders = this.memoryFolders(root).filter((dir) => existsSync(dir));
    const memories = folders.flatMap((dir) =>
      listMemoryFiles(dir, null)
        .filter((m) => !m.conflictOf)
        .map((m) => ({ ...m, description: m.description ?? '', body: splitFrontmatter(readText(m.path) ?? '').body })),
    );
    const head = root ? (await git(root, ['rev-parse', 'HEAD']).catch(() => '')).trim() : '';
    const signature = [head, ...folders.map((dir) => `${dir}:${statQuiet(join(dir, MEMORY_INDEX), true)?.mtimeMs ?? 0}`), ...memories.map((m) => `${m.path}:${m.modified}`)].join('|');
    const key = root ?? '';
    const cached = this.healthCache.get(key);
    if (cached && cached.signature === signature) return cached.findings;

    const findings: HealthFinding[] = [];
    if (root) {
      const projectMemories = memories.filter((m) => this.dirs(root).includes(dirname(m.path)));
      const tracked = new Set((await git(root, ['ls-files', '--cached', '--others', '--exclude-standard']).catch(() => '')).split('\n').filter(Boolean));
      const exists = (p: string) => tracked.has(p) || [...tracked].some((t) => t.startsWith(`${p}/`)) || existsSync(join(root, p));
      const pkg = readText(join(root, 'package.json'));
      let scripts: Set<string> | null = null;
      try {
        if (pkg) scripts = new Set(Object.keys((JSON.parse(pkg) as { scripts?: Record<string, unknown> }).scripts ?? {}));
      } catch {
        // A package.json that doesn't parse can't say which scripts there are.
      }
      const makefile = readText(join(root, 'Makefile'));
      findings.push(...staleReferences(projectMemories, { exists, scripts, makeTargets: makefile === null ? null : makeTargetsOf(makefile) }));
    }
    findings.push(...duplicates(memories));
    for (const dir of folders) {
      const indexPath = join(dir, MEMORY_INDEX);
      const index = readText(indexPath);
      findings.push(...indexMismatch(indexPath, index, memories.filter((m) => dirname(m.path) === dir)));
      if (index !== null) {
        const cut = memoryIndexCut(index);
        const lines = countLines(index);
        if (cut.lines < lines) findings.push({ kind: 'overLimit', memoryPaths: [], detail: `MEMORY.md has ${lines} lines; Claude only reads ${cut.lines}`, indexPath, linesNotLoaded: lines - cut.lines });
      }
    }
    findings.push(...oldMemories(memories, now));
    this.healthCache.set(key, { signature, findings });
    return findings;
  }

  /** MEMORY.md with only the lines for missing files taken out and lines for unlisted memories added, before and after. */
  fixIndexPreview(root: string | null, indexPath: string): { before: string; after: string; diff: string } {
    const dir = dirname(indexPath);
    if (basename(indexPath) !== MEMORY_INDEX || !this.memoryFolders(root).includes(dir)) throw new RpcError('FORBIDDEN', 'That isn’t a memory folder’s MEMORY.md');
    const before = readText(indexPath) ?? '';
    const files = listMemoryFiles(dir, null).filter((m) => !m.conflictOf);
    let after = before;
    for (const line of before.split(/\r?\n/)) {
      const parsed = parseIndexLine(line);
      const file = parsed ? basename(parsed.link) : null;
      if (!file?.endsWith('.md') || files.some((f) => basename(f.path) === file)) continue;
      after = removeIndexLine(after, file)?.text ?? after;
    }
    const personal = dir === this.personalDirOrNull();
    for (const f of files) {
      if (removeIndexLine(after, basename(f.path))) continue;
      after = appendIndexLine(after, styledIndexLine(after, f.name, personal ? tildePath(f.path, this.home) : basename(f.path), f.description ?? ''));
    }
    return { before, after, diff: unifiedDiff(before, after, 'MEMORY.md', before === '') };
  }

  /** Writes what `fixIndexPreview` shows. */
  fixIndex(root: string | null, indexPath: string): void {
    const { before, after } = this.fixIndexPreview(root, indexPath);
    if (after !== before) writeFileSync(indexPath, after);
  }

  private personalDirOrNull(): string | null {
    const dir = this.options.personalDir?.() ?? null;
    return dir ? resolve(dir) : null;
  }

  /** What a session in the project loads at launch with a profile (the project's own when not given). */
  loadOrder(root: string, profileId: string | null): { profileId: string; entries: LoadEntry[] } {
    const profiles = this.options.profiles(root);
    const profile = (profileId ? profiles.find((p) => p.id === profileId) : undefined) ?? profiles[0];
    if (!profile) throw new RpcError('NOT_FOUND', 'No Claude profile');
    const repoRoot = this.options.repoRoot?.(root) ?? root;
    return { profileId: profile.id, entries: loadOrder({ configDir: profile.configDir, root, memoryDir: memoryDirFor(profile.configDir, root, repoRoot) }) };
  }

  /** A file inside the project or one of its memory folders, without following a link out of them. */
  read(root: string | null, path: string): string {
    const real = this.realOrNull(path);
    // The profiles' own CLAUDE.md and rules load in every project, so What loads here can open them too.
    const configDirs = root ? this.options.profiles(root).map((p) => p.configDir) : [];
    const allowed = [...(root ? [root] : []), ...this.memoryFolders(root), ...configDirs.map((dir) => join(dir, 'rules'))].map((dir) => this.realOrNull(dir)).filter((dir): dir is string => dir !== null);
    const files = configDirs.map((dir) => this.realOrNull(join(dir, 'CLAUDE.md')));
    if (!real || !(allowed.some((dir) => isInside(dir, real)) || files.includes(real))) throw new RpcError('FORBIDDEN', 'Only memory and instruction files of this project can be read here');
    const content = readText(real);
    if (content === null) throw new RpcError('NOT_FOUND', `${basename(path)} can't be read`);
    return content;
  }

  async sharePreview(request: ShareRequest): Promise<SharePreview> {
    return (await this.plan(request)).preview;
  }

  async share(request: ShareRequest & { removeMemory: boolean; secretsChecked: boolean }): Promise<{ targetPath: string; removed: boolean; undoToken: string }> {
    const { preview, memoryContent } = await this.plan(request);
    const kinds = new Set(preview.warnings.map((w) => w.kind));
    if (kinds.has('alreadyThere')) throw new RpcError('ALREADY_THERE', `This text is in ${basename(preview.targetPath)} already`);
    if (kinds.has('secrets') && !request.secretsChecked) throw new RpcError('SECRETS', 'The text looks like it holds a secret; check it first');
    // Checked again right before writing: a folder could have been swapped for a link since the preview.
    this.assertWritable(request.root, preview.targetPath);
    mkdirSync(dirname(preview.targetPath), { recursive: true });
    writeFileSync(preview.targetPath, preview.after);
    let memory: UndoRecord['memory'] = null;
    if (request.removeMemory) {
      try {
        await this.options.trash([request.memoryPath], { memoryDir: dirname(request.memoryPath) });
      } catch (error) {
        // The share is all or nothing: put the target back.
        writeFileSync(preview.targetPath, preview.before);
        throw new RpcError('TRASH_FAILED', `Couldn't move the memory to the Trash: ${(error as Error).message}`);
      }
      const indexPath = join(dirname(request.memoryPath), MEMORY_INDEX);
      const index = readText(indexPath);
      const removed = index === null ? null : removeIndexLine(index, basename(request.memoryPath));
      if (removed) writeFileSync(indexPath, removed.text);
      memory = { path: request.memoryPath, content: memoryContent, index: removed ? { path: indexPath, line: removed.line, at: removed.at } : null };
    }
    const undoToken = randomUUID();
    this.last = { token: undoToken, root: request.root, targetPath: preview.targetPath, before: preview.exists ? preview.before : null, after: preview.after, memory };
    return { targetPath: preview.targetPath, removed: memory !== null, undoToken };
  }

  /** Puts the last share back. Returns the project it was in. */
  async undoShare(token: string): Promise<string> {
    const record = this.last;
    if (!record || record.token !== token) throw new RpcError('EXPIRED', 'Only the last share can be undone');
    const name = basename(record.targetPath);
    if (readText(record.targetPath) !== record.after) throw new RpcError('CHANGED', `${name} changed since; undo it there by hand`);
    if (record.memory && existsSync(record.memory.path)) throw new RpcError('CHANGED', `There is a new ${basename(record.memory.path)} in memory; nothing was undone`);
    this.assertWritable(record.root, record.targetPath);
    if (record.before === null) await this.options.trash([record.targetPath], { instructionsRoot: record.root });
    else writeFileSync(record.targetPath, record.before);
    if (record.memory) {
      mkdirSync(dirname(record.memory.path), { recursive: true });
      writeFileSync(record.memory.path, record.memory.content, { flag: 'wx' });
      const { index } = record.memory;
      if (index) writeFileSync(index.path, restoreIndexLine(readText(index.path) ?? '', index.line, index.at));
    }
    this.last = null;
    return record.root;
  }

  /** Adds CLAUDE.local.md to the project's .gitignore. */
  ignoreLocal(root: string): string {
    const path = join(root, '.gitignore');
    this.assertWritable(root, path);
    const current = readText(path) ?? '';
    const eol = current.includes('\r\n') ? '\r\n' : '\n';
    if (!current.split(/\r?\n/).some((line) => line.trim() === 'CLAUDE.local.md' || line.trim() === '/CLAUDE.local.md')) {
      writeFileSync(path, `${current === '' || current.endsWith('\n') ? current : current + eol}CLAUDE.local.md${eol}`);
    }
    return path;
  }

  /** Copies a section of an instruction file into a new memory (or, `dryRun`, says what it would write). */
  async createFromSection(params: { root: string; file: string; heading: string; name: string; type: string; description: string; dryRun: boolean }): Promise<SectionCopy> {
    const { instructions } = await this.list(params.root);
    if (!instructions.some((i) => i.path === params.file)) throw new RpcError('FORBIDDEN', 'Only a section of this project’s instructions can be copied');
    const text = this.read(params.root, params.file);
    const section = parseSections(text).find((s) => s.level >= 2 && s.level <= 3 && sameHeading(s.title, params.heading));
    if (!section) throw new RpcError('NOT_FOUND', `There is no section "${params.heading}" in ${basename(params.file)}`);
    const dir = this.dirs(params.root)[0];
    if (!dir) throw new RpcError('NOT_FOUND', 'No memory folder for this project');
    // A name that's taken gets -2, -3, …: an existing memory is never overwritten.
    const base = slugify(params.name);
    let name = base;
    for (let n = 2; existsSync(join(dir, `${name}.md`)) || name === 'MEMORY'; n++) name = `${base}-${n}`;
    const path = join(dir, `${name}.md`);
    const content = memoryFileText({ name, description: params.description, type: slugify(params.type), body: sectionBody(text, section) });
    const indexPath = join(dir, MEMORY_INDEX);
    const indexLine = memoryIndexLine(section.title, `${name}.md`, params.description);
    const index = appendIndexLine(readText(indexPath) ?? '', indexLine);
    if (!params.dryRun) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, content, { flag: 'wx' });
      writeFileSync(indexPath, index);
    }
    return { path, name, content, indexLine, indexLines: countLines(index) };
  }

  /** The target file, what it becomes, and the warnings; everything `share` writes comes from here. */
  private async plan(request: ShareRequest): Promise<{ preview: SharePreview; memoryContent: string }> {
    const { root, memoryPath, target, heading, placement } = request;
    this.assertMemoryFile(root, memoryPath);
    const memoryContent = readText(memoryPath);
    if (memoryContent === null) throw new RpcError('NOT_FOUND', `${basename(memoryPath)} is gone`);
    const body = shareBody(splitFrontmatter(memoryContent).body);
    const targetPath = this.targetPath(root, target);
    this.assertWritable(root, targetPath);
    const current = readText(targetPath);
    const exists = current !== null;
    const before = current ?? '';
    // A new rule scoped to some paths starts with its frontmatter.
    const base = !exists && target.kind === 'rule' && target.paths?.length ? rulePathsFrontmatter(target.paths) : before;
    const placed = placeSection(base, heading, body, placement);
    const rel = relative(root, targetPath);
    const warnings: ShareWarning[] = [];
    const secrets = findSecrets(`${heading}\n${body}`);
    if (secrets.length) warnings.push({ kind: 'secrets', detail: secrets.join(', ') });
    if (containsText(before, body)) warnings.push({ kind: 'alreadyThere', detail: null });
    else if (placed.sameHeading) warnings.push({ kind: 'sameHeading', detail: heading });
    if (target.kind === 'local' && (await this.isRepo(root)) && !(await ignoredPaths(root, [targetPath])).has(targetPath)) warnings.push({ kind: 'localNotIgnored', detail: null });
    if (exists && (await this.isDirty(root, rel))) warnings.push({ kind: 'targetDirty', detail: rel });
    return {
      preview: { targetPath, exists, before, after: placed.after, diff: unifiedDiff(before, placed.after, rel, !exists), warnings },
      memoryContent,
    };
  }

  private targetPath(root: string, target: ShareTarget): string {
    if (target.kind === 'local') return join(root, 'CLAUDE.local.md');
    if (target.kind === 'claude-md') {
      const atRoot = join(root, 'CLAUDE.md');
      const inClaude = join(root, '.claude', 'CLAUDE.md');
      return existsSync(atRoot) || !existsSync(inClaude) ? atRoot : inClaude;
    }
    const file = target.file.trim().replace(/\.md$/i, '');
    if (!RULE_NAME.test(file) || file.split('/').some((part) => part === '..' || part === '.')) throw new RpcError('INVALID', 'A rule’s name can only have letters, digits, “.”, “_”, “-” and “/”');
    return join(root, '.claude', 'rules', `${file}.md`);
  }

  /** A memory file of this project: a `.md` file (not MEMORY.md) right inside one of its memory folders, not a link. */
  private assertMemoryFile(root: string, path: string): void {
    const dirs = this.dirs(root);
    const ok = resolve(path) === path && path.endsWith('.md') && basename(path) !== MEMORY_INDEX && dirs.includes(dirname(path));
    if (!ok || !statQuiet(path)?.isFile()) throw new RpcError('FORBIDDEN', 'That isn’t one of this project’s memories');
  }

  /**
   * A file the share may write: inside the project once every folder on the way is resolved, and not itself a link.
   * Folders that don't exist yet are made later, under the deepest one that does (checked here).
   */
  private assertWritable(root: string, path: string): void {
    const realRoot = this.realOrNull(root);
    if (!realRoot || resolve(path) !== path || !isInside(root, path)) throw new RpcError('FORBIDDEN', 'Switchboard only writes inside the project');
    let existing = dirname(path);
    while (!existsSync(existing) && isInside(root, existing) && existing !== root) existing = dirname(existing);
    const real = this.realOrNull(existing);
    if (!real || !isInside(realRoot, real)) throw new RpcError('FORBIDDEN', `${relative(root, path)} leads outside the project`);
    if (statQuiet(path)?.isSymbolicLink()) throw new RpcError('FORBIDDEN', `${relative(root, path)} is a link; Switchboard doesn’t write through it`);
  }

  private realOrNull(path: string): string | null {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  }

  private async isRepo(root: string): Promise<boolean> {
    return (await git(root, ['rev-parse', '--is-inside-work-tree']).catch(() => '')).trim() === 'true';
  }

  /** Uncommitted changes to the file (staged, unstaged or untracked). */
  private async isDirty(root: string, rel: string): Promise<boolean> {
    if (!(await this.isRepo(root))) return false;
    return (await git(root, ['status', '--porcelain', '--untracked-files=all', '--', rel]).catch(() => '')).trim() !== '';
  }
}
