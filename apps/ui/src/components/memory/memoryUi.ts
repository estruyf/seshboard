import { isSameOrInside, MEMORY_INDEX_LIMIT, parseSections, validMemoryName, type InstructionFile, type ShareTarget, type ShareWarning } from '@switchboard/protocol/client';
import type { PillTone } from '../ui/buttonStyles.ts';

/** The memory types as the editor offers them, in this order. */
export const TYPE_CHOICES = ['user', 'feedback', 'project', 'reference'] as const;

/** Why a name for a new or renamed memory can't be used, or null when it can. */
export function memoryNameProblem(name: string, taken: Iterable<string>): string | null {
  if (!name) return 'Give it a name.';
  if (!validMemoryName(name)) return 'Use lowercase letters, digits and “-” (it becomes the file name).';
  const lower = name.toLowerCase();
  for (const other of taken) if (other.toLowerCase() === lower) return `There is a memory called ${name} already.`;
  return null;
}

/** The pill a memory's type shows in: each type its own tone, an unknown one quiet. */
export function typeTone(type: string | null): PillTone {
  switch (type) {
    case 'feedback':
      return 'caution';
    case 'reference':
      return 'link';
    case 'user':
      return 'ok';
    case 'project':
      return 'default';
    default:
      return 'muted';
  }
}

/** A path inside the project as people know it (`CLAUDE.md`, `.claude/rules/ui.md`; with `\` on Windows). */
export const relativeTo = (root: string, path: string) =>
  path !== root && isSameOrInside(path, root) ? path.slice(root.replace(/[\\/]+$/, '').length + 1) : path;

/** How an instruction file is described in the list: where it loads and whether the team gets it. */
export function instructionDetail(file: InstructionFile): string {
  const where =
    file.kind === 'rule'
      ? file.paths?.length
        ? `paths: ${file.paths.join(', ')}`
        : 'every file'
      : file.kind === 'subfolder'
        ? 'when Claude works in that folder'
        : file.kind === 'agent-memory'
          ? 'a subagent’s memory'
          : 'root';
  const kb = file.bytes < 1024 ? `${file.bytes} B` : `${(file.bytes / 1024).toFixed(1)} KB`;
  return `${where} · ${kb}`;
}

/** The profiles a project's memories are in, in the order given (each once): the filter shows only with two or more. */
export function memoryProfiles(memories: ReadonlyArray<{ profileId: string | null }>, order: readonly string[]): string[] {
  const present = new Set(memories.map((m) => m.profileId).filter((id): id is string => id !== null));
  return order.filter((id) => present.has(id));
}

/** The memories a profile filter shows: all of them, or one profile's. */
export const filterByProfile = <T extends { profileId: string | null }>(memories: readonly T[], profileId: string) => (profileId === 'all' ? [...memories] : memories.filter((m) => m.profileId === profileId));

/** The three places a memory can go, as the dialog's segments show them. */
export type TargetKind = ShareTarget['kind'];

/** "Remove it from memory after sharing" starts on for the team's files, off for CLAUDE.local.md (it stays yours either way). */
export const removeByDefault = (kind: TargetKind) => kind !== 'local';

/** A rule's name as typed (`ui`, `frontend/ui.md`) is fine: letters, digits, `.`, `_`, `-`, folders with `/`. */
export const validRuleName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(name.trim().replace(/\.md$/i, ''));

/** The rule file a name stands for, as the button says it: `rules/ui.md`. */
export const ruleLabel = (name: string) => `rules/${name.trim().replace(/\.md$/i, '')}.md`;

/** The primary button: where it adds the memory. */
export function shareButtonLabel(root: string, target: ShareTarget, targetPath: string | null): string {
  if (target.kind === 'rule') return `Add to ${ruleLabel(target.file)}`;
  if (target.kind === 'local') return 'Add to CLAUDE.local.md';
  return `Add to ${targetPath ? relativeTo(root, targetPath) : 'CLAUDE.md'}`;
}

/** "Only for paths": a comma-separated field, as a list (empty parts dropped). */
export const parsePaths = (text: string) =>
  text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

/** A warning, as the share dialog shows it above the preview. */
export interface ShareNotice {
  kind: ShareWarning['kind'];
  tone: 'error' | 'warn' | 'info';
  text: string;
  /** Share stays off while this shows. */
  blocks: boolean;
  /** Share needs "I checked, it's safe to share" ticked first. */
  needsCheck: boolean;
}

/**
 * The warnings from `memory.sharePreview` in the order and tone the dialog shows them: a secret first (error), then
 * what changes the result (the same heading, already there), then notes (not ignored, uncommitted changes).
 */
export function shareNotices(warnings: readonly ShareWarning[], fileName: string): ShareNotice[] {
  const order: Array<ShareWarning['kind']> = ['secrets', 'alreadyThere', 'sameHeading', 'localNotIgnored', 'targetDirty'];
  return [...warnings]
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((warning): ShareNotice => {
      switch (warning.kind) {
        case 'secrets':
          return { kind: 'secrets', tone: 'error', text: `This looks like it holds ${warning.detail ?? 'a secret'}. Everyone with the repository would see it.`, blocks: false, needsCheck: true };
        case 'alreadyThere':
          return { kind: 'alreadyThere', tone: 'info', text: `This text is in ${fileName} already. There is nothing to add.`, blocks: true, needsCheck: false };
        case 'sameHeading':
          return { kind: 'sameHeading', tone: 'warn', text: `${fileName} has a section called “${warning.detail ?? ''}” already.`, blocks: false, needsCheck: false };
        case 'localNotIgnored':
          return { kind: 'localNotIgnored', tone: 'warn', text: 'Git doesn’t ignore CLAUDE.local.md in this project, so it could be committed with everything else.', blocks: false, needsCheck: false };
        case 'targetDirty':
          return { kind: 'targetDirty', tone: 'info', text: `Your addition goes on top of uncommitted changes in ${warning.detail ?? fileName}.`, blocks: false, needsCheck: false };
      }
    });
}

/** Whether Share can go ahead with these notices: nothing blocks it, and a secret was checked. */
export const canShare = (notices: readonly ShareNotice[], secretsChecked: boolean) => !notices.some((n) => n.blocks) && (secretsChecked || !notices.some((n) => n.needsCheck));

/** The sections of an instruction file that can be copied to memory: its `##` and `###` headings. */
export const copyableSections = (text: string) => parseSections(text).filter((s) => s.level === 2 || s.level === 3);

/** "MEMORY.md becomes N of 200 lines", and whether that is past what Claude Code reads. */
export function indexMeterText(lines: number): { text: string; over: boolean } {
  return { text: `MEMORY.md becomes ${lines} of ${MEMORY_INDEX_LIMIT} lines`, over: lines > MEMORY_INDEX_LIMIT };
}
