import { describe, expect, it } from 'vitest';
import { THIS_COMPUTER } from './remoteRows.ts';
import { newSessionTarget } from './runOn.ts';

describe('where New session opens', () => {
  const drafts = new Set(['typed']);
  const hasDraft = (id: string) => drafts.has(id);

  it('opens on this computer when asked to', () => {
    expect(newSessionTarget('here', 'typed', hasDraft)).toBe(THIS_COMPUTER);
  });

  it('opens on this computer when the last choice was this computer', () => {
    expect(newSessionTarget('last', THIS_COMPUTER, hasDraft)).toBe(THIS_COMPUTER);
  });

  it('goes back to this computer when nothing was typed for the last one', () => {
    expect(newSessionTarget('last', 'empty', hasDraft)).toBe(THIS_COMPUTER);
  });

  it('stays on the last computer while a prompt typed for it is not sent', () => {
    expect(newSessionTarget('last', 'typed', hasDraft)).toBe('typed');
  });
});
