/**
 * The dot over Switchboard's taskbar button on Windows while sessions need you: the counterpart of the Dock's
 * badge, which Windows doesn't have. Drawn as a raw BGRA bitmap, so no image file ships for it. Pure, for testing.
 */

/**
 * The dot's colour: Demo Time's `warn` (needs you), fixed whatever the app's theme, as the Dock's badge on macOS is
 * always the system's red. It sits on the taskbar, which follows Windows' theme rather than the app's.
 */
const PINK = { r: 0xed, g: 0x21, b: 0x7c };

/** A filled circle with a white ring, `size` pixels square, as BGRA bytes for `nativeImage.createFromBitmap`. */
export function badgeDotBitmap(size = 16): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const centre = (size - 1) / 2;
  const outer = size / 2;
  const inner = outer - Math.max(1, size / 16) * 1.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - centre, y - centre);
      if (distance > outer) continue;
      // A soft edge: the last pixel fades out.
      const alpha = Math.round(255 * Math.min(1, outer - distance));
      const ring = distance > inner;
      const i = (y * size + x) * 4;
      pixels[i] = ring ? 255 : PINK.b;
      pixels[i + 1] = ring ? 255 : PINK.g;
      pixels[i + 2] = ring ? 255 : PINK.r;
      pixels[i + 3] = alpha;
    }
  }
  return pixels;
}

/** What a screen reader says about the dot. */
export const badgeDescription = (count: number) => (count === 1 ? '1 session needs you' : `${count} sessions need you`);
