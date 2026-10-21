import { formatKeys, SECTION_TITLES, SHORTCUTS, type ShortcutDef, type ShortcutSection } from './shortcuts.ts';

/**
 * The README's shortcuts tables, written from the registry by `npm run docs:shortcuts` between two
 * markers. A test fails when the README and the registry disagree.
 */

export const README_START = '<!-- shortcuts:start (written by npm run docs:shortcuts from apps/ui/src/lib/shortcuts.ts; edit the registry, not this table) -->';
export const README_END = '<!-- shortcuts:end -->';

/** Project actions are your own, so the README has no table for them. */
const SECTIONS: ShortcutSection[] = ['general', 'sessions', 'session', 'composer', 'permissions', 'catch-up', 'new-session', 'projects', 'settings'];

/** Markdown would read `\` as an escape. */
const cell = (text: string) => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

/** "In the sidebar" reads as "(in the sidebar)" after the action; names such as Esc keep their capital. */
const lowerFirst = (text: string) => (/^(In|On|At|Once|While|When|With|From)\b/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text);

function row(def: ShortcutDef): string {
  const keys = def.keys.map(formatKeys).join(' or ');
  const more = [def.context, def.note].filter(Boolean).map((text) => lowerFirst(text!));
  return `| ${cell(keys)} | ${cell(def.action)}${more.length ? ` (${cell(more.join('; '))})` : ''} |`;
}

/** One table per section, under its heading in bold. */
export function shortcutsMarkdown(shortcuts: readonly ShortcutDef[] = SHORTCUTS): string {
  return SECTIONS.map((section) => {
    const rows = shortcuts.filter((s) => s.section === section).map(row);
    return [`**${SECTION_TITLES[section]}**`, '', '| Shortcut | What it does |', '|---|---|', ...rows].join('\n');
  }).join('\n\n');
}

/** `readme` with the text between the markers replaced by `markdown`; throws when the markers are missing. */
export function withShortcuts(readme: string, markdown: string = shortcutsMarkdown()): string {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start === -1 || end === -1 || end < start) throw new Error(`README.md needs the markers ${README_START} and ${README_END}`);
  return `${readme.slice(0, start + README_START.length)}\n\n${markdown}\n\n${readme.slice(end)}`;
}
