import { describe, expect, it } from 'vitest';
import { stateLine, upFor } from './computer.ts';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

describe('the computer menu', () => {
  it('says how long the connection has been up', () => {
    expect(upFor(NOW - 20_000, NOW)).toBe('under a minute');
    expect(upFor(NOW - 12 * MINUTE, NOW)).toBe('12m');
    expect(upFor(NOW - 135 * MINUTE, NOW)).toBe('2h');
    expect(upFor(NOW - 50 * 60 * MINUTE, NOW)).toBe('2d');
  });

  it('says the state under the name', () => {
    expect(stateLine({ kind: 'connected', since: NOW - 125 * MINUTE }, NOW)).toBe('Connected for 2h · encrypted');
    expect(stateLine({ kind: 'connecting', attempt: 0 }, NOW)).toBe('Connecting…');
    expect(stateLine({ kind: 'connecting', attempt: 2 }, NOW)).toBe('Reconnecting…');
    expect(stateLine({ kind: 'offline', retryAt: NOW + 4_000 }, NOW)).toBe('Reconnecting…');
    expect(stateLine({ kind: 'offline', retryAt: null }, NOW)).toBe('Offline');
    expect(stateLine({ kind: 'disconnected' }, NOW)).toBe('Disconnected');
  });
});
