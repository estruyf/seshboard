/**
 * A mod's SVG, made safe to draw. It is drawn as an image (`<img>` with a data URL), where the browser runs no script
 * and loads nothing from outside; this strips those parts anyway, so the picture never depends on that alone: scripts,
 * `foreignObject`, event handlers, links and `url()`s to anything but the picture itself, entities and stylesheets.
 * Null when the source isn't an SVG or is too big. Pure, so it can be tested.
 */

/** Claude Code bounds a mod's SVG to 128 KiB; nothing larger is drawn. */
export const SVG_MAX = 128 * 1024;

/** Elements that run script, embed other content or reach outside the picture. */
const BANNED = 'script|foreignObject|iframe|object|embed|audio|video|image|use|animate\\w*|set|handler|listener';

export function sanitizeSvg(source: string): string | null {
  if (source.length > SVG_MAX) return null;
  let svg = source.trim();
  // No DOCTYPE (entities can expand without end) and no processing instructions (xml-stylesheet loads CSS).
  svg = svg.replace(/<!DOCTYPE[\s\S]*?(?:\[[\s\S]*?\])?\s*>/gi, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  if (!/^<svg[\s>]/i.test(svg.trim())) return null;
  svg = svg
    // Self-closing first, then with their content, then any open or closing tag left over.
    .replace(new RegExp(`<(?:${BANNED})\\b[^>]*\\/>`, 'gi'), '')
    .replace(new RegExp(`<(${BANNED})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\/?(?:${BANNED})\\b[^>]*>`, 'gi'), '')
    // Event handlers, in any quoting.
    .replace(/\s+on[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Links and references: only to something in the picture itself (`#id`).
    .replace(/\s+(?:xlink:)?href\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*'|(?!["'#])[^\s>]+)/gi, '')
    .replace(/url\(\s*(?!["']?#)[^)]*\)/gi, 'none')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/javascript:/gi, '');
  return svg;
}

/** The image source an SVG is drawn from. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
