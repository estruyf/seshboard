import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { isAbsolutePath, isSameOrInside } from '@seshboard/protocol/paths';
import { setFieldValue, settle, until, waitInPage } from './pageDriver.ts';
import { platformModifiers } from './smokeKeys.ts';

// The smoke steps of the Files panel: the tree, Quick open, Search in files, lines to the message, and a file link
// opening there. Read-only: they open and read files of the session's folder, and take out the chip they add.

const S = '[data-current-session]';
const PANEL = `document.querySelector('${S} [data-files-panel]')`;

const js = (win: BrowserWindow, code: string) => win.webContents.executeJavaScript(code);

/** Pictures for the pull request: each one in dark and in light. Left out, the steps take none. */
export interface FilesPictures {
  shot(name: string): Promise<void>;
  setScheme(scheme: 'light' | 'dark'): Promise<boolean>;
  scheme(): string;
  restoreScheme(scheme: string): void;
}

/** A picture of the window in dark and in light, in a window wide enough for the panel at Half. */
async function pictures(win: BrowserWindow, pics: FilesPictures | undefined, name: string, size: 'side' | 'half' | 'full' = 'half', prepare?: () => Promise<unknown>): Promise<void> {
  if (!pics) return;
  const [width, height] = win.getSize() as [number, number];
  const was = pics.scheme();
  win.setSize(1600, 960);
  await js(win, `${PANEL}?.querySelector('[data-web-preview-size="${size}"]')?.click()`);
  await waitInPage(win, size === 'full' ? `!!${PANEL}?.dataset.filesFull` : size === 'half' ? `${PANEL}?.getBoundingClientRect().width > 560` : `!${PANEL}?.dataset.filesFull`, 3_000);
  await prepare?.();
  try {
    for (const scheme of ['dark', 'light'] as const) {
      await pics.setScheme(scheme);
      await pics.shot(`${name}-${scheme}.png`);
    }
  } finally {
    pics.restoreScheme(was);
    await js(win, `${PANEL}?.querySelector('[data-web-preview-size="side"]')?.click()`);
    win.setSize(width, height);
    await waitInPage(win, `!${PANEL}?.dataset.filesFull && ${PANEL}?.getBoundingClientRect().width < 560`, 3_000);
  }
}

function press(win: BrowserWindow, keyCode: string, modifiers: Array<'meta' | 'alt' | 'shift'> = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: platformModifiers(modifiers) });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: platformModifiers(modifiers) });
}

