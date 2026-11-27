import type { BrowserWindow } from 'electron';
import { settle, waitInPage } from './pageDriver.ts';
import { platformModifiers } from './smokeKeys.ts';

// The smoke steps of Minimal mode, the Black and white theme, Code highlighting and Project colours. They change only
// the throwaway profile's preferences, and put each one back as it was.

const js = (win: BrowserWindow, code: string) => win.webContents.executeJavaScript(code);

/** What the steps need from main: pictures, the colour scheme and the preferences. */
export interface MinimalSmoke {
  shot(name: string): Promise<void>;
  setScheme(scheme: 'light' | 'dark'): Promise<boolean>;
  prefs(): { minimalMode: boolean; codeHighlighting: boolean; projectColors: boolean; themeId: string; colorScheme: string };
  update(patch: Record<string, unknown>): void;
  /** A stand-in session in a temp folder (the engine's `smokeQueueHost`): working, waiting on a made-up prompt, or gone. */
  host(sessionId: string, cwd: string, state: 'running' | 'needs-you' | 'closed'): void;
  /** A temp folder for the stand-ins, and taking it away again. */
  tempFolder(): { path: string; remove(): void };
}

/** ⌘⇧. (Ctrl+Shift+. elsewhere), as the keyboard sends it. */
function pressMinimalKey(win: BrowserWindow): void {
  const modifiers = platformModifiers(['meta', 'shift'] as const);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '.', modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '.', modifiers });
}

const MINIMAL_ON = `document.documentElement.getAttribute('data-minimal') === 'true'`;

/** minimal: preference. ⌘⇧. turns Minimal mode on (data-minimal="true" on the root, saved) and off again. */
export async function runMinimalPreferenceStep(win: BrowserWindow, deps: MinimalSmoke): Promise<string> {
  const was = deps.prefs().minimalMode;
  if (was) deps.update({ minimalMode: false });
  if (!(await waitInPage(win, `!document.documentElement.hasAttribute('data-minimal')`, 2_000))) return 'Minimal mode was on and did not turn off';
  win.focus();
  pressMinimalKey(win);
  if (!(await waitInPage(win, MINIMAL_ON, 2_000))) return '⌘⇧. did not turn Minimal mode on (no data-minimal="true" on the root)';
  if (!deps.prefs().minimalMode) return 'Minimal mode turned on but was not saved';
  pressMinimalKey(win);
  if (!(await waitInPage(win, `!document.documentElement.hasAttribute('data-minimal')`, 2_000))) return 'a second ⌘⇧. did not turn Minimal mode off';
  await settle(win);
  if (deps.prefs().minimalMode) return 'Minimal mode turned off but the saved preference stayed on';
  if (was) deps.update({ minimalMode: true });
  return 'ok: ⌘⇧. turns Minimal mode on and off, and it is saved';
}

const row = (id: string) => `document.querySelector('[data-session-list] [data-session-id="${id}"]')`;

/**
 * minimal: layout. With Minimal mode on: a waiting stand-in's row is one line with the Needs you dot and a bold title,
 * a working one has the turning arc, the rail of tools has no numbers, and the message box says its chips in one line.
 */
