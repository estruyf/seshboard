import { useCallback, useEffect, useState } from 'react';
import type { MemoryList, PersonalMemory } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';

/**
 * A project's memory and instruction files, read when shown and again whenever they change (`memory.changed` for this
 * project or the personal folder) or `reload` is called.
 */
export function useMemoryList(root: string | null): { list: MemoryList | null; error: string | null; reload(): void } {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ root: string | null; list: MemoryList | null; error: string | null }>({ root: null, list: null, error: null });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!client || !root) return;
    let cancelled = false;
    client.call('memory.list', { root }).then(
      (list) => !cancelled && setState({ root, list, error: null }),
      (error: Error) => !cancelled && setState({ root, list: null, error: error.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, root, version]);

  useEffect(() => {
    if (!client || !root) return;
    return client.on('memory.changed', (change) => (change.root === root || change.root === null) && reload());
  }, [client, root, reload]);

  // A list of another project (just switched) isn't shown while this one loads.
  return state.root === root ? { list: state.list, error: state.error, reload } : { list: null, error: null, reload };
}

/** A memory's `[[links]]` (resolved, or not written yet) and the memories that link to it. */
export type MemoryLinks = Record<string, { links: Array<{ name: string; target: string | null }>; backlinks: string[] }>;

/** The links between a project's memories and the personal ones (`root` null: personal only), read again on changes. */
export function useMemoryLinks(root: string | null): MemoryLinks {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [links, setLinks] = useState<MemoryLinks>({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.call('memory.links', { root }).then((r) => !cancelled && setLinks(r.links), () => {});
    return () => {
      cancelled = true;
    };
  }, [client, root, version]);
  useEffect(() => {
    if (!client) return;
    return client.on('memory.changed', (change) => (change.root === root || change.root === null) && setVersion((v) => v + 1));
  }, [client, root]);
  return links;
}

/** The personal memory folder, read when shown and again when it changes (`memory.changed` with no project). */
export function usePersonalMemory(): { personal: PersonalMemory | null; error: string | null; reload(): void; set(personal: PersonalMemory): void } {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ personal: PersonalMemory | null; error: string | null }>({ personal: null, error: null });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.call('memory.personal', {}).then(
      (personal) => !cancelled && setState({ personal, error: null }),
      (error: Error) => !cancelled && setState({ personal: null, error: error.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, version]);
  useEffect(() => {
    if (!client) return;
    return client.on('memory.changed', (change) => change.root === null && reload());
  }, [client, reload]);
  return { ...state, reload, set: (personal) => setState({ personal, error: null }) };
}

/**
 * One memory or instruction file's text and when it last changed, read when picked, and again whenever `version`
 * changes (a new listing). `root` null reads from the personal folder.
 */
export function useMemoryFile(root: string | null, path: string | null, version: unknown): { content: string | null; modified: number | null; error: string | null } {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ path: string | null; content: string | null; modified: number | null; error: string | null }>({ path: null, content: null, modified: null, error: null });
  useEffect(() => {
    if (!client || !path) return;
    let cancelled = false;
    client.call('memory.read', { root, path }).then(
      ({ content, modified }) => !cancelled && setState({ path, content, modified, error: null }),
      (error: Error) => !cancelled && setState({ path, content: null, modified: null, error: error.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, root, path, version]);
  return state.path === path ? { content: state.content, modified: state.modified, error: state.error } : { content: null, modified: null, error: null };
}
