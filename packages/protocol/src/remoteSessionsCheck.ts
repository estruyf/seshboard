import type { RemotePrompt, RemoteRunState, RemoteSession, RemoteSessions } from './remote.ts';

/**
 * Checks a paired computer's session list where zod can't (the remote app, which leaves zod out). Another computer
 * may run an older or newer Switchboard, or not be Switchboard at all, and a list the views can't read would blank
 * them. Each session, prompt and run is checked on its own, for the fields the views read: one that doesn't pass is
 * left out and counted, so the rest still shows. Unknown fields and values of an enum (a status a newer version
 * added) pass, as the views fall back on them. The engine checks the same lists with the contract's schemas.
 */

type Shape = Record<string, unknown>;

const isObject = (value: unknown): value is Shape => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const nullable = (check: (value: unknown) => boolean) => (value: unknown) => value === null || check(value);
/** Left out by an older Switchboard, or null. */
const optional = (check: (value: unknown) => boolean) => (value: unknown) => value === undefined || value === null || check(value);
const arrayOf = (check: (value: unknown) => boolean) => (value: unknown) => Array.isArray(value) && value.every(check);

function fields(value: unknown, checks: Record<string, (value: unknown) => boolean>): boolean {
  return isObject(value) && Object.entries(checks).every(([key, check]) => check(value[key]));
}

const profile = (value: unknown) => fields(value, { id: isString, name: isString, color: isString });
const backgroundTask = (value: unknown) => fields(value, { taskId: isString, type: isString, description: isString, startedAt: isNumber });

export function isRemoteSession(value: unknown): value is RemoteSession {
  return fields(value, {
    id: isString,
    title: isString,
    projectId: isString,
    projectName: isString,
    branch: nullable(isString),
    status: isString,
    updatedAt: isNumber,
    workingSince: optional(isNumber),
    unread: isBoolean,
    pinned: isBoolean,
    model: nullable(isString),
    effort: optional(isString),
    permissionMode: nullable(isString),
    profile: nullable(profile),
    auto: optional((auto) => fields(auto, { picked: nullable(isString), choosing: isBoolean })),
    background: optional(arrayOf(backgroundTask)),
    parentId: optional(isString),
  });
}

export function isRemotePrompt(value: unknown): value is RemotePrompt {
  return fields(value, {
    requestId: isString,
    sessionId: isString,
    toolName: isString,
    title: nullable(isString),
    description: nullable(isString),
    alwaysLabel: nullable(isString),
    createdAt: isNumber,
  });
}

const pipelineStep = (value: unknown) => fields(value, { kind: isString, name: isString });
const runStep = (value: unknown) =>
  fields(value, { step: isString, index: isNumber, round: isNumber, sessionId: nullable(isString), status: isString, reason: nullable(isString), startedAt: isNumber, endedAt: nullable(isNumber) });

export function isRemoteRunState(value: unknown): value is RemoteRunState {
  return fields(value, {
    run: (run) =>
      fields(run, {
        id: isString,
        title: isString,
        projectId: isString,
        projectName: isString,
        parentSessionId: nullable(isString),
        status: isString,
        reason: optional(isString),
        step: isNumber,
        round: isNumber,
        createdAt: isNumber,
        updatedAt: isNumber,
        worktree: optional(isBoolean),
        pipeline: (pipeline) => fields(pipeline, { name: isString, steps: arrayOf(pipelineStep) }),
      }),
    steps: arrayOf(runStep),
  });
}

/** A checked list, and how many of its entries were left out. */
export interface CheckedSessions {
  list: RemoteSessions;
  dropped: number;
}

/** The list without what the views can't read; null when it isn't a session list at all. */
export function checkRemoteSessions(value: unknown): CheckedSessions | null {
  if (!isObject(value) || !Array.isArray(value.sessions) || !Array.isArray(value.prompts)) return null;
  if (value.runs !== undefined && !Array.isArray(value.runs)) return null;
  const sessions = value.sessions.filter(isRemoteSession);
  const prompts = value.prompts.filter(isRemotePrompt);
  const runs = Array.isArray(value.runs) ? value.runs.filter(isRemoteRunState) : undefined;
  const dropped = value.sessions.length - sessions.length + (value.prompts.length - prompts.length) + (runs ? (value.runs as unknown[]).length - runs.length : 0);
  return { list: runs ? { sessions, prompts, runs } : { sessions, prompts }, dropped };
}

/**
 * What to tell you when a computer sent something this app can't read: all of it (`dropped` null), or some of its
 * sessions, which are then not shown.
 */
export function unreadableLine(name: string, dropped: number | null): string {
  const who = name || 'The other computer';
  const what = dropped === null ? 'data' : dropped === 1 ? '1 item in its session list' : `${dropped} items in its session list`;
  const shown = dropped === null ? '' : dropped === 1 ? ', so it isn’t shown' : ', so they aren’t shown';
  return `${who} sent ${what} this version of Switchboard can’t read${shown}. It may run an older or newer version. Update Switchboard on both computers.`;
}