export async function runMinimalLayoutStep(win: BrowserWindow, deps: MinimalSmoke): Promise<string> {
  const was = deps.prefs().minimalMode;
  const folder = deps.tempFolder();
  const ids = { waiting: `smoke-minimal-wait-${Date.now()}`, working: `smoke-minimal-work-${Date.now()}` };
  try {
    deps.update({ minimalMode: true });
    if (!(await waitInPage(win, MINIMAL_ON, 2_000))) return 'Minimal mode did not turn on';
    deps.host(ids.working, folder.path, 'running');
    deps.host(ids.waiting, folder.path, 'needs-you');
    const waiting = row(ids.waiting);
    if (!(await waitInPage(win, `!!${waiting}?.matches('[data-row-minimal]')`, 8_000))) return `the waiting stand-in has no one-line row (${String(await js(win, `${waiting}?.outerHTML.slice(0, 200) ?? 'no row'`))})`;
    const checks = (await js(
      win,
      `(() => {
        const w = ${waiting}, k = ${row(ids.working)};
        const dot = w.querySelector('[data-minimal-mark="dot"]');
        const title = w.querySelector('[data-row-title]');
        return JSON.stringify({
          height: w.getBoundingClientRect().height,
          dot: dot?.getAttribute('aria-label') ?? null,
          bold: title ? getComputedStyle(title).fontWeight : null,
          tip: w.dataset.tooltip ?? '',
          spinner: !!k?.querySelector('[data-minimal-mark="spinner"]'),
          tile: !!w.querySelector('[data-project-icon]'),
          rail: [...document.querySelectorAll('[data-tool-rail] [data-rail-badge]')].map((b) => b.textContent).join('|'),
          summary: document.querySelector('[data-current-session] [data-composer-summary]')?.textContent ?? null,
        });
      })()`,
    )) as string;
    const got = JSON.parse(checks) as { height: number; dot: string | null; bold: string | null; tip: string; spinner: boolean; tile: boolean; rail: string; summary: string | null };
    // The nav rail stays as it is, with dots for counts: one on Sessions for the waiting stand-in, no number.
    const views = 'nav[aria-label="Views"]';
    if (!(await js(win, `!!document.querySelector('${views} [data-nav="home"]')`))) return 'the nav rail has no Home';
    const badge = (await js(win, `(() => { const b = document.querySelector('${views} [data-nav="sessions"] [data-needs-you-pill]'); return b ? { dot: b.hasAttribute('data-badge-dot'), text: b.textContent } : null; })()`)) as { dot: boolean; text: string } | null;
    if (!badge?.dot || /\d/.test(badge.text)) return `Sessions on the nav rail has no plain dot for what needs you (${JSON.stringify(badge)})`;
    if (got.height > 36) return `the waiting row is ${got.height}px tall, not one line`;
    if (got.dot !== 'Needs you') return `the waiting row has no Needs you dot (${String(got.dot)})`;
    if (got.bold !== '600') return `the waiting row's title is not bold (${String(got.bold)})`;
    if (got.tile) return 'the row still shows its project tile';
    if (!got.spinner) return 'the working row has no turning arc';
    if (/\d/.test(got.rail)) return `the rail of tools still shows counts (${got.rail})`;
    if (got.summary === null) return 'the message box has no one-line summary of its chips';
    if (got.summary.split(' · ').length < 2) return `the message box line is not "model · mode · profile" (${got.summary})`;
    if (await js(win, `getComputedStyle(document.querySelector('[data-current-session] [data-composer-tray]')).display !== 'none'`)) return 'the chips under the box still show';
    // No row has a project marker, and a queued prompt's title starts where a session's does (when the list has one:
    // the demo profile has no project added, so nothing can be queued here; rowLeading's tests cover the slot).
    const rows = JSON.parse(
      (await js(
        win,
        `JSON.stringify({
          tiles: document.querySelectorAll('[data-session-list] :is([data-session-id], [data-queue-item], [data-sidebar-project]) [data-project-icon]').length,
          session: Math.round(document.querySelector('[data-session-list] [data-row-minimal] [data-row-title]')?.getBoundingClientRect().left ?? -1),
          queue: Math.round(document.querySelector('[data-session-list] [data-queue-item] [data-row-title]')?.getBoundingClientRect().left ?? -1),
          queued: document.querySelectorAll('[data-session-list] [data-queue-item]').length,
        })`,
      )) as string,
    ) as { tiles: number; session: number; queue: number; queued: number };
    if (rows.tiles > 0) return `${rows.tiles} sidebar rows still show a project tile`;
    if (rows.queued > 0 && rows.queue !== rows.session) return `queued titles start at ${rows.queue}px, sessions at ${rows.session}px`;
    await deps.shot('minimal-layout.png');
    return `ok: one-line rows (Needs you dot, bold title, the arc), no project tiles${rows.queued ? `, queued titles in line at ${rows.queue}px` : ' (no queued prompts in the list)'}, no counts on the rail, the box says "${got.summary}"`;
  } finally {
    deps.host(ids.waiting, folder.path, 'closed');
    deps.host(ids.working, folder.path, 'closed');
    folder.remove();
    deps.update({ minimalMode: was });
    await settle(win);
  }
}

/**
 * minimal: theme. Settings › Theme has three cards: Seshboard, Black and white, and Black and white, light. The two
 * Black and white cards pick the theme in dark (#111111) and in light (#ffffff); Seshboard goes back to the colour theme.
 */
