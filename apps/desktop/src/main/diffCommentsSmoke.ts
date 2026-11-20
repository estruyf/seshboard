import type { BrowserWindow } from 'electron';
import { setFieldValue, settle, waitInPage } from './pageDriver.ts';
import { MOD_KEY_PROPERTY } from './smokeKeys.ts';

// The smoke step for review comments on lines in Changes (#279). Nothing is sent: the comments go in the message box,
// which the step empties again.

const S = '[data-current-session]';
const q = (selector: string) => `document.querySelector(${JSON.stringify(`${S} ${selector}`)})`;

/**
 * Comments on lines of the first changed file: a click and a Shift-click on line numbers open the editor, Comment keeps
 * it under its lines, Edit changes it, Esc lets a new one go without closing Changes, ⌘⇧M comments on selected text, the
 * comments outlive closing the panel, and Submit puts them in the message box as one review card.
 */
export async function runDiffCommentsStep(win: BrowserWindow, shot: (name: string) => Promise<void>): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!(await waitInPage(win, q('[data-toggle-changes]'), 5_000))) return 'ok: skipped (session is not on a git checkout)';
  const wasOpen = (await js(`!!${q('[data-changes-panel]')}`)) as boolean;
  const toggleChanges = () => js(`${q('[data-toggle-changes]')}.click()`);
  if (!wasOpen) await toggleChanges();
  if (!(await waitInPage(win, `${q('[data-changes-panel]')} && !${q('[data-changes-panel]')}.innerText.includes('Loading')`, 5_000))) return 'the Changes panel did not load';
  if (!(await js(`!!${q('[data-changed-file]')}`))) {
    if (!wasOpen) await toggleChanges();
    return 'ok: skipped (no changed files)';
  }
  const composer = `${S} [data-composer]`;
  const draftBefore = (await js(`${q('[data-composer]')}?.value ?? null`)) as string | null;
  if (draftBefore === null) return 'the session has no message box';

  const openFirstDiff = async () => {
    if (!(await js(`!!${q('[data-changed-file] [data-file-open]')}`))) await js(`${q('[data-file-toggle]')}.click()`);
    return waitInPage(win, `document.querySelectorAll('${S} [data-file-diff] [data-diff-line]').length > 0`, 5_000);
  };
  if (!(await openFirstDiff())) return 'the first diff did not load';
  const lines = (await js(`document.querySelectorAll('${S} [data-file-diff] [data-diff-line]').length`)) as number;

  // Click a line number, Shift-click the next: the editor opens on both lines.
  const press = (index: number, shift: boolean) =>
    js(`(() => {
      const line = document.querySelectorAll('${S} [data-file-diff] [data-diff-line]')[${index}];
      line.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, shiftKey: ${shift} }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    })()`);
  await press(0, false);
  if (lines > 1) {
    await waitInPage(win, q('[data-diff-comment-editor]'), 2_000);
    await press(1, true);
  }
  if (!(await waitInPage(win, `document.activeElement === ${q('[data-diff-comment-input]')}`, 3_000))) return 'a click on a line number did not open the comment editor with the focus';
  const picked = (await js(`document.querySelectorAll('${S} [data-diff-picked]').length`)) as number;
  if (picked !== Math.min(lines, 2)) return `${picked} rows picked after a click and a Shift-click, not ${Math.min(lines, 2)}`;

  await setFieldValue(win, `${S} [data-diff-comment-input]`, 'Smoke comment');
  await js(`${q('[data-diff-comment-save]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-diff-comment]')}?.innerText.includes('Smoke comment')`, 3_000))) return 'the comment did not show under its lines';
  if (!(await js(`${q('[data-review-count="1"]')} && ${q('[data-file-comments="1"]')}`))) return 'the review bar or the file row does not count the comment';

  // Edit it.
  await js(`${q('[data-diff-comment-edit]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-diff-comment-input]')}?.value === 'Smoke comment'`, 2_000))) return 'Edit did not open the comment with its text';
  await setFieldValue(win, `${S} [data-diff-comment-input]`, 'Smoke comment, edited');
  await js(`${q('[data-diff-comment-save]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-diff-comment]')}?.innerText.includes('Smoke comment, edited')`, 2_000))) return 'the edited comment did not show';

  // Esc lets a new comment go, and leaves Changes open.
  await press(lines - 1, false);
  if (!(await waitInPage(win, `document.activeElement === ${q('[data-diff-comment-input]')}`, 2_000))) return 'a second click did not open the editor';
  await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  if (!(await waitInPage(win, `!${q('[data-diff-comment-editor]')}`, 2_000))) return 'Esc did not close the comment editor';
  if (!(await js(`!!${q('[data-changes-panel]')}`))) return 'Esc in the comment editor closed Changes';

  // ⌘⇧M with text of a line selected.
  const shortcut = (await js(`(() => {
    const row = document.querySelectorAll('${S} [data-file-diff] [data-diff-row] > span:last-child')[${lines - 1}];
    if (!row) return false;
    const range = document.createRange();
    range.selectNodeContents(row);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', shiftKey: true, ${MOD_KEY_PROPERTY}: true, bubbles: true, cancelable: true }));
    return true;
  })()`)) as boolean;
  if (shortcut) {
    if (!(await waitInPage(win, q('[data-diff-comment-editor]'), 2_000))) return '⌘⇧M with a selected line did not open the comment editor';
    // A comment and the editor, side by side in the diff.
    await shot('diff-comments.png');
    await js(`${q('[data-diff-comment-editor] button')}.click()`);
  }

  // Closing Changes keeps the comment.
  await toggleChanges();
  await waitInPage(win, `!${q('[data-changes-panel]')}`, 3_000);
  await toggleChanges();
  if (!(await waitInPage(win, q('[data-review-count="1"]'), 5_000))) return 'the comment was gone after closing and opening Changes';
  if (!(await openFirstDiff()) || !(await waitInPage(win, q('[data-diff-comment]'), 3_000))) return 'the comment did not show in the diff again';

  // Submit: one review card and a prompt in the message box; the comments leave Changes.
  await js(`${q('[data-review-submit]')}.click()`);
  const submitted = await waitInPage(win, `${q('[data-context-chip="review"]')} && ${q('[data-composer]')}.value.includes('Address my review comment')`, 3_000);
  const barGone = await waitInPage(win, `!${q('[data-review-bar]')}`, 2_000);
  const card = (await js(`${q('[data-context-chip="review"]')}?.getAttribute('data-tooltip') ?? ''`)) as string;
  // Empty the box again: the card off, and its text as it was.
  await js(`${q('[data-context-chip="review"] [data-context-chip-remove]')}?.click()`);
  await setFieldValue(win, composer, draftBefore);
  await settle(win);
  if (!wasOpen) await toggleChanges();
  if (!submitted) return 'Submit did not put a review card and a prompt in the message box';
  if (!barGone) return 'the review bar stayed after Submit';
  return `ok: ${lines} diff lines; click and Shift-click picked ${picked}, Comment, Edit, Esc kept Changes, ${shortcut ? '⌘⇧M on a selection, ' : ''}kept after closing Changes, Submit made "${card}"`;
}
