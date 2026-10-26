import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { ariaShortcut, shortcutGlyphs, storedShortcut } from '../../lib/shortcuts.ts';
import { Kbd } from '../ui/Kbd.tsx';
import { useMiddleEllipsis } from '../ui/useMiddleEllipsis.ts';
import { gridMove, type TileTone } from './projectTiles.ts';

/**
 * New session's project list: one column, two from 520px, three from 780px (`COLUMN_BREAKPOINTS`, which `useColumns`
 * reads). A container query, so the sidebar and side panels count; put `@container` on the picker around it.
 */
export const PROJECT_GRID = 'grid grid-cols-1 gap-1.5 @min-[520px]:grid-cols-2 @min-[780px]:grid-cols-3';

/**
 * New session's column: one width for the heading, the project list, the message box and the usage line, up to 56rem.
 * Wide enough for three columns of projects (from 780px), and still a comfortable line length in the message box.
 */
export const NEW_SESSION_COLUMN = 'mx-auto grid w-full max-w-4xl grid-cols-[minmax(0,1fr)] gap-5 px-6';

const TONE_DOT: Record<TileTone, string> = { 'needs-you': 'bg-warn animate-pulse', working: 'bg-accent-ink', idle: 'bg-faint/60' };
const TONE_TEXT: Record<TileTone, string> = { 'needs-you': 'text-warn', working: 'text-accent-ink', idle: 'text-muted' };

interface ProjectRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'color'> {
  icon: ReactNode;
  /** The whole name: cut in the middle only when the row is too narrow for it, and always whole for screen readers. */
  name: string;
  tone: TileTone;
  /** "Idle · 2d", "1 working". */
  label: string;
  /** The checked-out branch, after the status in faint text. */
  branch?: string | null;
  /** 1 to 9: the ⌘ key that picks it, shown faint on the right and announced through `aria-keyshortcuts`. */
  shortcut?: number;
  selected: boolean;
  /** Highlighted from the keyboard in the open list (`aria-activedescendant`). */
  highlighted?: boolean;
  /** The picked row's border and glow: its project's colour, as on the message box's frame. */
  color?: string | null;
  'data-tooltip'?: string;
}

/** One project in New session's list, on this computer or another: its icon, its name over its state, and its ⌘ key. */
export function ProjectRow({ icon, name, tone, label, branch, shortcut, selected, highlighted = false, color, className = '', ...rest }: ProjectRowProps) {
  const { ref, text } = useMiddleEllipsis<HTMLSpanElement>(name);
  const keys = shortcut ? `⌘${shortcut}` : null;
  return (
    <button
      type="button"
      aria-label={`${name}, ${label}`}
      aria-keyshortcuts={keys ? ariaShortcut(storedShortcut(keys)) : undefined}
      data-project-row
      {...rest}
      // The picked row wears its project's colour, lifted a pixel.
      style={selected && color ? { borderColor: color, boxShadow: `0 6px 14px -6px color-mix(in srgb, ${color} 55%, transparent)` } : undefined}
      className={`flex min-w-0 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow,translate] ${
        selected ? '-translate-y-px border-border bg-selected' : highlighted ? 'border-border bg-border/45' : 'border-border bg-card hover:bg-border/45'
      } ${className}`}
    >
      {icon}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span ref={ref} className="truncate text-ui font-semibold text-text" data-project-name>
          {text}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-meta">
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
          {/* One span, so the dot before the branch is spaced like the one in the label ("Idle · 8m · dev"). */}
          <span className="min-w-0 truncate">
            <span className={TONE_TEXT[tone]}>{label}</span>
            {branch && <span className="text-faint"> · {branch}</span>}
          </span>
        </span>
      </span>
      {keys && <Kbd keys={keys} tone="plain" aria-hidden />}
    </button>
  );
}

/**
 * Arrow keys on a list of rows (`onKeyDown` on its container): left and right along a row, up and down between rows,
 * Home and End, in the order the grid shows them. Moves the focus; true when the key was used.
 */
export function moveInGrid(event: KeyboardEvent<HTMLElement>, columns: number): boolean {
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-project-row]')];
  const index = rows.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return false;
  const next = gridMove(event.key, index, rows.length, columns);
  if (next === null) return false;
  event.preventDefault();
  rows[next]!.focus();
  return true;
}

/**
 * Under the list: "All N projects…" (the whole list, when some don't show), then which ⌘ keys pick a row. `onFewer`
 * puts the short list back, where the whole list has no field of its own to close.
 */
export function ProjectListFooter({ total, shown, onAll, onFewer }: { total: number; shown: number; onAll?(): void; onFewer?(): void }) {
  if (shown === 0 && !onAll) return null;
  const last = Math.min(shown, 9);
  const keys = last === 1 ? `${shortcutGlyphs('⌘1')} picks it` : `${shortcutGlyphs('⌘1')}–${shortcutGlyphs(`⌘${last}`)} pick one`;
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-0.5 text-ui" data-project-footer>
      {onAll && (
        <button type="button" onClick={onAll} aria-expanded={false} className="shrink-0 rounded font-semibold text-accent-ink hover:underline" data-all-projects>
          All {total} projects…
        </button>
      )}
      {onFewer && (
        <button type="button" onClick={onFewer} aria-expanded className="shrink-0 rounded font-semibold text-accent-ink hover:underline" data-fewer-projects>
          Show fewer
        </button>
      )}
      {shown > 0 && (
        <span aria-hidden className="min-w-0 truncate text-faint">
          {onAll || onFewer ? '· ' : ''}
          {keys}
        </span>
      )}
    </div>
  );
}
