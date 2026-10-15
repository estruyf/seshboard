import type { SessionGroup } from './sidebarRows.ts';

/** The sidebar's sections that can close: every one but Needs you and Needs review (and Archived, which has its own toggle). */
export type SectionKey = Exclude<SessionGroup, 'needs-you' | 'review'> | 'queue';

export const SECTION_KEYS: readonly SectionKey[] = ['working', 'queue', 'pinned', 'today', 'yesterday', 'earlier', 'read', 'still-working'];

/** Which sections are open. Earlier starts closed; the rest start open. */
export type SectionsOpen = Record<SectionKey, boolean>;

export const DEFAULT_SECTIONS: SectionsOpen = { working: true, queue: true, pinned: true, today: true, yesterday: true, earlier: false, read: true, 'still-working': true };

export const isSectionKey = (value: unknown): value is SectionKey => typeof value === 'string' && (SECTION_KEYS as readonly string[]).includes(value);

/** The saved state, read leniently: anything unknown or missing keeps its default. */
export function parseSections(value: unknown): SectionsOpen {
  const stored = value && typeof value === 'object' && 'open' in value ? (value as { open: unknown }).open : null;
  const open = { ...DEFAULT_SECTIONS };
  if (stored && typeof stored === 'object') {
    for (const [key, on] of Object.entries(stored)) if (isSectionKey(key) && typeof on === 'boolean') open[key] = on;
  }
  return open;
}

/** ⌥-click on a header: every section closes, or (when that one was closed) they all open. */
export function toggleAllSections(current: SectionsOpen, clicked: SectionKey): SectionsOpen {
  const open = !current[clicked];
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, open])) as SectionsOpen;
}

/** The sections that are closed now. Search or the project filter show every section while they're on. */
export function closedSections(open: SectionsOpen, options: { search: string; project: string | null }): ReadonlySet<SectionKey> {
  if (options.search.trim() !== '' || options.project !== null) return new Set();
  return new Set(SECTION_KEYS.filter((key) => !open[key]));
}
