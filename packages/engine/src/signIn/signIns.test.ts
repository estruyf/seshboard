import { describe, expect, it } from 'vitest';
import type { SignInState } from '@seshboard/protocol';
import { SignIns } from './signIns.ts';

function make() {
  const changes: SignInState[] = [];
  const signIns = new SignIns({ onChange: (state) => changes.push(state), now: () => 1000 });
  return { signIns, changes };
}

describe('SignIns', () => {
  it('collects the sessions a profile’s login stopped', () => {
    const { signIns, changes } = make();
    signIns.hit('default', 'a', 'OAuth token has expired · Please run /login');
    signIns.hit('default', 'b', null);
    signIns.hit('default', 'a', null);
    expect(signIns.of('default')).toEqual({ profileId: 'default', since: 1000, message: 'OAuth token has expired · Please run /login', sessionIds: ['a', 'b'], terminalId: null });
    expect(signIns.of('work')).toBeNull();
    expect(changes).toHaveLength(3);
  });

  it('follows the Sign in terminal', () => {
    const { signIns } = make();
    signIns.signingIn('default', 't1');
    expect(signIns.of('default')).toBeNull();
    signIns.hit('default', 'a', null);
    signIns.signingIn('default', 't1');
    expect(signIns.of('default')?.terminalId).toBe('t1');
    signIns.signingIn('default', null);
    expect(signIns.of('default')?.terminalId).toBeNull();
  });

  it('hands back the sessions to continue once you signed in', () => {
    const { signIns } = make();
    signIns.hit('default', 'a', null);
    signIns.hit('default', 'b', null);
    signIns.forget('b');
    expect(signIns.signedIn('default')).toEqual(['a']);
    expect(signIns.of('default')).toBeNull();
    expect(signIns.signedIn('default')).toEqual([]);
  });

  it('clears when a turn of the profile gets through', () => {
    const { signIns, changes } = make();
    signIns.ok('default');
    expect(changes).toHaveLength(0);
    signIns.hit('default', 'a', null);
    signIns.ok('default');
    expect(signIns.state()).toEqual({ profiles: [] });
  });
});
