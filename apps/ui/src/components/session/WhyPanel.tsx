import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import type { PermissionRequest } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useWhy } from '../../state/whyStore.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { permissionTitle } from './PermissionCard.tsx';

function Part({ title, children, data }: { title: string; children: ReactNode; data: string }) {
  return (
    <section className="grid gap-1" {...{ [`data-why-${data}`]: true }}>
      <SectionHeader as="h3">{title}</SectionHeader>
      {children}
    </section>
  );
}

/**
 * "Why is Claude asking?", beside the conversation: what saying yes does and why Claude needs it (Haiku, with summaries
 * on), Claude's own last words, your ask and what it did so far. It only explains: the answer stays in the card above the
 * message box. Esc or the card's answer closes it.
 */
export function WhyPanel({ request, cwd }: { request: PermissionRequest; cwd: string | null }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const result = useWhy((s) => s.results.get(request.requestId));
  const summaries = usePreferences((s) => s.prefs.catchUpSummaries);
  const command = request.toolName === 'Bash' ? (request.input as { command?: string }).command : undefined;

  useEffect(() => {
    if (!client || result) return;
    const { setResult } = useWhy.getState();
    setResult(request.requestId, { status: 'loading' });
    client
      .call('catchup.why', { sessionId: request.sessionId, requestId: request.requestId })
      .then(({ why }) => setResult(request.requestId, { status: 'done', why }))
      .catch((e: unknown) => setResult(request.requestId, { status: 'error', error: e instanceof Error ? e.message : String(e) }));
  }, [client, request.requestId, request.sessionId, result]);

  const why = result?.status === 'done' ? result.why : null;
  return (
    <aside aria-label="Why Claude asks" className="flex w-80 max-w-[85%] min-w-0 shrink-0 flex-col border-l border-border bg-bg" data-why-panel>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="min-w-0 flex-1 truncate text-ui font-semibold">Why Claude asks</h2>
        <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Close (Esc)" data-tooltip="Close (Esc)" onClick={() => useWhy.getState().close()} data-why-close />
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 py-3 text-body select-text">
        <Part title="The request" data="request">
          <p className="font-medium text-text">{permissionTitle(request, cwd)}</p>
          {command && <pre className="max-h-32 overflow-auto rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-ui whitespace-pre-wrap">{command}</pre>}
        </Part>
        {result?.status === 'loading' && (
          <p role="status" className="text-ui text-muted" data-why-loading>
            {summaries ? 'Asking Haiku…' : 'Reading the turn…'}
          </p>
        )}
        {result?.status === 'error' && (
          <Notice tone="error" data-why-error>
            {result.error}
          </Notice>
        )}
        {why?.why && (
          <Part title="Why Claude needs it" data="why">
            <p className="text-text">{why.why}</p>
          </Part>
        )}
        {why?.what && (
          <Part title="What it does" data="what">
            <p className="text-text">{why.what}</p>
          </Part>
        )}
        {why?.claudeSaid && (
          <Part title="What Claude said" data="claude-said">
            <blockquote className="border-l-2 border-border pl-3 text-text/85">{why.claudeSaid}</blockquote>
          </Part>
        )}
        {why && (
          <>
            <Part title="Your ask" data="ask">
              <p className="text-text">{why.ask || 'No prompt found.'}</p>
            </Part>
            <Part title="So far" data="did">
              <ul className="grid list-disc gap-1 pl-4 text-text/90 marker:text-faint">
                {why.did.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </Part>
          </>
        )}
        {why && !summaries && (
          <p className="text-meta text-muted" data-why-summaries-off>
            Turn on{' '}
            <button type="button" className="text-link hover:underline" onClick={() => useSessions.getState().openSettings('conversation')}>
              Write catch-up summaries with Haiku
            </button>{' '}
            for a plain explanation of the request.
          </p>
        )}
      </div>
    </aside>
  );
}
