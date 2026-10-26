import type { TurnDetails } from '@seshboard/protocol/bridge';
import { safeLocale } from '@seshboard/protocol/client';
import { claudeMs, type Turn, type TurnTokens } from './turns.ts';

/**
 * The words and numbers of a turn's line ("14:32 · 2m 14s · 18.4k tokens") and its tooltips. Pure: `locale` and
 * `timeZone` are for tests; the app passes neither, so times follow the user's locale (12 or 24 hours).
 */

const DAY_MS = 86_400_000;

/** Whether the locale reads time on a 24-hour clock: there an hour has two digits ("09:12"), as people write it. */
const twentyFourHours = (locale?: string) => {
  const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h23' || cycle === 'h24';
};

/** The time of day in the user's own format: "14:32", or "2:32 PM" where the locale uses 12 hours. */
const clock = (date: Date, locale?: string, timeZone?: string) => date.toLocaleTimeString(locale, { hour: twentyFourHours(locale) ? '2-digit' : 'numeric', minute: '2-digit', timeZone });

/** The calendar day of a moment, in the time zone, as a comparable number of days. */
function dayNumber(at: number, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).formatToParts(new Date(at));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS;
}

const yearOf = (at: number, timeZone?: string) => Number(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(new Date(at)));

type Age = 'today' | 'yesterday' | 'week' | 'year' | 'older';

/** How long ago a moment was, in calendar terms: today, yesterday, this week (the last 6 days), this year, or older. */
export function ageOf(at: number, now: number, timeZone?: string): Age {
  const days = dayNumber(now, timeZone) - dayNumber(at, timeZone);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  return yearOf(at, timeZone) === yearOf(now, timeZone) ? 'year' : 'older';
}

/** When a turn ended, short: "14:32" today, "Mon 09:12" this week, "3 Oct 14:32" this year, "12 Dec 2025" before. */
export function formatTurnTime(at: number, now = Date.now(), locale?: string, timeZone?: string): string {
  locale = safeLocale(locale);
  const date = new Date(at);
  const time = clock(date, locale, timeZone);
  switch (ageOf(at, now, timeZone)) {
    case 'today':
      return time;
    case 'yesterday':
    case 'week':
      return `${date.toLocaleDateString(locale, { weekday: 'short', timeZone })} ${time}`;
    case 'year':
      return `${date.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone })} ${time}`;
    case 'older':
      return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone });
  }
}

/** The full date and time, for the time's tooltip: "Thursday 16 October 2026 at 14:32". */
export function formatFullTime(at: number, locale?: string, timeZone?: string): string {
  locale = safeLocale(locale);
  return new Date(at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short', timeZone });
}

/** "Sent today at 14:30", "Sent yesterday at 09:12", "Sent Mon at 09:12", "Sent 3 Oct at 14:32", "Sent 12 Dec 2025 at 14:32", and " from <device>". */
export function sentLine(at: number, device: string | null, now = Date.now(), locale?: string, timeZone?: string): string {
  locale = safeLocale(locale);
  const date = new Date(at);
  const time = clock(date, locale, timeZone);
  const age = ageOf(at, now, timeZone);
  const day =
    age === 'today'
      ? 'today'
      : age === 'yesterday'
        ? 'yesterday'
        : age === 'week'
          ? date.toLocaleDateString(locale, { weekday: 'short', timeZone })
          : date.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(age === 'older' ? { year: 'numeric' } : {}), timeZone });
  return `Sent ${day} at ${time}${device ? ` from ${device}` : ''}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A finished turn's duration: "48s", "2m 14s", "1h 05m". */
export function formatTurnDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

/** The working line's clock: always minutes and seconds ("0m 37s"), so it doesn't change width each minute; "1h 05m" past an hour. */
export function formatLiveDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return formatTurnDuration(ms);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A duration for a screen reader: "2 minutes 14 seconds", "48 seconds", "1 hour 5 minutes". */
export function durationWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return plural(s, 'second');
  if (s < 3600) return [plural(Math.floor(s / 60), 'minute'), ...(s % 60 ? [plural(s % 60, 'second')] : [])].join(' ');
  const minutes = Math.floor((s % 3600) / 60);
  return [plural(Math.floor(s / 3600), 'hour'), ...(minutes ? [plural(minutes, 'minute')] : [])].join(' ');
}

/** A token count: "842", "18.4k" (one decimal under 100k), "184k", "1.2M". */
export function formatTurnTokens(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 100_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${trim(n / 1_000)}k`;
  return String(Math.round(n));
}
const trim = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ''));

/** The same in words, for a screen reader: "18.4 thousand tokens", "1.2 million tokens", "842 tokens". */
export function tokenWords(n: number): string {
  const short = formatTurnTokens(n);
  const words = short.endsWith('M') ? `${short.slice(0, -1)} million` : short.endsWith('k') ? `${short.slice(0, -1)} thousand` : short;
  return `${words} ${n === 1 ? 'token' : 'tokens'}`;
}

