/**
 * The tab's icon with a `warn` dot while something needs you, drawn on a canvas from the app's own icon (the CSP
 * allows `data:` images). Without it, the icon the page started with.
 */

const SIZE = 64;
let original: string | null = null;
let icon: Promise<HTMLImageElement> | null = null;
let shown: boolean | null = null;

function link(): HTMLLinkElement {
  let element = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!element) {
    element = document.createElement('link');
    element.rel = 'icon';
    document.head.append(element);
  }
  return element;
}

function loadIcon(): Promise<HTMLImageElement> {
  icon ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No icon'));
    image.src = `${import.meta.env.BASE_URL}favicon.svg`;
  });
  return icon;
}

export async function setFaviconDot(on: boolean): Promise<void> {
  if (shown === on) return;
  shown = on;
  const element = link();
  original ??= element.href;
  if (!on) {
    element.type = 'image/svg+xml';
    element.href = original;
    return;
  }
  try {
    const image = await loadIcon();
    if (!shown) return;
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