/** Presses and lets go of the mouse in the middle of the element `expression` finds, as a real click does. */
async function clickAt(win: BrowserWindow, expression: string): Promise<void> {
  const box = (await js(win, `(() => { const r = (${expression}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)) as { x: number; y: number };
  win.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
}

/** The session's folder, from the view. */
async function sessionCwd(win: BrowserWindow): Promise<string | null> {
  const cwd = (await js(win, `document.querySelector('${S}')?.dataset.cwd ?? null`)) as string | null;
  return cwd && isAbsolutePath(cwd) ? cwd : null;
}

/** Opens the Files panel from the rail, in Files mode; false when it doesn't show. */
async function openFiles(win: BrowserWindow): Promise<boolean> {
  if (!(await js(win, `!!${PANEL}`))) await js(win, `document.querySelector('${S} [data-toggle-files]')?.click()`);
  if (!(await waitInPage(win, `!!${PANEL}`, 5_000))) return false;
  await js(win, `${PANEL}.querySelector('[data-files-mode-files]')?.click()`);
  if (!(await waitInPage(win, `${PANEL}.dataset.filesMode === 'files'`, 3_000))) return false;
  // At Side the tree and the viewer take turns: ‹ Files brings the tree back.
  await js(win, `${PANEL}.querySelector('[data-files-show-tree]')?.click()`);
  return true;
}

/** The viewer in front, found by the path it shows. */
const viewer = (path: string) => `[...(${PANEL}?.querySelectorAll('[data-files-viewer]') ?? [])].find((v) => v.dataset.filesViewer === ${JSON.stringify(path)})`;

/** The first line of a file with text on it, as the viewer shows it (a Markdown heading without its #). */
function firstLine(path: string): string {
  const line = readFileSync(path, 'utf8').split('\n').find((l) => l.trim()) ?? '';
  return path.endsWith('.md') ? line.replace(/^#+\s*/, '').trim() : line.trim();
}

/** Files on the rail: the tree lists the folder's files and folders, a folder opens, and a file opens in the viewer. */
export async function runFilesTreeStep(win: BrowserWindow, pics?: FilesPictures): Promise<string> {
  const cwd = await sessionCwd(win);
  if (!cwd) return 'ok: the session has no folder, so the rail has no Files';
  if (!(await js(win, `!!document.querySelector('${S} [data-toggle-files]')`))) return 'the rail has no Files for a session with a folder';
  if (!(await openFiles(win))) return 'Files did not open from the rail';
  if (!(await waitInPage(win, `${PANEL}.querySelector('[data-files-node]')`, 10_000))) return `the tree listed nothing (${await js(win, `${PANEL}.querySelector('[data-files-tree]')?.innerText ?? 'no tree'`)})`;
  const top = (await js(win, `[...${PANEL}.querySelectorAll('[data-files-node]')].filter((n) => !n.dataset.filesNode.includes('/')).map((n) => ({ path: n.dataset.filesNode, dir: n.dataset.filesDir === 'true' }))`)) as Array<{ path: string; dir: boolean }>;
  const folder = top.find((n) => n.dir && n.path === 'src') ?? top.find((n) => n.dir);
  const file = top.find((n) => !n.dir && n.path === 'README.md') ?? top.find((n) => !n.dir);
  if (!file) return `the tree's top level has no file: ${top.map((n) => n.path).join(', ')}`;
  if (existsSync(join(cwd, 'README.md')) && file.path !== 'README.md') return 'the tree does not list README.md';
  let opened = 'no folder at the top';
  if (folder) {
    const isOpen = (await js(win, `${PANEL}.querySelector('[data-files-node=${JSON.stringify(folder.path)}]').getAttribute('aria-expanded') === 'true'`)) as boolean;
    if (!isOpen) await js(win, `${PANEL}.querySelector('[data-files-node=${JSON.stringify(folder.path)}]').click()`);
    if (!(await waitInPage(win, `[...${PANEL}.querySelectorAll('[data-files-node]')].some((n) => n.dataset.filesNode.startsWith(${JSON.stringify(`${folder.path}/`)}))`, 3_000))) return `the folder ${folder.path} did not open`;
    opened = `${folder.path}/ opened`;
  }
  // With a filter on (before a file opens: at Side the viewer then takes the tree's place), the folders of the matches open by themselves, and a click still closes and opens one.
  let filtered = 'nothing in an open folder to filter on';
  const nested = (await js(win, `[...${PANEL}.querySelectorAll('[data-files-node]')].find((n) => n.dataset.filesNode.includes('/'))?.dataset.filesNode ?? null`)) as string | null;
  if (nested) {
    const dir = nested.slice(0, nested.lastIndexOf('/'));
    const node = `${PANEL}.querySelector('[data-files-node=${JSON.stringify(dir)}]')`;
    const shows = `!!${PANEL}.querySelector('[data-files-node=${JSON.stringify(nested)}]')`;
    await setFieldValue(win, `${S} [data-files-filter]`, nested);
    if (!(await waitInPage(win, shows, 3_000))) return `the filter "${nested}" did not show it`;
    await js(win, `${node}.click()`);
    if (!(await waitInPage(win, `!(${shows}) && ${node}.getAttribute('aria-expanded') === 'false'`, 3_000))) return `a click did not close ${dir} while filtering`;
    await js(win, `${node}.click()`);
    if (!(await waitInPage(win, shows, 3_000))) return `a second click did not open ${dir} again while filtering`;
    await setFieldValue(win, `${S} [data-files-filter]`, '');
    if (!(await waitInPage(win, `!!${PANEL}.querySelector('[data-files-node=${JSON.stringify(file.path)}]')`, 3_000))) return `clearing the filter did not bring back ${file.path}`;
    filtered = `${dir}/ closed and opened with a filter on`;
  }
  await js(win, `${PANEL}.querySelector('[data-files-node=${JSON.stringify(file.path)}]').click()`);
  const path = join(cwd, file.path);
  const expected = firstLine(path);
  if (!(await waitInPage(win, `(${viewer(path)})?.querySelector('[data-file-preview-source], [data-file-preview-markdown]')?.innerText.includes(${JSON.stringify(expected)})`, 5_000))) return `the viewer did not show "${expected}" from ${file.path}`;
  await pictures(win, pics, 'files-tree');
  await pictures(win, pics, 'files-full', 'full');
  return `ok: the tree lists ${top.length} entries at the top, ${opened}, ${file.path} opened in the viewer with "${expected.slice(0, 40)}", and ${filtered}`;
}

/** Quick open (⌘⌥P): part of a name opens the file in Files, and `name:3` opens it at line 3. */
export async function runFilesQuickOpenStep(win: BrowserWindow, pics?: FilesPictures): Promise<string> {
  const cwd = await sessionCwd(win);
  if (!cwd) return 'ok: the session has no folder';
  const name = existsSync(join(cwd, 'package.json')) ? 'package.json' : existsSync(join(cwd, 'README.md')) ? 'README.md' : null;
  if (!name) return 'ok: no package.json or README.md in the session folder to look for';
  await js(win, `document.querySelector('${S} [data-transcript]')?.focus?.()`);
  press(win, 'P', ['meta', 'alt']);
  if (!(await waitInPage(win, "document.activeElement?.matches('[data-quick-open-input]')", 3_000))) return '⌘⌥P did not open Quick open';
  await setFieldValue(win, '[data-quick-open-input]', name.slice(0, 5));
  if (!(await waitInPage(win, `document.querySelector('[data-quick-open-row=${JSON.stringify(name)}]')`, 5_000))) return `"${name.slice(0, 5)}" did not list ${name}`;
  if (pics) await pics.shot('files-quick-open.png');
  // ↓ until the file is the active row, then ↩.
  for (let i = 0; i < 20 && !(await js(win, `document.querySelector('[data-quick-open-row=${JSON.stringify(name)}]')?.getAttribute('aria-selected') === 'true'`)); i++) press(win, 'Down');
  press(win, 'Return');
  const path = join(cwd, name);
  if (!(await waitInPage(win, `!document.querySelector('[data-quick-open]') && !!(${viewer(path)})`, 5_000)))
    return `↩ did not open ${name} in Files (open: ${await js(win, `JSON.stringify({ quickOpen: !!document.querySelector('[data-quick-open]'), viewers: [...document.querySelectorAll('[data-files-viewer]')].map((v) => v.dataset.filesViewer), panel: !!${PANEL} })`)})`;

  press(win, 'P', ['meta', 'alt']);
  if (!(await waitInPage(win, "document.activeElement?.matches('[data-quick-open-input]')", 3_000))) return '⌘⌥P did not open Quick open again';
  await setFieldValue(win, '[data-quick-open-input]', `${name}:3`);
  if (!(await waitInPage(win, `document.querySelector('[data-quick-open-row=${JSON.stringify(name)}][aria-selected="true"]')`, 5_000))) return `"${name}:3" did not list ${name} first`;
  press(win, 'Return');
  if (!(await waitInPage(win, `(${viewer(path)})?.querySelector('[data-line="3"][data-line-marked]')`, 5_000))) return `${name}:3 did not open at line 3`;
  const inView = (await js(win, `(() => { const v = ${viewer(path)}; const box = v.querySelector('[data-file-preview-source]').getBoundingClientRect(); const row = v.querySelector('[data-line="3"]').getBoundingClientRect(); return row.top >= box.top && row.bottom <= box.bottom; })()`)) as boolean;
  if (!inView) return 'line 3 is not in view';
  // At Side the viewer stands alone: a strip of the panel keeps it apart from the conversation.
  await pictures(win, pics, 'files-side', 'side');
  return `ok: "${name.slice(0, 5)}" found ${name}, ↩ opened it in Files, and ${name}:3 opened it at line 3, in view`;
}

/** Search in files: a word of the project gives a count and results; a result opens in the viewer with the match marked. */
export async function runFilesSearchStep(win: BrowserWindow, pics?: FilesPictures): Promise<string> {
  const cwd = await sessionCwd(win);
  if (!cwd) return 'ok: the session has no folder';
  const word = existsSync(join(cwd, 'package.json')) ? 'name' : null;
  if (!word) return 'ok: no package.json in the session folder to search';
  if (!(await openFiles(win))) return 'Files did not open';
  await js(win, `${PANEL}.querySelector('[data-files-mode-search]').click()`);
  if (!(await waitInPage(win, `${PANEL}.querySelector('[data-files-search-input]')`, 3_000))) return 'Search did not show its field';
  await setFieldValue(win, `${S} [data-files-search-input]`, word);
  if (!(await waitInPage(win, `/^\\d[\\d,]* match(es)? in \\d+ files? · \\.gitignore respected/.test(${PANEL}.querySelector('[data-files-search-count]')?.innerText ?? '')`, 10_000))) return `no count for "${word}" (${await js(win, `${PANEL}.querySelector('[data-files-search-count]')?.innerText`)})`;
  const count = (await js(win, `${PANEL}.querySelector('[data-files-search-count]').innerText.split('\\n')[0]`)) as string;
  const first = (await js(win, `${PANEL}.querySelector('[data-files-result]')?.dataset.filesResult ?? null`)) as string | null;
  if (!first) return 'the count shows but no result';
  await js(win, `${PANEL}.querySelector('[data-files-result]').click()`);
  if (!(await waitInPage(win, `${PANEL}.querySelector('[data-files-search-position]') && CSS.highlights.get('find-current')?.size > 0`, 5_000))) return `the first result (${first}) did not open with its match marked`;
  await pictures(win, pics, 'files-search');
  await js(win, `${PANEL}.querySelector('[data-files-mode-files]').click()`);
  return `ok: "${word}" gives "${count}", and the first result (${first}) opens in the viewer with the match highlighted`;
}

/** Lines to Claude: selecting lines shows the toolbar, and Add to message puts the chip with their range in the box. */
export async function runFilesToMessageStep(win: BrowserWindow, pics?: FilesPictures): Promise<string> {
  const cwd = await sessionCwd(win);
  if (!cwd) return 'ok: the session has no folder';
  const name = existsSync(join(cwd, 'package.json')) ? 'package.json' : null;
  if (!name) return 'ok: no package.json in the session folder';
  if (!(await openFiles(win))) return 'Files did not open';
  const path = join(cwd, name);
  await js(win, `window.dispatchEvent(new CustomEvent('seshboard:preview-file', { detail: { path: ${JSON.stringify(path)}, sessionId: document.querySelector('${S}').dataset.currentSession } }))`);
  if (!(await waitInPage(win, `(${viewer(path)})?.querySelector('[data-line="3"]')`, 5_000))) return `${name} did not open in the viewer`;
  // Lines 2 to 3, selected as a drag would, then the mouse let go.
  // The viewer can draw itself again while the file's colours arrive: a selection made just before is lost then, so
  // it is made again until the toolbar shows.
  const selectOnce = `(() => { const v = ${viewer(path)}; const a = v?.querySelector('[data-line="2"]')?.lastElementChild; const b = v?.querySelector('[data-line="3"]')?.lastElementChild; if (!a || !b) return false; const range = document.createRange(); range.setStart(a, 0); range.setEnd(b, b.childNodes.length); const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); v.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return true; })()`;
  const selectLines = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      if ((await js(win, selectOnce)) && (await waitInPage(win, `${PANEL}?.querySelector('[data-files-selection-bar]')`, 1_000))) return true;
    }
    return false;
  };
  await selectLines();
  if (!(await waitInPage(win, `${PANEL}.querySelector('[data-files-selection-bar]')`, 3_000))) return 'selecting lines did not show the toolbar';
  const label = (await js(win, `${PANEL}.querySelector('[data-files-ask-lines]').innerText`)) as string;
  if (!label.includes('lines 2–3')) return `the toolbar says "${label}"`;
  if (pics) {
    // A new size draws the viewer again: the lines are selected again each time.
    await pictures(win, pics, 'files-lines', 'full', async () => {
      await waitInPage(win, `(${viewer(path)})?.querySelector('[data-line="3"]')`, 3_000);
      await selectLines();
      await waitInPage(win, `${PANEL}.querySelector('[data-files-selection-bar]')`, 3_000);
    });
    await waitInPage(win, `(${viewer(path)})?.querySelector('[data-line="3"]')`, 3_000);
    await selectLines();
    if (!(await waitInPage(win, `${PANEL}.querySelector('[data-files-selection-bar]')`, 3_000))) return 'the toolbar did not come back after the pictures';
  }
  const before = (await js(win, `document.querySelectorAll('${S} [data-context-chip="file"]').length`)) as number;
  // A real click, as a person makes it: the press and the release go through the viewer's own handlers first.
  await clickAt(win, `${PANEL}.querySelector('[data-files-add-lines]')`);
  const chip = `[...document.querySelectorAll('${S} [data-context-chip="file"]')].find((c) => c.innerText.includes('${name}:2–3'))`;
  if (!(await waitInPage(win, `!!(${chip})`, 3_000))) return `no ${name}:2–3 chip in the message box (${before} file chips before)`;
  await js(win, `(${chip}).querySelector('[data-context-chip-remove]').click()`);
  if (!(await waitInPage(win, `!(${chip})`, 3_000))) return 'the chip did not come out again';
  // Ask about the lines: the same chip, and the message box takes focus.
  if (!(await selectLines())) return 'selecting lines again did not show the toolbar';
  await clickAt(win, `${PANEL}.querySelector('[data-files-ask-lines]')`);
  if (!(await waitInPage(win, `!!(${chip}) && document.activeElement?.closest('${S}') && document.activeElement.tagName === 'TEXTAREA'`, 3_000))) return 'Ask about lines put no chip in the box, or the box did not take focus';
  await js(win, `(${chip}).querySelector('[data-context-chip-remove]').click()`);
  if (!(await waitInPage(win, `!(${chip})`, 3_000))) return 'the Ask chip did not come out again';
  // As the companion does from VS Code's explorer: a right-click on a file of the tree, Add file to message.
  await js(win, `${PANEL}.querySelector('[data-files-show-tree]')?.click()`);
  const node = `${PANEL}.querySelector('[data-files-node=${JSON.stringify(name)}]')`;
  if (!(await waitInPage(win, `!!${node}`, 3_000))) return `${name} is not in the tree`;
  await js(win, `(() => { const n = ${node}; const r = n.getBoundingClientRect(); n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 5 })); })()`);
  if (!(await waitInPage(win, "document.querySelector('[data-files-menu-item=\"add-file\"]')", 3_000))) return 'a right-click on a file did not show Add file to message';
  await js(win, "document.querySelector('[data-files-menu-item=\"add-file\"]').click()");
  const fileChip = `[...document.querySelectorAll('${S} [data-context-chip="file"]')].find((c) => c.innerText.trim() === ${JSON.stringify(name)})`;
  if (!(await waitInPage(win, `!!(${fileChip})`, 3_000))) return `Add file to message put no ${name} chip in the box`;
  await js(win, `(${fileChip}).querySelector('[data-context-chip-remove]').click()`);
  if (!(await waitInPage(win, `!(${fileChip})`, 3_000))) return 'the file chip did not come out again';
  // The picture of a file Claude changed: its lines marked in the gutter, with Show diff.
  // The demo's dark mode session changed src/lib/theme.ts.
  const changedFile = existsSync(join(cwd, 'src/lib/theme.ts')) ? 'src/lib/theme.ts' : null;
  if (pics && changedFile) {
    const full = join(cwd, changedFile);
    await js(win, `window.dispatchEvent(new CustomEvent('seshboard:preview-file', { detail: { path: ${JSON.stringify(full)}, sessionId: document.querySelector('${S}').dataset.currentSession } }))`);
    if (await waitInPage(win, `(${viewer(full)})?.querySelector('[data-line-changed]')`, 5_000)) await pictures(win, pics, 'files-changed', 'full');
  }
  return `ok: selecting lines 2 to 3 showed "${label}", Add to message and Ask about lines (real clicks) put the ${name}:2–3 chip in the box, a right-click on ${name} in the tree added the file, and both came out again`;
}

