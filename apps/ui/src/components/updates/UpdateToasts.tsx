import { ArrowDownCircle, CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { claudeUpdateToast } from '../../lib/claudeUpdate.ts';
import { updateToast } from '../../lib/updates.ts';
import { useClaudeUpdate } from '../../state/claudeUpdateStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useUpdates } from '../../state/updatesStore.ts';
import { Button } from '../ui/Button.tsx';
import { ToastFrame, useToastCountdown } from '../ui/ToastFrame.tsx';
import { useInstallUpdate } from './useInstallUpdate.tsx';

/** How long "Updated to …" stays while visible before it counts as seen. */
const UPDATED_MS = 10_000;

type Tone = 'accent' | 'busy' | 'error' | 'ok';

const LEAD: Record<Tone, ReactNode> = {
  accent: <ArrowDownCircle size={14} className="shrink-0 text-accent-ink" aria-hidden />,
  busy: <LoaderCircle size={14} className="shrink-0 animate-spin text-accent-ink" aria-hidden />,
  error: <CircleAlert size={14} className="shrink-0 text-error" aria-hidden />,
  ok: <CheckCircle2 size={14} className="shrink-0 text-ok" aria-hidden />,
};

interface UpdateCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone: Tone;
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  /** Release notes, folded away under "What’s new". */
  notes?: string | null;
  onClose(): void;
  closeLabel: string;
}

/** An update toast: it stays until it's dealt with, except "Updated to …", which goes by itself once seen. */
function UpdateCard({ tone, title, body, actions, notes, onClose, closeLabel, ...rest }: UpdateCardProps) {
  const [showNotes, setShowNotes] = useState(false);
  const countdown = useToastCountdown(tone === 'ok' ? UPDATED_MS : null, onClose);
  const notesButton = notes && (
    <Button size="md" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes} data-update-notes-toggle>
      What’s new
    </Button>
  );
  return (
    <ToastFrame lead={LEAD[tone]} title={title} body={body} actions={actions || notesButton ? <>{actions}{notesButton}</> : undefined} onDismiss={onClose} dismissLabel={closeLabel} {...countdown} {...rest}>
      {showNotes && notes && (
        <p className="mt-1 max-h-56 overflow-y-auto pr-2 text-ui leading-relaxed whitespace-pre-wrap text-muted" tabIndex={0} data-update-notes>
          {notes}
        </p>
      )}
    </ToastFrame>
  );
}

/** A download's progress, in the working colour (a level meter would read it as a warning near the end). */
function Progress({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-accent-ink transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 text-meta tabular-nums">{percent}%</span>
    </div>
  );
}

/**
 * News about updates to Seshboard and to Claude Code, on top of the toast stack. Closing an offer hides it until
 * the next step (or the next launch); closing "Updated" or a Claude Code version tells main or the engine it was seen.
 */
export function UpdateToasts() {
  const app = useUpdates((s) => s.state);
  const claude = useClaudeUpdate((s) => s.state);
  const { install, dialog } = useInstallUpdate();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const hide = (key: string) => setHidden((keys) => new Set(keys).add(key));

  const appToast = updateToast(app);
  const appKey = appToast && `app:${appToast.key}`;
  const claudeToast = claudeUpdateToast(claude);
  const claudeKey = claudeToast && `claude:${claudeToast.key}`;

  return (
    <>
      {appToast && appKey && !hidden.has(appKey) && (
        <UpdateCard
          key={appKey}
          tone={appToast.tone}
          title={appToast.title}
          body={appToast.progress !== null ? <Progress percent={appToast.progress} /> : appToast.body}
          notes={appToast.notes}
          actions={
            appToast.action && (
              <Button
                variant="primary"
                onClick={() => (appToast.action?.run === 'install' ? install() : window.seshboard?.update(appToast.action!.run))}
                data-update-toast-action={appToast.action.run}
              >
                {appToast.action.label}
              </Button>
            )
          }
          onClose={() => (appToast.close === 'dismiss' ? window.seshboard?.update('dismiss') : hide(appKey))}
          closeLabel={appToast.close === 'dismiss' ? 'Dismiss' : 'Not now'}
          data-update-toast={app?.status}
        />
      )}
      {claudeToast && claudeKey && !hidden.has(claudeKey) && (
        <UpdateCard
          key={claudeKey}
          tone={claudeToast.tone}
          title={claudeToast.title}
          body={claudeToast.body}
          actions={
            claudeToast.action && (
              <Button
                variant={claudeToast.action.primary ? 'primary' : 'secondary'}
                onClick={() => {
                  // Updating shows its output (and any error) in Settings → About, so go there too.
                  useSessions.getState().openSettings('about');
                  if (claudeToast.action?.run === 'update') useClaudeUpdate.getState().update();
                }}
                data-tooltip={claudeToast.action.run === 'update' && claude?.command ? `Runs ${claude.command}` : undefined}
                data-claude-update-toast-action={claudeToast.action.run}
              >
                {claudeToast.action.label}
              </Button>
            )
          }
          onClose={() => (claudeToast.close === 'dismiss' ? useClaudeUpdate.getState().dismiss() : hide(claudeKey))}
          closeLabel={claudeToast.close === 'dismiss' ? 'Dismiss Claude Code update' : 'Hide'}
          data-claude-update-toast={claude?.status}
        />
      )}
      {/* The toasts' layer lets clicks through to the window; the confirmation must not inherit that. */}
      {dialog && createPortal(dialog, document.body)}
    </>
  );
}
