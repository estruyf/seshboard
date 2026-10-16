import { Puzzle, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BUILTIN_PROFILE_ID, type ModInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { tildify } from '../../lib/format.ts';
import { useHome } from '../../state/homeStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useMods } from '../../state/modsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Notice } from '../ui/Notice.tsx';
import { Switch, Toggle } from '../ui/Toggle.tsx';
import { screenedBy } from './modFooter.ts';
import { modShown, withModShown } from './modVisibility.ts';

/** Where a mod comes from, as its row says it. */
function sourceLine(mod: ModInfo, profileName: string, home: string | null): string {
  if (mod.source === 'managed') return 'Managed by your organization';
  if (mod.source === 'marketplace') return `${profileName} profile · marketplace`;
  return mod.path ? `${profileName} profile · ${tildify(mod.path, home)}` : `${profileName} profile`;
}

/**
 * Settings › Mods: Show mods (the main switch), then each mod Claude Code loads, per profile, with a switch that shows
 * or hides its UI here. The switches never turn a mod off: Claude Code still runs it.
 */
export function ModsSettings() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  const profiles = useProfiles((s) => s.profiles);
  const home = useHome((s) => s.home);
  const sessions = useMods((s) => s.sessions);
  const selectedId = useSessions((s) => s.selectedId);
  const selectedRunning = useHosts((s) => (selectedId ? s.hosts.get(selectedId)?.state : undefined));
  const [mods, setMods] = useState<ModInfo[] | null>(null);

  useEffect(() => {
    if (!client) return;
    void client.call('mods.list', {}).then(({ mods }) => setMods(mods), () => setMods([]));
  }, [client]);

  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? (id === BUILTIN_PROFILE_ID ? 'Personal' : id);
  // The session in front runs a Claude Code that can't draw mods.
  const selected = selectedId ? sessions.get(selectedId) : undefined;
  const unsupported = selectedId && selectedRunning && selectedRunning !== 'starting' && selectedRunning !== 'closed' && selectedRunning !== 'error' && selected && !selected.state.supported;
  // Prompt screening happens in Claude Code, so it goes on with Show mods off.
  const screening = [...sessions.values()].filter((m) => m.state.promptsScreened);
  const checker = screenedBy([...new Set(screening.flatMap((m) => m.state.plugins))]);

  return (
    <div className="grid gap-3" data-mods-settings>
      <Toggle
        label="Show mods"
        detail="Bands, panes, statuses, toasts and replaced views from your plugins. Off, sessions use only Switchboard's own views."
        checked={prefs.showMods}
        attr="data-show-mods"
        onChange={(showMods) => update({ showMods })}
      />
      {unsupported && (
        <Notice tone="caution" data-mods-unsupported>
          Needs Claude Code with mod support. This session's version doesn't draw mods.
        </Notice>
      )}
      {mods === null ? null : mods.length === 0 ? (
        <Notice data-mods-empty>No mods in your enabled plugins. A mod is a plugin whose hooks name a module.</Notice>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-card" data-mods-list>
          {mods.map((mod) => {
            const shown = modShown({ showMods: true, hiddenMods: prefs.hiddenMods }, mod.profileId, mod.name);
            return (
              <li key={`${mod.profileId}:${mod.name}`} className={`flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 ${prefs.showMods ? '' : 'opacity-60'}`} data-setting-row data-mod-row={mod.name}>
                <Puzzle size={15} className="shrink-0 text-muted" aria-hidden />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-ui text-text">{mod.name}</span>
                  <span className="truncate text-meta text-muted">{sourceLine(mod, profileName(mod.profileId), home)}</span>
                </span>
                <Switch
                  checked={shown}
                  disabled={!prefs.showMods}
                  label={`Show ${mod.name}'s UI`}
                  onChange={(on) => update({ hiddenMods: withModShown(prefs.hiddenMods, mod.profileId, mod.name, on) })}
                  dataAttrs={{ 'data-mod-setting-switch': mod.name }}
                />
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-meta text-muted">A mod's switch only shows or hides its UI here. To turn a mod off, disable its plugin in Claude Code.</p>
      {!prefs.showMods && screening.length > 0 && (
        <p className="flex items-start gap-1.5 text-meta text-muted" data-mods-screening-note>
          <ShieldCheck size={13} className="mt-px shrink-0 text-ok" aria-hidden />
          {checker === 'a mod' ? 'A mod' : checker} still checks your prompts. That happens in Claude Code, so the shield stays in the message box.
        </p>
      )}
    </div>
  );
}
