import { useEffect } from 'react';
import { create } from 'zustand';
import type { SignInState } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';

/** The Claude profiles whose login stopped working, and the sessions it stopped, as the engine keeps them. */
interface SignInStore {
  state: SignInState;
  set(state: SignInState): void;
}

export const useSignIn = create<SignInStore>()((set) => ({
  state: { profiles: [] },
  set: (state) => set({ state }),
}));

/** Loads the signed-out profiles once per connection and follows changes from every window. */
export function useSignInSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('signIn.changed', (state) => useSignIn.getState().set(state));
    void client.call('signIn.state', {}).then((state) => useSignIn.getState().set(state), () => {});
    return off;
  }, [client]);
}