/** A file link in a reply opens in Files, at its line, not in the old Preview panel. */
export async function runFilesFromLinkStep(win: BrowserWindow): Promise<string> {
  const link = (await js(win, `(() => { const a = [...document.querySelectorAll('${S} [data-transcript] [data-file-link][data-file-link-action="preview"]')].at(-1); return a ? { target: a.dataset.fileLink } : null; })()`)) as { target: string } | null;
  if (!link) return 'ok: no file link that opens in Seshboard in this session';
  await js(win, `[...document.querySelectorAll('${S} [data-transcript] [data-file-link][data-file-link-action="preview"]')].at(-1).click()`);
  const [, line] = /:(\d+)$/.exec(link.target) ?? [];
  if (!(await waitInPage(win, `${PANEL}?.querySelector('[data-files-viewer]')`, 5_000))) return `${link.target} did not open in Files`;
  if (await js(win, `!!document.querySelector('${S} [data-file-preview-place="panel"]')`)) return 'the old Preview panel opened too';
  if (line && !(await waitInPage(win, `${PANEL}.querySelector('[data-files-viewer] [data-line="${line}"][data-line-marked]')`, 5_000))) return `${link.target} opened, but not at line ${line}`;
  await js(win, `${PANEL}.querySelector('[data-files-close]').click()`);
  // Closed and the conversation back at its width, so the next step doesn't measure a view that is still growing.
  if (!(await waitInPage(win, `!${PANEL}`, 3_000))) return 'Files did not close';
  await settle(win);
  return `ok: ${link.target} opened in Files${line ? ` at line ${line}` : ''}`;
}

