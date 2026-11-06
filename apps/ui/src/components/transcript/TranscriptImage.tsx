import { sameShortcut, shortcutFromEvent } from '../../lib/shortcuts.ts';
import { fileManagerName } from '../../lib/platform.ts';
import { ChevronLeft, ChevronRight, Copy, Download, ImageOff, Maximize2, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ImageRef } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { contextMenuPoint, isContextMenuKey, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { toast } from '../../state/toastStore.ts';
import { Menu } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { basename } from '../../lib/format.ts';
import { isTopModal, useModalFocus } from '../ui/useModalFocus.ts';
import { imageFileName, parseDataUrl } from './imageFile.ts';
import { formatBytes, frameSize, imageFacts, stepIndex, type ImageVariant, type Size } from './imageLayout.ts';

/** Fetched images as data URLs, shared across views; small LRU so long sessions don't hold everything. */
const cache = new Map<string, Promise<string>>();
const CACHE_SIZE = 60;

function useImage(sessionId: string, ref: ImageRef): { url: string | null; failed: boolean } {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const key = `${sessionId}|${ref.imageId}`;
  // Tagged with its key, so moving to another image (in the lightbox) never shows the previous one.
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({ key, url: null, failed: false });

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let pending = cache.get(key);
    if (!pending) {
      pending = client.call('transcript.image', { sessionId, imageId: ref.imageId }).then(({ mediaType, data }) => `data:${mediaType};base64,${data}`);
      pending.catch(() => cache.delete(key));
      cache.set(key, pending);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    }
    pending.then(
      (url) => !cancelled && setState({ key, url, failed: false }),
      () => !cancelled && setState({ key, url: null, failed: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, key, sessionId, ref.imageId]);

  return state.key === key ? state : { url: null, failed: false };
}

/** Asks where to save an image (a data URL) and writes it there; a toast says where it went. */
async function saveImage(url: string, imageId: string) {
  const image = parseDataUrl(url);
  const bridge = window.seshboard;
  if (!image || !bridge) return;
  try {
    const path = await bridge.saveImage({ ...image, fileName: imageFileName(imageId, image.mediaType) });
    if (!path) return;
    toast('Image saved', {
      body: basename(path),
      actions: [{ label: `Show in ${fileManagerName()}`, onSelect: () => bridge.showSavedImage(path) }],
      data: { 'data-image-saved': path },
    });
  } catch {
    toast('The image couldn’t be saved');
  }
}

/** Puts an image (a data URL) on the clipboard, which only takes PNG: any type is drawn to a canvas and copied as one. */
async function copyImage(url: string) {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('The image could not be drawn');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast('Image copied', { data: { 'data-image-copied': true } });
  } catch {
    toast('The image couldn’t be copied');
  }
}

/** No caption to go on, so describe what kind of image it is ("PNG image, 120 KB"). */
const describe = (image: ImageRef) => `${image.mediaType.replace(/^image\//, '').toUpperCase()} image, ${formatBytes(image.bytes)}`;

/** The pixel size the engine read from the image's header, if it could. */
const knownSize = (image: ImageRef): Size | null => (image.width && image.height ? { width: image.width, height: image.height } : null);

/** One image in the lightbox's filmstrip. */
function FilmstripThumb({ sessionId, image, index, count, current, onSelect }: { sessionId: string; image: ImageRef; index: number; count: number; current: boolean; onSelect(): void }) {
  const { url } = useImage(sessionId, image);
  const ref = useRef<HTMLButtonElement>(null);
  // A long reply's strip scrolls, so the one showing stays in view as ← → move on.
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      aria-label={`Image ${index + 1} of ${count}`}
      aria-current={current ? 'true' : undefined}
      className={`block h-10 w-14 shrink-0 overflow-hidden rounded border border-border bg-sidebar transition-opacity ${current ? 'ring-2 ring-accent-ink' : 'opacity-60 hover:opacity-100'}`}
      data-lightbox-thumb={index}
    >
      {url && <img src={url} alt="" className="block h-full w-full object-cover" draggable={false} />}
    </button>
  );
}

/**
 * A message's or a reply's images full size: ← → (or the chevrons and the filmstrip) step through them, ⌘C copies
 * the one showing, ⌘S saves it (both are in its context menu too) and Esc closes. Focus stays inside, and goes back
 * to `returnFocus` on close.
 */
