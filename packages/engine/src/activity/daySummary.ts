import type { ActivityEntry, ActivitySummaryExtra } from '@seshboard/protocol';
import { oneLine } from '../catchUp/turn.ts';

/** What Haiku is told when it writes the day in short. */
export const DAY_SUMMARY_SYSTEM_PROMPT = `You write "the day in short": a few lines someone reads to remember what they did on a day of work with Claude Code. You get the day's projects, and per project its sessions with their titles, what each did and what was asked.

Write one to three short, plain sentences. Start with the project that took the most time. Put each project's name between ** the first time it comes up, and nothing else. Say what changed or got fixed, in the past tense or as "can now". Leave out numbers of sessions, commits and time: those show elsewhere. No lists, headings, praise, or advice. Answer with the sentences and nothing else.`;

/** The most sessions, and lines per session, Haiku reads: a few lines don't need more. */
const MAX_SESSIONS = 40;
const MAX_LINES = 4;

/** The user message: what Haiku may see, as JSON. Titles, catch-up lines and your prompts, never transcripts, diffs or paths. */
export function daySummaryInput(entries: readonly ActivityEntry[], others: readonly ActivitySummaryExtra[]): string {
  const sessions = [...entries, ...others].sort((a, b) => b.activeMs - a.activeMs).slice(0, MAX_SESSIONS);
  const projects = new Map<string, Array<{ title: string; did?: string[]; asked?: string[] }>>();
  for (const session of sessions) {
    const list = projects.get(session.projectName) ?? [];
    list.push({
      title: oneLine(session.title, 120),
      ...(session.did.length ? { did: session.did.slice(-MAX_LINES) } : { asked: session.asks.slice(0, MAX_LINES).map((ask) => oneLine(ask, 160)) }),
    });
    projects.set(session.projectName, list);
  }
  return JSON.stringify({ projects: [...projects].map(([name, list]) => ({ name, sessions: list })) });
}

/** Haiku's answer as a day's summary: its text without code fences, in at most a few lines. Null when nothing is left. */
export function parseDaySummary(text: string | null): string | null {
  if (!text) return null;
  const clean = text.replace(/^```\w*\n?|\n?```$/g, '').replace(/\s+/g, ' ').trim();
  return clean ? oneLine(clean, 700) : null;
}

/** The smoke run's and the screenshots' day in short: no model is called. It answers from the input, as Haiku must. */
export function stubDaySummary(input: string): string {
  const { projects } = JSON.parse(input) as { projects: Array<{ name: string; sessions: Array<{ title: string }> }> };
  const [first, second] = projects;
  if (!first) return '';
  const lead = `Mostly **${first.name}**: ${first.sessions[0]?.title ?? 'its sessions'}.`;
  return second ? `${lead} In **${second.name}**: ${second.sessions[0]?.title ?? 'its sessions'}.` : lead;
}
