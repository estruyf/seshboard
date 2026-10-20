import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { CatchUp, PermissionDecision, RemoteSession } from '@switchboard/protocol/remote-client';
import type { ListedPrompt, ListedSession, ListedSessions, ListedUsage } from '../lib/everywhere.ts';
import { catchUpChips, reviewLabel } from '../lib/catchUp.ts';
import { age, homeHeadline, toReview } from '../lib/groups.ts';
import { promptTag } from '../lib/prompts.ts';
import { answer } from './answer.ts';
import type { Client } from './Connected.tsx';
import type { ListComputer } from './SessionList.tsx';
import { PromptBody } from './PermissionCard.tsx';
import { useNow } from './SessionList.tsx';
import { UsageSection } from './Usage.tsx';
import { connectionOf } from './connectionOf.ts';
import { useLeaving } from './useLeaving.ts';
import { Button, ComputerTag, SectionHeader } from './ui.tsx';

/** How a card opens its session (by its key in the list): on its own, or with Changes open. */
export type OpenSession = (sessionId: string, options?: { changes?: boolean }) => void;

/**
 * The right side of a wide screen while no session is open: what needs you. Every open prompt as a card, oldest
 * first, answered right here (A, D and ↩ too); then the finished sessions you haven't read, each with its catch-up;
 * then each profile's plan usage. Every paired computer's, each card saying which with more than one. J and K move
 * through the cards (`Connected.tsx` has the keys).
 */
export function Home({
  sessions,
  usage,
  offline,
  computerOf,
  labels = false,
  onOpen,
  onNew,
  onRefresh,
  lead,
}: {
  sessions: ListedSessions;
  usage: ListedUsage[] | null;
  /** No computer is connected. */
  offline: boolean;
  computerOf: (computer: string) => ListComputer;
  /** More than one computer is paired: each card says which it is on. */
  labels?: boolean;
  onOpen: OpenSession;
  onNew: () => void;
  onRefresh: () => void;
  /** Before the title on a wide screen whose sidebar folded away: the drawer button. */
  lead?: ReactNode;
}) {
  const now = useNow();
  // Not what a computer that is away said last.
  const headline = homeHeadline(labels ? sessions.sessions.filter((s) => computerOf(s.computer).online) : sessions.sessions, now);
  const leaving = useLeaving(sessions.prompts);
  const cards = leaving.merge([...sessions.prompts].sort((a, b) => a.createdAt - b.createdAt));
  const byId = useMemo(() => new Map(sessions.sessions.map((s) => [s.id, s])), [sessions.sessions]);
  const review = toReview(sessions.sessions);
  const catchUps = useCatchUps(computerOf, review);
  const tagOf = (computer: string) => (labels ? computerOf(computer).name || 'Your computer' : undefined);

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
            <Button variant="primary" size="md" onClick={onNew} disabled={offline} className="ml-auto self-center">
              <Plus className="size-4" aria-hidden />
              New session
            </Button>
          )}
        </div>

        {cards.length > 0 && (
          <section aria-label="Needs you" className="flex flex-col">
            {cards.map((prompt) => (
              <div key={prompt.requestId} className={`collapse-out mb-3 ${!offline && !computerOf(prompt.computer).online ? 'opacity-60' : ''}`} data-leaving={leaving.isLeaving(prompt.requestId) || undefined} onTransitionEnd={(event) => event.propertyName === 'grid-template-rows' && leaving.gone(prompt.requestId)}>
                <div>
                  <PromptCard
                    prompt={prompt}
                    session={byId.get(prompt.sessionId)}
                    client={computerOf(prompt.computer).client}
                    computer={tagOf(prompt.computer)}
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
                <ReviewCard key={session.id} session={session} computer={tagOf(session.computer)} card={catchUps.get(session.id) ?? null} now={now} onOpen={onOpen} />
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
function PromptCard({ prompt, session, client, computer, now, onOpen, onAnswered }: { prompt: ListedPrompt; session: RemoteSession | undefined; client: Client; computer: string | undefined; now: number; onOpen: () => void; onAnswered: (result: 'done' | 'gone') => void }) {
  const [busy, setBusy] = useState(false);
  const title = session?.title ?? 'Session';
  const respond = async (decision: PermissionDecision) => {
    if (!client || busy) return;
    setBusy(true);
    const result = await answer(client, prompt.original, decision, title);
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
        {computer && <ComputerTag name={computer} />}
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
function ReviewCard({ session, computer, card, now, onOpen }: { session: ListedSession; computer: string | undefined; card: CatchUp | null; now: number; onOpen: OpenSession }) {
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
      <p className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
        {computer && <ComputerTag name={computer} />}
        <span className="truncate">
          {session.projectName} · {age(session.updatedAt, now)}
        </span>
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

/** The catch-ups of the sessions to review, each from its computer, asked again when one of them changes. */
function useCatchUps(computerOf: (computer: string) => ListComputer, sessions: readonly ListedSession[]): Map<string, CatchUp | null> {
  const [cards, setCards] = useState<Map<string, CatchUp | null>>(new Map());
  const clients = sessions.map((s) => computerOf(s.computer).client);
  const key = sessions.map((s, i) => `${s.id}@${s.updatedAt}#${connectionOf(clients[i] ?? null)}`).join(' ');
  const latest = useMemo(() => ({ sessions, clients }), [key]);
  useEffect(() => {
    if (!latest.sessions.length) return;
    let live = true;
    const ask = (s: ListedSession, client: Client) => (client ? client.call('catchup.get', { sessionId: s.sessionId }).then((r) => [s.id, r.catchUp] as const, () => [s.id, null] as const) : Promise.resolve([s.id, null] as const));
    void Promise.all(latest.sessions.map((s, i) => ask(s, latest.clients[i] ?? null))).then((entries) => live && setCards(new Map(entries)));
    return () => {
      live = false;
    };
    // `key` says when the list, one of its sessions or a computer's connection changed.
  }, [latest]);
  return cards;
}
