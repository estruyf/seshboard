import { describe, expect, it } from 'vitest';
import { parsePeerMessage, peerName } from './peerMessage.ts';

const saved =
  'Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/28545.sock" from-name="dev-game-2f" from-mode="prompting">\nPlease don\'t edit versions.ts meanwhile.\n\nFix releases number as patches.\n</cross-session-message>\n\nThis came from another Claude session, not typed by your user.';

describe('parsePeerMessage', () => {
  it('reads the sender and the message, without the line before it and the guidance after it', () => {
    expect(parsePeerMessage(saved)).toEqual({
      from: 'uds:/tmp/cc-socks/28545.sock',
      name: 'dev-game-2f',
      mode: 'prompting',
      text: "Please don't edit versions.ts meanwhile.\n\nFix releases number as patches.",
    });
  });

  it('reads the tag on its own, and a sender without a name', () => {
    const live = '<cross-session-message from="uds:/tmp/a.sock">hi</cross-session-message>';
    expect(parsePeerMessage(live)).toEqual({ from: 'uds:/tmp/a.sock', name: null, mode: null, text: 'hi' });
    expect(peerName(parsePeerMessage(live)!)).toBe('uds:/tmp/a.sock');
    expect(peerName(parsePeerMessage(saved)!)).toBe('dev-game-2f');
  });

  it('leaves other text alone', () => {
    expect(parsePeerMessage('Fix the login')).toBeNull();
    expect(parsePeerMessage('What does <cross-session-message from="x">hi</cross-session-message> mean?')).toBeNull();
    expect(parsePeerMessage('<cross-session-message>no sender</cross-session-message>')).toBeNull();
  });
});
