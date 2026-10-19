import { MoreHorizontal, Play } from 'lucide-react';
import { useMemo } from 'react';
import { useLater } from '../../state/laterStore.ts';
import { promptLabel, startsAfter } from '../../state/queue.ts';
import { useQueue } from '../../state/useQueue.ts';
import { Button } from '../ui/Button.tsx';
import { useQueueMenu } from './queueMenu.tsx';

/**
 * Above the message box of a session that queued items start after: "Starts after this one: Run the tests", "+1
 * after it" for a chain, and ⋯ for the item's menu. Only for items that start by themselves; an item you start
 * yourself shows in the queue alone.
 */
export function StartsAfterBand({ sessionId }: { sessionId: string }) {
  // Most queues have nothing that starts by itself: don't work the whole queue out in every pane for that.
  const any = useLater((s) => s.items.some((item) => item.autoStart));
  return any ? <Band sessionId={sessionId} /> : null;
}

function Band({ sessionId }: { sessionId: string }) {
  const queue = useQueue();
  const menus = useQueueMenu(queue.rows);
  const after = useMemo(() => startsAfter(queue.entries, sessionId), [queue.entries, sessionId]);
  if (!after) return null;
  const { first, more } = after;
  const prompt = promptLabel(first.item.prompt, 80);
  return (
    <div
      role="note"
      aria-label={`Starts by itself after this session: ${prompt}${more ? `, and ${more} more after it` : ''}`}
      className="flex min-w-0 items-center gap-2 rounded-xl border border-link/40 bg-link/5 py-1 pr-1 pl-3 text-ui"
      data-start-after-band={first.item.id}
    >
      <Play size={10} fill="currentColor" className="shrink-0 text-link" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-muted">
        Starts after this one: <span className="font-semibold text-text">{prompt}</span>
        {more > 0 && <span className="text-faint"> +{more} after it</span>}
      </span>
      <Button
        variant="quiet"
        size="sm"
        iconOnly
        icon={<MoreHorizontal size={15} aria-hidden />}
        aria-label="More for this queued item"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          menus.openMenu({ x: rect.right - 250, y: rect.top - 4, above: true }, first);
        }}
        data-start-after-more
      />
      {menus.overlay}
    </div>
  );
}