/** The demo home's VS Code icon theme (`iconThemeExtension` in scripts/screenshot-demo.ts). */
const DEMO_ICON_THEME = 'seshboard-demo.file-icons/demo-icons';

/**
 * File icons: with the demo's VS Code icon theme picked in Settings › Theme › File icons, the tree draws README.md,
 * package.json and the `src` folder with that theme's icons; with None, it draws none.
 */
export async function runFilesIconsStep(win: BrowserWindow, deps: { fileIconTheme(): string; update(patch: { fileIconTheme: string }): void }, pics?: FilesPictures): Promise<string> {
  if (!process.env.SESHBOARD_SMOKE_DEMO) return 'ok: only in the demo home, which has an icon theme installed';
  const cwd = await sessionCwd(win);
  if (!cwd) return 'ok: the session has no folder';
  if (!existsSync(join(cwd, 'README.md')) || !existsSync(join(cwd, 'package.json'))) return 'ok: no README.md and package.json in the session folder';
  const was = deps.fileIconTheme();
  try {
    deps.update({ fileIconTheme: DEMO_ICON_THEME });
    if (!(await openFiles(win))) return 'Files did not open';
    // At Side the viewer stands in for the tree while a file is open: its ‹ Files brings the tree back.
    await js(win, `${PANEL}.querySelector('[data-files-show-tree]')?.click()`);
    const iconOf = (path: string) => `${PANEL}?.querySelector('[data-files-node=${JSON.stringify(path)}] [data-file-icon]')`;
    const drawn = (path: string, icon: string) => `(${iconOf(path)})?.dataset.fileIcon === ${JSON.stringify(icon)} && !!(${iconOf(path)})?.querySelector('img[src^="data:image/svg+xml"]')`;
    if (!(await waitInPage(win, drawn('README.md', 'readme'), 10_000))) return `README.md has no "readme" icon (it has ${await js(win, `(${iconOf('README.md')})?.dataset.fileIcon ?? 'none'`)})`;
    if (!(await waitInPage(win, drawn('package.json', 'json'), 3_000))) return `package.json has no "json" icon (it has ${await js(win, `(${iconOf('package.json')})?.dataset.fileIcon ?? 'none'`)})`;
    if (!(await waitInPage(win, drawn('src', 'src'), 3_000))) return `the src folder has no "src" icon (it has ${await js(win, `(${iconOf('src')})?.dataset.fileIcon ?? 'none'`)})`;
    await pictures(win, pics, 'files-icons');
    deps.update({ fileIconTheme: '' });
    if (!(await waitInPage(win, `!${PANEL}?.querySelector('[data-file-icon]')`, 3_000))) return 'the icons stayed with File icons set to None';
    return 'ok: README.md, package.json and src drawn with the demo icon theme, and none with None';
  } finally {
    deps.update({ fileIconTheme: was });
  }
}

