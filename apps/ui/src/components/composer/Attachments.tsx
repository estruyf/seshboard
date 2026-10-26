import { AtSign, ImageOff, ImagePlus } from 'lucide-react';
import type { ImageAttachment } from '@seshboard/protocol/client';
import { dropMessage } from './images.ts';
import type { DropState } from './useDropTarget.ts';

/** Covers the message box while files are dragged over the view, saying what a drop would do. */
export function DropOverlay({ drop }: { drop: DropState }) {
  if (!drop.verdict) return null;
  const dropOk = drop.verdict.kind === 'ok';
  const mentionOnly = drop.verdict.kind === 'ok' && drop.verdict.attach === 0 && drop.verdict.mention > 0;
  return (
    <div
      data-drop-overlay
      data-drop-state={drop.verdict.kind}
      data-drop-over={drop.over}
      data-drop-mention={drop.verdict.kind === 'ok' ? drop.verdict.mention : undefined}
      aria-live="polite"
      className={`pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-xl border-2 bg-card/95 ${dropOk ? `border-accent-ink text-accent-ink ${drop.over ? 'border-solid' : 'border-dashed'}` : 'border-dashed border-faint text-muted'}`}
    >
      <div className={`flex size-full items-center justify-center gap-2 px-4 text-center text-[12.5px] font-medium ${dropOk ? (drop.over ? 'bg-accent/20' : 'bg-accent/10') : ''}`}>
        {mentionOnly ? <AtSign size={16} className="shrink-0" /> : dropOk ? <ImagePlus size={16} className="shrink-0" /> : <ImageOff size={16} className="shrink-0" />}
        <span className="min-w-0">{dropMessage(drop.verdict)}</span>
      </div>
    </div>
  );
}

/** The attached images as thumbnails, each with a remove button. */
export function AttachmentThumbs({ attachments, onRemove, className = '' }: { attachments: ImageAttachment[]; onRemove(index: number): void; className?: string }) {
  if (attachments.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`} data-attachments>
      {attachments.map((a, i) => (
        <div key={i} className="group relative size-14 overflow-hidden rounded-md border border-border">
          <img src={`data:${a.mediaType};base64,${a.data}`} alt={a.name ?? `Attached image ${i + 1}`} className="size-full object-cover" />
          {/* Hidden until hover, but still in the Tab order: it appears when it has keyboard focus. */}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/70 text-[10px] text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={`Remove ${a.name ?? `image ${i + 1}`}`}
            data-tooltip="Remove"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
      ))}
    </div>
  );
}
