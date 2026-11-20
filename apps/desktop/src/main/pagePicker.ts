import type { WebContents } from 'electron';
import type { PickedElement } from '@seshboard/protocol/bridge';

/** The isolated world the picker runs in, apart from the page's scripts (the one `webPreview.ts` uses for the mouse's buttons). */
export const PICKER_WORLD = 1999;

/** An element's picture wider or taller than this is sent shrunk: Claude needs to see it, not every pixel. */
const IMAGE_MAX_SIDE = 1600;

/**
 * The picker, set up once per document in the isolated world: `pick()` outlines the element under the pointer until a
 * click picks it or Escape ends it, `at(x, y)` describes the element at a point, `cancel()` ends a pick. An element is
 * described by its page, a selector that finds it (a test id or an id where there is one, otherwise a short path of
 * tags and classes), its HTML and text (cut short) and where it is in the viewport, clipped to it.
 */
const PICKER = `(() => {
  if (window.__seshboardPicker) return;
  const MAX_HTML = 4000;
  const MAX_TEXT = 500;
  const unique = (selector) => { try { return document.querySelectorAll(selector).length === 1; } catch { return false; } };
  const quoted = (value) => '"' + value.replace(/["\\\\]/g, '\\\\$&') + '"';
  const part = (el) => {
    for (const attr of ['data-testid', 'data-test', 'data-cy']) {
      const value = el.getAttribute(attr);
      if (value) return el.localName + '[' + attr + '=' + quoted(value) + ']';
    }
    const classes = [...el.classList].filter((c) => c.length <= 30 && !/[:[\\]/]/.test(c)).slice(0, 2);
    return el.localName + classes.map((c) => '.' + CSS.escape(c)).join('');
  };
  const selectorOf = (el) => {
    if (el.id && unique('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node !== el && node.id && unique('#' + CSS.escape(node.id))) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      let step = part(node);
      const parent = node.parentElement;
      if (parent && parent.querySelectorAll(':scope > ' + step).length > 1) step += ':nth-of-type(' + ([...parent.children].filter((c) => c.localName === node.localName).indexOf(node) + 1) + ')';
      parts.unshift(step);
      if (unique(parts.join(' > '))) break;
    }
    return parts.join(' > ');
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const right = Math.min(innerWidth, r.right);
    const bottom = Math.min(innerHeight, r.bottom);
    const html = el.outerHTML.length > MAX_HTML ? el.outerHTML.slice(0, MAX_HTML) + '\\n<!-- cut short -->' : el.outerHTML;
    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    return {
      url: location.href,
      selector: selectorOf(el),
      html,
      text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text,
      rect: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
    };
  };
  let finish = null;
  const pick = () => new Promise((resolve) => {
    finish?.(null);
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = '<style>div{position:fixed;pointer-events:none;box-sizing:border-box}.box{border:2px solid #ffd43b;background:rgba(255,212,59,.18);border-radius:2px;display:none}.tag{font:12px/1.5 ui-monospace,Menlo,monospace;background:#1a1b1e;color:#ffd43b;padding:1px 6px;border-radius:4px;white-space:nowrap;display:none;max-width:60vw;overflow:hidden;text-overflow:ellipsis}</style><div class="box"></div><div class="tag"></div>';
    const box = root.querySelector('.box');
    const tag = root.querySelector('.tag');
    const cursor = document.createElement('style');
    cursor.textContent = '*{cursor:crosshair!important}';
    let target = null;
    const show = () => {
      if (!target) return;
      const r = target.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      const name = target.localName + (target.id ? '#' + target.id : '') + [...target.classList].slice(0, 2).map((c) => '.' + c).join('');
      tag.textContent = name + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
      Object.assign(tag.style, { display: 'block', left: Math.max(0, r.left) + 'px', top: (r.top > 24 ? r.top - 22 : Math.min(innerHeight - 22, r.bottom + 4)) + 'px' });
    };
    const block = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onMove = (event) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (el && el !== target) {
        target = el;
        show();
      }
    };
    const onClick = (event) => {
      block(event);
      const el = document.elementFromPoint(event.clientX, event.clientY) ?? target;
      finish(el ? describe(el) : null);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      block(event);
      finish(null);
    };
    const blocked = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'contextmenu'];
    finish = (value) => {
      finish = null;
      removeEventListener('mousemove', onMove, true);
      removeEventListener('click', onClick, true);
      removeEventListener('keydown', onKey, true);
      removeEventListener('scroll', show, true);
      for (const name of blocked) removeEventListener(name, block, true);
      host.remove();
      cursor.remove();
      // Once the outline is off the screen, so the element's picture doesn't have it.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)));
    };
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('keydown', onKey, true);
    addEventListener('scroll', show, true);
    for (const name of blocked) addEventListener(name, block, true);
    document.documentElement.append(host, cursor);
  });
  window.__seshboardPicker = {
    pick,
    cancel: () => finish?.(null),
    at: (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el ? describe(el) : null;
    },
  };
})();`;