export async function runMinimalThemeStep(win: BrowserWindow, deps: MinimalSmoke): Promise<string> {
  const was = { themeId: deps.prefs().themeId, colorScheme: deps.prefs().colorScheme };
  const bg = `getComputedStyle(document.documentElement).getPropertyValue('--sb-bg').trim()`;
  const card = (value: string) => `document.querySelector('[data-appearance-card="${value}"]')`;
  const openTheme = async () => {
    if (!(await js(win, `!!document.querySelector('[data-settings]')`))) await js(win, `document.querySelector('[data-open-settings]')?.click()`);
    if (!(await waitInPage(win, `!!document.querySelector('[data-settings]')`, 3_000))) return false;
    await js(win, `document.querySelector('[data-settings-section="theme"]').click()`);
    return waitInPage(win, `!!${card('bw-dark')}`, 3_000);
  };
  try {
    if (!(await openTheme())) return 'Settings › Theme has no Black and white card';
    const cards = await js(win, `[...document.querySelectorAll('[data-appearance-card]')].map((c) => c.dataset.appearanceCard).join(',')`);
    if (cards !== 'seshboard,bw-dark,bw-light') return `the theme cards are ${String(cards)}`;
    if (!(await js(win, `!!document.querySelector('[data-theme-picker]') && !document.querySelector('[data-theme-card="black-and-white"]')`))) return 'with Seshboard picked, its themes do not show (or list Black and white)';
    const seen: string[] = [];
    for (const [value, scheme, want] of [['bw-dark', 'dark', '#111111'], ['bw-light', 'light', '#ffffff']] as const) {
      if (!(await openTheme())) return 'Settings › Theme did not open again';
      await js(win, `${card(value)}.click()`);
      if (!(await waitInPage(win, `document.documentElement.hasAttribute('data-monochrome') && ${bg} === '${want}' && !!${card(value)}?.dataset.appearanceSelected`, 3_000))) return `${value} did not apply (canvas ${String(await js(win, bg))})`;
      if (deps.prefs().colorScheme !== scheme) return `${value} did not set ${scheme}`;
      if (await js(win, `!!document.querySelector('[data-theme-picker]') || !!document.querySelector('[data-color-scheme]')`)) return 'the Seshboard themes or the Light or dark control still show with Black and white picked';
      // The pictures show the session, with its sidebar, prompts and rail of tools.
      await js(win, `document.querySelector('[data-close-settings]')?.click()`);
      await waitInPage(win, `!document.querySelector('[data-settings]')`, 2_000);
      seen.push(`${scheme} ${want}`);
      await deps.shot(`minimal-theme-${scheme}.png`);
    }
    if (!(await openTheme())) return 'Settings › Theme did not open again';
    await js(win, `${card('seshboard')}.click()`);
    if (!(await waitInPage(win, `!document.documentElement.hasAttribute('data-monochrome') && !!document.querySelector('[data-theme-picker]')`, 3_000))) return 'Seshboard did not bring the colour themes back';
    if (deps.prefs().themeId !== was.themeId && was.themeId !== 'black-and-white') return `Seshboard picked ${deps.prefs().themeId}, not the last colour theme ${was.themeId}`;
    return `ok: three cards, ${seen.join(', ')}, Seshboard back to ${deps.prefs().themeId}`;
  } finally {
    deps.update({ themeId: was.themeId, colorScheme: was.colorScheme });
    await js(win, `document.querySelector('[data-close-settings]')?.click()`);
    await settle(win);
  }
}

/** The colours the code blocks in the current session use, as one list (each distinct once). */
const CODE_COLOURS = `[...new Set([...document.querySelectorAll('[data-current-session] .shiki span')].map((s) => getComputedStyle(s).color))]`;

/**
 * minimal: code highlighting. Off: code blocks use at most two colours (text, and faint comments), and a diff in
 * Changes strikes removed lines through and puts added lines in bold. On again: the syntax colours come back.
 */
