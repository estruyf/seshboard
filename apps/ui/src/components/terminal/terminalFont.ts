/** What `terminal.font` returns. An engine from before the list existed only sends `fontFamily`. */
export interface DetectedFont {
  fontFamily: string | null;
  fontFamilies?: string[];
}

/**
 * The CSS `font-family` for the terminal: each font from the user's own terminal as its own quoted name, in
 * order, then the fallbacks. Without any (nothing found, or only blanks) it is just the fallbacks.
 */
export function terminalFontFamily(detected: DetectedFont, fallbacks: string): string {
  const names = detected.fontFamilies ?? (detected.fontFamily ? [detected.fontFamily] : []);
  const quoted = names.map((name) => name.replace(/["\\]/g, '').trim()).filter(Boolean).map((name) => `"${name}"`);
  return [...quoted, fallbacks].join(', ');
}
