import type { KeyboardEvent } from 'react';
import { continueList, type TextEdit } from '@seshboard/protocol/client';
import { matches } from '../../lib/shortcuts.ts';

export { continueList, type TextEdit };

/** The longest run of backticks in `text`. */
const longestTicks = (text: string) => Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));

/**
 * What typing ` does with text selected: wraps it as code and keeps it selected. One line becomes
 * `inline code`, several lines a fenced block on lines of its own. Backticks in the selection get a longer fence.
 * Null without a selection, where ` is just typed.
 */
export function wrapInCode(text: string, start: number, end: number): TextEdit | null {
  if (start === end) return null;
  const selected = text.slice(start, end);
  if (selected.includes('\n')) {
    const fence = '`'.repeat(Math.max(3, longestTicks(selected) + 1));
    const before = start > 0 && text[start - 1] !== '\n' ? '\n' : '';
    const after = end < text.length && text[end] !== '\n' ? '\n' : '';
    const open = `${before}${fence}\n`;
    const body = selected.replace(/\n$/, '');
    return { from: start, to: end, insert: `${open}${body}\n${fence}${after}`, select: [start + open.length, start + open.length + body.length] };
  }
  const ticks = '`'.repeat(longestTicks(selected) + 1);
  // `` a`b ``: a space between the fence and a backtick in the code keeps them apart.
  const pad = /^`|`$/.test(selected) ? ' ' : '';
  const open = `${ticks}${pad}`;
  return { from: start, to: end, insert: `${open}${selected}${pad}${ticks}`, select: [start + open.length, start + open.length + selected.length] };
}

/** `quoted` as a Markdown quote: `> ` before each line, runs of blank lines as one `>`, no blank lines around it. */
export function asQuote(quoted: string): string {
  const lines = quoted.replace(/\r\n?/g, '\n').replace(/\s+$/, '').replace(/^\s*\n/, '').replace(/\n\s*\n(\s*\n)+/g, '\n\n').split('\n');
  return lines.map((line) => (line.trim() ? `> ${line.trimEnd()}` : '>')).join('\n');
}

/**
 * Quote in reply: `quoted` as a Markdown quote at the end of the message, after a blank line, with the caret
 * on a new line under it, ready for your answer. Null when there is nothing to quote.
 */
export function appendQuote(text: string, quoted: string): TextEdit | null {
  const quote = asQuote(quoted);
  if (quote === '>' || !quote) return null;
  const before = !text ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return { from: text.length, to: text.length, insert: `${before}${quote}\n\n` };
}

/** A prompt put in the box for you (Fix failing checks with Claude): at the end of what is there, after a blank line. */
export function appendText(text: string, added: string): TextEdit | null {
  const block = added.replace(/\r\n?/g, '\n').trim();
  if (!block) return null;
  const before = !text ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return { from: text.length, to: text.length, insert: `${before}${block}` };
}

/** Makes the edit as if typed, so ⌘Z undoes it; `fallback` sets the text where the browser can't. */
export function applyEdit(el: HTMLTextAreaElement, edit: TextEdit, fallback: (text: string) => void) {
  const [selectStart, selectEnd] = edit.select ?? [edit.from + edit.insert.length, edit.from + edit.insert.length];
  el.setSelectionRange(edit.from, edit.to);
  if (document.execCommand(edit.insert ? 'insertText' : 'delete', false, edit.insert)) {
    el.setSelectionRange(selectStart, selectEnd);
    return;
  }
  fallback(el.value.slice(0, edit.from) + edit.insert + el.value.slice(edit.to));
  requestAnimationFrame(() => el.setSelectionRange(selectStart, selectEnd));
}

/** ⇧↵ in a list and ` on a selection. True when the key made an edit, so the caller does nothing else with it. */
export function editKey(event: KeyboardEvent<HTMLTextAreaElement>, setText: (text: string) => void): boolean {
  const el = event.currentTarget;
  const { value, selectionStart: start, selectionEnd: end } = el;
  // ⌃` opens the terminal; Ctrl with Alt is AltGr, which types ` on some keyboards.
  const backtick = event.key === '`' && !event.metaKey && (!event.ctrlKey || event.altKey);
  const edit = (matches(event.nativeEvent, 'composer.newline') && continueList(value, start, end)) || (backtick && wrapInCode(value, start, end));
  if (!edit) return false;
  event.preventDefault();
  applyEdit(el, edit, setText);
  return true;
}

/** The selection when a dead key started composing, by text area. */
const composing = new WeakMap<HTMLTextAreaElement, { value: string; start: number; end: number }>();

/**
 * Where ` is a dead key (Belgian, French, German keyboards) it composes instead of arriving as a key
 * press: the selection is replaced by the ` once composing ends. Then the ` becomes the wrap after all.
 */
export const deadKeyWrap = (setText: (text: string) => void) => ({
  onCompositionStart: (event: { currentTarget: HTMLTextAreaElement }) => {
    const el = event.currentTarget;
    if (el.selectionStart !== el.selectionEnd) composing.set(el, { value: el.value, start: el.selectionStart, end: el.selectionEnd });
    else composing.delete(el);
  },
  onCompositionEnd: (event: { currentTarget: HTMLTextAreaElement; data: string }) => {
    const el = event.currentTarget;
    const before = composing.get(el);
    composing.delete(el);
    if (!before || event.data !== '`') return;
    const typed = `${before.value.slice(0, before.start)}\`${before.value.slice(before.end)}`;
    // After the input that ends composing, and only if that ` is all that changed.
    requestAnimationFrame(() => {
      const edit = el.value === typed && wrapInCode(before.value, before.start, before.end);
      if (edit) applyEdit(el, { ...edit, to: before.start + 1 }, setText);
    });
  },
});
