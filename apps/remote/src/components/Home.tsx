import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { CatchUp, PermissionDecision, RemoteProfileUsage, RemotePrompt, RemoteSession, RemoteSessions } from '@switchboard/protocol/remote-client';
import { catchUpChips, reviewLabel } from '../lib/catchUp.ts';
import { age, homeHeadline, toReview } from '../lib/groups.ts';
import { promptTag } from '../lib/prompts.ts';
import { answer } from './answer.ts';
import type { Client } from './Connected.tsx';
import { PromptBody } from './PermissionCard.tsx';
import { useNow } from './SessionList.tsx';
import { UsageSection } from './Usage.tsx';
import { useLeaving } from './useLeaving.ts';
import { Button, SectionHeader } from './ui.tsx';

/** How a card opens its session: on its own, or with Changes open. */
export type OpenSession = (sessionId: string, options?: { changes?: boolean }) => void;

/**
 * The right side of a wide screen while no session is open: what needs you. Every open prompt as a card, oldest
 * first, answered right here (A, D and ↩ too); then the finished sessions you haven't read, each with its catch-up;
 * then each profile's plan usage. J and K move through the cards (`Connected.tsx` has the keys).
 */
export function Home({
  sessions,
  usage,
  offline,
  client,
  onOpen,
  onNew,
  onRefresh,
  lead,
}: {
  sessions: RemoteSessions;
  usage: RemoteProfileUsage[] | null;
  offline: boolean;
  client: Client;
  onOpen: OpenSession;
  onNew: () => void;
  onRefresh: () => void;
  /** Before the title on a wide screen whose sidebar folded away: the drawer button. */
  lead?: ReactNode;
}) {
  const now = useNow();
  const headline = homeHeadline(sessions.sessions, now);
  const leaving = useLeaving(sessions.prompts);
  const cards = leaving.merge([...sessions.prompts].sort((a, b) => a.createdAt - b.createdAt));
  const byId = useMemo(() => new Map(sessions.sessions.map((s) => [s.id, s])), [sessions.sessions]);
  const review = toReview(sessions.sessions);
  const catchUps = useCatchUps(client, review);

  return (
    <main className="h-full overflow-y-auto overscroll-contain" data-remote-scroll data-remote-home>
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 py-8">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {lead && <div className="-ml-2 self-center">{lead}</div>}
          <h1 className="text-hero font-semibold" data-remote-home-title>
            {headline.title}
          </h1>
          {headline.counts && <p className="text-ui text-muted">{headline.counts}</p>}
          {cards.length === 0 && (
            <Button variant="primary" size="md" onClick={onNew} disabled={!client} className="ml-auto self-center">
              <Plus className="size-4" aria-hidden />
              New session
            </Button>
          )}
        </div>

        {cards.length > 0 && (
          <section aria-label="Needs you" className="flex flex-col">
            {cards.map((prompt) => (
              <div key={prompt.requestId} className="collapse-out mb-3" data-leaving={leaving.isLeaving(prompt.requestId) || undefined} onTransitionEnd={(event) => event.propertyName === 'grid-template-rows' && leaving.gone(prompt.requestId)}>
                <div>
                  <PromptCard
                    prompt={prompt}
                    session={byId.get(prompt.sessionId)}
                    client={client}
                    now={now}
                    onOpen={() => onOpen(prompt.sessionId)}
                    onAnswered={(result) => {
                      leaving.leave(prompt);
                      if (result === 'gone') onRefresh();
                    }}
                  />
                </div>
              </div>
            ))}
          </section>
        )}

        {review.length > 0 && (
          <section aria-labelledby="home-review">
            <SectionHeader id="home-review" label="Finished, ready to review" count={review.length} tone="text-unread" className="px-0" />
            <div className="grid grid-cols-1 gap-3 pt-1 lg:grid-cols-2">
              {review.map((session) => (
                <ReviewCard key={session.id} session={session} card={catchUps.get(session.id) ?? null} now={now} onOpen={onOpen} />
              ))}
            </div>
          </section>
        )}

        <UsageSection usage={usage} offline={offline} />
      </div>
    </main>
  );
}

/** ↩ on the card itself (not a button or a field in it) opens the session. */
const enterOpens = (onOpen: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  event.preventDefault();
  onOpen();
};

/**
 * A prompt on the home view: the phone's card with room to spare, so Always allow is on it too, Open on the right of
 * its header, and the keys on its buttons. A question's options are chips, a plan has Keep planning and Start.
 */