export async function runMinimalCodeHighlightingStep(win: BrowserWindow, deps: MinimalSmoke): Promise<string> {
  const was = deps.prefs().codeHighlighting;
  let changesOpened = false;
  try {
    // The demo session's reply has a code block; Shiki highlights it once it has loaded.
    await waitInPage(win, `${CODE_COLOURS}.length > 2`, 5_000);
    const before = (await js(win, CODE_COLOURS)) as string[];
    deps.update({ codeHighlighting: false });
    if (!(await waitInPage(win, `document.documentElement.hasAttribute('data-code-plain')`, 2_000))) return 'turning Code highlighting off did not reach the page';
    if (before.length > 2 && !(await waitInPage(win, `${CODE_COLOURS}.length <= 2`, 5_000))) return `code blocks still use ${String(((await js(win, CODE_COLOURS)) as string[]).length)} colours`;
    if (!(await waitInPage(win, `!!document.querySelector('[data-current-session] [data-toggle-changes]')`, 5_000))) return 'no Changes button on the session';
    if (!(await js(win, `!!document.querySelector('[data-current-session] [data-changes-panel]')`))) {
      await js(win, `document.querySelector('[data-current-session] [data-toggle-changes]').click()`);
      changesOpened = true;
    }
    if (!(await waitInPage(win, `!!document.querySelector('[data-changed-file]')`, 5_000))) return 'ok: skipped the diff, the session has no changed files';
    await js(win, `document.querySelector('[data-file-toggle]').click()`);
    if (!(await waitInPage(win, `!!document.querySelector('[data-file-diff] [data-diff-kind="add"], [data-file-diff] [data-diff-kind="del"]')`, 5_000))) return 'the diff did not load';
    const lines = JSON.parse(
      (await js(
        win,
        `JSON.stringify({
          del: [...document.querySelectorAll('[data-file-diff] [data-diff-kind="del"] > :last-child')].map((el) => getComputedStyle(el).textDecorationLine),
          add: [...document.querySelectorAll('[data-file-diff] [data-diff-kind="add"] > :last-child')].map((el) => getComputedStyle(el).fontWeight),
        })`,
      )) as string,
    ) as { del: string[]; add: string[] };
    if (lines.del.some((d) => !d.includes('line-through'))) return `removed lines are not struck through (${lines.del.join(', ')})`;
    if (lines.add.some((w) => w !== '600')) return `added lines are not bold (${lines.add.join(', ')})`;
    // The diff's code: in one colour while off (the lines are highlighted with the plain theme), in colours once on.
    const diffColours = `[...new Set([...document.querySelectorAll('[data-file-diff] .shiki span')].map((s) => getComputedStyle(s).color))]`;
    if (!(await waitInPage(win, `${diffColours}.length > 0 && ${diffColours}.length <= 2`, 5_000))) return `the diff's code is not in one colour with Code highlighting off (${String(((await js(win, diffColours)) as string[]).length)} colours)`;
    await deps.shot('minimal-code-plain.png');
    deps.update({ codeHighlighting: true });
    if (!(await waitInPage(win, `!document.documentElement.hasAttribute('data-code-plain')`, 2_000))) return 'turning Code highlighting on again did not reach the page';
    if (!(await waitInPage(win, `${diffColours}.length > 2`, 5_000))) return `the diff's code has no syntax colours with Code highlighting on (${String(((await js(win, diffColours)) as string[]).length)} colours)`;
    await deps.shot('minimal-code-colours.png');
    if (before.length > 2 && !(await waitInPage(win, `${CODE_COLOURS}.length > 2`, 5_000))) return 'the syntax colours did not come back';
    return `ok: code in ${before.length > 2 ? `one colour (was ${before.length})` : 'plain text (no highlighted code to check)'}, ${lines.del.length} removed lines struck through, ${lines.add.length} added in bold, the diff's code in one colour, then in colour again`;
  } finally {
    deps.update({ codeHighlighting: was });
    if (changesOpened) await js(win, `document.querySelector('[data-current-session] [data-toggle-changes]')?.click()`);
    await settle(win);
  }
}

