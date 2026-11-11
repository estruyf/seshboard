/** A page's icon at most this many pixels a side: twice the largest it is drawn (a favourite's tile), for sharp edges. */
const ICON_PX = 40;

/** An icon this short as a `data:` URL is kept as it is. */
const SMALL_ICON = 16_384;

/**
 * A page's icon (a `data:` image from main) made small: drawn into a 40px square and kept as a PNG. Some sites ship a
 * favicon of megabytes (an SVG with a photo inside); kept as it is, every tab and favourite would carry it. Drawing a
 * `data:` image in an `<img>` runs no script and loads nothing. Null when it doesn't draw.
 */
export async function shrinkIcon(dataUrl: string): Promise<string | null> {
  if (dataUrl.length <= SMALL_ICON) return dataUrl;
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = ICON_PX;
    canvas.height = ICON_PX;
    const context = canvas.getContext('2d');
    if (!context) return null;
    // Kept in proportion, centred: an SVG without a size of its own draws square.
    const width = image.naturalWidth || ICON_PX;
    const height = image.naturalHeight || ICON_PX;
    const scale = ICON_PX / Math.max(width, height);
    const w = width * scale;
    const h = height * scale;
    context.drawImage(image, (ICON_PX - w) / 2, (ICON_PX - h) / 2, w, h);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
