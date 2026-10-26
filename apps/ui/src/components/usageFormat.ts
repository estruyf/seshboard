import { formatCost, safeLocale, type CurrencyCode, type UsageLimit, type UsageSnapshot, type WindowCost } from '@seshboard/protocol/client';

/** "5h", "7d", "7d · Fable" for the server's meter kinds. */
export function limitLabel(limit: UsageLimit): string {
  const base = limit.kind === 'session' ? '5h' : limit.group === 'weekly' || limit.kind.startsWith('weekly') ? '7d' : limit.kind.replace(/_/g, ' ');
  return limit.scope ? `${base} · ${limit.scope}` : base;
}

/** "4h3m", "3d1h", "12m", "now". */
export function countdown(resetsAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000));
  if (minutes < 1) return 'now';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

/**
 * When a window resets, for the line after its meter: "3h 10m" or "45m" within a day, else the
 * weekday ("Mon"). `locale` is for tests; the app uses the system's.
 */
export function resetLabel(resetsAt: number, now = Date.now(), locale?: string): string {
  locale = safeLocale(locale);
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes >= 24 * 60) return new Date(resetsAt).toLocaleDateString(locale, { weekday: 'short' });
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

/** The 5-hour and weekly windows, plus scoped ones once they're in use. */
export function visibleLimits(limits: UsageLimit[]): UsageLimit[] {
  return limits.filter((l) => l.kind === 'session' || l.kind === 'weekly_all' || l.percent >= 1);
}

/** The estimated cost of a limit's window: the one with its kind and scope, if the engine priced it. */
export function windowCostOf(limit: UsageLimit, costs: readonly WindowCost[]): WindowCost | undefined {
  return costs.find((c) => c.kind === limit.kind && c.scope === limit.scope);
}

/** "≈$3.20": an estimated cost as the app shows it everywhere. `locale` is for tests; the app uses the system's. */
export const costText = (usd: number, currency: CurrencyCode, locale?: string) => `≈${formatCost(usd, currency, locale)}`;

/**
 * Each limit's cost as the bars show it ("≈$3.20"), or null where there is none: the estimate turned off
 * (`currency` null), or the window not priced (yet). `locale` is for tests; the app uses the system's.
 */
export function limitCosts(limits: readonly UsageLimit[], costs: readonly WindowCost[], currency: CurrencyCode | null, locale?: string): Array<string | null> {
  return limits.map((limit) => {
    const cost = currency ? windowCostOf(limit, costs) : undefined;
    return cost && currency ? costText(cost.usd, currency, locale) : null;
  });
}

/**
 * "5-hour limit: 6% used, resets in 4h3m": a meter's pill in words, for VoiceOver (the ring and "5h" don't read well).
 * `cost` is its estimate as the bar shows it (`limitCosts`).
 */
export function spokenLimit(limit: UsageLimit, now = Date.now(), cost: string | null = null): string {
  const name = limit.kind === 'session' ? '5-hour limit' : limitLabel(limit).startsWith('7d') ? 'Weekly limit' : `${limit.kind.replace(/_/g, ' ')} limit`;
  const scoped = limit.scope ? `${name} (${limit.scope})` : name;
  const severity = limit.severity === 'critical' ? ', nearly used up' : limit.severity === 'warning' ? ', getting close' : '';
  const reset = limit.resetsAt ? `, resets in ${countdown(limit.resetsAt, now)}` : '';
  const priced = cost ? `, about ${cost.replace('≈', '')} at API prices` : '';
  return `${scoped}: ${Math.round(limit.percent)}% used${severity}${reset}${priced}`;
}

/**
 * A usage bar's tooltip: every window on a line ("5h: 38% used, resets in 2h14m · ≈$3.20"), a note on what the costs
 * are when it shows some (with `costNotes`: which computers they count), then what a click does. `costs` lines up
 * with `limits` (`limitCosts`).
 */
export function usageSummary(limits: UsageLimit[], now = Date.now(), costs: ReadonlyArray<string | null> = [], costNotes: readonly string[] = []): string {
  const lines = limits.map((l, i) => `${limitLabel(l)}: ${Math.round(l.percent)}% used${l.resetsAt ? `, resets in ${countdown(l.resetsAt, now)}` : ''}${costs[i] ? ` · ${costs[i]}` : ''}`);
  const note = costs.some(Boolean) ? ['Costs are estimates at API prices, not charges', ...costNotes] : [];
  return [...lines, ...note, 'Click to see what used it'].join('\n');
}

/**
 * Which computers a plan window's cost counts, once other computers are paired: "Counts This PC and mystic" and
 * "Not counted: studio is offline." (`reasons` are `Uncounted` sentences). Nothing while no other computer is paired.
 */
export function costComputersNotes(thisComputer: string, counted: ReadonlyArray<{ name: string }>, reasons: readonly string[]): string[] {
  const notes = counted.length > 0 ? [`Counts ${[thisComputer, ...counted.map((c) => c.name)].join(' and ')}`] : [];
  return reasons.length > 0 ? [...notes, `Not counted: ${reasons.join(' ')}`] : notes;
}

/** A profile's usage once it has been asked for: the numbers (null when there are none) and why the last fetch failed. */
export interface UsageEntry {
  usage: UsageSnapshot | null;
  error: string | null;
}

/**
 * The entry after a fetch or an update. A failed fetch keeps the numbers already shown (they are
 * still the best guess) and records why; any new numbers clear the error.
 */
export function nextUsageEntry(prev: UsageEntry | undefined, result: { usage: UsageSnapshot | null; error?: string | null }): UsageEntry {
  if (result.usage) return { usage: result.usage, error: null };
  if (result.error) return { usage: prev?.usage ?? null, error: result.error };
  return { usage: null, error: null };
}

/** What a usage card says while it has no limits to show. */
export function usageMessage(entry: UsageEntry | undefined): string {
  if (!entry) return 'Loading usage…';
  if (entry.error && !entry.usage) return 'Usage unavailable';
  return 'No plan limits reported.';
}
