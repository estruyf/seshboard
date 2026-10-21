import { useRef, useState, type ClipboardEvent, type RefObject } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { REMOTE_FEATURE_ATTACHMENTS, type Computer, type RemoteFile, type RemoteImage } from '@switchboard/protocol/client';
import { remoteDraft, useRemoteDrafts } from '../../state/remoteDraftsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { AttachmentThumbs } from '../composer/Attachments.tsx';
import { useDropTarget, type DropState } from '../composer/useDropTarget.ts';
import { Button } from '../ui/Button.tsx';
import { fileSize, placeFor, readBase64, readRemoteImage, remoteDropVerdict, remoteFileName, type Accepts, type RemoteAttachment } from './remoteAttachments.ts';

let nextId = 1;
const NO_ITEMS: RemoteAttachment[] = [];

export interface RemoteAttachmentsState {
  items: RemoteAttachment[];
  images: RemoteImage[];
  files: RemoteFile[];
  accepts: Accepts;
  /** Still reading (an image being redrawn): Send waits. */
  reading: boolean;
  add(files: readonly File[]): Promise<void>;
  remove(id: number): void;
  clear(): void;
  onPaste(event: ClipboardEvent): void;
  drop: DropState;
}

/**
 * The images and files of a message to another computer: picked, pasted or dropped on the view around `rootRef`.
 * `session.send` takes images on every version; files, and images for a new session, need `REMOTE_FEATURE_ATTACHMENTS`.
 * They are kept under `draftKey` (`remoteDraftsStore.ts`), so they are still there when you come back, and one still
 * being read when you leave lands there too.
 */
export function useRemoteAttachments({ computer, rootRef, draftKey, newSession = false, disabledReason }: { computer: Computer; rootRef: RefObject<HTMLElement | null>; draftKey: string; newSession?: boolean; disabledReason: string | null }): RemoteAttachmentsState {
  const items = useRemoteDrafts((s) => s.drafts[draftKey]?.items ?? NO_ITEMS);
  const [reading, setReading] = useState(0);
  /** The items now, also between the awaits of `add`. */
  const current = () => remoteDraft(draftKey).items;
  const put = (next: RemoteAttachment[]) => useRemoteDrafts.getState().update(draftKey, { items: next });
  const full = computer.features.includes(REMOTE_FEATURE_ATTACHMENTS);
  const accepts: Accepts = { images: full || !newSession, files: full };

  const add = async (files: readonly File[]) => {
    const skipped = new Set<string>();
    setReading((n) => n + 1);
    try {
      for (const file of files) {
        const place = placeFor(file, current(), accepts, computer.name);
        if ('skip' in place) {
          skipped.add(place.skip);
          continue;
        }
        try {
          const item: RemoteAttachment =
            place.as === 'image'
              ? { id: nextId++, kind: 'image', image: await readRemoteImage(file) }
              : { id: nextId++, kind: 'file', file: { name: remoteFileName(file.name), data: await readBase64(file) }, size: file.size };
          put([...current(), item]);
        } catch (e) {
          skipped.add(e instanceof Error ? e.message : `${file.name} couldn't be read.`);
        }
      }
    } finally {
      setReading((n) => n - 1);
    }
    if (skipped.size) toast([...skipped].join(' '));
  };

  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files];
    if (!files.length) return;
    event.preventDefault();
    void add(files);
  };

  const drop = useDropTarget(
    rootRef,
    (drag) => remoteDropVerdict(drag, { items: current(), accepts, computer: computer.name, disabledReason: disabledReason ?? (accepts.images || accepts.files ? null : `Update Switchboard on ${computer.name} to send images and files.`) }),
    (files, directories) => {
      if (directories.some(Boolean)) toast(`Folders can't go to ${computer.name}. Drop the files in it instead.`);
      void add(files.filter((_, i) => !directories[i]));
    },
  );

  const remove = (id: number) => put(current().filter((a) => a.id !== id));
  const clear = () => put([]);

  return {
    items,
    images: items.flatMap((a) => (a.kind === 'image' ? [a.image] : [])),
    files: items.flatMap((a) => (a.kind === 'file' ? [a.file] : [])),
    accepts,
    reading: reading > 0,
    add,
    remove,
    clear,
    onPaste,
    drop,
  };
}

/** The attach button: images and files when that computer takes files, else images only, else disabled with why. */
export function RemoteAttachButton({ state, computer, disabled }: { state: RemoteAttachmentsState; computer: Computer; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const { accepts } = state;
  const label = accepts.files ? 'Attach images and files' : 'Attach images';
  const tooltip = !accepts.images ? `Update Switchboard on ${computer.name} to send images and files.` : accepts.files ? `Attach images and files (or paste / drop them). They go to ${computer.name} with the message.` : `Attach images (or paste / drop them). Update Switchboard on ${computer.name} to send files too.`;
  return (
    <>
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
        data-remote-attach-input
      />
      <span className="flex" data-tooltip={tooltip}>
        <Button variant="quiet" size="sm" iconOnly icon={<Paperclip size={14} aria-hidden />} aria-label={label} disabled={disabled || !accepts.images} onClick={() => input.current?.click()} data-remote-attach />
      </span>
    </>
  );
}

/** The attached images as thumbnails and the files as chips, each with a remove button. */
export function RemoteAttachmentList({ state, className = '' }: { state: RemoteAttachmentsState; className?: string }) {
  const images = state.items.filter((a) => a.kind === 'image');
  const files = state.items.filter((a) => a.kind === 'file');
  if (!state.items.length) return null;
  return (
    <div className={`grid gap-2 ${className}`} data-remote-attachments>
      <AttachmentThumbs attachments={images.map((a) => a.image)} onRemove={(i) => state.remove(images[i]!.id)} />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((a) => (
            <li key={a.id} className="flex h-7 max-w-64 items-center gap-1.5 rounded-md border border-border bg-bg pr-0.5 pl-2 text-ui" data-remote-file>
              <FileText size={13} aria-hidden className="shrink-0 text-muted" />
              <span className="min-w-0 truncate">{a.file.name}</span>
              <span className="shrink-0 text-meta text-muted">{fileSize(a.size)}</span>
              <button type="button" onClick={() => state.remove(a.id)} className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-border/60 hover:text-text" aria-label={`Remove ${a.file.name}`} data-tooltip="Remove">
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