/** What the page's script hands back: the element, and where it is in the viewport in CSS pixels. */
interface Described extends Omit<PickedElement, 'image'> {
  rect: { x: number; y: number; width: number; height: number };
}

const run = (guest: WebContents, code: string): Promise<unknown> => guest.executeJavaScriptInIsolatedWorld(PICKER_WORLD, [{ code: `${PICKER}\n${code}` }]);

/** What the script handed back, checked: the HTML and text are the page's, so they are only ever data. */
function described(value: unknown): Described | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const rect = v.rect as Record<string, unknown> | undefined;
  if (typeof v.url !== 'string' || typeof v.selector !== 'string' || typeof v.html !== 'string' || typeof v.text !== 'string' || !rect) return null;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return { url: v.url, selector: v.selector, html: v.html, text: v.text, rect: { x: n(rect.x), y: n(rect.y), width: n(rect.width), height: n(rect.height) } };
}

/** The element with its picture: the part of the page it covers, in device pixels at the tab's zoom, shrunk when large. */
async function withImage(guest: WebContents, element: Described | null): Promise<PickedElement | null> {
  if (!element || guest.isDestroyed()) return null;
  const { rect, ...rest } = element;
  let image: string | null = null;
  if (rect.width >= 1 && rect.height >= 1) {
    const zoom = guest.getZoomFactor();
    const shot = await guest
      .capturePage({ x: Math.floor(rect.x * zoom), y: Math.floor(rect.y * zoom), width: Math.ceil(rect.width * zoom), height: Math.ceil(rect.height * zoom) })
      .catch(() => null);
    if (shot && !shot.isEmpty()) {
      const { width, height } = shot.getSize();
      const scaled = Math.max(width, height) > IMAGE_MAX_SIDE ? (width >= height ? shot.resize({ width: IMAGE_MAX_SIDE }) : shot.resize({ height: IMAGE_MAX_SIDE })) : shot;
      image = scaled.toPNG().toString('base64');
    }
  }
  return { ...rest, image };
}

/** Picks on these pages now: each one's way to end it. */
const picking = new Map<number, () => void>();

/**
 * Lets you pick an element on the page: resolves with it, or null on Escape, `cancelPick`, a navigation, or the page
 * going away. A second pick on the same page ends the first.
 */
export function pickElement(guest: WebContents): Promise<PickedElement | null> {
  picking.get(guest.id)?.();
  return new Promise((resolve) => {
    let done = false;
    const end = (value: Described | null) => {
      if (done) return;
      done = true;
      picking.delete(guest.id);
      guest.off('did-start-navigation', onNavigate);
      guest.off('destroyed', onGone);
      guest.off('render-process-gone', onGone);
      void withImage(guest, value).then(resolve, () => resolve(null));
    };
    const onNavigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (details.isMainFrame && !details.isSameDocument) end(null);
    };
    const onGone = () => end(null);
    guest.on('did-start-navigation', onNavigate);
    guest.once('destroyed', onGone);
    guest.once('render-process-gone', onGone);
    picking.set(guest.id, () => {
      if (!guest.isDestroyed()) void run(guest, 'window.__seshboardPicker.cancel();').catch(() => {});
      end(null);
    });
    run(guest, 'window.__seshboardPicker.pick();').then((value) => end(described(value)), () => end(null));
  });
}

/** Ends the pick on this page, if there is one. */
export function cancelPick(contentsId: number): void {
  picking.get(contentsId)?.();
}

/** The element at a point of the page (a right-click's, in the page's device-independent pixels), with its picture. */
export async function elementAt(guest: WebContents, x: number, y: number): Promise<PickedElement | null> {
  const zoom = guest.getZoomFactor();
  const value = await run(guest, `window.__seshboardPicker.at(${Number(x / zoom) || 0}, ${Number(y / zoom) || 0});`).catch(() => null);
  return withImage(guest, described(value));
}
