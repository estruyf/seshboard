import type { BrowserWindow } from 'electron';
import type { PreferencesPatch } from '@seshboard/protocol/bridge';
import { waitInPage } from './pageDriver.ts';

// The smoke steps for the sidebar's View button: grouped by project, a folded project, and compact rows. They only
// change the throwaway profile's preferences and UI state, and put them back.

export interface SidebarGroupSmokeDeps {
  shot(name: string): Promise<void>;
  setPreferences(patch: PreferencesPatch): void;
  /** The preferences as they are, to put back. */
  preferences(): { sidebarGroup: 'state' | 'project'; sidebarStyle: 'large' | 'standard' | 'compact'; sidebarShowDone: boolean };
}

const LIST = '[data-session-list]';
/** The list's rows in order, each as what it is: `p:<key>` for a project's header, `s:<id>:<state>` for a session. */
const ROWS = `[...document.querySelectorAll('${LIST} [data-list-row]')].sort((a, b) => Number(a.dataset.listRow) - Number(b.dataset.listRow)).map((r) => { const p = r.querySelector('[data-sidebar-project]'); if (p) return 'p:' + p.dataset.sidebarProject; const s = r.querySelector('[data-session-id]'); return s ? 's:' + s.dataset.sessionId + ':' + (s.querySelector('[data-state-dot]')?.dataset.stateDot ?? '') : 'x'; })`;

/** Opens the View menu and picks an option by its hook. */
async function pickView(win: BrowserWindow, option: string): Promise<boolean> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js("document.querySelector('[data-sidebar-view]')?.click()");
  if (!(await waitInPage(win, `!!document.querySelector('[data-sidebar-view-option="${option}"]')`, 2_000))) return false;
  await js(`document.querySelector('[data-sidebar-view-option="${option}"]').click()`);
  return true;
}

/**
 * Sidebar group by project: View › Project lists a header per project (`data-sidebar-project`), the button says
 * Project, and a session that needs you sits under the first project.
 */
export async function runSidebarGroupByProjectStep(win: BrowserWindow, deps: SidebarGroupSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const before = deps.preferences();
  try {
    if (!(await js("!!document.querySelector('[data-sidebar-open]')"))) return 'the sidebar is not open';
    if (await js("!!document.querySelector('[data-project-filter]') && !document.querySelector('[data-project-filter]').textContent.includes('All projects')")) return 'ok: skipped, a project is picked in the filter';
    // The View menu as it opens, grouped by state.
    await js("document.querySelector('[data-sidebar-view]')?.click()");
    if (await waitInPage(win, "!!document.querySelector('[data-sidebar-view-option=\"group-project\"]')", 2_000)) await deps.shot('sidebar-view-menu');
    await js("document.querySelector('[data-sidebar-view]')?.click()");
    await waitInPage(win, "!document.querySelector('[data-sidebar-view-option]')", 2_000);
    if (!(await pickView(win, 'group-project'))) return 'the View menu has no Project';
    if (!(await waitInPage(win, `!!document.querySelector('${LIST} [data-sidebar-project]') && document.querySelector('[data-sidebar-view]').dataset.sidebarView === 'project'`, 3_000))) return 'View › Project did not group the list by project';
    const label = (await js("document.querySelector('[data-sidebar-view]').innerText.trim()")) as string;
    if (label !== 'Project') return `the View button says "${label}"`;
    if (await js(`!!document.querySelector('${LIST} [data-session-group="needs-you"], ${LIST} [data-session-group="working"]')`)) return 'the state sections are still listed';
    const rows = (await js(ROWS)) as string[];
    const projects = rows.filter((r) => r.startsWith('p:'));
    // The project a session that needs you sits under: the last header above it.
    const asks = rows.findIndex((r) => r.startsWith('s:') && r.endsWith(':needs-you'));
    let note = 'no session needs you';
    if (asks !== -1) {
      const under = rows.slice(0, asks).filter((r) => r.startsWith('p:')).at(-1);
      if (under !== projects[0]) return `the session that needs you is under ${under}, not the first project ${projects[0]}`;
      note = `the session that needs you under the first project (${projects[0]!.slice(2)})`;
    }
    await deps.shot('sidebar-by-project');
    return `ok: ${projects.length} ${projects.length === 1 ? 'project' : 'projects'}, ${note}`;
  } finally {
    deps.setPreferences({ sidebarGroup: before.sidebarGroup });
  }
}

/**
 * Sidebar fold project: a click on a project's header folds it to one line that says what is in it
 * (`data-sidebar-project-summary`), and a second click brings its rows back.
 */