function Lightbox({ sessionId, images, start, returnFocus, onClose }: { sessionId: string; images: ImageRef[]; start: number; returnFocus: RefObject<HTMLElement | null>; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [index, setIndex] = useState(start);
  const [menuAt, setMenuAt] = useState<ContextMenuPoint | null>(null);
  const image = images[index] ?? images[0]!;
  const { url } = useImage(sessionId, image);
  const many = images.length > 1;
  const description = describe(image);
  const save = () => url && void saveImage(url, image.imageId);
  const copy = () => url && void copyImage(url);
  const openMenu = (pointer: { x: number; y: number } | null) => {
    const rect = imageRef.current?.getBoundingClientRect();
    if (rect) setMenuAt(contextMenuPoint(pointer, rect, window.innerHeight));
  };
  // Back to the image that opened it, even when that was through its context menu (which is gone by now).
  const close = () => {
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    onClose();
  };
  const step = (delta: number) => setIndex((i) => stepIndex(i, delta, images.length));
  useModalFocus(ref);
  const keys = useRef({ close, save, copy, step, openMenu, menuOpen: menuAt !== null });
  keys.current = { close, save, copy, step, openMenu, menuOpen: menuAt !== null };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      // While its context menu is open, the keys are the menu's: this listener runs first, so Escape would close both.
      if (!isTopModal(ref.current) || e.defaultPrevented || keys.current.menuOpen) return;
      if (e.key === 'Escape') keys.current.close();
      else if (isContextMenuKey(e)) {
        e.preventDefault();
        keys.current.openMenu(null);
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        keys.current.step(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (sameShortcut(shortcutFromEvent(e) ?? '', 'mod+s')) {
        e.preventDefault();
        keys.current.save();
      } else if (sameShortcut(shortcutFromEvent(e) ?? '', 'mod+c')) {
        e.preventDefault();
        keys.current.copy();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const facts = imageFacts(image.mediaType, image.bytes);
  const stop = (e: MouseEvent) => e.stopPropagation();
  // Above dialogs (z-60), so it opens over a subagent's transcript, and under the toasts (z-70), so "Image saved" shows.
  // Its controls sit on the card surface, so they stay readable over the dark backdrop in either mode.
  return createPortal(
    <>
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={many ? `Image ${index + 1} of ${images.length}` : description}
      className="no-drag fixed inset-0 z-[65] flex flex-col items-center gap-3 bg-black/80 p-4"
      onClick={close}
      data-lightbox
      data-lightbox-index={index}
    >
      <div className="flex w-full items-start justify-between gap-3">
        {/* The traffic lights stay on top of the lightbox; they end 68px in, so the label starts after them (as SidebarToggle does). */}
        <span className="overlay ml-17 rounded-lg px-2.5 py-1.5 text-ui text-muted" aria-live="polite" onClick={stop} data-lightbox-label>
          {many ? `${index + 1} / ${images.length} · ${facts}` : facts}
        </span>
        <span className="overlay flex items-center gap-1 rounded-lg p-1" onClick={stop}>
          <Button variant="quiet" icon={<Copy size={14} />} kbd="⌘C" onClick={copy} disabled={!url} data-lightbox-copy>
            Copy
          </Button>
          <Button variant="quiet" icon={<Download size={14} />} kbd="⌘S" onClick={save} disabled={!url} data-lightbox-save>
            Save
          </Button>
          <Button variant="quiet" iconOnly aria-label="Close" kbd="Esc" icon={<X size={16} />} onClick={close} />
        </span>
      </div>
      <div className={`relative flex min-h-0 w-full flex-1 items-center justify-center ${many ? 'px-14' : ''}`}>
        {url ? (
          <img
            ref={imageRef}
            src={url}
            alt={description}
            className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
            data-lightbox-image
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu(e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : null);
            }}
          />
        ) : (
          <span className="h-40 w-60 animate-pulse rounded-md bg-sidebar" />
        )}
        {many && (
          <>
            <span className="overlay absolute top-1/2 left-0 -translate-y-1/2 rounded-full p-0.5" onClick={stop}>
              <Button variant="quiet" iconOnly aria-label="Previous image" kbd="←" icon={<ChevronLeft size={18} />} onClick={() => step(-1)} data-lightbox-prev />
            </span>
            <span className="overlay absolute top-1/2 right-0 -translate-y-1/2 rounded-full p-0.5" onClick={stop}>
              <Button variant="quiet" iconOnly aria-label="Next image" kbd="→" icon={<ChevronRight size={18} />} onClick={() => step(1)} data-lightbox-next />
            </span>
          </>
        )}
      </div>
      {many && (
        <div className="flex max-w-full gap-2 overflow-x-auto p-1" onClick={stop} data-lightbox-film>
          {images.map((item, i) => (
            <FilmstripThumb key={item.imageId} sessionId={sessionId} image={item} index={i} count={images.length} current={i === index} onSelect={() => setIndex(i)} />
          ))}
        </div>
      )}
    </div>
    {/* Beside the lightbox, not in it: React bubbles a click in the menu up its tree, and a click in the lightbox closes it. */}
    {menuAt && url && (
      <Menu
        x={menuAt.x}
        y={menuAt.y}
        above={menuAt.above}
        width={180}
        label="Image"
        onClose={() => setMenuAt(null)}
        entries={[
          { label: 'Copy image', icon: <Copy size={13} />, hint: '⌘C', onSelect: copy, data: { 'data-image-menu-copy': true } },
          { label: 'Save image…', icon: <Download size={13} />, hint: '⌘S', onSelect: save, data: { 'data-image-menu-save': true } },
        ]}
      />
    )}
    </>,
    document.body,
  );
}

/**
 * An image from the transcript, in a frame of its own size (`imageLayout.ts`): it opens full size, with
 * the rest of `gallery` (the message's images) a step away, and can be saved. The frame never grows wider
 * than its column; `more` turns it into the "+N" tile that stands for the images after it.
 */
export function TranscriptImage({ sessionId, image, variant = 'single', gallery, index = 0, more = 0 }: { sessionId: string; image: ImageRef; variant?: ImageVariant; gallery?: ImageRef[]; index?: number; more?: number }) {
  const { url, failed } = useImage(sessionId, image);
  const [loaded, setLoaded] = useState<Size | null>(null);
  const [open, setOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<ContextMenuPoint | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const natural = knownSize(image) ?? loaded;
  const frame = frameSize(variant, natural);
  // Shrinks with the column, keeping its shape; the loading placeholder has the same frame, so nothing jumps.
  const frameStyle = { width: frame.width, aspectRatio: `${frame.width} / ${frame.height}`, maxWidth: '100%' };
  const description = describe(image);
  const save = () => url && void saveImage(url, image.imageId);
  if (failed) {
    return (
      <span
        style={frameStyle}
        className="flex min-w-0 items-center justify-center gap-1 rounded-md border border-border text-meta text-muted"
        data-tooltip="This image couldn’t be loaded"
        data-image-variant={variant}
      >
        <ImageOff size={13} /> {variant === 'single' && 'Unavailable'}
      </span>
    );
  }
  // Right-click and Shift+F10 open the same menu.
  const onContextMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (!url) return;
    e.preventDefault();
    const pointer = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : null;
    setMenuAt(contextMenuPoint(pointer, e.currentTarget.getBoundingClientRect(), window.innerHeight));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!url || !isContextMenuKey(e)) return;
    e.preventDefault();
    setMenuAt(contextMenuPoint(null, e.currentTarget.getBoundingClientRect(), window.innerHeight));
  };
  return (
    <>
      <span className="group/image relative block w-fit max-w-full min-w-0">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => url && setOpen(true)}
          onContextMenu={onContextMenu}
          onKeyDown={onKeyDown}
          style={frameStyle}
          data-tooltip={more ? `${more} more ${more === 1 ? 'image' : 'images'}` : imageFacts(image.mediaType, image.bytes, natural)}
          aria-label={more ? `${description}, and ${more} more: show full size` : `${description}: show full size`}
          className={`relative block overflow-hidden rounded-md border border-border ring-link transition-shadow outline-none hover:ring-2 focus-visible:ring-2 ${url ? '' : 'bg-sidebar'}`}
          data-transcript-image
          data-image-variant={variant}
          data-lightbox-index={index}
        >
          {url ? (
            <img
              src={url}
              alt={description}
              onLoad={(e) => setLoaded({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
              // A single image's frame has its own shape, so cover only trims a rounding pixel; thumbnails and tiles crop.
              className="block h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <span className="block h-full w-full animate-pulse bg-border/40" />
          )}
          {more > 0 && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-title font-semibold text-white" aria-hidden data-image-more={more}>
              +{more}
            </span>
          )}
        </button>
        {/* On the card surface, so it stays visible over any image; shown on hover and keyboard focus. */}
        {url && !more && (
          <span className="overlay absolute top-1 right-1 flex rounded-md opacity-0 transition-opacity group-focus-within/image:opacity-100 group-hover/image:opacity-100">
            <Button variant="quiet" size="sm" iconOnly aria-label="Enlarge" icon={<Maximize2 size={12} />} onClick={() => setOpen(true)} data-transcript-image-enlarge />
            <Button variant="quiet" size="sm" iconOnly aria-label="Save image…" icon={<Download size={13} />} onClick={save} data-transcript-image-save />
          </span>
        )}
      </span>
      {menuAt && (
        <Menu
          x={menuAt.x}
          y={menuAt.y}
          above={menuAt.above}
          width={180}
          label="Image"
          onClose={() => setMenuAt(null)}
          entries={[
            { label: 'Show full size', icon: <Maximize2 size={13} />, onSelect: () => setOpen(true) },
            { label: 'Copy image', icon: <Copy size={13} />, onSelect: () => url && void copyImage(url), data: { 'data-image-menu-copy': true } },
            { label: 'Save image…', icon: <Download size={13} />, onSelect: save, data: { 'data-image-menu-save': true } },
          ]}
        />
      )}
      {open && url && <Lightbox sessionId={sessionId} images={gallery ?? [image]} start={gallery ? index : 0} returnFocus={buttonRef} onClose={() => setOpen(false)} />}
    </>
  );
}
