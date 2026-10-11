import type { ActionScope } from '@switchboard/protocol/client';
import { fuzzyMatch } from '../../lib/fuzzy.ts';
import {
  available,
  formatShortcut,
  localizeKeys,
  matches,
  normalizeShortcut,
  SECTION_TITLES,
  shortcutFromEvent,
  SHORTCUTS,
  type ShortcutContext,
  type ShortcutDef,
  type ShortcutSection,
} from '../../lib/shortcuts.ts';
import type { PaletteContext } from '../palette/paletteContext.ts';

/**
 * The shortcuts sheet (⌘/) as pure logic: which rows show, in which sections and columns, what a filter
 * matches, and what a key pressed in the filter field types. `ShortcutsSheet.tsx` draws the result.
 */

/** `all`: every shortcut, the ones that don't work here faded. `here`: only what works where you are. */
export type SheetMode = 'all' | 'here';

/** Letters to highlight, by field. */
export interface RowMarks {
  action: number[];
  context: number[];
  /** Indices into `keys` of the combos a key filter matched. */
  keys: number[];
}

export interface SheetRow {
  /** The registry id, or `action:<id>` for a project action. */
  id: string;
  action: string;
  context?: string;
  note?: string;
  keys: readonly string[];
  /** It works where you are; otherwise the sheet fades it. */
  available: boolean;
  marks: RowMarks;
}

export interface SheetSection {
  id: ShortcutSection;
  title: string;
  rows: SheetRow[];
}

/** A project action, as the sheet lists it. */
export interface SheetAction {
  id: string;
  name: string;
  shortcut: string | null;
  scope: ActionScope;
}

/** Sections in reading order. In All mode the first two (and New session and Settings, when shown) are the left column. */
const ORDER: ShortcutSection[] = ['general', 'sessions', 'session', 'composer', 'permissions', 'actions', 'new-session', 'settings'];
const LEFT = new Set<ShortcutSection>(['general', 'sessions', 'new-session', 'settings']);
/** Shown in All mode only when a filter matches them; Here mode shows them where they apply. */
const ON_DEMAND = new Set<ShortcutSection>(['new-session', 'settings']);

/** The section that belongs to the view you're on: Here mode puts it first. */
export function sectionForView(view: ShortcutContext['view']): ShortcutSection {
  return view === 'new-session' ? 'new-session' : view === 'settings' ? 'settings' : view === 'session' ? 'session' : 'general';
}

/** The sheet's context from the command palette's (both come from the same stores), plus what only the sheet knows. */
export function shortcutContext(p: PaletteContext, extra: { focus: ShortcutContext['focus']; selection: number }): ShortcutContext {
  return {
    view: p.view,
    session: p.session !== null,
    running: p.session?.running ?? false,
    pending: p.session?.waiting ?? null,
    selection: extra.selection,
    split: p.split,
    behind: p.git?.pullable ?? false,
    focus: extra.focus,
    terminal: { open: p.terminal.open, maximized: p.terminal.maximized, actionRunning: p.terminal.action?.running ?? false },
  };
}

// --- Filtering by key ------------------------------------------------------------------------------

const MODIFIERS: Record<string, string> = {
  '⌘': 'cmd',
  cmd: 'cmd',
  command: 'cmd',
  meta: 'cmd',
  mod: 'cmd',
  '⌃': 'ctrl',
  ctrl: 'ctrl',
  control: 'ctrl',
  '⌥': 'alt',
  alt: 'alt',
  opt: 'alt',
  option: 'alt',
  '⇧': 'shift',
  shift: 'shift',
};
/** Key glyphs and names someone might type for a key. */
const KEY_NAMES: Record<string, string> = {
  '↩': 'enter',
  '↵': 'enter',
  enter: 'enter',
  return: 'enter',
  esc: 'escape',
  escape: 'escape',
  '⇥': 'tab',
  tab: 'tab',
  '⌫': 'backspace',
  backspace: 'backspace',
  delete: 'backspace',
  space: 'space',
  '↑': 'arrowup',
  up: 'arrowup',
  '↓': 'arrowdown',
  down: 'arrowdown',
  '←': 'arrowleft',
  left: 'arrowleft',
  '→': 'arrowright',
  right: 'arrowright',
  click: 'click',
};
/** Glyphs that only ever mean a key, so a query with one is about keys even without a modifier. */
const KEY_GLYPHS = /[⌘⌃⌥⇧↩↵⇥⌫↑↓←→]/;

export interface KeyQuery {
  /** Modifiers, sorted. */
  mods: string[];
  /** The key, or null to match every combo with these modifiers ("⌘⇧"). */
  key: string | null;
}

/**
 * A filter that names keys rather than words: "⌘J", "cmd j", "cmd+j", "ctrl c", "⌘⇧", "Esc", "F2".
 * Null when the query reads as words ("terminal").
 */
