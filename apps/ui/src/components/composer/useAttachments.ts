import { useState, type ClipboardEvent, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { ContextItem, ImageAttachment } from '@seshboard/protocol/client';
import { droppedItems } from './contextItems.ts';
import { dropVerdict, MAX_ATTACHMENTS, mergeAttachments, planDrop, readImage } from './images.ts';
import { insertMentions, mentionFor } from './mentions.ts';
import { useDropTarget, type DropState } from './useDropTarget.ts';

export interface AttachmentsOptions {
  /** Attached when the prompt opens (a draft kept from before). */
  initial?: ImageAttachment[];
  /** The message box: the drop target is its closest `[data-drop-zone]`, else the box itself. */
  rootRef: RefObject<HTMLElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Mentions of dropped files are relative to it. */
  cwd: string | null;
  disabledReason?: string | null;
  setText(text: string): void;
  /** What was left out of a paste or drop; null clears it. */
  onNotice(notice: string | null): void;
  /** Dropped files and folders become context chips through this; without it, `@` mentions in the text. */
  onContext?(items: ContextItem[]): void;
}

export interface Attachments {
  attachments: ImageAttachment[];
  setAttachments: Dispatch<SetStateAction<ImageAttachment[]>>;
  /** Picked, pasted or dropped files: the images are attached, the rest is counted in the notice. */
  addFiles(files: File[]): Promise<void>;
  onPaste(event: ClipboardEvent): void;
  drop: DropState;
}

/**
 * The images attached to a prompt, and what pasting or dropping files on it does: the message box
 * and the palette's New session step behave the same way.
 */
export function useAttachments(options: AttachmentsOptions): Attachments {
  const { rootRef, textareaRef, cwd, disabledReason, setText, onNotice, onContext } = options;
  const [attachments, setAttachments] = useState<ImageAttachment[]>(options.initial ?? []);

  const addFiles = async (files: File[]) => {
    const images = (await Promise.all(files.map(readImage))).filter((a): a is ImageAttachment => a !== null);
    setAttachments((current) => {
      const { next, notice } = mergeAttachments(current, images, files.length);
      onNotice(notice);
      return next;
    });
  };

  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  };

  // A dropped file's place on disk, for an @ mention; empty outside the app or for files not on disk.
  const canMention = typeof window.seshboard?.getPathForFile === 'function';
  const pathOf = (file: File) => {
    try {
      return window.seshboard?.getPathForFile(file) ?? '';
    } catch {
      return '';
    }
  };

  /** A drop: images are attached while there is room; other files, folders and the images past the limit become context chips (or @ mentions). */
  const dropFiles = async (files: File[], directories: boolean[]) => {
    const dropped = files.map((file, i) => ({ type: file.type, size: file.size, directory: directories[i] ?? false, path: pathOf(file) }));
    const plan = planDrop(dropped, attachments.length);
    const read = await Promise.all(plan.attach.map((i) => readImage(files[i]!)));
    // An image that can't be read is mentioned instead, when it has a path.
    const unread = plan.attach.filter((_, k) => !read[k]).map((i) => dropped[i]!);
    const mentioned = [...plan.mention, ...unread.filter((f) => f.path)];
    const images = read.filter((a): a is ImageAttachment => a !== null);
    if (images.length) setAttachments((current) => [...current, ...images].slice(0, MAX_ATTACHMENTS));
    const el = textareaRef.current;
    if (mentioned.length && onContext) {
      onContext(droppedItems(mentioned));
      el?.focus();
    } else if (mentioned.length && el) {
      const caret = document.activeElement === el ? el.selectionEnd : el.value.length;
      const next = insertMentions(el.value, caret, mentioned.map((f) => mentionFor(f.path, cwd, f.directory)));
      setText(next.text);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    }
    const skipped = plan.skipped + unread.length - unread.filter((f) => f.path).length;
    onNotice(skipped ? 'Some files were skipped: only images, and files and folders on disk, can be added.' : null);
  };

  // Files dragged anywhere over the view: an overlay on the message box shows what a drop would do.
  const drop = useDropTarget(rootRef, (drag) => dropVerdict(drag, { attached: attachments.length, disabledReason, canMention }), (files, directories) => void dropFiles(files, directories));

  return { attachments, setAttachments, addFiles, onPaste, drop };
}
