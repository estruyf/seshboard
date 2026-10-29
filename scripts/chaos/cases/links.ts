/** Deep links (the permission rule, links at launch) and project choices across a restart. */
import { sleep } from '../lib/harness.ts';
import { closeAll, goHome, newSessionIn, openLink } from '../lib/ui.ts';
import type { Case } from './types.ts';

const enc = encodeURIComponent;
const NEVER_FROM_A_LINK = ['bypassPermissions', 'auto', 'dontAsk'];

export const linkCases: Record<string, Case> = {
  linkPermissionMode: {
    finding: 'D1',
    mutates: true,
    expect: 'An autostart link never starts a session in Bypass, Auto or Don\'t ask: not from the last-used mode, link parameters, or the project\'s default.',
    async run(c, note) {
      const acme = c.world.acme;
      const globals = await c.rpc('appState.get', { key: 'newSession.defaults' });
      const value = ((globals.result as { value?: Record<string, unknown> } | undefined)?.value ?? {}) as Record<string, unknown>;
      await c.rpc('appState.set', { key: 'newSession.defaults', value: { ...value, permissionMode: 'bypassPermissions' } });
      const links = [
        `seshboard://new-session?cwd=${enc(acme)}&autostart=1&prompt=one`,
        `seshboard://new-session?cwd=${enc(acme)}&autostart=1&prompt=two&mode=bypassPermissions&permissionMode=bypassPermissions&dangerouslySkipPermissions=1`,
      ];
      // A project default is only read when the window loads its projects: set it, then restart.
      await c.rpc('projects.setDefaults', { root: acme, defaults: { permissionMode: 'bypassPermissions' } });
      await c.restart();
      links.push('seshboard://new-session?project=acme-store&autostart=1&prompt=three');
      const modes: string[] = [];
      for (const url of links) {
        await c.calls(true);
        await openLink(c, url);
        await sleep(4_000);
        for (const call of await c.calls()) if (call.method === 'session.create') modes.push(String(call.params.permissionMode));
        await goHome(c);
      }
      note('modes', modes);
      return { ok: modes.length === links.length && !modes.some((m) => NEVER_FROM_A_LINK.includes(m)), saw: modes };
    },
  },

  linksAtLaunch: {
    finding: 'check',
    expect: 'Links that start the app work: New session filled in, an autostart in the default mode, a session opened, a bad link refused with a reason.',
    async run(c, note) {
      const results: boolean[] = [];
      const cases: Array<[string, (s: { newSession: string | null; current: string | null; alerts: string[]; modes: string[] }) => boolean]> = [
        [`seshboard://new-session?prompt=${enc('cold start')}&cwd=${enc(c.world.acme)}`, (s) => s.newSession === 'cold start'],
        [`seshboard://new-session?prompt=${enc('cold autostart')}&cwd=${enc(c.world.acme)}&autostart=1`, (s) => s.modes.join() === 'default'],
        [`seshboard://session/${c.world.sessions.hero}`, (s) => s.current === c.world.sessions.hero],
        ['seshboard://not-a-thing', (s) => s.alerts.some((a) => /Couldn.t open that link/.test(a))],
      ];
      for (const [url, check] of cases) {
        await c.quit();
        c.options.extraArgs = [url];
        await c.launch();
        await sleep(3_000);
        const shown = await c.page.evaluate(() => ({
          newSession: (document.querySelector('[data-new-session-view] [data-composer]') as HTMLTextAreaElement | null)?.value ?? null,
          current: document.querySelector('[data-current-session]')?.getAttribute('data-current-session') ?? null,
          alerts: [...document.querySelectorAll('[role="alert"], [data-toast]')].map((e) => (e as HTMLElement).innerText.slice(0, 120)),
        }));
        const modes = (await c.calls()).filter((x) => x.method === 'session.create').map((x) => String(x.params.permissionMode));
        const ok = check({ ...shown, modes });
        results.push(ok);
        note(url.slice(0, 60), { ok, ...shown, modes });
      }
      c.options.extraArgs = [];
      return { ok: results.every(Boolean), saw: results };
    },
  },

  projectChoicesKept: {
    finding: 'check',
    mutates: true,
    expect: "A project's defaults (Accept edits, Sonnet) and a project action survive a restart, and ⌘N and an autostart link use them.",
    async run(c, note) {
      const acme = c.world.acme;
      await c.rpc('projects.setDefaults', { root: acme, defaults: { permissionMode: 'acceptEdits', model: 'sonnet' } });
      await c.rpc('actions.save', { projectRoot: acme, action: { id: 'chaos-kept', name: 'Kept action', icon: 'play', command: 'echo kept', type: 'shell' } });
      await c.restart();
      const projects = ((await c.rpc('projects.list', {})).result as { projects?: Array<{ root: string; defaults?: { permissionMode?: string; model?: string } }> } | undefined)?.projects ?? [];
      const defaults = projects.find((p) => p.root === acme)?.defaults;
      const actions = (((await c.rpc('actions.list', { projectRoot: acme })).result as { actions?: Array<{ name: string }> } | undefined)?.actions ?? []).map((a) => a.name);
      await newSessionIn(c, 'acme-store');
      await sleep(500);
      const mode = await c.page.locator('[data-new-session-view] [data-chip="mode"] button').first().getAttribute('aria-label').catch(() => null);
      await closeAll(c);
      await goHome(c);
      await c.calls(true);
      await openLink(c, 'seshboard://new-session?project=acme-store&autostart=1&prompt=link');
      await sleep(4_000);
      const created = (await c.calls()).find((x) => x.method === 'session.create')?.params;
      const saw = { defaults, actions, newSessionMode: mode, linkMode: created?.permissionMode, linkModel: created?.model };
      note('after restart', saw);
      const ok = defaults?.permissionMode === 'acceptEdits' && actions.includes('Kept action') && /Accept edits/.test(mode ?? '') && created?.permissionMode === 'acceptEdits' && created?.model === 'sonnet';
      return { ok, saw };
    },
  },
};
