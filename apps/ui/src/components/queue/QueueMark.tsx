import { Clock, Play } from 'lucide-react';
import type { QueueEntry } from '../../state/queue.ts';

/**
 * The small mark before what a queued item waits for: a play mark in `link` for an item that starts by itself (green
 * once it is ready), else a clock while it waits. Nothing for an item that waits for nothing.
 */
export function QueueMark({ entry, size = 10 }: { entry: QueueEntry; size?: number }) {
  if (entry.autoStart && entry.state !== 'queued') {
    return <Play size={size - 1} fill="currentColor" className={`shrink-0 ${entry.state === 'ready' ? 'text-ok' : 'text-link'}`} aria-hidden data-queue-autostart-mark />;
  }
  if (entry.state === 'waiting') return <Clock size={size} className="shrink-0" aria-hidden />;
  return null;
}
