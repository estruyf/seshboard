import { describe, expect, it } from 'vitest';
import { generateKeyPair, newPairingSecret, remoteLinkFragment, type RemoteMessage } from '@switchboard/protocol/remote-client';
import { pastedLink, reconnectDelay, startFrom, type Paired } from './link.ts';
import { appendMessages, applyStream, applyUpdate, editLines, NOT_STREAMING, prependMessages, resultsByCall, toolSummary, visibleMessages } from './transcript.ts';

const engine = generateKeyPair().publicKey;
const paired: Paired = { deviceSecret: new Uint8Array(32), enginePublicKey: engine, address: 'https://old.trycloudflare.com', deviceId: 'd1', name: 'Phone', pairedAt: 1 };
const pairLink = (key = engine) => `#${remoteLinkFragment({ kind: 'pair', enginePublicKey: key, secret: newPairingSecret(), address: 'https://new.trycloudflare.com' })}`;
const connectLink = (key = engine) => `#${remoteLinkFragment({ kind: 'connect', enginePublicKey: key, address: 'https://new.trycloudflare.com' })}`;

describe('opening the remote app', () => {
  it('connects to the paired computer without a link, and explains how to pair without one', () => {
    expect(startFrom('', paired)).toEqual({ kind: 'connect', paired });
    expect(startFrom('', null)).toEqual({ kind: 'welcome' });
  });

  it('pairs from a pairing link, and says when that replaces another computer', () => {
    expect(startFrom(pairLink(), null)).toMatchObject({ kind: 'pair', replaces: false, link: { address: 'https://new.trycloudflare.com' } });
    expect(startFrom(pairLink(), paired)).toMatchObject({ kind: 'pair', replaces: false });
    expect(startFrom(pairLink(generateKeyPair().publicKey), paired)).toMatchObject({ kind: 'pair', replaces: true });
  });

  it('moves to the computer\'s new address from a connect link, for that computer only', () => {
    expect(startFrom(connectLink(), paired)).toEqual({ kind: 'connect', paired: { ...paired, address: 'https://new.trycloudflare.com' } });
    expect(startFrom(connectLink(generateKeyPair().publicKey), paired)).toEqual({ kind: 'other-computer' });
    expect(startFrom(connectLink(), null)).toEqual({ kind: 'other-computer' });
  });

  it('ignores a broken link when it is paired', () => {
    expect(startFrom('#nonsense', paired)).toEqual({ kind: 'connect', paired });
    expect(startFrom('#nonsense', null)).toEqual({ kind: 'bad-link' });
  });

  it('takes the link out of what was pasted, a whole link or only its fragment', () => {
    const fragment = pairLink().slice(1);
    expect(pastedLink(`  https://switchboard.struyfconsulting.com/remote/#${fragment}\n`)).toBe(fragment);
    expect(pastedLink(fragment)).toBe(fragment);
    expect(startFrom(pastedLink(`https://x/remote/#${fragment}`), null)).toMatchObject({ kind: 'pair' });
    expect(startFrom(pastedLink('hello'), null)).toEqual({ kind: 'bad-link' });
  });

  it('waits longer between reconnects, up to 30 seconds', () => {
    expect([0, 1, 2, 3].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000]);
    expect(reconnectDelay(20)).toBe(30_000);
  });
});

const msg = (uuid: string, blocks: RemoteMessage['blocks'] = [{ type: 'text', text: uuid }], parentToolUseId: string | null = null): RemoteMessage => ({ uuid, role: 'assistant', timestamp: 1, parentToolUseId, blocks });

describe('the conversation on the phone', () => {
  it('merges pages and updates, each message once', () => {
    const ids = (list: RemoteMessage[]) => list.map((m) => m.uuid);
    expect(ids(appendMessages([msg('a'), msg('b')], [msg('b'), msg('c')]))).toEqual(['a', 'b', 'c']);
    expect(ids(prependMessages([msg('c')], [msg('a'), msg('c')]))).toEqual(['a', 'c']);
    expect(ids(applyUpdate([msg('a')], { sessionId: 's', mode: 'replace', messages: [msg('z')] }))).toEqual(['z']);
  });

  it('follows what Claude is writing', () => {
    const one = applyStream(NOT_STREAMING, { sessionId: 's', kind: 'text', text: 'Hel' });
    expect(applyStream(one, { sessionId: 's', kind: 'text', text: 'lo' })).toEqual({ kind: 'text', text: 'Hello' });
    expect(applyStream(one, { sessionId: 's', kind: 'tool', text: 'Bash' })).toEqual({ kind: 'tool', text: 'Bash' });
    expect(applyStream(one, { sessionId: 's', kind: 'clear', text: '' })).toEqual(NOT_STREAMING);
  });

  it('shows the main conversation, with tool results under their calls', () => {
    const call = msg('a', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' }, truncated: false }]);
    const result = msg('b', [{ type: 'tool_result', toolUseId: 't1', isError: false, text: 'ok', truncated: false }]);
    const sub = msg('c', [{ type: 'text', text: 'inside a subagent' }], 't9');
    expect(visibleMessages([call, result, sub]).map((m) => m.uuid)).toEqual(['a']);
    expect(resultsByCall([call, result]).get('t1')?.text).toBe('ok');
  });

  it('sums up a tool call in one line, and an edit as plain diff lines', () => {
    expect(toolSummary('Bash', { command: 'npm test\nnpm run build' })).toBe('npm test');
    expect(toolSummary('Read', { file_path: '/repo/src/a.ts' })).toBe('/repo/src/a.ts');
    expect(toolSummary('TodoWrite', { todos: [] })).toBe('TodoWrite');
    expect(editLines('Edit', { old_string: 'a', new_string: 'b\nc' })).toEqual([{ kind: '-', text: 'a' }, { kind: '+', text: 'b' }, { kind: '+', text: 'c' }]);
    expect(editLines('Bash', { command: 'x' })).toBeNull();
  });
});