function PromptCard({ prompt, session, client, now, onOpen, onAnswered }: { prompt: RemotePrompt; session: RemoteSession | undefined; client: Client; now: number; onOpen: () => void; onAnswered: (result: 'done' | 'gone') => void }) {
  const [busy, setBusy] = useState(false);
  const title = session?.title ?? 'Session';
  const respond = async (decision: PermissionDecision) => {
    if (!client || busy) return;
    setBusy(true);
    const result = await answer(client, prompt, decision, title);
    if (result === 'failed') setBusy(false);
    else onAnswered(result);
  };
  return (
    <article
      tabIndex={0}
      onKeyDown={enterOpens(onOpen)}
      aria-label={`${promptTag(prompt)}: ${title}`}
      className="flex flex-col gap-2 rounded-xl border-2 border-warn bg-card p-4 focus-visible:outline-offset-4"
      data-remote-nav="card"
      data-remote-prompt-card={prompt.requestId}
    >
      <div className="flex items-center gap-2 text-meta">
        <span className="font-semibold tracking-wide text-warn uppercase">{promptTag(prompt)}</span>
        <span className="truncate text-faint">
          {session?.projectName} · {age(prompt.createdAt, now)}
        </span>
        <Button variant="quiet" size="md" onClick={onOpen} className="-my-1 -mr-1.5 ml-auto" data-remote-open>
          Open
        </Button>
      </div>
      <h2 className="truncate text-body font-semibold">{title}</h2>
      <PromptBody prompt={prompt} disabled={busy || !client} respond={respond} hints compact />
    </article>
  );
}

/** A finished session you haven't read: its review time, what it did, the tests, and Changes and Open. */
function ReviewCard({ session, card, now, onOpen }: { session: RemoteSession; card: CatchUp | null; now: number; onOpen: OpenSession }) {
  const tests = card ? catchUpChips(card).find((chip) => chip.id === 'tests') : undefined;
  const summary = card?.did[0] ?? card?.ask ?? '';
  const hasDiff = (card?.signals.diff?.files ?? 0) > 0;
  const open = () => onOpen(session.id);
  return (
    <article tabIndex={0} onKeyDown={enterOpens(open)} aria-label={`Finished: ${session.title}`} className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card p-3 focus-visible:outline-offset-4" data-remote-nav="card" data-remote-review={session.id}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-unread" />
        <h3 className="min-w-0 flex-1 truncate text-body font-semibold">{session.title}</h3>
        {card && <span className="shrink-0 text-meta font-semibold">{reviewLabel(card)}</span>}
      </div>
      <p className="truncate text-meta text-muted">
        {session.projectName} · {age(session.updatedAt, now)}
      </p>
      {summary && <p className="line-clamp-2 text-ui text-muted">{summary}</p>}
      <div className="mt-auto flex items-center gap-1.5 pt-1">
        {tests && (
          <span className={`inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-meta ${tests.tone === 'ok' ? 'text-ok' : tests.tone === 'error' ? 'text-error' : 'text-muted'}`}>
            <span aria-hidden className={`size-1.5 rounded-full ${tests.tone === 'ok' ? 'bg-ok' : tests.tone === 'error' ? 'bg-error' : 'bg-faint'}`} />
            {tests.text}
          </span>
        )}
        <span className="flex-1" />
        {hasDiff && (
          <Button size="md" onClick={() => onOpen(session.id, { changes: true })} data-remote-review-changes>
            Changes
          </Button>
        )}
        <Button size="md" onClick={open} data-remote-open>
          Open
        </Button>
      </div>
    </article>
  );
}

/** The catch-ups of the sessions to review, asked again when one of them changes. */
function useCatchUps(client: Client, sessions: readonly RemoteSession[]): Map<string, CatchUp | null> {
  const [cards, setCards] = useState<Map<string, CatchUp | null>>(new Map());
  const key = sessions.map((s) => `${s.id}@${s.updatedAt}`).join(' ');
  useEffect(() => {
    if (!client || !sessions.length) return;
    let live = true;
    void Promise.all(sessions.map((s) => client.call('catchup.get', { sessionId: s.id }).then((r) => [s.id, r.catchUp] as const, () => [s.id, null] as const))).then((entries) => live && setCards(new Map(entries)));
    return () => {
      live = false;
    };
    // `key` says when the list or one of its sessions changed.
  }, [client, key]);
  return cards;
}
