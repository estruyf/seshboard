import { describe, expect, it } from 'vitest';
import { isMine } from './computerMine.ts';

describe('isMine', () => {
  const computer = { mineHere: ['started-here', 'sent-to-from-here'] };

  it('is a session this computer started there, or one it acted on from here', () => {
    expect(isMine('started-here', null, computer)).toBe(true);
    expect(isMine('sent-to-from-here', null, computer)).toBe(true);
  });

  it('is a sub-session of one of those', () => {
    expect(isMine('agent', 'started-here', computer)).toBe(true);
  });

  it('is not anyone else’s', () => {
    expect(isMine('theirs', null, computer)).toBe(false);
    expect(isMine('their-agent', 'theirs', computer)).toBe(false);
    expect(isMine('theirs', undefined, { mineHere: [] })).toBe(false);
  });
});
