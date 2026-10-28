import type { AppIconKey } from '@seshboard/protocol/remote-client';
import { APP_ICON_STORAGE, iconLinks } from './appIcon.ts';

/**
 * The tab's icon with a `warn` dot while something needs you, drawn on a canvas from the app's own icon (the CSP
 * allows `data:` images). Without it, the icon itself: the app's, or the colourway the computer picked
 * (`showAppIcon`).
 */

const SIZE = 64;
/** The tab's icon without the dot: the page's own until a colourway is shown. */
let plain: string | null = null;
let icon: { href: string; image: Promise<HTMLImageElement> } | null = null;
let shown: boolean | null = null;

function link(rel: string): HTMLLinkElement {
  let element = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement('link');
    element.rel = rel;
    document.head.append(element);
  }
  return element;
}

function loadIcon(href: string): Promise<HTMLImageElement> {
  if (icon?.href !== href) {
    const image = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('No icon'));
      image.src = href;
    });
    icon = { href, image };
  }
  return icon.image;
}

async function draw(): Promise<void> {
  const element = link('icon');
  plain ??= element.href;
  const href = plain;
  if (!shown) {
    element.type = 'image/svg+xml';
    element.href = href;
    return;
  }
  try {
    const image = await loadIcon(href);
    if (!shown || plain !== href) return;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(image, 0, 0, SIZE, SIZE);
    // The status colour of needs you, with a ring in the page's background so it reads on any tab strip.
    const style = getComputedStyle(document.documentElement);
    context.beginPath();
    context.arc(SIZE - 15, SIZE - 15, 14, 0, Math.PI * 2);
    context.fillStyle = style.getPropertyValue('--sb-bg').trim() || '#ffffff';
    context.fill();
    context.beginPath();
    context.arc(SIZE - 15, SIZE - 15, 10, 0, Math.PI * 2);
    context.fillStyle = style.getPropertyValue('--sb-warn').trim() || '#d1186b';
    context.fill();
    element.type = 'image/png';
    element.href = canvas.toDataURL('image/png');
  } catch {
    // No icon to draw on: the title still counts what needs you.
  }
}

export async function setFaviconDot(on: boolean): Promise<void> {
  if (shown === on) return;
  shown = on;
  await draw();
}

/**
 * The computer's app icon colourway (Settings › Theme › App icon there): the tab's icon at once, and the Home Screen
 * icons a new Add to Home Screen takes (the manifest for Android, apple-touch-icon for iOS). An app already on the Home
 * Screen keeps the icon it was added with. Kept for the next load.
 */
export function showAppIcon(key: AppIconKey): void {
  const links = iconLinks(key, import.meta.env.BASE_URL);
  const manifest = link('manifest');
  if (manifest.getAttribute('href') !== links.manifest) manifest.href = links.manifest;
  const touch = link('apple-touch-icon');
  if (touch.getAttribute('href') !== links.appleTouchIcon) touch.href = links.appleTouchIcon;
  const favicon = new URL(links.favicon, document.baseURI).href;
  if (plain !== favicon) {
    plain = favicon;
    void draw();
  }
  try {
    localStorage.setItem(APP_ICON_STORAGE, key);
  } catch {
    // Without storage the page starts with Graphite and follows the computer once it answers.
  }
}
