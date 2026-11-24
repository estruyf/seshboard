/**
 * Minimal mode's message box: the chips under it fold into one quiet line inside it ("Sonnet 5.5 · Auto · Work"), and
 * usage and context show only once they pass `ALERT_PERCENT`, as one line above it. Pure, for the tests.
 */

/** Usage and context show above the box from this percentage. */
export const ALERT_PERCENT = 80;

/** The chips in one line: model · mode · profile, leaving out what the row doesn't have. */
export function composerSummary(parts: { model?: string | null; mode?: string | null; profile?: string | null }): string {
  return [parts.model, parts.mode, parts.profile].filter((part): part is string => !!part && part.trim() !== '').join(' · ');
}

/**
 * The line above the box once something is past `ALERT_PERCENT`: "Context 84% full · 5h 91% used". Null while
 * everything is under it.
 */
export function minimalAlert(context: number | null | undefined, usage: ReadonlyArray<{ label: string; percent: number | null | undefined }> = []): string | null {
  const parts: string[] = [];
  if (context != null && context >= ALERT_PERCENT) parts.push(`Context ${Math.round(context)}% full`);
  for (const line of usage) if (line.percent != null && line.percent >= ALERT_PERCENT) parts.push(`${line.label} ${Math.round(line.percent)}% used`);
  return parts.length ? parts.join(' · ') : null;
}
