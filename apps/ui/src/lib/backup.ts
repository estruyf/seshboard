import { BACKUP_SECTIONS, type BackupSection, type ImportChange } from '@switchboard/protocol/client';

/** How the export and import dialogs name each kind of data. */
export const SECTION_INFO: Record<BackupSection, { label: string; detail: string }> = {
  preferences: { label: 'Preferences', detail: 'Appearance and theme choice, sidebar, tool activity, startup and quitting, updates.' },
  themes: { label: 'Themes', detail: 'Themes you imported or duplicated. The built-in ones are always there.' },
  profiles: { label: 'Claude profiles', detail: 'Profiles with their folders, colours and defaults for new sessions, the default profile and which projects use which. Logins are never in the file.' },
  projects: { label: 'Projects', detail: 'Your projects in order, with their names, icons and defaults for new sessions.' },
  actions: { label: 'Project actions', detail: 'Global and per-project actions, with their shortcuts and worktree setup.' },
  choices: { label: 'App choices', detail: 'Default editor, New session defaults, Claude Code update checks.' },
  sessions: { label: 'Pinned and archived sessions', detail: 'Only useful on this Mac, or when ~/.claude is copied too.' },
};

/** Sessions are left out by default: their ids only mean something where the same transcripts are. */
export const DEFAULT_EXPORT_SECTIONS: BackupSection[] = BACKUP_SECTIONS.filter((s) => s !== 'sessions');

const CHANGE_ORDER: Record<ImportChange['change'], number> = { add: 0, change: 1, remove: 2, keep: 3, skip: 4 };

/** The preview's changes per section, in section order, adds first. Sections without changes are left out. */
export function groupChanges(changes: readonly ImportChange[]): Array<{ section: BackupSection; changes: ImportChange[] }> {
  return BACKUP_SECTIONS.map((section) => ({
    section,
    changes: changes.filter((c) => c.section === section).sort((a, b) => CHANGE_ORDER[a.change] - CHANGE_ORDER[b.change]),
  })).filter((group) => group.changes.length > 0);
}

/** One line for the import button's neighbourhood, e.g. "3 to add, 1 to change, 2 unchanged". */
export function summarizeChanges(changes: readonly ImportChange[], unchanged: number): string {
  const count = (kind: ImportChange['change']) => changes.filter((c) => c.change === kind).length;
  const parts = [
    [count('add'), 'to add'],
    [count('change'), 'to change'],
    [count('remove'), 'to remove'],
    [count('keep'), 'kept as yours'],
    [count('skip'), 'skipped'],
    [unchanged, 'unchanged'],
  ] as const;
  const text = parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  return text.length > 0 ? text.join(', ') : 'Nothing to import';
}

/** True when the import would change anything. */
export const hasEffect = (changes: readonly ImportChange[]) => changes.some((c) => c.change === 'add' || c.change === 'change' || c.change === 'remove');