/** A model's name with its version, as the model menu shows it: "Opus 5.5" for `claude-opus-5-5`, "Sonnet 3.5" for `claude-3-5-sonnet-20241022`. */
export function modelTitle(model: string): string {
  const parts = model.replace(/\[.*\]$/, '').split(/[-_]/).filter((p) => p && p !== 'claude' && !/^\d{8}$/.test(p));
  const family = parts.find((p) => /^[a-z]+$/i.test(p));
  if (!family) return model;
  const version = parts.filter((p) => /^\d{1,2}$/.test(p)).join('.');
  const name = family[0]!.toUpperCase() + family.slice(1);
  return version ? `${name} ${version}` : name;
}

/** What the line shows, by the setting: Nothing, Time, Time and duration, or all three. */
export interface LineParts {
  time: boolean;
  duration: boolean;
  tokens: boolean;
}

/** Below this width (the conversation's), the tokens go; below the next, the duration too. The time's tooltip keeps them. */
export const DROP_TOKENS_BELOW = 520;
export const DROP_DURATION_BELOW = 380;

/** The parts the line shows for the setting at the conversation's width (null: not measured yet, so everything). */
export function lineParts(mode: TurnDetails, width: number | null): LineParts {
  const wide = width === null || width >= DROP_TOKENS_BELOW;
  const roomy = width === null || width >= DROP_DURATION_BELOW;
  return {
    time: mode !== 'none',
    duration: (mode === 'duration' || mode === 'tokens') && roomy,
    tokens: mode === 'tokens' && wide && roomy,
  };
}

/** The live part of the working line, by the setting: the clock with Duration and Tokens, and the tokens with Tokens. */
export function liveParts(mode: TurnDetails): { duration: boolean; tokens: boolean } {
  return { duration: mode === 'duration' || mode === 'tokens', tokens: mode === 'tokens' };
}

/** A finished turn's line, as text: the parts it shows, its label for screen readers, and the time's tooltip. */
export interface TurnLine {
  time: string | null;
  /** "2m 14s", "Stopped after 1m 02s", "Failed after 18s"; `waiting` goes after it in brackets. */
  duration: { text: string; waiting: string | null; failed: boolean } | null;
  tokens: string | null;
  /** "Ended at 14:32, took 2 minutes 14 seconds, 18.4 thousand tokens". */
  label: string;
  /** Everything, whatever the line leaves out: the full date and time, the duration and the tokens. */
  tooltip: string;
}

/** What a finished turn's line says, for the setting and the conversation's width. Null when it shows nothing. */
export function describeTurn(turn: Turn, mode: TurnDetails, width: number | null, now = Date.now(), locale?: string, timeZone?: string): TurnLine | null {
  if (mode === 'none' || turn.endedAt === null) return null;
  const parts = lineParts(mode, width);
  const worked = claudeMs(turn);
  const waited = turn.waitingMs ? formatTurnDuration(turn.waitingMs) : null;
  const tokens = turn.tokens ? formatTurnTokens(turn.tokens.total) : null;

  const durationText =
    worked === null ? null : turn.outcome === 'stopped' ? `Stopped after ${formatTurnDuration(worked)}` : turn.outcome === 'failed' ? `Failed after ${formatTurnDuration(worked)}` : formatTurnDuration(worked);
  const durationLabel =
    worked === null
      ? null
      : `${turn.outcome === 'stopped' ? 'stopped after' : turn.outcome === 'failed' ? 'failed after' : 'took'} ${durationWords(worked)}${turn.waitingMs ? `, ${durationWords(turn.waitingMs)} waiting on you` : ''}`;
  const time = formatTurnTime(turn.endedAt, now, locale, timeZone);
  const showDuration = parts.duration && durationText !== null;
  const showTokens = parts.tokens && tokens !== null;
  const modeHas = { duration: mode === 'duration' || mode === 'tokens', tokens: mode === 'tokens' };

  const label = [`Ended at ${time}`, ...(modeHas.duration && durationLabel ? [durationLabel] : []), ...(modeHas.tokens && turn.tokens ? [tokenWords(turn.tokens.total)] : [])].join(', ');
  const tooltip = [
    formatFullTime(turn.endedAt, locale, timeZone),
    ...(durationText ? [`${turn.outcome === 'done' ? 'Took ' : ''}${durationText}${waited ? ` (${waited} waiting on you)` : ''}`] : []),
    ...(tokens && turn.tokens ? [`${tokens} tokens · ${turn.tokens.replies} ${turn.tokens.replies === 1 ? 'reply' : 'replies'}`] : []),
  ].join('\n');
  return {
    time,
    duration: showDuration ? { text: durationText!, waiting: waited ? `${waited} waiting on you` : null, failed: turn.outcome === 'failed' } : null,
    tokens: showTokens ? `${tokens} tokens` : null,
    label,
    tooltip,
  };
}

/** The token tooltip's heading: "18.4k tokens · this turn · 4 replies". */
export function tokensHeading(tokens: TurnTokens): string {
  return `${formatTurnTokens(tokens.total)} tokens · this turn · ${tokens.replies} ${tokens.replies === 1 ? 'reply' : 'replies'}`;
}
