import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { isAbsolutePath } from '@seshboard/protocol/paths';
import { setFieldValue, settle, waitInPage } from './pageDriver.ts';
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
