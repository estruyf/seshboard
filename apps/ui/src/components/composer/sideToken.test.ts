import { describe, expect, it } from 'vitest';
import { joinSideToken, SIDE_DESCRIPTION, sideKey, splitSideToken, withSideCommand } from './sideToken.ts';

const item = (name: string) => ({ value: `/${name}`, label: `/${name}`, detail: '' });
const btw = { value: '/btw', label: '/btw', detail: SIDE_DESCRIPTION };
const names = (items: Array<{ value: string }>) => items.map((i) => i.value);
const key = (k: string, mods: Partial<{ metaKey: boolean; altKey: boolean; ctrlKey: boolean }> = {}) => ({ key: k, metaKey: false, altKey: false, ctrlKey: false, ...mods });

describe('the /btw token', () => {
  it('appears once a space follows /btw at the start, and a draft keeps it', () => {
    expect(splitSideToken('/btw which flag?')).toEqual({ token: true, question: 'which flag?' });
    expect(splitSideToken('/btw ')).toEqual({ token: true, question: '' });
    expect(splitSideToken('/btw')).toEqual({ token: false, question: '/btw' });
    expect(splitSideToken('/btwx hi')).toEqual({ token: false, question: '/btwx hi' });
    expect(splitSideToken('ask /btw later')).toEqual({ token: false, question: 'ask /btw later' });
    expect(joinSideToken(true, 'which flag?')).toBe('/btw which flag?');
    expect(splitSideToken(joinSideToken(true, ''))).toEqual({ token: true, question: '' });
    expect(joinSideToken(false, 'hi')).toBe('hi');
  });

  it('goes with Backspace right after it, and only then', () => {
    const at = (selectionStart: number, selectionEnd = selectionStart) => ({ token: true, selectionStart, selectionEnd, sends: false });
    expect(sideKey(key('Backspace'), at(0))).toBe('untoken');
    expect(sideKey(key('Backspace'), at(3))).toBeNull();
    // A selection from the start deletes the selection, not the token.
    expect(sideKey(key('Backspace'), at(0, 4))).toBeNull();
    expect(sideKey(key('Backspace', { altKey: true }), at(0))).toBeNull();
    expect(sideKey(key('Backspace'), { ...at(0), token: false })).toBeNull();
  });

  it('asks on every key that would send, so a side question never queues, steers or stops Claude', () => {
    const box = { token: true, selectionStart: 5, selectionEnd: 5, sends: true };
    // Enter (queue or steer while Claude works), ⌥↵ (the other one) and ⌘⇧↵ (send now) all ask.
    expect(sideKey(key('Enter'), box)).toBe('ask');
    expect(sideKey(key('Enter', { altKey: true }), box)).toBe('ask');
    expect(sideKey(key('Enter', { metaKey: true }), box)).toBe('ask');
    expect(sideKey(key('a'), { ...box, sends: false })).toBeNull();
    // Without the token, sending is left to the message box.
    expect(sideKey(key('Enter'), { ...box, token: false })).toBeNull();
  });
});

describe('/btw in the slash menu', () => {
  const commands = [item('bug'), item('batch'), item('review')];

  it('is the first match for /b', () => {
    expect(names(withSideCommand(commands, 'b', btw))).toEqual(['/btw', '/bug', '/batch', '/review']);
    expect(names(withSideCommand(commands, 'BT', btw))).toEqual(['/btw', '/bug', '/batch', '/review']);
  });

  it('takes its alphabetical place for /, and leaves Claude Code’s own /btw out', () => {
    const sorted = [item('batch'), item('btw'), item('bug'), item('review')];
    expect(names(withSideCommand(sorted, '', btw))).toEqual(['/batch', '/btw', '/bug', '/review']);
    expect(withSideCommand(sorted, '', btw).filter((i) => i.value === '/btw')).toEqual([btw]);
  });

  it('is left out when the query doesn’t match it', () => {
    expect(names(withSideCommand(commands, 'rev', btw))).toEqual(['/bug', '/batch', '/review']);
  });
});
