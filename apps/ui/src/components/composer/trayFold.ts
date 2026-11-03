/**
 * What the tray under the message box needs on one line: the chip row at its smallest level (`chips`), what folds
 * into the folded chip's menu (Tools and usage, `info`), and the context ring that always stays (`ring`).
 */
export interface TrayWidths {
  chips: number;
  info: number;
  ring: number;
}

/** Room the tray keeps between and around its two sides (their gap and the chips' own margins). */
export const TRAY_SLACK = 16;

/**
 * Whether the tray folds model, effort and mode into one chip, with Tools and usage in its menu. It measures the
 * chip row at its smallest level, never at the level it shows now, so the answer doesn't depend on itself: the tray
 * can't flip between the two layouts as you type. A tray without a chip row has nothing to fold into.
 */
export function trayFolds(available: number, widths: TrayWidths): boolean {
  if (widths.chips <= 0) return false;
  // Half a pixel of slack: measured widths are fractional, and a tray that fits exactly must not fold.
  return widths.chips + widths.info + widths.ring + TRAY_SLACK > available + 0.5;
}

/** The folded chip's face: "Opus 5.5 · High · Ask first", leaving out what the session doesn't have. */
export function foldedFace(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}

/** The folded chip's accessible name: what it sets, then every value ("Model, effort and mode: Opus 5.5, High, Ask first"). */
export function foldedLabel(parts: { model: string; effort?: string | null; mode?: string | null }): string {
  const names = ['Model', parts.effort ? 'effort' : null, parts.mode ? 'mode' : null].filter((n): n is string => !!n);
  const what = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${what}: ${[parts.model, parts.effort, parts.mode].filter((p): p is string => !!p).join(', ')}`;
}

/**
 * The message box's placeholder in a session, which also carries the hint the footer line had: what Enter does while
 * the agent works (`whileWorking`), and the keys that send it now (`sendNow`, already localized).
 */
export function boxPlaceholder({ agent, running, whileWorking, sendNow }: { agent: string; running: boolean; whileWorking: 'queue' | 'steer'; sendNow: string }): string {
  if (!running) return `Message ${agent}`;
  return whileWorking === 'queue' ? `Message ${agent}. It waits in Up next, or ${sendNow} sends it now.` : `Message ${agent}. ${agent} reads it at its next step, or ${sendNow} sends it now.`;
}
