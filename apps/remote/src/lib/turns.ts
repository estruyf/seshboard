import type { RemoteMessage } from '@switchboard/protocol/remote-client';

/**
 * Under the last reply of each finished turn, when it ended, how long it took and its tokens ("14:32 · 2m 14s · 18.4k
 * tokens"), as on the computer (apps/ui `transcript/turns.ts` and `turnFormat.ts`), from the messages' timestamps and
 * usage. Also the turn's text replies, for Read. Pure, with tests.
 */

/** A prompt this soon after Claude's last step, while Claude was mid-work, was steered into the turn (as on the computer). */
const STEER_GAP_MS = 5 * 60_000;
/** The reading speed of the Read sheet, in words a minute (the computer's reading mode uses the same). */
const WORDS_PER_MINUTE = 230;

const isPrompt = (m: RemoteMessage) => m.role === 'user' && m.parentToolUseId === null && m.blocks.some((b) => b.type === 'text' || b.type === 'image') && !m.blocks.some((b) => b.type === 'tool_result');
const isInterrupt = (m: RemoteMessage) => m.role === 'user' && m.blocks.some((b) => b.type === 'text' && /^\[Request interrupted by user/.test(b.text));

export interface TurnEnd {
  endedAt: number;
  durationMs: number;
  stopped: boolean;
  /** Claude's tokens in the turn, subagents' included (input, cache and output); null when no reply reported any. */
  tokens: number | null;
  /** Claude's text replies in the turn, in order. The last one is the reply the line sits under. */
  texts: string[];
}

/**
 * Each finished turn by the key of its last reply (`<uuid>:<block>`, as `transcriptItems` keys text). The last turn
 * counts only when `working` is false.
 */
export function turnEnds(messages: readonly RemoteMessage[], working: boolean): Map<string, TurnEnd> {
  type Open = {
    startedAt: number | null;
    endedAt: number | null;
    reply: string | null;
    stopped: boolean;
    midWork: boolean;
    lastAt: number | null;
    tokens: number;
    reported: boolean;
    /** The responses counted so far: a response's usage repeats on each of its messages. */
    counted: Set<string>;
    texts: string[];
  };
  const out = new Map<string, TurnEnd>();
  let turn: Open | null = null;
  const close = (t: Open | null) => {
    if (t?.reply && t.startedAt !== null && t.endedAt !== null) {
      out.set(t.reply, { endedAt: t.endedAt, durationMs: Math.max(0, t.endedAt - t.startedAt), stopped: t.stopped, tokens: t.reported ? t.tokens : null, texts: t.texts });
    }
  };
  for (const m of messages) {
    // Subagents' replies cost tokens too, so they count before the top-level filter below.
    if (turn && m.usage && !turn.counted.has(m.usage.id)) {
      turn.counted.add(m.usage.id);
      turn.reported = true;
      turn.tokens += m.usage.input + m.usage.cacheRead + m.usage.cacheWrite + m.usage.output;
    }
    if (m.parentToolUseId !== null) continue;
    if (isInterrupt(m)) {
      if (turn) {
        turn.stopped = true;
        if (m.timestamp !== null) turn.endedAt = m.timestamp;
      }
      continue;
    }
    if (isPrompt(m)) {
      const steered = turn?.midWork && (m.timestamp === null || turn.lastAt === null || m.timestamp - turn.lastAt <= STEER_GAP_MS);
      if (steered) continue;
      close(turn);
      turn = { startedAt: m.timestamp, endedAt: null, reply: null, stopped: false, midWork: false, lastAt: null, tokens: 0, reported: false, counted: new Set(), texts: [] };
      continue;
    }
    if (!turn || m.role === 'system') continue;
    if (m.timestamp !== null) {
      turn.endedAt = m.timestamp;
      turn.lastAt = m.timestamp;
    }
    m.blocks.forEach((block, index) => {
      if (block.type === 'text' && m.role === 'assistant' && block.text.trim()) {
        turn!.reply = `${m.uuid}:${index}`;
        turn!.texts.push(block.text);
        turn!.stopped = false;
        turn!.midWork = false;
      } else if (block.type === 'tool_use' || block.type === 'tool_result' || block.type === 'thinking') turn!.midWork = true;
    });
  }
  if (!working) close(turn);
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "48s", "2m 14s", "1h 05m". */
export function formatTurnDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

const dayNumber = (at: number, timeZone?: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).formatToParts(new Date(at));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
};

/** "14:32" today (in the phone's own time format), "Mon 09:12" this week, "3 Oct 14:32" this year, "12 Dec 2025" before. */
export function formatTurnTime(at: number, now = Date.now(), locale?: string, timeZone?: string): string {
  const date = new Date(at);
  const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
  const time = date.toLocaleTimeString(locale, { hour: cycle === 'h23' || cycle === 'h24' ? '2-digit' : 'numeric', minute: '2-digit', timeZone });
  const days = dayNumber(now, timeZone) - dayNumber(at, timeZone);
  if (days <= 0) return time;
  if (days < 7) return `${date.toLocaleDateString(locale, { weekday: 'short', timeZone })} ${time}`;
  const sameYear = new Date(at).getUTCFullYear() === new Date(now).getUTCFullYear();
  return sameYear ? `${date.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone })} ${time}` : date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone });
}

/** "842", "18.4k" (one decimal under 100k), "184k", "1.2M", as the computer's turn line. */
export function formatTurnTokens(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 100_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${trim(n / 1_000)}k`;
  return String(Math.round(n));
}
const trim = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ''));

/** The line: "14:32 · 2m 14s · 18.4k tokens", or "14:32 · Stopped after 1m 02s". */
export function turnLine(end: TurnEnd, now = Date.now(), locale?: string, timeZone?: string): string {
  const duration = formatTurnDuration(end.durationMs);
  const tokens = end.tokens === null ? '' : ` · ${formatTurnTokens(end.tokens)} tokens`;
  return `${formatTurnTime(end.endedAt, now, locale, timeZone)} · ${end.stopped ? `Stopped after ${duration}` : duration}${tokens}`;
}

/** A reply's length for the Read sheet: its words, and the minutes to read them (at least one, when there are words). */
export function readingOf(texts: readonly string[]): { words: number; minutes: number } {
  const words = texts.reduce((n, t) => n + (t.match(/\S+/g)?.length ?? 0), 0);
  return { words, minutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) };
}
