/**
 * The shapes an app icon colourway is drawn in, made from its source (`assets/app-icons/<key>.svg`): the patch panel
 * full bleed on an 824px body, as home screens want it (the system draws the corners or the mask). Only the colours
 * differ between colourways, so each shape is the source with its frame swapped; a source drawn another way fails
 * here instead of making a wrong icon. Used by the icon script (`apps/desktop/scripts/icon/app-icons.mjs`).
 */

const BLEED_VIEW_BOX = 'viewBox="100 100 824 824"';
const BLEED_NOTE = 'Full bleed for home screens: the OS draws the rounded corners (iOS) or the mask (Android).';
const BLEED_BODY = `  <rect x="100" y="100" width="824" height="824" fill="url(#body)" />
  <rect x="100" y="100" width="824" height="824" fill="url(#sheen)" />`;

/** The tile in the 1024px macOS icon, without its margin and shadow: what Windows, Linux and Settings show. */
export const MAC_TILE = { x: 94, y: 94, width: 836, height: 836 } as const;

/**
 * The maskable icon's canvas, in the source's units: wider than the body, so the panel sits inside Android's safe
 * zone (the middle 80%) whatever mask the launcher uses, on the body's own colour.
 */
export const MASKABLE_VIEW = { x: 40, size: 944 } as const;

function swap(svg: string, from: string, to: string): string {
  if (!svg.includes(from)) throw new Error(`Not an app icon source: it has no ${JSON.stringify(from.trim().slice(0, 60))}`);
  return svg.replace(from, to);
}

/** The 1024px icon in the macOS grid: the 824px body inset 100px, with its rounded corners, shadow and rim. */
export function macIconSvg(source: string): string {
  let svg = swap(source, BLEED_VIEW_BOX, 'viewBox="0 0 1024 1024"');
  svg = swap(svg, BLEED_NOTE, 'macOS grid: 824×824 body inset 100 px on a 1024 canvas.');
  return swap(
    svg,
    BLEED_BODY,
    `  <g filter="url(#iconShadow)">
    <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#body)" />
  </g>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#sheen)" />
  <rect x="101.5" y="101.5" width="821" height="821" rx="183.5" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="3" />`,
  );
}

/** The maskable icon for Android: the full-bleed one with room around the panel (`MASKABLE_VIEW`). */
export function maskableIconSvg(source: string): string {
  const { x, size } = MASKABLE_VIEW;
  let svg = swap(source, BLEED_VIEW_BOX, `viewBox="${x} ${x} ${size} ${size}"`);
  svg = swap(svg, BLEED_NOTE, 'Maskable for Android: the panel inside the safe zone, the body to the edges for any mask.');
  return swap(
    svg,
    BLEED_BODY,
    `  <rect x="${x}" y="${x}" width="${size}" height="${size}" fill="url(#body)" />
  <rect x="${x}" y="${x}" width="${size}" height="${size}" fill="url(#sheen)" />`,
  );
}