export function parseKeyQuery(query: string): KeyQuery | null {
  const text = query.trim().toLowerCase();
  if (!text) return null;
  const tokens: string[] = [];
  for (const chunk of text.split(/[\s+]+/).filter(Boolean)) {
    // Glyphs run together ("⌘⇧j"): each modifier glyph is a token of its own.
    let rest = chunk;
    while (rest && (MODIFIERS[rest[0]!] || KEY_NAMES[rest[0]!]) && rest.length > 1 && !/^[a-z]/.test(rest)) {
      tokens.push(rest[0]!);
      rest = rest.slice(1);
    }
    if (rest) tokens.push(rest);
  }
  const mods = new Set<string>();
  let key: string | null = null;
  for (const token of tokens) {
    if (MODIFIERS[token]) mods.add(MODIFIERS[token]!);
    else if (key === null && (KEY_NAMES[token] || /^f\d{1,2}$/.test(token) || token.length === 1)) key = KEY_NAMES[token] ?? token;
    else return null;
  }
  // A bare word key ("esc", "f2") is a key; a bare letter is the start of a word.
  const keyOnly = mods.size === 0 && key !== null && (KEY_GLYPHS.test(text) || /^(esc|escape|f\d{1,2})$/.test(text));
  if (mods.size === 0 && !keyOnly) return null;
  return { mods: [...mods].sort(), key };
}

/** Every press a combo stands for, clicks included (a key filter "⌥" finds ⌥-click). */
function pressesOf(combo: string): Array<{ mods: string[]; key: string }> {
  return combo.split(' ').flatMap((step) => {
    const range = /^(.*?)(\d)\.\.(\d)$/.exec(step);
    const steps = range ? Array.from({ length: Number(range[3]) - Number(range[2]) + 1 }, (_, i) => `${range[1]}${Number(range[2]) + i}`) : [step];
    return steps.map((press) => {
      const parts = normalizeShortcut(press).split('+');
      return { mods: parts.slice(0, -1).sort(), key: parts.at(-1)! };
    });
  });
}

/** Which of `keys` a key query matches: with a key, the same modifiers and key; with modifiers only, every combo that has them. */
export function matchKeys(query: KeyQuery, keys: readonly string[]): number[] {
  return keys.flatMap((combo, index) =>
    pressesOf(combo).some((press) => (query.key === null ? query.mods.every((m) => press.mods.includes(m)) : press.key === query.key && press.mods.join('+') === query.mods.join('+')))
      ? [index]
      : [],
  );
}

// --- Filtering by word -----------------------------------------------------------------------------

const range = (from: number, length: number) => Array.from({ length }, (_, i) => from + i);

/**
 * Whether every word of the query is in the row: as text in its action, context or section name, or
 * (letters in order, `lib/fuzzy.ts`) in its action. Null when a word isn't; otherwise what to highlight.
 */
export function matchWords(query: string, row: { action: string; context?: string }, sectionTitle: string): RowMarks | null {
  const marks: RowMarks = { action: [], context: [], keys: [] };
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const inAction = row.action.toLowerCase().indexOf(word);
    const inContext = row.context?.toLowerCase().indexOf(word) ?? -1;
    if (inAction >= 0) marks.action.push(...range(inAction, word.length));
    if (inContext >= 0) marks.context.push(...range(inContext, word.length));
    if (inAction >= 0 || inContext >= 0 || sectionTitle.toLowerCase().includes(word)) continue;
    const fuzzy = fuzzyMatch(word, row.action);
    // Letters in order, but only from the start of a word: "nses" finds New session, "terminal" doesn't find a stray t, e, r…
    const start = fuzzy?.indices[0] ?? 0;
    if (!fuzzy || (start > 0 && !/\s/.test(row.action[start - 1]!)) || fuzzy.indices.at(-1)! - start > word.length * 3) return null;
    marks.action.push(...fuzzy.indices);
  }
  return marks;
}

/** What a row needs to match a filter: by keys when the query names keys, else by words. */
export function matchRow(query: string, row: { action: string; context?: string; keys: readonly string[] }, sectionTitle: string): RowMarks | null {
  if (!query.trim()) return { action: [], context: [], keys: [] };
  const keyQuery = parseKeyQuery(query);
  if (keyQuery) {
    const keys = matchKeys(keyQuery, row.keys);
    return keys.length ? { action: [], context: [], keys } : null;
  }
  return matchWords(query, row, sectionTitle);
}

// --- Typing a combo into the filter ------------------------------------------------------------------

