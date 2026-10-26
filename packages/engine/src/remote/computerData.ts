import { z } from 'zod';
import { remoteContract, RemotePrompt, RemoteRunState, RemoteSession, type ComputerMethod } from '@seshboard/protocol';

/**
 * What another computer sends, checked against the remote contract before a window sees it. That computer may run
 * an older or newer Seshboard, or not be Seshboard at all: the windows trust what the engine passes on, and a
 * list they can't read would blank them. A session list is checked entry by entry, so one entry this version can't
 * read is left out and the rest still shows; anything else passes whole or not at all.
 */
export type CheckedData = { ok: true; value: unknown; dropped: number } | { ok: false; issue: string };

const ListShape = z.object({ sessions: z.array(z.unknown()), prompts: z.array(z.unknown()), runs: z.array(z.unknown()).optional() });

function keep<T>(schema: z.ZodType<T>, items: readonly unknown[]): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** A session list (`sessions.list`, `sessions.changed`), without the entries this version can't read. */
export function checkSessions(value: unknown): CheckedData {
  const shape = ListShape.safeParse(value);
  if (!shape.success) return { ok: false, issue: issueOf(shape.error) };
  const { sessions, prompts, runs } = shape.data;
  const list = { sessions: keep(RemoteSession, sessions), prompts: keep(RemotePrompt, prompts), ...(runs ? { runs: keep(RemoteRunState, runs) } : {}) };
  const dropped = sessions.length - list.sessions.length + prompts.length - list.prompts.length + (runs ? runs.length - list.runs!.length : 0);
  return { ok: true, value: list, dropped };
}

function checkWith(schema: z.ZodType, value: unknown): CheckedData {
  const parsed = schema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data, dropped: 0 } : { ok: false, issue: issueOf(parsed.error) };
}

/** The answer to a request a window made. */
export function checkResult(method: ComputerMethod, value: unknown): CheckedData {
  if (method === 'sessions.list') return checkSessions(value);
  return checkWith(remoteContract.requests[method].result, value);
}

/** An event of the remote contract's; null for one it doesn't have, which is dropped. */
export function checkEvent(name: string, payload: unknown): CheckedData | null {
  if (name === 'sessions.changed') return checkSessions(payload);
  const schema = (remoteContract.events as Record<string, z.ZodType>)[name];
  return schema ? checkWith(schema, payload) : null;
}

/** Where it went wrong, for the log: the path and zod's message, never the data itself. */
function issueOf(error: z.ZodError): string {
  const first = error.issues[0];
  return first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid';
}