/** A TypeScript file of the folder with an import (the editor must not mark it), or a JSON file; null when there is none. */
function editableFile(cwd: string): string | null {
  let json: string | null = null;
  const skip = (name: string) => name.startsWith('.') || name === 'node_modules';
  const walk = (dir: string, depth: number): string | null => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (skip(entry.name) || !entry.isFile()) continue;
      const path = join(dir, entry.name);
      if (/\.tsx?$/.test(entry.name) && /^import /m.test(readFileSync(path, 'utf8'))) return path;
      if (entry.name.endsWith('.json')) json ??= path;
    }
    if (depth === 0) return null;
    for (const entry of entries) {
      if (skip(entry.name) || !entry.isDirectory()) continue;
      const found = walk(join(dir, entry.name), depth - 1);
      if (found) return found;
    }
    return null;
  };
  return walk(cwd, 3) ?? json;
}

/**
 * Edit in the Files viewer: Edit loads Monaco, which shows the file coloured by Shiki on the code background; a typed
 * character marks it unsaved and ⌘S writes it to disk; ⌘F opens the viewer's find bar; another tab in front keeps the
 * edits and their undo; closing a tab with edits asks first; a change on disk while there are edits shows a notice. It
 * writes a file, so it runs only in the demo home, and puts the file back after.
 */
