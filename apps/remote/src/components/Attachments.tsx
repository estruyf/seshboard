import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import type { RemoteFile, RemoteImage } from '@switchboard/protocol/remote-client';
import { acceptsFor, fileName, fileSize, placeFor, type Accepts, type Attachment } from '../lib/attachments.ts';
import { base64, toImage } from '../lib/images.ts';
import { Button } from './ui.tsx';

let nextId = 1;

export interface AttachmentsState {
  items: Attachment[];
  images: RemoteImage[];
  files: RemoteFile[];
  accepts: Accepts;
  /** Still reading (an image being resized): Send waits. */
  reading: boolean;
  dragging: boolean;
  add(files: readonly File[]): Promise<void>;
  remove(id: number): void;
  clear(): void;
  onPaste(event: ClipboardEvent): void;
  /** For the form around the box. */
  dropProps: { onDragOver(event: DragEvent): void; onDragLeave(event: DragEvent): void; onDrop(event: DragEvent): void };
}

/**
 * The images and files of a message: picked, pasted or dropped. Images are resized on this device first; files go as
 * they are, and only to a Switchboard that says it takes them (`features`, from its hello). `blocked` says why nothing
 * can be added right now (a prompt is open, the connection is down).
 */
export function useAttachments({ features, newSession = false, blocked = null, onError }: { features: readonly string[]; newSession?: boolean; blocked?: string | null; onError: (message: string) => void }): AttachmentsState {
  const [items, setItems] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const latest = useRef(items);
  latest.current = items;
  const accepts = acceptsFor(features, newSession);

  const add = async (files: readonly File[]) => {
    if (blocked) return onError(blocked);
    const skipped = new Set<string>();
    setReading((n) => n + 1);
    try {
      for (const file of files) {
        const place = placeFor(file, latest.current, accepts);
        if ('skip' in place) {
          skipped.add(place.skip);
          continue;
        }
        try {
          const item: Attachment = place.as === 'image' ? { id: nextId++, kind: 'image', image: await toImage(file) } : { id: nextId++, kind: 'file', file: { name: fileName(file.name), data: await base64(file) }, size: file.size };
          latest.current = [...latest.current, item];
          setItems(latest.current);
        } catch (error) {
          skipped.add(error instanceof Error ? error.message : `${file.name} couldn't be read.`);
        }
      }
    } finally {
      setReading((n) => n - 1);
    }
    if (skipped.size) onError([...skipped].join(' '));
  };

  const remove = (id: number) => {
    latest.current = latest.current.filter((a) => a.id !== id);
    setItems(latest.current);
  };
  const clear = () => {
    latest.current = [];
    setItems([]);
  };

  return {
    items,
    images: items.flatMap((a) => (a.kind === 'image' ? [a.image] : [])),
    files: items.flatMap((a) => (a.kind === 'file' ? [a.file] : [])),
    accepts,
    reading: reading > 0,
    dragging,
    add,
    remove,
    clear,
    onPaste: (event) => {
      // A screenshot pastes as an image; a copied page with text in it pastes its text.
      const files = [...event.clipboardData.files];
      if (!files.length || event.clipboardData.types.includes('text/plain')) return;
      event.preventDefault();
      void add(files);
    },
    dropProps: {
      onDragOver: (event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      },
      onDragLeave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      },
      onDrop: (event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        setDragging(false);
        void add([...event.dataTransfer.files]);
      },
    },
  };
}

/** The attach button: images and files when the computer takes files, else images, else disabled. */
export function AttachButton({ state, disabled, title }: { state: AttachmentsState; disabled: boolean; title?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const { accepts } = state;
  const label = accepts.files ? 'Attach images and files' : 'Add an image';
  const hint = !accepts.images && !accepts.files ? 'Update Switchboard on your computer to attach images and files' : label;
  return (
    <>
      <Button variant="quiet" size="md" aria-label={label} title={title ?? hint} disabled={disabled || (!accepts.images && !accepts.files)} onClick={() => input.current?.click()} className="px-2!" data-remote-attach>
        <Paperclip className="size-4" aria-hidden />
      </Button>
      <input
        ref={input}
        type="file"
        accept={accepts.files ? undefined : 'image/*'}
        multiple
        hidden
        onChange={(event) => {
          void state.add([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
    </>
  );
}

/** The attached images as thumbnails and the files as chips, each with a remove button. */
export function AttachmentTray({ state, className = '' }: { state: AttachmentsState; className?: string }) {
  if (!state.items.length && !state.reading) return null;
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`} aria-label="Attached to this message" data-remote-images>
      {state.items.map((a) =>
        a.kind === 'image' ? (
          <li key={a.id} className="group relative size-14 shrink-0 overflow-hidden rounded-lg border border-edge bg-code">
            <img src={`data:${a.image.mediaType};base64,${a.image.data}`} alt={a.image.name ?? 'Image'} className="size-full object-cover" />
            <button type="button" aria-label={`Remove ${a.image.name ?? 'image'}`} onClick={() => state.remove(a.id)} className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80" data-remote-image-remove>
              <X className="size-3" aria-hidden />
            </button>
          </li>
        ) : (
          <li key={a.id} className="flex h-14 max-w-56 items-center gap-2 rounded-lg border border-edge bg-code pr-1 pl-2.5 text-ui" data-remote-file>
            <FileText className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate">{a.file.name}</span>
              <span className="block text-meta text-faint">{fileSize(a.size)}</span>
            </span>
            <button type="button" aria-label={`Remove ${a.file.name}`} onClick={() => state.remove(a.id)} className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-border/60 hover:text-text">
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ),
      )}
      {state.reading && <li className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-edge text-meta text-faint">Reading…</li>}
    </ul>
  );
}