export async function runSidebarFoldProjectStep(win: BrowserWindow, deps: SidebarGroupSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const before = deps.preferences();
  try {
    deps.setPreferences({ sidebarGroup: 'project' });
    if (!(await waitInPage(win, `!!document.querySelector('${LIST} [data-sidebar-project]')`, 3_000))) return 'ok: skipped, the list shows no projects (a project is picked in the filter?)';
    // A project with sessions that are not open right now: folded, none of its rows stays.
    const selected = (await js(`document.querySelector('${LIST} [aria-current="true"]')?.dataset.sessionId ?? null`)) as string | null;
    const rows = (await js(ROWS)) as string[];
    const under = (key: string) => {
      const at = rows.indexOf(`p:${key}`);
      const out: string[] = [];
      for (const r of rows.slice(at + 1)) {
        if (!r.startsWith('s:')) break;
        out.push(r.split(':')[1]!);
      }
      return out;
    };
    const key = rows.filter((r) => r.startsWith('p:')).map((r) => r.slice(2)).find((k) => under(k).length > 0 && !under(k).includes(selected ?? ''));
    if (!key) return 'ok: skipped, no project with sessions to fold';
    const count = under(key).length;
    const header = `[...document.querySelectorAll('${LIST} [data-sidebar-project]')].find((el) => el.dataset.sidebarProject === ${JSON.stringify(key)})`;
    await js(`${header}.click()`);
    if (!(await waitInPage(win, `${header}?.getAttribute('aria-expanded') === 'false' && ${header}.hasAttribute('data-sidebar-project-folded')`, 2_000))) return `a click did not fold ${key}`;
    const summary = ((await js(`[...document.querySelectorAll('${LIST} [data-sidebar-project-summary]')].find((el) => el.dataset.sidebarProjectSummary === ${JSON.stringify(key)})?.innerText ?? ''`)) as string).replace(/\s+/g, ' ').trim();
    if (!/^(\d+ (needs you|working|to review|open) ?)+$/.test(summary)) return `the folded project says "${summary}"`;
    const left = (await js(`(${ROWS}).filter((r) => r.startsWith('s:') && ${JSON.stringify(under(key))}.includes(r.split(':')[1])).length`)) as number;
    if (left > 0) return `folding ${key} left ${left} of its rows`;
    await deps.shot('sidebar-project-folded');
    await js(`${header}.click()`);
    if (!(await waitInPage(win, `${header}?.getAttribute('aria-expanded') === 'true' && (${ROWS}).filter((r) => r.startsWith('s:') && ${JSON.stringify(under(key))}.includes(r.split(':')[1])).length === ${count}`, 2_000))) return `unfolding ${key} did not bring its ${count} rows back`;
    // ← and → on the focused header fold and unfold it.
    const press = (keyCode: string) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    };
    await js(`${header}.focus()`);
    press('Left');
    if (!(await waitInPage(win, `${header}?.getAttribute('aria-expanded') === 'false'`, 2_000))) return `← did not fold ${key}`;
    press('Right');
    if (!(await waitInPage(win, `${header}?.getAttribute('aria-expanded') === 'true'`, 2_000))) return `→ did not unfold ${key}`;
    return `ok: folded ${key} to "${summary}", unfolded its ${count} ${count === 1 ? 'row' : 'rows'}, ← → on its header`;
  } finally {
    deps.setPreferences({ sidebarGroup: before.sidebarGroup });
  }
}

/** Sidebar compact: View › Compact rows makes a session row one line, lower than before. */
export async function runSidebarCompactStep(win: BrowserWindow, deps: SidebarGroupSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const before = deps.preferences();
  const height = `(() => { const r = document.querySelector('${LIST} [data-list-row] [data-session-id]')?.closest('[data-list-row]'); return r ? r.getBoundingClientRect().height : 0; })()`;
  try {
    if (before.sidebarStyle === 'compact') deps.setPreferences({ sidebarStyle: 'standard' });
    if (!(await waitInPage(win, `${height} > 40`, 3_000))) return 'ok: skipped, no session row in the list';
    const tall = (await js(height)) as number;
    if (!(await pickView(win, 'compact'))) return 'the View menu has no Compact rows';
    if (!(await waitInPage(win, `${height} > 0 && ${height} < ${tall}`, 3_000))) return `Compact rows kept the rows ${tall}px high`;
    const low = (await js(height)) as number;
    if (await js(`!!document.querySelector('${LIST} [data-session-id] [data-row-review], ${LIST} [data-session-id] [data-row-note]')`)) return 'a compact row still has a second line';
    // Compact and grouped by project, for the picture.
    deps.setPreferences({ sidebarGroup: 'project' });
    await waitInPage(win, `!!document.querySelector('${LIST} [data-sidebar-project]')`, 2_000);
    await deps.shot('sidebar-compact');
    return `ok: rows ${Math.round(tall)}px, then ${Math.round(low)}px with Compact rows`;
  } finally {
    deps.setPreferences({ sidebarStyle: before.sidebarStyle, sidebarGroup: before.sidebarGroup });
  }
}
