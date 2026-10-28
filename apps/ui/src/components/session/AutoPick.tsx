import { Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { tierLabel, type AutoPick, type AutoTier } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { estimateLine, failedLine, otherTiers, shortReason } from '../../lib/autoModel.ts';
import { shouldSuggest, strongerTier, suggestSignals } from '../../lib/autoSuggest.ts';
import { useAutoPick } from '../../state/autoPickStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { AutoWand } from '../composer/ComposerChips.tsx';
import { archiveSessions } from '../drafts/ArchiveDraftDialog.tsx';
import type { DisplayItem } from '../transcript/displayItems.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Popover } from '../ui/Popover.tsx';
import { runAgain } from './runAgain.ts';
import { formatTokens } from '../usage/usageModel.ts';

/**
 * What Auto picked for a session: live from its running process (which also knows when you changed the model), or
 * from the engine for a session that isn't running, so the pick shows after a restart too.
 */
export function useSessionAutoPick(sessionId: string): AutoPick | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const live = useHosts((s) => s.hosts.get(sessionId)?.autoPick);
  const [stored, setStored] = useState<{ sessionId: string; pick: AutoPick | null } | null>(null);
  useEffect(() => {
    if (!client || live !== undefined) return;
    let cancelled = false;
    client
      .call('session.autoPick', { sessionId })
      .then(({ autoPick }) => !cancelled && setStored({ sessionId, pick: autoPick }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, sessionId, live]);
  return live !== undefined ? live : stored?.sessionId === sessionId ? stored.pick : null;
}

/** The quiet line above the first answer: "Auto picked Sonnet · a small, local change · Why". */
export function AutoPickLine({ sessionId, pick }: { sessionId: string; pick: AutoPick }) {
  const open = useAutoPick((s) => s.openPopover);
  const why = (
    <button type="button" className="shrink-0 text-link hover:underline" onClick={(e) => open(sessionId, e.currentTarget.getBoundingClientRect())} aria-haspopup="dialog" data-auto-why>
      Why
    </button>
  );
  if (!pick.model) {
    return (
      <p className="flex min-w-0 items-start gap-1.5 pb-1 text-ui text-muted" data-auto-pick-line="failed">
        <Info size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden />
        <span className="min-w-0">{failedLine(pick.reason)}</span>
      </p>
    );
  }
  return (
    <p className="flex min-w-0 items-center gap-1.5 pb-1 text-ui text-muted" data-auto-pick-line={pick.model}>
      <AutoWand />
      <span className="shrink-0">
        Auto picked <strong className="font-semibold text-text">{tierLabel(pick.model)}</strong>
      </span>
      <span className="min-w-0 truncate">· {shortReason(pick.reason)}</span>
      <span aria-hidden className="text-faint">
        ·
      </span>
      {why}
    </p>
  );
}

/** The "Auto picked Sonnet" popover, from the chip's menu or the first-turn line's Why. */
export function AutoPickPopover({ sessionId, pick, items, cwd }: { sessionId: string; pick: AutoPick; items: readonly DisplayItem[]; cwd: string | null }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const popover = useAutoPick((s) => (s.popover?.sessionId === sessionId ? s.popover : null));
  const close = useAutoPick((s) => s.closePopover);
  const host = useHosts((s) => s.hosts.get(sessionId));
  const summary = useSessions((s) => s.sessions.get(sessionId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!popover) return null;
  const running = !!host && host.state !== 'closed' && host.state !== 'error';
  const others = otherTiers(pick);
  const picked = pick.model ? tierLabel(pick.model) : 'Default model';

  const rerun = async (model: AutoTier) => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      await runAgain(
        { items, model, cwd, host },
        {
          image: (imageId) => client.call('transcript.image', { sessionId, imageId }),
          createSession: (params) => client.call('session.create', params),
          interrupt: () => void client.call('session.interrupt', { sessionId }).catch(() => {}),
          open: (next) => {
            close();
            useSessions.getState().select(next);
          },
          archive: () => archiveSessions([{ id: sessionId, title: summary?.title ?? '' }], () => void client.call('sessions.setFlags', { sessionId, archived: true }).catch(() => {})),
        },
      );
    } catch (e) {
      setError(`Couldn't start it again: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async (model: AutoTier) => {
    if (!client) return;
    await client.call('session.setModel', { sessionId, model }).catch((e: Error) => setError(`Couldn't switch: ${e.message}`));
    close();
  };

  return (
    <Popover x={popover.x} y={popover.y} above={popover.above} width={440} onClose={close} role="dialog" aria-label={pick.model ? `Auto picked ${picked}` : "Auto couldn't pick a model"} className="py-0" data-auto-popover>
      <div className="grid gap-2 px-4 pt-3 pb-3">
        <div className="flex items-center gap-2">
          <AutoWand size={15} />
          <h2 className="text-title font-semibold text-text">{pick.model ? `Auto picked ${picked}` : "Auto couldn't pick a model"}</h2>
          <span className="ml-auto text-meta text-faint">from your prompt only</span>
        </div>
        <p className="text-body text-text">{pick.model ? `“${pick.reason}”` : failedLine(pick.reason)}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ui">
          {pick.model && (
            <>
              <dt className="text-muted">Estimate</dt>
              <dd className="text-text">{estimateLine(pick.model)}</dd>
            </>
          )}
          <dt className="text-muted">Routing</dt>
          <dd className="text-text">{pick.tokens > 0 ? `Haiku read ${formatTokens(pick.tokens)} tokens · counted in your usage` : 'No tokens used'}</dd>
        </dl>
      </div>
      {others.length > 0 && (
        <div className="grid gap-2 border-t border-border px-4 py-3">
          {others.map((tier) => (
            <div key={`again-${tier}`} className="flex items-center gap-3">
              <Button size="md" disabled={busy || !client} onClick={() => void rerun(tier)} data-auto-rerun={tier}>
                Run again with {tierLabel(tier)}
              </Button>
              <span className="min-w-0 text-meta text-muted">new session, same prompt; this one is archived</span>
            </div>
          ))}
          {running &&
            others.map((tier) => (
              <div key={`switch-${tier}`} className="flex items-center gap-3">
                <Button size="md" disabled={busy || !client} onClick={() => void switchTo(tier)} data-auto-switch={tier}>
                  Use {tierLabel(tier)} from the next message
                </Button>
                <span className="min-w-0 text-meta text-muted">the cache starts over</span>
              </div>
            ))}
          {error && <p className="text-meta text-error">{error}</p>}
        </div>
      )}
    </Popover>
  );
}

/**
 * The note above the message box when a session Auto started has grown past its first prompt. It says what
 * switching costs, never switches by itself, and shows at most once per session.
 */
export function AutoSuggestNote({ sessionId, pick, items, contextTokens }: { sessionId: string; pick: AutoPick | null; items: readonly DisplayItem[]; contextTokens: number | null }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const enabled = usePreferences((s) => s.prefs.autoModel.suggest);
  const state = useAutoPick((s) => s.suggested[sessionId]);
  const mark = useAutoPick((s) => s.markSuggested);
  const signals = useMemo(() => suggestSignals(items), [items]);
  const fresh = shouldSuggest({ enabled, pick, seen: state !== undefined, signals });
  // Once shown it stays until answered, also when the signals that raised it change.
  const tier = state === 'shown' && pick && !pick.left ? (fresh ?? strongerTier(pick)) : fresh;
  useEffect(() => {
    if (fresh && state === undefined) mark(sessionId, 'shown');
  }, [fresh, state, sessionId]);
  if (!tier || !pick?.model || state === 'answered') return null;
  const answer = () => mark(sessionId, 'answered');
  const tokens = contextTokens ? `, so the next turn reads about ${formatTokens(contextTokens)} tokens again` : '';
  return (
    <Notice
      tone="neutral"
      icon={<AutoWand />}
      data-auto-suggest={tier}
      actions={
        <>
          <Button
            size="sm"
            onClick={() => {
              answer();
              void client?.call('session.setModel', { sessionId, model: tier }).catch(() => {});
            }}
            data-auto-suggest-use
          >
            Use {tierLabel(tier)}
          </Button>
          <Button size="sm" variant="quiet" onClick={answer} data-auto-suggest-keep>
            Keep {tierLabel(pick.model)}
          </Button>
          <Button size="sm" variant="quiet" onClick={answer} className="ml-auto" data-auto-suggest-never>
            Don't suggest in this session
          </Button>
        </>
      }
    >
      <strong className="font-semibold">This looks bigger than the first prompt.</strong> Use {tierLabel(tier)} from this message? The cache starts over{tokens}.
    </Notice>
  );
}
