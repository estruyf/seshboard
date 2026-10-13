import { useMemo } from 'react';
import { hostAsLive, isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { sharingCheckout } from './branchMenu.ts';

/**
 * The live sessions (in this app or anywhere else) working in the checkout at `root`, other than `selfId`:
 * their ids, and the folders they work in.
 */
export function useSharingCheckout(root: string, selfId: string | null = null): { ids: string[]; cwds: string[] } {
  const registry = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  return useMemo(() => {
    const live = new Map(registry);
    for (const host of hosts.values()) {
      const asLive = isActiveHost(host) ? hostAsLive(host) : null;
      if (asLive) live.set(host.sessionId, asLive);
    }
    const ids = sharingCheckout(root, selfId ?? '', live.values());
    return { ids, cwds: ids.flatMap((id) => live.get(id)?.cwd ?? []) };
  }, [registry, hosts, root, selfId]);
}
