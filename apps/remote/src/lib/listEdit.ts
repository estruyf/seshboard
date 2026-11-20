import type { KeyboardEvent } from 'react';
import { continueList, type TextEdit } from '@seshboard/protocol/remote-client';
import { newLineKey } from './sendMode.ts';

/** Makes the edit as if typed, so undo takes it back; `fallback` sets the text where the browser can't. */
function applyEdit(el: HTMLTextAreaElement, edit: TextEdit, fallback: (text: string) => void) {
  const caret = edit.from + edit.insert.length;
  el.setSelectionRange(edit.from, edit.to);
  if (document.execCommand(edit.insert ? 'insertText' : 'delete', false, edit.insert)) {
    el.setSelectionRange(caret, caret);
    return;
  }
  fallback(el.value.slice(0, edit.from) + edit.insert + el.value.slice(edit.to));
  requestAnimationFrame(() => el.setSelectionRange(caret, caret));
}

/**
 * A new line on a list item starts the next one (`- `, `2. `, `- [ ] `), as on the computer, and one on an empty item
 * ends the list. True when the key made that edit, so the caller does nothing else with it.
 */
export function continueListKey(event: KeyboardEvent<HTMLTextAreaElement>, enterSends: boolean, setText: (text: string) => void): boolean {
  const { key, metaKey, ctrlKey, altKey, shiftKey } = event;
  if (!newLineKey({ key, metaKey, ctrlKey, altKey, shiftKey, isComposing: event.nativeEvent.isComposing }, enterSends)) return false;
  const el = event.currentTarget;
  const edit = continueList(el.value, el.selectionStart, el.selectionEnd);
  if (!edit) return false;
  event.preventDefault();
  applyEdit(el, edit, setText);
  return true;
}
