/**
 * The top of the visual row a text offset sits on, in pixels, or null when it can't be measured.
 * A long line wraps over several rows: comparing rows tells whether the caret is on the first or last one.
 */
export type RowOf = (offset: number) => number | null;

/** Nothing is selected, and the caret is on the box's first row: no line break before it, and not on a wrapped row below. */
export function onFirstLine(text: string, selectionStart: number, selectionEnd: number, rowOf: RowOf | null): boolean {
  if (selectionStart !== selectionEnd) return false;
  if (text.slice(0, selectionStart).includes('\n')) return false;
  const caret = rowOf?.(selectionStart) ?? null;
  const first = rowOf?.(0) ?? null;
  // Without a measurement only the very start is surely on the first row.
  return caret === null || first === null ? selectionStart === 0 : caret === first;
}

/** Nothing is selected, and the caret is on the box's last row: no line break after it, and not on a wrapped row above. */
export function onLastLine(text: string, selectionStart: number, selectionEnd: number, rowOf: RowOf | null): boolean {
  if (selectionStart !== selectionEnd) return false;
  if (text.includes('\n', selectionStart)) return false;
  const caret = rowOf?.(selectionStart) ?? null;
  const last = rowOf?.(text.length) ?? null;
  return caret === null || last === null ? selectionStart === text.length : caret === last;
}

const MIRRORED = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'fontStretch',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textIndent',
  'textTransform',
  'tabSize',
  'wordBreak',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
] as const;

/**
 * Measures rows in a textarea with a hidden copy of it: the same font, padding and width, the text
 * up to the offset, then a marker holding the rest (so it wraps where the textarea does). The
 * marker's top is the row the offset sits on.
 */
export function textareaRows(el: HTMLTextAreaElement): RowOf {
  return (offset) => {
    const doc = el.ownerDocument;
    const style = doc.defaultView?.getComputedStyle(el);
    if (!style || el.clientWidth === 0) return null;
    const mirror = doc.createElement('div');
    for (const name of MIRRORED) mirror.style[name] = style[name];
    Object.assign(mirror.style, {
      position: 'absolute',
      visibility: 'hidden',
      top: '0',
      left: '-9999px',
      boxSizing: 'border-box',
      // clientWidth leaves out the border and a scrollbar, which take no room from the text in the copy.
      width: `${el.clientWidth}px`,
      border: '0',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
    });
    mirror.textContent = el.value.slice(0, offset);
    const marker = doc.createElement('span');
    marker.textContent = el.value.slice(offset) || '.';
    mirror.appendChild(marker);
    doc.body.appendChild(mirror);
    const top = marker.offsetTop;
    mirror.remove();
    return top;
  };
}

/** The scroll position that shows a row `top`–`top + height` in a box `clientHeight` tall: unchanged when it already shows. */
export function scrollToRow(scrollTop: number, clientHeight: number, top: number, height: number): number {
  if (top < scrollTop) return top;
  if (top + height > scrollTop + clientHeight) return top + height - clientHeight;
  return scrollTop;
}

/**
 * Scrolls a box at its full height to the caret's row. Chromium scrolls to the caret before
 * `field-sizing: content` grows the box, so a new line typed at the bottom stayed just out of sight.
 */
export function revealCaret(el: HTMLTextAreaElement) {
  if (el.scrollHeight <= el.clientHeight) return;
  const top = textareaRows(el)(el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd);
  if (top === null) return;
  const style = getComputedStyle(el);
  const height = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  el.scrollTop = scrollToRow(el.scrollTop, el.clientHeight, top, height);
}
