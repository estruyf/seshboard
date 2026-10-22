import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { addedProjects, baseOrder } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toast } from '../../state/toastStore.ts';

/**
 * Your projects in their saved order (the one the sidebar and New session use), and `save` to change it. A new order
 * shows at once and is sent with one `projects.reorder`; the list keeps showing it until the engine's list catches
 * up, so quick moves build on each other. If saving fails, the list goes back to what was saved, with a toast.
 */
export function useProjectOrder() {
  const projects = useProjects((s) => s.projects);
  const reload = useProjects((s) => s.reload);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const saved = useMemo(() => addedProjects(projects), [projects]);
  const [pending, setPending] = useState<string[] | null>(null);
  // The same order for `save`, which can run twice before a render (two quick ⌥⇧↓).
  const pendingRef = useRef<string[] | null>(null);

  useEffect(() => {
    const shown = saved.map((p) => p.root).join('\n');
    if (pendingRef.current?.join('\n') === shown) {
      pendingRef.current = null;
      setPending(null);
    }
  }, [saved]);

  const list = useMemo<ProjectInfo[]>(() => {
    const order = baseOrder(pending, saved.map((p) => p.root));
    const byRoot = new Map(saved.map((p) => [p.root, p]));
    return order.map((root) => byRoot.get(root)!);
  }, [pending, saved]);

  /** The order to build the next move on: one still on its way, else the saved one. */
  const current = useCallback(() => baseOrder(pendingRef.current, saved.map((p) => p.root)), [saved]);

  const save = useCallback(
    async (roots: string[]) => {
      if (!client) return;
      pendingRef.current = roots;
      setPending(roots);
      try {
        await client.call('projects.reorder', { roots });
      } catch (e) {
        pendingRef.current = null;
        setPending(null);
        toast(`Couldn't save the order: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error', data: { 'data-project-order-error': true } });
      }
      reload();
    },
    [client, reload],
  );

  return { list, current, save };
}
