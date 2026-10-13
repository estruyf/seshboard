/**
 * The class strings behind `Button` and `Pill`, kept apart from the components so the rules can be
 * tested without React. See AGENTS.md, Design system, for when to use which variant.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'side';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonLook {
  variant: ButtonVariant;
  size: ButtonSize;
  iconOnly: boolean;
  /** Danger only: the solid red confirm button of a destructive dialog. */
  filled: boolean;
  /** Quiet only: a pressed toggle or the current place (Home, an open panel). */
  selected: boolean;
  /** One half of a split button (`SplitButton`): `main` keeps its left corners, `menu` (the ▾) its right ones. */
  segment?: 'main' | 'menu';
}

const HEIGHT: Record<ButtonSize, string> = { sm: 'h-6', md: 'h-7', lg: 'h-8' };
const SQUARE: Record<ButtonSize, string> = { sm: 'size-6', md: 'size-7', lg: 'size-8' };
// Quiet buttons have no edge to keep clear of, so they sit a little tighter.
const PAD: Record<ButtonSize, string> = { sm: 'px-2', md: 'px-3', lg: 'px-3' };
const QUIET_PAD: Record<ButtonSize, string> = { sm: 'px-1.5', md: 'px-2', lg: 'px-2.5' };

/*
 * `enabled:hover:` rather than `hover:`: a disabled button doesn't react, and for the bordered variants
 * it outranks btn-secondary's own `:hover:not(:disabled)` rule, which a plain `hover:` loses to.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent font-semibold text-on-accent enabled:hover:bg-accent/85',
  secondary: 'btn-secondary',
  quiet: 'text-muted enabled:hover:bg-border/50 enabled:hover:text-text',
  danger: 'btn-secondary border-error/50 text-error enabled:hover:bg-error/10',
  // Ask in the message box while it holds a side question (/btw): the side channel's blue, never the accent.
  side: 'bg-link font-semibold text-bg enabled:hover:bg-link/85',
};
const DANGER_FILLED = 'bg-error font-semibold text-white enabled:hover:bg-error/85';
const QUIET_SELECTED = 'bg-selected text-text';
// The ▾ of a split button: narrower than a square, behind a 1px line in the button's own ink.
const MENU_WIDTH: Record<ButtonSize, string> = { sm: 'w-5', md: 'w-6', lg: 'w-7' };
const SEGMENT_DIVIDER: Record<ButtonVariant, string> = { primary: 'border-l border-on-accent/20', secondary: '', quiet: 'border-l border-border', danger: '', side: '' };

/** The classes for a button: shape, size and variant. Callers add layout (`ml-auto`, `w-full`) on top. */
export function buttonClass({ variant, size, iconOnly, filled, selected, segment }: ButtonLook): string {
  const tone = variant === 'danger' && filled ? DANGER_FILLED : variant === 'quiet' && selected ? QUIET_SELECTED : VARIANT[variant];
  // btn-secondary brings its own padding; an icon-only button is square instead.
  const box =
    segment === 'menu' ? `${HEIGHT[size]} ${MENU_WIDTH[size]} px-0 ${SEGMENT_DIVIDER[variant]}` : iconOnly ? `${SQUARE[size]} px-0` : `${HEIGHT[size]} ${variant === 'quiet' ? QUIET_PAD[size] : PAD[size]}`;
  const corners = segment === 'main' ? 'rounded-l-md' : segment === 'menu' ? 'rounded-r-md' : 'rounded-md';
  return `inline-flex items-center justify-center gap-1.5 ${corners} text-ui whitespace-nowrap disabled:opacity-50 ${box} ${tone}`;
}

export type PillTone = 'default' | 'muted' | 'accent' | 'ok' | 'warn' | 'caution' | 'link' | 'count';

const PILL_TONE: Record<Exclude<PillTone, 'count'>, string> = {
  default: 'border-border text-text',
  muted: 'border-border bg-card text-muted',
  // At a limit (the focus counter): the readable yellow, never a status.
  accent: 'border-accent-ink/45 bg-accent/12 text-accent-ink',
  // Running in the background (green), as in the status colours.
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  // Something to look at before it goes (uncommitted files in a worktree).
  caution: 'border-caution/40 bg-caution/10 text-caution',
  // Something that lives elsewhere and is still open (a pull request).
  link: 'border-link/40 bg-link/10 text-link',
};

export interface PillLook {
  tone: PillTone;
  /** A button (it reacts to hover) rather than a label. */
  interactive: boolean;
  dashed: boolean;
  selected: boolean;
  /** May shrink below its content (it truncates its label) instead of keeping its width. */
  shrink: boolean;
}

/** The classes for a pill. `count` is the small tinted number next to a group heading; its tint comes from the caller. */
export function pillClass({ tone, interactive, dashed, selected, shrink }: PillLook): string {
  if (tone === 'count') return 'inline-flex items-center rounded-full px-1.5 tabular-nums tracking-normal';
  const muted = dashed || tone === 'muted';
  const look = selected ? 'border-border bg-selected text-text' : dashed ? 'border-dashed border-border text-muted' : PILL_TONE[tone];
  const hover = interactive ? `hover:bg-border/50 ${muted && !selected ? 'hover:text-text' : ''}` : '';
  return `inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-meta whitespace-nowrap ${shrink ? 'min-w-0' : 'shrink-0'} ${look} ${hover}`;
}
