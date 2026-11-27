import { AtSign, ImageOff, ImagePlus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { ImageAttachment } from '@seshboard/protocol/client';
import { dropMessage } from './images.ts';
import type { DropState } from './useDropTarget.ts';
import { Lightbox, type LightboxImage } from '../transcript/TranscriptImage.tsx';

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

/** An attachment as the lightbox's image: it carries its own data, so nothing is fetched. */
const toLightbox = (a: ImageAttachment, i: number): LightboxImage => ({
  imageId: `attachment-${i}`,
  mediaType: a.mediaType,
  bytes: Math.floor((a.data.length * 3) / 4),
  url: `data:${a.mediaType};base64,${a.data}`,
  fileName: a.name,
});

/** The attached images as thumbnails: a click shows one full size (with the others a step away), and each has a remove button. */
export function AttachmentThumbs({ attachments, onRemove, className = '' }: { attachments: ImageAttachment[]; onRemove(index: number): void; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const images = useMemo(() => attachments.map(toLightbox), [attachments]);
  if (attachments.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`} data-attachments>
      {attachments.map((a, i) => {
        const label = a.name ?? `Attached image ${i + 1}`;
        return (
          <div key={i} className="group relative size-14 overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={(e) => {
                opener.current = e.currentTarget;
                setOpen(i);
              }}
              className="block size-full rounded-md ring-link outline-none hover:ring-2 focus-visible:ring-2"
              aria-label={`${label}: show full size`}
              data-tooltip="Show full size"
              data-attachment-thumb={i}
            >
              <img src={images[i]!.url} alt={label} className="size-full object-cover" draggable={false} />
            </button>
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
        );
      })}
      {open !== null && images.length > 0 && <Lightbox sessionId="" images={images} start={Math.min(open, images.length - 1)} returnFocus={opener} onClose={() => setOpen(null)} />}
    </div>
  );
}
