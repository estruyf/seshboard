import { isMine, REMOTE_FEATURE_ACTIVITY, type ActivitySummary, type ActivitySummaryState, type Computer } from '@seshboard/protocol/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useComputers } from '../../state/computersStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { scopeOf } from '../../state/remoteRows.ts';
import { callComputer } from '../computers/callComputer.ts';
import { computersToAsk } from '../usage/usageMerge.ts';
import { dayOf, summaryExtras, type ActivityRow } from './activityModel.ts';

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
/** New tokens come in bursts while a session works, and without a pause during a first read: the page follows at this pace. */
const RELOAD_MS = 2_000;
/** How long the day in short waits for other computers before it is written without the ones that haven't answered. */
const REMOTE_WAIT_MS = 4_000;
/** Other computers have no event for this: their numbers are asked for again at this pace, while the range has today. */
const REMOTE_POLL_MS = 60_000;

/** A paired computer's rows, as its Mine / All filter shows them. */
const keepers = (computer: Computer, mineOnly: boolean) => (entry: { sessionId: string; parentId?: string | null }) => !mineOnly || isMine(entry.sessionId, entry.parentId, computer);

export interface ActivityRange {
  rows: ActivityRow[];
  /** Nothing has come back yet for this range. */
  loading: boolean;
  /** This computer and the others have answered, or the others had their time: what is here can be summed up. */
  settled: boolean;
  /** The transcripts' first read is still going: the days may fill up. */
  scanning: boolean;
}

/** What every session did from `from` through `to`, on this computer and on the paired ones that answer. */
export function useActivityRange(from: string, to: string, options: { git?: boolean } = {}): ActivityRange {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const git = options.git ?? true;
  const [local, setLocal] = useState<{ key: string; rows: ActivityRow[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const key = `${from}|${to}`;

  useEffect(() => {
    if (!client) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      client.call('activity.range', { from, to, timeZone: timeZone(), git }).then(
        ({ entries }) => alive && setLocal({ key, rows: entries }),
        () => alive && setLocal((now) => (now?.key === key ? now : { key, rows: [] })),
      );
    };
    load();
    const off = client.on('usage.tokens', ({ scan }) => {
      setScanning(!!scan);
      timer ??= setTimeout(() => {
        timer = undefined;
        load();
      }, RELOAD_MS);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      off();
    };
  }, [client, from, to, git, key]);

  // The other computers. The status changes all the time: only who is asked matters.
  const computers = useComputers((s) => s.status?.computers);
  const scopes = useComputers((s) => s.scopes);
  const asked = useMemo(() => computersToAsk(computers ?? [], REMOTE_FEATURE_ACTIVITY).ask, [computers]);
  const ids = asked.map((c) => c.id).join('\n');
  const [remote, setRemote] = useState<ReadonlyMap<string, { key: string; rows: ActivityRow[] }>>(new Map());
  const [patience, setPatience] = useState<string | null>(null);
  const latest = useRef({ computers, scopes, asked });
  latest.current = { computers, scopes, asked };
  useEffect(() => {
    if (!client || !ids) {
      setRemote(new Map());
      return;
    }
    let alive = true;
    const load = () => {
      for (const { id, name } of latest.current.asked) {
        callComputer(client, id, 'activity.range', { from, to, timeZone: timeZone() }).then(
          ({ entries }) => {
            if (!alive) return;
            const computer = latest.current.computers?.find((c) => c.id === id);
            const keep = computer ? keepers(computer, scopeOf(latest.current.scopes, id) === 'mine') : () => true;
            setRemote((now) => new Map(now).set(id, { key, rows: entries.filter(keep).map((entry) => ({ ...entry, projectRoot: null, computer: { id, name } })) }));
          },
          // A computer that doesn't answer simply doesn't count this time.
          () => alive && setRemote((now) => new Map(now).set(id, { key, rows: [] })),
        );
      }
    };
    load();
    const waited = setTimeout(() => alive && setPatience(key), REMOTE_WAIT_MS);
    const timer = to >= dayOf(Date.now()) ? setInterval(load, REMOTE_POLL_MS) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
      clearTimeout(waited);
    };
  }, [client, ids, from, to, key]);

  const rows = useMemo(() => {
    const here = local?.key === key ? local.rows : [];
    const there = [...remote.values()].filter((r) => r.key === key).flatMap((r) => r.rows);
    return [...here, ...there];
  }, [local, remote, key]);
  const loading = local?.key !== key;
  const answered = asked.every((c) => remote.get(c.id)?.key === key);
  return { rows, loading, settled: !loading && (answered || patience === key), scanning };
}

export interface DaySummary {
  summary: ActivitySummary | null;
  state: ActivitySummaryState;
  /** Being written now. */
  writing: boolean;
  regenerate(): void;
}

/**
 * The day in short of a day. Asked for when the day opens (the engine says what to keep and what to write) and only
 * then: today's follows its sessions when you come back to it, not while you watch. It waits for the other computers
 * (`settled`), as what they did goes along and a past day's is kept.
 */
export function useDaySummary(day: string | null, rows: readonly ActivityRow[], settled: boolean): DaySummary {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const enabled = usePreferences((s) => s.prefs.activitySummaries);
  const [answer, setAnswer] = useState<{ day: string; summary: ActivitySummary | null; state: ActivitySummaryState } | null>(null);
  const [writing, setWriting] = useState(false);
  const request = useRef(0);
  const latestRows = useRef(rows);
  latestRows.current = rows;

  const ask = useCallback(
    (fresh: boolean) => {
      if (!client || !day) return;
      const id = ++request.current;
      setWriting(true);
      client.call('activity.summary', { day, timeZone: timeZone(), fresh, others: summaryExtras(latestRows.current) }).then(
        (result) => {
          if (id !== request.current) return;
          setAnswer({ day, ...result });
          setWriting(false);
        },
        () => {
          if (id !== request.current) return;
          setAnswer({ day, summary: null, state: 'failed' });
          setWriting(false);
        },
      );
    },
    [client, day],
  );

  const hasRows = rows.length > 0;
  useEffect(() => {
    if (!enabled) {
      request.current++;
      setWriting(false);
      setAnswer(null);
      return;
    }
    if (!day || !settled || !hasRows) return;
    ask(false);
  }, [ask, day, enabled, settled, hasRows]);

  const current = answer?.day === day ? answer : null;
  return { summary: current?.summary ?? null, state: enabled ? (current?.state ?? 'ok') : 'off', writing, regenerate: () => ask(true) };
}
