import { create } from 'zustand';
import type { RepoBrings } from '@seshboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';

/** A cloned repository the engine won't start Claude Code in until its trust question is answered. */
export interface TrustNeeded {
  root: string;
  brings: RepoBrings;
}

/** The details of a TRUST_NEEDED error (a start in such a repository), or null for any other error. */
export function trustNeededOf(error: unknown): TrustNeeded | null {
  const { code, details } = (error ?? {}) as { code?: unknown; details?: unknown };
  if (code !== 'TRUST_NEEDED' || typeof details !== 'object' || details === null) return null;
  const { root, brings } = details as Partial<TrustNeeded>;
  return typeof root === 'string' && brings ? { root, brings } : null;
}

/** The question on screen (`RepoTrustDialog`, mounted once per window). */
export const useRepoTrust = create<{ request: { brings: RepoBrings; resolve(start: boolean): void } | null }>()(() => ({ request: null }));

/**
 * Asks the trust question for a cloned repository and, on Start anyway, tells the engine, which starts Claude Code
 * there from then on. False when the person cancelled, or another question is open already.
 */
export async function trustRepository(client: EngineClient, needed: TrustNeeded): Promise<boolean> {
  if (useRepoTrust.getState().request) return false;
  const start = await new Promise<boolean>((resolve) =>
    useRepoTrust.setState({
      request: {
        brings: needed.brings,
        resolve: (answer) => {
          useRepoTrust.setState({ request: null });
          resolve(answer);
        },
      },
    }),
  );
  if (start) await client.call('projects.trustClone', { root: needed.root });
  return start;
}
