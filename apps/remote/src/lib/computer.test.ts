import { describe, expect, it } from 'vitest';
import { computerRowLine, otherLine, pairedAgo, stateLine, upFor } from './computer.ts';

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

describe('the other computers in the menu', () => {
  it('says how many sessions need you there, else why it isn\'t connected', () => {
    expect(otherLine({ kind: 'connected', since: NOW }, 0)).toBe('');
    expect(otherLine({ kind: 'connected', since: NOW }, 1)).toBe('1 needs you');
    expect(otherLine({ kind: 'connected', since: NOW }, 3)).toBe('3 need you');
    expect(otherLine({ kind: 'connecting', attempt: 0 }, 2)).toBe('Connecting…');
    expect(otherLine({ kind: 'offline', retryAt: null }, 2)).toBe('Offline');
    expect(otherLine({ kind: 'disconnected' }, 0)).toBe('Disconnected');
  });
});

describe('the computer row', () => {
  it('says the state in a few words, with the colour of its dot', () => {
    expect(computerRowLine({ kind: 'connected', since: NOW })).toEqual({ text: 'Connected · encrypted', tone: 'ok' });
    expect(computerRowLine({ kind: 'connecting', attempt: 0 })).toEqual({ text: 'Connecting…', tone: 'caution' });
    expect(computerRowLine({ kind: 'connecting', attempt: 3 })).toEqual({ text: 'Reconnecting…', tone: 'caution' });
    expect(computerRowLine({ kind: 'offline', retryAt: NOW + 4_000 })).toEqual({ text: 'Reconnecting…', tone: 'caution' });
    expect(computerRowLine({ kind: 'offline', retryAt: null })).toEqual({ text: 'Offline', tone: 'error' });
    expect(computerRowLine({ kind: 'disconnected' })).toEqual({ text: 'Disconnected', tone: 'faint' });
    expect(computerRowLine({ kind: 'unpaired' })).toEqual({ text: 'Pair again', tone: 'error' });
  });

  it('can leave out encrypted, for Settings', () => {
    expect(computerRowLine({ kind: 'connected', since: NOW }, { encrypted: false }).text).toBe('Connected');
    expect(computerRowLine({ kind: 'disconnected' }, { encrypted: false }).text).toBe('Disconnected');
  });
});

describe('when it was paired', () => {
  it('says today, yesterday or how many days ago', () => {
    expect(pairedAgo(NOW - 5 * MINUTE, NOW)).toBe('paired today');
    expect(pairedAgo(NOW - 30 * 60 * MINUTE, NOW)).toBe('paired yesterday');
    expect(pairedAgo(NOW - 3 * 24 * 60 * MINUTE, NOW)).toBe('paired 3 days ago');
    expect(pairedAgo(NOW + MINUTE, NOW)).toBe('paired today');
  });
});
