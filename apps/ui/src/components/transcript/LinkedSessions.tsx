import { ChevronRight, Link2 } from 'lucide-react';
import { useId, useState } from 'react';
import { writeBrief, type Brief } from '@seshboard/protocol/client';
import { useSessions } from '../../state/sessionsStore.ts';
import { Pill } from '../ui/Pill.tsx';
import { briefPr } from '../composer/sessionLinks.ts';

/**
 * Under your prompt, one row per session it linked (session linking): its label, branch and pull request, and **What
 * Claude got**, which shows the brief as Claude read it. A click on the label opens the session beside this one.
 */
export function LinkedSessions({ briefs }: { briefs: readonly Brief[] }) {
  if (!briefs.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2" aria-label="Linked sessions">
      {briefs.map((brief) => (
        <LinkedRow key={brief.sessionId} brief={brief} />
      ))}
    </ul>
  );
}

function LinkedRow({ brief }: { brief: Brief }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const exists = useSessions((s) => s.sessions.has(brief.sessionId));
  const pr = briefPr(brief);
  const branch = brief.fields.branch && !brief.fields.branch.startsWith('none') ? brief.fields.branch : null;
  return (
    <li className="min-w-0" data-linked-session={brief.sessionId}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta">
        <Link2 size={12} className="shrink-0 text-accent-ink" aria-hidden />
        <span className="text-muted">Linked:</span>
        {exists ? (
          <button type="button" className="min-w-0 truncate text-ui font-semibold text-text hover:underline" onClick={() => useSessions.getState().openBeside(brief.sessionId)} data-tooltip="Open beside this one">
            {brief.label}
          </button>
        ) : (
          <span className="min-w-0 truncate text-ui font-semibold text-muted" data-tooltip="This session is gone">
            {brief.label}
          </span>
        )}
        {branch && <span className="min-w-0 truncate font-mono text-muted">{branch}</span>}
        {pr && <Pill tone="link">#{pr}</Pill>}
        {!brief.stub && (
          <button
            type="button"
            className="ml-auto flex shrink-0 items-center gap-0.5 text-link hover:underline"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((o) => !o)}
            data-what-claude-got
          >
            <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
            What Claude got
          </button>
        )}
      </div>
      {open && (
        <pre id={id} className="mt-1.5 max-h-72 overflow-auto rounded-md bg-code p-2.5 font-mono text-meta whitespace-pre-wrap text-text [overflow-wrap:anywhere]">
          {writeBrief(brief, Number.POSITIVE_INFINITY)}
        </pre>
      )}
    </li>
  );
}