/** Text editing keeps these, even in the filter field. */
const EDITING = new Set(['cmd+a', 'cmd+c', 'cmd+v', 'cmd+x', 'cmd+z', 'cmd+shift+z']);
const EDITING_KEYS = /^(arrow(up|down|left|right)|backspace|delete|home|end)$/;

/**
 * A key pressed in the filter field that should land in it as text (⌘J), rather than run: anything with
 * ⌘, ⌃ or ⌥, except ⌘/ (it closes the sheet) and the keys that edit text. Null to let the key through.
 */
export function typedCombo(event: Parameters<typeof shortcutFromEvent>[0]): string | null {
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null;
  const press = shortcutFromEvent(event);
  if (!press || matches(event, 'shortcuts') || EDITING.has(press) || EDITING_KEYS.test(press.split('+').at(-1)!)) return null;
  return formatShortcut(press);
}

// --- Sections and columns ----------------------------------------------------------------------------

const ACTION_CONTEXT: Record<ActionScope, string | undefined> = { global: 'Global, in every project', shared: "Shared in the project's repository", project: undefined };

/** Project actions with a shortcut, as rows. They run while a session is on screen; ⌃ and ⌥ keys stay with the shell in the terminal. */
export function actionRows(actions: readonly SheetAction[], ctx: ShortcutContext): Array<Omit<SheetRow, 'marks'>> {
  return actions
    .filter((a) => a.shortcut)
    .map((a) => ({
      id: `action:${a.id}`,
      action: a.name,
      context: ACTION_CONTEXT[a.scope],
      keys: [a.shortcut!],
      available: ctx.view === 'session' && ctx.session && !(ctx.focus === 'terminal' && !normalizeShortcut(a.shortcut!).startsWith('cmd+')),
    }));
}

export interface SheetInput {
  ctx: ShortcutContext;
  mode: SheetMode;
  query: string;
  /** The open session's project actions; empty without a session. */
  actions: readonly SheetAction[];
  /** The registry, for tests; the app's own by default. */
  shortcuts?: readonly ShortcutDef[];
}

export interface SheetLayout {
  /** Left, then right. */
  columns: [SheetSection[], SheetSection[]];
  /** Rows shown, in all sections. */
  count: number;
}

/**
 * What the sheet shows. All mode: everything, in fixed columns (General and Sessions on the left; In a
 * session, Message box, Permissions and Project actions on the right), with New session and Settings only
 * when a filter finds them. Here mode: only what works where you are, the section for your view first,
 * spread over the two columns. A filter keeps matching rows in their sections and drops the empty ones.
 * Project actions stays in an unfiltered list even when empty, so the sheet can offer to add one.
 */
export function sheetLayout({ ctx, mode, query, actions, shortcuts = SHORTCUTS }: SheetInput): SheetLayout {
  const filtering = query.trim() !== '';
  const bySection = new Map<ShortcutSection, SheetRow[]>(ORDER.map((id) => [id, []]));
  const candidates: Array<Omit<SheetRow, 'marks'> & { section: ShortcutSection }> = [
    ...shortcuts.map((def) => ({ id: def.id, action: def.action, context: def.context && localizeKeys(def.context), note: def.note && localizeKeys(def.note), keys: def.keys, available: available(def, ctx), section: def.section })),
    ...actionRows(actions, ctx).map((row) => ({ ...row, section: 'actions' as const })),
  ];
  for (const { section, ...row } of candidates) {
    if (mode === 'here' && !row.available) continue;
    const marks = matchRow(query, row, SECTION_TITLES[section]);
    if (marks) bySection.get(section)!.push({ ...row, marks });
  }

  const keepEmptyActions = !filtering && (mode === 'all' || (ctx.view === 'session' && ctx.session));
  const first = mode === 'here' ? sectionForView(ctx.view) : null;
  const order = first ? [first, ...ORDER.filter((id) => id !== first)] : ORDER;
  const shown = order
    .filter((id) => !(mode === 'all' && !filtering && ON_DEMAND.has(id)))
    .map((id) => ({ id, title: SECTION_TITLES[id], rows: bySection.get(id)! }))
    .filter((s) => s.rows.length > 0 || (s.id === 'actions' && keepEmptyActions));

  const count = shown.reduce((n, s) => n + s.rows.length, 0);
  if (mode === 'all') return { columns: [shown.filter((s) => LEFT.has(s.id)), shown.filter((s) => !LEFT.has(s.id))], count };
  // Here: down the left column, then the right, splitting near the middle (a header counts as a row).
  const weight = (s: SheetSection) => s.rows.length + 1;
  const total = shown.reduce((n, s) => n + weight(s), 0);
  const left: SheetSection[] = [];
  let used = 0;
  for (const section of shown) {
    if (left.length > 0 && used >= total / 2) break;
    left.push(section);
    used += weight(section);
  }
  return { columns: [left, shown.slice(left.length)], count };
}
