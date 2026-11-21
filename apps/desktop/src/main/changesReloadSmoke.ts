import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { waitInPage } from './pageDriver.ts';

const S = '[data-current-session]';
const q = (selector: string) => `document.querySelector(${JSON.stringify(`${S} ${selector}`)})`;
const MARK = ' /* smoke: edited again */';

/**
 * An open diff in Changes shows a new edit of its file, also one that keeps its counts of added and removed lines: the
 * panel reloads its open diffs for every new check, not only when the counts change. It edits a file, so it runs only in
 * the made-up demo home (npm run smoke:demo), and puts the file back after.
 */
export async function runChangesReloadStep(win: BrowserWindow): Promise<string> {
  if (!process.env.SESHBOARD_SMOKE_DEMO) return 'ok: skipped, only in the demo home (it edits a file)';
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!(await waitInPage(win, q('[data-toggle-changes]'), 5_000))) return 'ok: skipped (session is not on a git checkout)';
  const wasOpen = (await js(`!!${q('[data-changes-panel]')}`)) as boolean;
  const toggleChanges = () => js(`${q('[data-toggle-changes]')}.click()`);
  if (!wasOpen) await toggleChanges();
  let restore: (() => void) | null = null;
  try {
    if (!(await waitInPage(win, `${q('[data-changes-panel]')} && !${q('[data-changes-panel]')}.innerText.includes('Loading')`, 5_000))) return 'the Changes panel did not load';
    const path = (await js(`${q('[data-changed-file]')}?.dataset.changedFile ?? null`)) as string | null;
    if (!path) return 'ok: skipped (no changed files)';
    if (!(await js(`!!${q('[data-changed-file] [data-file-open]')}`))) await js(`${q('[data-file-toggle]')}.click()`);
    if (!(await waitInPage(win, `document.querySelectorAll('${S} [data-file-diff] [data-diff-line]').length > 0`, 5_000))) return 'the first diff did not load';
    // An added line, edited into another added line: the counts stay the same.
    const added = (await js(`(() => {
      const row = [...document.querySelectorAll('${S} [data-file-diff] .bg-diff-added[data-diff-row]')].find((r) => r.lastElementChild?.textContent?.trim());
      return row ? row.lastElementChild.textContent : null;
    })()`)) as string | null;
    if (!added) return 'ok: skipped (the first diff adds no line)';
    const cwd = (await js(`document.querySelector('${S}')?.dataset.cwd ?? ''`)) as string;
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
    const file = join(root, path);
    const before = readFileSync(file, 'utf8');
    const lines = before.split('\n');
    const at = lines.indexOf(added);
    if (at === -1) return `ok: skipped (the added line isn't a whole line of ${path})`;
    restore = () => writeFileSync(file, before);
    lines[at] = `${added}${MARK}`;
    writeFileSync(file, lines.join('\n'));
    const shows = (yes: boolean) => `${yes ? '' : '!'}[...document.querySelectorAll('${S} [data-file-diff]')].some((d) => d.textContent.includes(${JSON.stringify(MARK.trim())}))`;
    // The window coming to the front checks again at once, as the panel's poll would a moment later.
    await js("window.dispatchEvent(new Event('focus'))");
    if (!(await waitInPage(win, shows(true), 8_000))) return `the open diff of ${path} did not show an edit that kept its counts`;
    restore();
    restore = null;
    await js("window.dispatchEvent(new Event('focus'))");
    if (!(await waitInPage(win, shows(false), 8_000))) return `the open diff of ${path} did not go back after the edit was undone`;
    return `ok: the open diff of ${path} showed an edit that kept its counts, and went back`;
  } finally {
    restore?.();
    if (!wasOpen) await toggleChanges();
  }
}