/** minimal: settings. Settings › Theme has the three switches (role=switch, aria-checked) and the Black and white card. */
export async function runMinimalSettingsStep(win: BrowserWindow, deps: MinimalSmoke): Promise<string> {
  try {
    await js(win, `document.querySelector('[data-open-settings]')?.click()`);
    if (!(await waitInPage(win, `!!document.querySelector('[data-settings]')`, 3_000))) return 'Settings did not open';
    await js(win, `document.querySelector('[data-settings-section="theme"]').click()`);
    if (!(await waitInPage(win, `!!document.querySelector('[data-settings-page="theme"] [data-appearance-card="bw-dark"]')`, 3_000))) return 'Settings › Theme has no Black and white card';
    const switches = JSON.parse(
      (await js(
        win,
        `JSON.stringify(['minimal-mode', 'code-highlighting', 'project-colors'].map((name) => {
          const el = document.querySelector('[data-settings-page="theme"] [data-' + name + ']');
          return el ? { name, role: el.getAttribute('role'), checked: el.getAttribute('aria-checked'), top: el.getBoundingClientRect().top } : { name };
        }))`,
      )) as string,
    ) as Array<{ name: string; role?: string; checked?: string; top?: number }>;
    const missing = switches.filter((s) => s.role !== 'switch' || (s.checked !== 'true' && s.checked !== 'false'));
    if (missing.length) return `not a switch with aria-checked: ${missing.map((s) => s.name).join(', ')}`;
    const order = await js(
      win,
      `(() => { const top = (sel) => document.querySelector('[data-settings-page="theme"] ' + sel)?.getBoundingClientRect().top ?? -1; return [top('[data-minimal-mode]'), top('[data-appearance-card]'), top('[data-color-scheme]'), top('[data-code-highlighting]'), top('[data-project-colors]')].every((t, i, all) => t >= 0 && (i === 0 || t > all[i - 1])); })()`,
    );
    if (!order) return `Settings › Theme is not in order: Minimal mode, Theme, Appearance, Code highlighting, Project colours (${String(await js(win, `['[data-minimal-mode]', '[data-appearance-card]', '[data-color-scheme]', '[data-code-highlighting]', '[data-project-colors]'].map((sel) => Math.round(document.querySelector('[data-settings-page="theme"] ' + sel)?.getBoundingClientRect().top ?? -1)).join(', ')`))})`;
    await deps.shot('minimal-settings.png');
    return `ok: ${switches.map((s) => `${s.name} ${s.checked}`).join(', ')}, and the Black and white card`;
  } finally {
    await js(win, `document.querySelector('[data-close-settings]')?.click()`);
    await settle(win);
  }
}

/**
 * In the page: every field in view on the open Settings page (inputs and text areas, and dropdowns), each with its
 * edge's colour and its contrast against the surface behind it (the first ancestor with a background).
 */
const FIELDS_IN_VIEW = `(() => {
  // rgb()/rgba() in 0 to 255, or color(srgb …) in 0 to 1 (what color-mix gives).
  const rgb = (c) => { const v = (c.match(/[\\d.]+/g) || []).map(Number); return c.startsWith('color(') ? v.map((x, i) => (i < 3 ? x * 255 : x)) : v; };
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const surface = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; const v = rgb(c); if (v.length === 3 || (v.length === 4 && v[3] > 0.95)) return v.slice(0, 3); } return [255, 255, 255]; };
  return JSON.stringify([...document.querySelectorAll('[data-settings] .field')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
    const css = getComputedStyle(el);
    const edge = rgb(css.borderTopColor);
    return { kind: el.tagName.toLowerCase() === 'button' ? 'dropdown' : el.tagName.toLowerCase(), width: css.borderTopWidth, edge: css.borderTopColor, contrast: edge.length === 4 && edge[3] === 0 ? 0 : Math.round(ratio(edge.slice(0, 3), surface(el)) * 100) / 100 };
  }));
})()`;

type FieldSeen = { kind: string; width: string; edge: string; contrast: number };

/** Opens Settings on a section and lists its fields in view. */
async function fieldsOn(win: BrowserWindow, section: string): Promise<FieldSeen[]> {
  if (!(await js(win, `!!document.querySelector('[data-settings]')`))) await js(win, `document.querySelector('[data-open-settings]')?.click()`);
  await waitInPage(win, `!!document.querySelector('[data-settings-section="${section}"]')`, 3_000);
  await js(win, `document.querySelector('[data-settings-section="${section}"]').click()`);
  await waitInPage(win, `!!document.querySelector('[data-settings-page="${section}"]')`, 3_000);
  await settle(win);
  return JSON.parse((await js(win, FIELDS_IN_VIEW)) as string) as FieldSeen[];
}

/** The pages with fields that are there in every profile: General (the global model), Usage (the currency) and Remote (a link field). */
const FIELD_PAGES = ['general', 'usage', 'remote'];

