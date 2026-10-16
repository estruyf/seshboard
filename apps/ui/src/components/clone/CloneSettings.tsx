import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import type { CloneSettings as Settings } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { tildify } from '../../lib/format.ts';
import { useClone } from '../../state/cloneStore.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { Button } from '../ui/Button.tsx';
import { Toggle } from '../ui/Toggle.tsx';

/**
 * Settings › Projects › Clone from GitHub: the switch, and the folder new clones go in. The switch can't be on without
 * a folder, so turning it on first asks for one. Each computer keeps its own (the engine stores it).
 */
export function CloneSettings() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const settings = useClone((s) => s.settings);
  const home = useHomeFolder();
  const [error, setError] = useState<string | null>(null);

  const save = async (change: Partial<Settings>) => {
    if (!client) return;
    setError(null);
    try {
      useClone.getState().setSettings(await client.call('projects.setCloneSettings', change));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /** The system folder dialog; null when it was cancelled. */
  const pick = async () => (await window.switchboard?.pickFolder(settings?.folder ?? home ?? undefined)) ?? null;
  const choose = async () => {
    const folder = await pick();
    if (folder) await save({ folder });
  };
  const toggle = async (enabled: boolean) => {
    if (!enabled || settings?.folder) return save({ enabled });
    const folder = await pick();
    if (folder) await save({ folder, enabled: true });
  };

  return (
    <div className="grid gap-4">
      <Toggle
        label="Clone from GitHub"
        detail="Start a project from a GitHub URL. New session clones it into the folder below, adds it to your projects and runs your first prompt there."
        checked={settings?.enabled ?? false}
        attr="data-clone-enabled"
        onChange={(enabled) => void toggle(enabled)}
      />
      <div className="flex items-center justify-between gap-4" data-setting-row>
        <span className="min-w-0">
          <span className="block text-ui">Clone into</span>
          <span className={`block truncate text-meta ${settings?.folder ? 'font-mono text-text' : 'text-muted'}`} data-clone-folder-path={settings?.folder ?? ''}>
            {settings?.folder ? tildify(settings.folder, home) : 'The folder new projects go in, such as ~/Developer.'}
          </span>
        </span>
        <Button icon={<FolderOpen size={13} aria-hidden />} onClick={() => void choose()} disabled={!client} className="shrink-0" data-clone-folder-choose>
          Choose…
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-ui text-error">
          {error}
        </p>
      )}
      <p className="text-meta text-muted">
        A cloned repository can bring its own hooks, MCP servers and permission rules. Before its first session, Switchboard lists them and asks.
      </p>
    </div>
  );
}
