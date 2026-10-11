import { useEffect, useMemo } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { guessHome } from '../../lib/format.ts';
import { useMemoryView } from '../../state/memoryStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import type { MemoryFolders } from '../transcript/memoryWrites.ts';

/** Reads where the personal folder is (once, and again when it changes), for `useKnownMemoryFolders`. Call it once per view. */
export function useMemoryFoldersSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const personalDir = useMemoryView((s) => s.personalDir);
  useEffect(() => {
    if (!client || personalDir) return;
    void client.call('memory.personal', {}).then((p) => useMemoryView.setState({ personalDir: p.dir }), () => {});
  }, [client, personalDir]);
  useEffect(() => {
    if (!client) return;
    // The folder can be changed in Settings.
    return client.on('memory.changed', (change) => {
      if (change.root === null) void client.call('memory.personal', {}).then((p) => useMemoryView.setState({ personalDir: p.dir }), () => {});
    });
  }, [client]);
}

/** Where memory lives as far as the window knows: every profile's config folder and the personal folder. */
export function useKnownMemoryFolders(): MemoryFolders {
  const personalDir = useMemoryView((s) => s.personalDir);
  const profiles = useProfiles((s) => s.profiles);
  const projects = useProjects((s) => s.projects);
  const home = useMemo(() => guessHome(projects.keys()), [projects]);
  return useMemo(() => ({ home, configDirs: profiles.map((p) => p.configDir), personalDir }), [home, profiles, personalDir]);
}