/** Checks the fields of FIELD_PAGES in the current theme: each has a 1px edge at 3:1 against its surface. */
async function checkFields(win: BrowserWindow, where: string): Promise<{ problem: string | null; seen: number; kinds: Set<string> }> {
  // The pointer away from every field, so none shows its hover edge.
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  let seen = 0;
  const kinds = new Set<string>();
  for (const page of FIELD_PAGES) {
    for (const field of await fieldsOn(win, page)) {
      seen++;
      kinds.add(field.kind);
      if (field.width !== '1px' || field.contrast < 3) return { problem: `${where}, Settings › ${page}: a ${field.kind} has its edge at ${field.contrast}:1 (${field.edge}, ${field.width})`, seen, kinds };
    }
  }
  return { problem: seen ? null : `${where}: no fields on ${FIELD_PAGES.join(', ')}`, seen, kinds };
}

/** fields: edge. In Demo Time and Black and white, light and dark, every field on the Settings pages has a 3:1 edge. */
export async function runFieldsEdgeStep(win: BrowserWindow, deps: MinimalSmoke): Promise<string> {
  const was = { themeId: deps.prefs().themeId, colorScheme: deps.prefs().colorScheme, minimalMode: deps.prefs().minimalMode };
  try {
    deps.update({ minimalMode: false });
    const notes: string[] = [];
    for (const themeId of ['demo-time', 'black-and-white']) {
      for (const scheme of ['light', 'dark'] as const) {
        deps.update({ themeId });
        if (!(await deps.setScheme(scheme))) return `${scheme} did not apply`;
        const { problem, seen, kinds } = await checkFields(win, `${themeId} ${scheme}`);
        if (problem) return problem;
        if (!kinds.has('dropdown') || !(kinds.has('input') || kinds.has('textarea'))) return `${themeId} ${scheme}: found only ${[...kinds].join(', ')}`;
        notes.push(`${themeId} ${scheme} ${seen}`);
      }
    }
    return `ok: every field's edge at 3:1 or more (${notes.join(', ')} fields)`;
  } finally {
    deps.update(was);
    await js(win, `document.querySelector('[data-close-settings]')?.click()`);
    await settle(win);
  }
}

/**
 * minimal: fields. With Minimal mode on, the same edges stay, and a field clicked with the mouse shows its focus in the
 * accent ink. Pictures in light and dark.
 */
export async function runMinimalFieldsStep(win: BrowserWindow, deps: MinimalSmoke): Promise<string> {
  const was = { themeId: deps.prefs().themeId, colorScheme: deps.prefs().colorScheme, minimalMode: deps.prefs().minimalMode };
  try {
    deps.update({ minimalMode: true, themeId: 'black-and-white' });
    if (!(await waitInPage(win, MINIMAL_ON, 2_000))) return 'Minimal mode did not turn on';
    const notes: string[] = [];
    for (const scheme of ['light', 'dark'] as const) {
      if (!(await deps.setScheme(scheme))) return `${scheme} did not apply`;
      const { problem, seen } = await checkFields(win, `Minimal mode, ${scheme}`);
      if (problem) return problem;
      // A click (not Tab) on the Remote page's text field: its edge turns to the accent ink.
      const input = `[...document.querySelectorAll('[data-settings] input.field')].find((el) => el.getBoundingClientRect().width > 0)`;
      const box = (await js(win, `(() => { const el = ${input}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) }; })()`)) as { x: number; y: number } | null;
      if (!box) return `Minimal mode, ${scheme}: no text field to click`;
      win.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      const focused = `(() => { const el = document.activeElement; if (!el?.matches('input.field')) return false; const probe = document.createElement('div'); probe.style.color = 'var(--sb-accent-ink)'; document.body.appendChild(probe); const ink = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(el).borderTopColor === ink; })()`;
      if (!(await waitInPage(win, focused, 2_000))) return `Minimal mode, ${scheme}: a clicked field shows no focus (border ${String(await js(win, `getComputedStyle(document.activeElement).borderTopColor`))})`;
      await deps.shot(`minimal-fields-${scheme}.png`);
      await js(win, `document.activeElement?.blur()`);
      notes.push(`${scheme} ${seen} fields`);
    }
    return `ok: fields keep their edge in Minimal mode (${notes.join(', ')}), a click shows the focus`;
  } finally {
    deps.update(was);
    await js(win, `document.querySelector('[data-close-settings]')?.click()`);
    await settle(win);
  }
}

export { js as minimalJs, MINIMAL_ON };
