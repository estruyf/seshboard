import { ArrowLeft, Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import type { LiveSession } from '@seshboard/protocol/client';
import { currentPlatform } from '../../lib/platform.ts';
import { StatusDot } from '../StatusDot.tsx';
import { Button } from '../ui/Button.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { ReadSettings } from './ReadSettings.tsx';

/** What the session is doing, in the status colours (Design system: Status colours). */
function stateOf(live: LiveSession | null, writing: boolean): { label: string; tone: string } {
  if (live?.status === 'needs-you') return { label: 'Needs you', tone: 'text-warn' };
  if (live?.status === 'running') return { label: writing ? 'Still writing this reply' : 'Working on the next reply', tone: 'text-accent-ink' };
  return { label: live ? 'Idle' : 'Finished', tone: 'text-faint' };
}

/**
 * The 48px bar over the reading view, which is also the window's drag region: back, the session and what it is doing,
 * then the reply's number with the arrows, Copy and Done. The traffic lights on macOS sit over its left end.
 */
export function ReadTopBar({
  title,
  live,
  writing,
  index,
  total,
  previous,
  next,
  copyText,
  onGo,
  onClose,
}: {
  title: string;
  live: LiveSession | null;
  writing: boolean;
  index: number;
  total: number;
  previous: string | null;
  next: string | null;
  /** The reply as Markdown, for Copy. */
  copyText: string;
  onGo(turnKey: string): void;
  onClose(): void;
}) {
  const [copied, flash] = useFlash(1_500);
  const state = stateOf(live, writing);
  return (
    <header className="drag relative flex h-12 shrink-0 items-center gap-3 border-b border-border px-4" data-read-top-bar>
      {/* The traffic lights end 68px in; this keeps 16px clear of them. Elsewhere the window has its own title bar. */}
      <div className={`flex min-w-0 flex-1 items-center gap-2 ${currentPlatform() === 'darwin' ? 'ml-17' : ''}`}>
        <Button variant="quiet" iconOnly icon={<ArrowLeft size={15} aria-hidden />} aria-label="Back to the session" onClick={onClose} className="no-drag" data-read-back />
        <span className="min-w-0 truncate text-ui font-semibold" data-read-title>
          {title}
        </span>
        <span className={`flex shrink-0 items-center gap-1.5 text-meta max-[700px]:hidden ${state.tone}`} data-read-state>
          {live ? <StatusDot live={live} /> : <span className="inline-block size-2 shrink-0 rounded-full bg-faint" aria-hidden />}
          {state.label}
        </span>
      </div>
      <div className="no-drag flex shrink-0 items-center gap-1">
        <Button variant="quiet" size="sm" iconOnly icon={<ChevronLeft size={14} aria-hidden />} aria-label="Previous reply" shortcut="read.previous" disabled={!previous} onClick={() => previous && onGo(previous)} data-read-previous />
        <span className="px-1 text-meta text-muted tabular-nums" data-read-position>
          Reply {index + 1} of {total}
        </span>
        <Button variant="quiet" size="sm" iconOnly icon={<ChevronRight size={14} aria-hidden />} aria-label="Next reply" shortcut="read.next" disabled={!next} onClick={() => next && onGo(next)} data-read-next />
        <ReadSettings />
        <Button
          variant="quiet"
          size="sm"
          icon={copied ? <Check size={13} className="text-ok" aria-hidden /> : <Copy size={12} aria-hidden />}
          onClick={() => void navigator.clipboard.writeText(copyText).then(() => flash('Copied'), () => {})}
          data-read-copy
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button kbd="Esc" onClick={onClose} data-read-done>
          Done
        </Button>
      </div>
    </header>
  );
}
