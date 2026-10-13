import { useState, type DragEvent } from 'react';
import { reorderQueue, useLater } from '../../state/laterStore.ts';
import { dropIndex } from '../../state/queue.ts';

const MIME = 'application/x-switchboard-queue-item';

/** What a list that isn't the sidebar's queue passes: its own order, how it moves an item, and its own drag type. */
export interface QueueDragSource {
  ids(): string[];
  move(id: string, to: number): void | Promise<unknown>;
  /** Keeps a drag from another list from dropping here. */
  mime: string;
}

/** Where a dragged item would land: before or after this item. */
export type DropMark = { id: string; after: boolean } | null;

/**
 * Drag to reorder: the item is dragged by its grip (the whole row is the drag source), and dropping on another item
 * puts it before or after that one, by which half of the row the pointer is over. The keyboard does the same with ⌥↑ ⌥↓.
 */
export function useQueueDrag(source?: QueueDragSource) {
  const mime = source?.mime ?? MIME;
  const [mark, setMark] = useState<DropMark>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const props = (id: string) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(mime, id);
      event.dataTransfer.effectAllowed = 'move';
      setDragging(id);
    },
    onDragEnd: () => {
      setDragging(null);
      setMark(null);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(mime)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const rect = event.currentTarget.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      setMark((current) => (current?.id === id && current.after === after ? current : { id, after }));
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMark((current) => (current?.id === id ? null : current));
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const dragged = event.dataTransfer.getData(mime);
      if (!dragged) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const to = dropIndex(source ? source.ids() : useLater.getState().items.map((i) => i.id), dragged, id, event.clientY > rect.top + rect.height / 2);
      setMark(null);
      setDragging(null);
      if (to === null) return;
      if (source) void Promise.resolve(source.move(dragged, to)).catch(() => {});
      else void reorderQueue(dragged, to).catch(() => {});
    },
  });

  /** The line where the item would land, for the row it is over. */
  const markFor = (id: string): 'before' | 'after' | null => (mark?.id === id && dragging !== id ? (mark.after ? 'after' : 'before') : null);
  return { props, markFor, dragging };
}
