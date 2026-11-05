import type { SessionGroup } from './sidebarRows.ts';

/**
 * The sidebar's sections that can close: every one but Needs you, To review, Reminders and Snoozed (and Archived, which
 * has its own toggle).
 */
export type SectionKey = Exclude<SessionGroup, 'needs-you' | 'review' | 'reminders' | 'snoozed'> | 'queue';

export const SECTION_KEYS: readonly SectionKey[] = ['working', 'queue', 'pinned', 'open', 'read', 'still-working'];

/** Which sections are open. They all start open. */
export type SectionsOpen = Record<SectionKey, boolean>;

export const DEFAULT_SECTIONS: SectionsOpen = { working: true, queue: true, pinned: true, open: true, read: true, 'still-working': true };

/** The sections by day before To review and Open: what they say about Open, when nothing is stored for it yet. */
const BY_DAY = ['today', 'yesterday', 'earlier'] as const;

export const isSectionKey = (value: unknown): value is SectionKey => typeof value === 'string' && (SECTION_KEYS as readonly string[]).includes(value);

/** The saved state, read leniently: anything unknown or missing keeps its default. */
export function parseSections(value: unknown): SectionsOpen {
  const stored = value && typeof value === 'object' && 'open' in value ? (value as { open: unknown }).open : null;
  const open = { ...DEFAULT_SECTIONS };
  if (stored && typeof stored === 'object') {
    for (const [key, on] of Object.entries(stored)) if (isSectionKey(key) && typeof on === 'boolean') open[key] = on;
    // Saved before Open replaced Today, Yesterday and Earlier: Open stays open unless you had closed all three.
    const old = BY_DAY.map((key) => (stored as Record<string, unknown>)[key]).filter((on): on is boolean => typeof on === 'boolean');
    if (!('open' in stored) && old.length > 0) open.open = old.some(Boolean);
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