export async function runFilesEditStep(win: BrowserWindow, pics?: FilesPictures): Promise<string> {
  if (!process.env.SESHBOARD_SMOKE_DEMO) return 'ok: skipped, only in the demo home (it writes a file)';
  const cwd = await sessionCwd(win);
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (!cwd || !home || !isSameOrInside(cwd, home)) return 'ok: skipped, the session folder is not in the demo home';
  const path = editableFile(cwd);
  if (!path) return 'ok: no TypeScript or JSON file in the session folder';
  const before = readFileSync(path, 'utf8');
  const name = path.slice(cwd.length + 1);
  // A page this step makes, and takes away after.
  const page = join(cwd, 'seshboard-smoke-edit.html');
  const v = `(${viewer(path)})`;
  try {
    if (!(await openFiles(win))) return 'Files did not open';
    await js(win, `window.dispatchEvent(new CustomEvent('seshboard:preview-file', { detail: { path: ${JSON.stringify(path)}, sessionId: document.querySelector('${S}').dataset.currentSession } }))`);
    if (!(await waitInPage(win, `${v}?.querySelector('[data-files-edit]')`, 5_000))) return `${name} opened without Edit`;
    const started = Date.now();
    await js(win, `${v}.querySelector('[data-files-edit]').click()`);
    if (!(await waitInPage(win, `${v}?.querySelector('[data-file-editor="ready"] .monaco-editor .view-lines')?.innerText.trim().length > 0`, 15_000)))
      return `Monaco did not show ${name} (${await js(win, `${v}?.querySelector('[data-file-editor]')?.innerText ?? 'no editor'`)})`;
    const loadMs = Date.now() - started;
    // Shiki's colours: the tokens of the first lines in more than two colours.
    const coloured = `new Set([...${v}.querySelectorAll('.view-line span span')].map((s) => getComputedStyle(s).color)).size`;
    if (!(await waitInPage(win, `${coloured} > 2`, 5_000))) return `the editor is not highlighted (${await js(win, coloured)} colours)`;
    const colours = (await js(win, coloured)) as number;
    // The editor's surface is the app's code background, in both modes.
    const sameSurface = `getComputedStyle(${v}.querySelector('.monaco-editor-background')).backgroundColor === getComputedStyle(${v}.querySelector('[data-file-editor]')).backgroundColor`;
    if (!(await waitInPage(win, sameSurface, 3_000))) return `the editor's background (${await js(win, `getComputedStyle(${v}.querySelector('.monaco-editor-background')).backgroundColor`)}) is not the code background (${await js(win, `getComputedStyle(${v}.querySelector('[data-file-editor]')).backgroundColor`)})`;
    // Claude's changes show in the editor's gutter, as in the viewer (before this step writes the file).
    const changedLines = (await js(win, `Number(${v}.querySelector('[data-files-changed-lines]')?.dataset.filesChangedLines ?? 0)`)) as number;
    if (changedLines > 0 && !(await waitInPage(win, `${v}.querySelectorAll('.monaco-editor .sb-claude-mark').length > 0`, 3_000))) return `${name} has ${changedLines} lines Claude changed, but the editor marks none`;
    let schemes = 'no pictures';
    if (pics) {
      const was = pics.scheme();
      try {
        for (const scheme of ['dark', 'light'] as const) {
          await pics.setScheme(scheme);
          if (!(await waitInPage(win, sameSurface, 3_000))) return `in ${scheme} mode the editor's background (${await js(win, `getComputedStyle(${v}.querySelector('.monaco-editor-background')).backgroundColor`)}) is not the code background (${await js(win, `getComputedStyle(${v}.querySelector('[data-file-editor]')).backgroundColor`)})`;
          await pics.shot(`files-edit-${scheme}.png`);
        }
        schemes = 'the surface follows dark and light';
      } finally {
        pics.restoreScheme(was);
      }
    }
    const freed = (await js(win, `window.__seshboardEditor?.clashes() ?? []`)) as Array<{ command: string; label: string }>;
    console.log(`[smoke] Monaco keys that the app's shortcuts take over in the editor (${freed.length}): ${freed.map((k) => `${k.label} ${k.command}`).join(', ')}`);

    // A character typed at the start of the file marks it unsaved; ⌘S writes it.
    // A real click in the text, then ⌘↑ to the start of the file.
    await clickAt(win, `${v}.querySelector('.monaco-editor .view-line')`);
    if (!(await waitInPage(win, `${v}.querySelector('.monaco-editor')?.classList.contains('focused')`, 3_000))) return 'a click in the text did not focus the editor';
    // The app's single-letter keys (the catch-up's Space, C, S…) skip a focused textarea: Monaco must type through one.
    if (!(await js(win, `document.activeElement?.tagName === 'TEXTAREA' && !!document.activeElement.closest('[data-file-editor]')`)))
      return `the editor types through a ${String(await js(win, 'document.activeElement?.tagName'))}, not a textarea: the app's single-letter keys would fire while you type`;
    press(win, 'Up', ['meta']);
    await settle(win);
    await win.webContents.insertText('/* smoke */ ');
    if (!(await waitInPage(win, `!!${v}.querySelector('[data-files-dirty]')`, 3_000))) return 'typing did not mark the file unsaved';
    press(win, 'S', ['meta']);
    if (!(await until(() => readFileSync(path, 'utf8').startsWith('/* smoke */ '), 5_000))) return `⌘S did not write ${name} (it starts "${readFileSync(path, 'utf8').slice(0, 30)}")`;
    if (!(await waitInPage(win, `!${v}.querySelector('[data-files-dirty]')`, 3_000))) return 'the file still shows unsaved after ⌘S';
    const lineEndings = readFileSync(path, 'utf8').includes('\r\n') === before.includes('\r\n');

    // ⌘K in the editor is the app's: the command palette opens (the key never reaches Monaco's ⌘K chords), and Esc closes it.
    press(win, 'K', ['meta']);
    if (!(await waitInPage(win, "!!document.querySelector('[data-command-palette]')", 3_000)))
      return '⌘K in the editor did not open the command palette';
    press(win, 'Escape');
    if (!(await waitInPage(win, "!document.querySelector('[data-command-palette]')", 3_000))) return 'Esc did not close the command palette';
    await clickAt(win, `${v}.querySelector('.monaco-editor .view-line')`);

    // ⌘F in the editor opens the viewer's find bar (as in the read-only view): it marks the matches in the editor, Enter
    // steps to the next, and its close button (a real click) closes it and gives the editor its focus back.
    press(win, 'F', ['meta']);
    if (!(await waitInPage(win, `document.activeElement?.matches('${S} [data-files-find-input]')`, 3_000))) return '⌘F in the editor did not open the find bar';
    await win.webContents.insertText('import');
    const findCount = `${v}.querySelector('[data-files-find-count]')?.textContent ?? ''`;
    if (!(await waitInPage(win, `/^1 of \\d+$/.test(${findCount}) && !!${v}.querySelector('.monaco-editor .sb-find-current')`, 3_000)))
      return `find in the editor marked no match ("${await js(win, findCount)}")`;
    press(win, 'Enter');
    if (!(await waitInPage(win, `/^2 of /.test(${findCount})`, 3_000))) return `Enter in the find bar did not step to the next match ("${await js(win, findCount)}")`;
    await clickAt(win, `${v}.querySelector('[data-files-find] [aria-label="Close find"]')`);
    if (!(await waitInPage(win, `!${v}.querySelector('[data-files-find]') && !${v}.querySelector('.monaco-editor .sb-find-match, .monaco-editor .sb-find-current') && ${v}.querySelector('.monaco-editor')?.classList.contains('focused')`, 3_000)))
      return 'the find bar did not close on its close button, or left marks, or the editor did not get its focus back';

    // Another tab in front keeps the edits: the editor stays, hidden, and comes back as it was. A tab with unsaved
    // edits asks before it closes, and Cancel keeps it.
    const tabOf = (p: string) => `[...${PANEL}.querySelectorAll('[data-files-tab]')].find((t) => t.dataset.filesTab === ${JSON.stringify(p)})`;
    const other = join(cwd, 'package.json');
    if (other !== path && existsSync(other)) {
      press(win, 'Up', ['meta']);
      await settle(win);
      await win.webContents.insertText('y');
      if (!(await waitInPage(win, `!!${v}.querySelector('[data-files-dirty]')`, 3_000))) return 'typing did not mark the file unsaved before another tab came in front';
      await js(win, `window.dispatchEvent(new CustomEvent('seshboard:preview-file', { detail: { path: ${JSON.stringify(other)}, sessionId: document.querySelector('${S}').dataset.currentSession } }))`);
      if (!(await waitInPage(win, `${PANEL}.querySelector('[data-files-tab-front]')?.dataset.filesTab === ${JSON.stringify(other)}`, 5_000))) return "package.json did not come in front";
      if (!(await js(win, `!!${tabOf(path)}?.querySelector('[data-files-dirty]')`))) return 'the edited tab lost its unsaved dot behind another tab';
      // A second file in edit mode at the same time.
      const otherViewer = `(${viewer(other)})`;
      if (!(await waitInPage(win, `!!${otherViewer}?.querySelector('[data-files-edit]')`, 5_000))) return 'package.json opened without Edit';
      await js(win, `${otherViewer}.querySelector('[data-files-edit]').click()`);
      if (!(await waitInPage(win, `!!${otherViewer}?.querySelector('[data-file-editor="ready"] .view-line')`, 5_000))) return 'package.json did not go into edit mode with the other file still in it';
      await js(win, `${tabOf(path)}.click()`);
      // Its undo history came back too: ⌘Z below takes the y back.
      if (!(await waitInPage(win, `!!${v}?.querySelector('[data-file-editor="ready"] .view-line')?.innerText.startsWith('y/*')`, 3_000)))
        return `back on ${name}, its edits were gone ("${String(await js(win, `${v}?.querySelector('[data-file-editor] .view-line')?.innerText.slice(0, 20)`))}")`;
      await js(win, `${tabOf(path)}.querySelector('[aria-label^="Close"]').click()`);
      if (!(await waitInPage(win, "!!document.querySelector('[data-files-close-unsaved]')", 3_000))) return 'closing a tab with unsaved edits did not ask first';
      press(win, 'Escape');
      if (!(await waitInPage(win, `!document.querySelector('[data-files-close-unsaved]') && !!${v}?.querySelector('[data-files-dirty]')`, 3_000))) return 'Cancel on the close question did not keep the tab with its edits';
      // ⌘Z takes the y back: the file is as saved again.
      await clickAt(win, `${v}.querySelector('.monaco-editor .view-line')`);
      press(win, 'Z', ['meta']);
      if (!(await waitInPage(win, `!${v}.querySelector('[data-files-dirty]')`, 3_000))) return 'undo back to the saved text still shows the file unsaved';
      // package.json is still in edit mode behind it; Done takes it out.
      await js(win, `${tabOf(other)}.click()`);
      if (!(await waitInPage(win, `!!${otherViewer}?.querySelector('[data-file-editor="ready"]')`, 5_000))) return 'package.json left edit mode while the other file was in front';
      await js(win, `${otherViewer}.querySelector('[data-files-edit-done]').click()`);
      await js(win, `${tabOf(path)}.click()`);
      if (!(await waitInPage(win, `!!${v}?.querySelector('[data-file-editor="ready"]')`, 5_000))) return `${name} left edit mode`;
      await clickAt(win, `${v}.querySelector('.monaco-editor .view-line')`);
    }

    // The path bar keeps the file's name whole at this width; the folders give way first.
    if (!(await js(win, `(() => { const n = ${v}.querySelector('[data-files-crumb-name] .truncate'); return !!n && n.scrollWidth <= n.clientWidth; })()`))) return `the path bar cut the file's name ("${String(await js(win, `${v}.querySelector('[data-files-crumb-name]')?.innerText`))}")`;

    // Lines picked in the editor go to the message: ⇧↓ picks the first two, and Add to message names them.
    press(win, 'Up', ['meta']);
    press(win, 'Down', ['shift']);
    press(win, 'Down', ['shift']);
    if (!(await waitInPage(win, `${v}.querySelector('[data-files-add-to-message]')?.getAttribute('aria-label') === 'Add lines 1–2 to message'`, 3_000)))
      return `picking lines in the editor did not reach Add to message ("${String(await js(win, `${v}.querySelector('[data-files-add-to-message]')?.getAttribute('aria-label')`))}")`;
    const chips = `document.querySelectorAll('${S} [data-context-chip="file"]').length`;
    const chipsBefore = (await js(win, chips)) as number;
    await js(win, `${v}.querySelector('[data-files-add-to-message]').click()`);
    if (!(await waitInPage(win, `${chips} > ${chipsBefore}`, 3_000))) return 'Add to message with lines picked in the editor put no chip in the message box';
    await js(win, `[...document.querySelectorAll('${S} [data-context-chip="file"]')].at(-1).querySelector('[data-context-chip-remove]').click()`);

    // Esc is the editor's while it has something to close: the lines still picked go first. With nothing left, Esc
    // leaves the editor, and the panel stays (with the file still in edit mode).
    // A click in the lines picked gives the editor its focus back and keeps them picked.
    await clickAt(win, `${v}.querySelector('.monaco-editor .view-line')`);
    if (!(await waitInPage(win, `${v}.querySelector('[data-files-add-to-message]')?.getAttribute('aria-label') === 'Add lines 1–2 to message' && !!${v}.querySelector('.monaco-editor')?.classList.contains('focused')`, 3_000)))
      return 'a click in the picked lines lost them or did not focus the editor';
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
    press(win, 'Escape');
    if (!(await waitInPage(win, `${v}.querySelector('[data-files-add-to-message]')?.getAttribute('aria-label') === 'Add file to message' && !!${v}.querySelector('.monaco-editor')?.classList.contains('focused')`, 3_000)))
      return 'the first Esc did not clear the lines picked in the editor, or left it';
    press(win, 'Escape');
    if (!(await waitInPage(win, `!!${PANEL} && !${v}.querySelector('.monaco-editor')?.classList.contains('focused') && !!${v}.querySelector('[data-file-editor="ready"]')`, 3_000)))
      return `the second Esc did not leave the editor, or closed the panel or edit mode (${String(await js(win, `JSON.stringify({ panel: !!${PANEL}, focused: ${PANEL} ? !!${v}?.querySelector('.monaco-editor')?.classList.contains('focused') : null, editing: ${PANEL} ? !!${v}?.querySelector('[data-file-editor]') : null })`))})`;
    await clickAt(win, `${v}.querySelector('.monaco-editor .view-line')`);

    press(win, 'Up', ['meta']);
    await settle(win);

    // Changed on disk while there are edits: a notice says so, and a save doesn't overwrite it.
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n// written by someone else\n`);
    await win.webContents.insertText('x');
    if (!(await waitInPage(win, `!!${v}.querySelector('[data-files-dirty]')`, 3_000))) return 'a second edit did not mark the file unsaved';
    // The window coming to the front reads the file again, as Claude's write does through reloadKey.
    await js(win, "window.dispatchEvent(new Event('focus'))");
    let notice = 'on reading it again';
    if (!(await waitInPage(win, `!!${v}.querySelector('[data-files-changed-on-disk]')`, 5_000))) {
      press(win, 'S', ['meta']);
      notice = 'when ⌘S was refused';
      if (!(await waitInPage(win, `!!${v}.querySelector('[data-files-changed-on-disk]')`, 5_000))) return 'a change on disk while editing showed no notice, and ⌘S did not refuse';
    }
    if (!readFileSync(path, 'utf8').includes('written by someone else')) return 'the save overwrote a change made on disk';
    await js(win, `${v}.querySelector('[data-files-edit-done]').click()`);
    if (!(await waitInPage(win, `!${v}.querySelector('[data-file-editor]') && !!${v}.querySelector('[data-file-preview-source]')`, 3_000))) return 'Discard did not go back to the viewer';

    // An HTML page edits as it is on disk: not the copy the viewer shows, with a policy and inlined images added.
    writeFileSync(page, '<p>edit me</p>\n');
    await js(win, `window.dispatchEvent(new CustomEvent('seshboard:preview-file', { detail: { path: ${JSON.stringify(page)}, sessionId: document.querySelector('${S}').dataset.currentSession } }))`);
    const pv = `(${viewer(page)})`;
    if (!(await waitInPage(win, `!!${pv}?.querySelector('[data-files-edit]')`, 5_000))) return 'an HTML page opened without Edit';
    await js(win, `${pv}.querySelector('[data-files-edit]').click()`);
    if (!(await waitInPage(win, `${pv}?.querySelector('[data-file-editor="ready"] .view-line')?.innerText.replace(/\\u00a0/g, ' ').trim() === '<p>edit me</p>'`, 5_000)))
      return `the HTML page in the editor is not its text on disk ("${String(await js(win, `${pv}?.querySelector('[data-file-editor] .view-line')?.innerText.slice(0, 60)`))}")`;
    await js(win, `${pv}.querySelector('[data-files-edit-done]').click()`);
    return `ok: Monaco loaded in ${loadMs}ms with ${name} in ${colours} colours on the code background (${schemes}), ⌘S wrote the typed text${lineEndings ? ' with its line endings' : ' but changed its line endings'}, a change on disk showed a notice ${notice} and was kept; ${freed.length} Monaco keys taken over by the app's shortcuts, ⌘K in the editor opened the palette, ⌘F the find bar, which closed on its button, edits kept behind another tab and asked before closing, two files in edit mode at once, Claude's marks in the gutter${changedLines ? '' : ' (none here)'}, picked lines added to the message, Esc cleared the pick, then left the editor and kept the panel, an HTML page edited as it is on disk`;
  } finally {
    writeFileSync(path, before);
    rmSync(page, { force: true });
  }
}
