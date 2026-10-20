import type { Effort, PermissionMode } from '@switchboard/protocol/client';

/**
 * How compact the message box's chips are. 0: everything. 1: the profile shows only its dot. 2: the model
 * drops its version. 3: effort shows only its bars. 4: the mode shows only its dot. The model, effort and mode
 * say the most about a run, so they shrink last. Each step keeps whole words, so a chip never ends in "…".
 */
export type FooterLevel = 0 | 1 | 2 | 3 | 4;

export const FOOTER_LEVELS: readonly FooterLevel[] = [0, 1, 2, 3, 4];

/**
 * The fullest level whose chips fit: `widths[level]` is the chip row's own width at that level, and
 * `widthAvailable` the room the footer leaves it. Past level 4 there is nothing left to drop, so it stays there.
 */
export function footerLevel(widthAvailable: number, widths: readonly number[]): FooterLevel {
  // Half a pixel of slack: measured widths are fractional, and a row that fits exactly must not flip.
  for (const level of FOOTER_LEVELS) if ((widths[level] ?? Infinity) <= widthAvailable + 0.5) return level;
  return 4;
}

/** The model chip's name: "Opus 4.5", without "Claude" or a note in brackets; "Default model" when nothing is picked. */
export function shortModelName(label: string): string {
  const name = label
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/^claude\s+/i, '')
    .trim();
  return !name || /^default$/i.test(name) ? 'Default model' : name;
}

/** The model chip at level 2 and up: the name without its version ("Opus"). */
export function modelFamily(label: string): string {
  const name = shortModelName(label);
  return name.replace(/\s+v?\d[\d.]*\b.*$/i, '').trim() || name;
}

/** The effort chip's three bars: how many are filled, and whether they're in the accent (above High). */
export function effortBars(effort: Effort | ''): { filled: 0 | 1 | 2 | 3; strong: boolean } {
  switch (effort) {
    case 'low':
      return { filled: 1, strong: false };
    case 'medium':
      return { filled: 2, strong: false };
    case 'high':
      return { filled: 3, strong: false };
    case 'xhigh':
    case 'max':
      return { filled: 3, strong: true };
    default:
      return { filled: 0, strong: false };
  }
}

/** The mode chip's short name; the menu keeps the full one (`MODE_LABEL`). */
export const MODE_SHORT: Record<PermissionMode, string> = {
  default: 'Ask first',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass',
};

/** What each chip shows at a level. */
export function chipShape(level: FooterLevel): { effortLabel: boolean; modeLabel: boolean; modelVersion: boolean; profileName: boolean } {
  return { effortLabel: level < 3, modeLabel: level < 4, modelVersion: level < 2, profileName: level < 1 };
}
