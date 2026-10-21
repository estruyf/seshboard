/** The lines a preview marks: `start` to `end`, both counted from 1 and inside the file. */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * The lines of Shiki's HTML, each as the HTML of its `<span class="line">`, or null when it isn't Shiki's shape. Shiki
 * puts a newline between the lines and none inside one (it escapes the code), so splitting the `<code>` on newlines is exact.
 */
export function shikiLines(html: string): string[] | null {
  const open = html.indexOf('<code>');
  const close = html.lastIndexOf('</code>');
  if (open < 0 || close < open) return null;
  return html.slice(open + '<code>'.length, close).split('\n');
}

/** The plain text's lines, as many as Shiki makes of it (a file that ends with a newline has an empty last line). */
export const plainLines = (code: string): string[] => code.split(/\r?\n/);

/** The range a link asked for, inside a file of `count` lines; null without a line. `end` defaults to `start`. */
export function lineRange(line: number | undefined, endLine: number | undefined, count: number): LineRange | null {
  if (!line || line < 1 || count < 1) return null;
  const start = Math.min(line, count);
  const end = Math.min(Math.max(endLine ?? start, start), count);
  return { start, end };
}

/** How many lines a block of the source holds: blocks the browser skips while they are off screen keep a long file fast. */
export const LINES_PER_BLOCK = 200;

/** The lines cut into blocks of `size`, each with the number of its first line. */
export function lineBlocks<T>(lines: readonly T[], size = LINES_PER_BLOCK): Array<{ first: number; lines: readonly T[] }> {
  const blocks: Array<{ first: number; lines: readonly T[] }> = [];
  for (let i = 0; i < lines.length; i += size) blocks.push({ first: i + 1, lines: lines.slice(i, i + size) });
  return blocks;
}
