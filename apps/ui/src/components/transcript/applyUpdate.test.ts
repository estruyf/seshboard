import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '@seshboard/protocol/client';
import { applyTranscriptUpdate } from './applyUpdate.ts';

const msg = (uuid: string): TranscriptMessage => ({ uuid, role: 'user', timestamp: null, parentToolUseId: null, model: null, blocks: [{ type: 'text', text: uuid }] });

describe('applyTranscriptUpdate', () => {
  it('appends, replaces, and splices keeping the messages before the splice as they were', () => {
    const start = [msg('1'), msg('2'), msg('live')];
    expect(applyTranscriptUpdate(start, { mode: 'append', messages: [msg('4')] }).map((m) => m.uuid)).toEqual(['1', '2', 'live', '4']);
    expect(applyTranscriptUpdate(start, { mode: 'replace', messages: [msg('x')] }).map((m) => m.uuid)).toEqual(['x']);
    const spliced = applyTranscriptUpdate(start, { mode: 'splice', at: 2, messages: [msg('file'), msg('live')] });
    expect(spliced.map((m) => m.uuid)).toEqual(['1', '2', 'file', 'live']);
    expect(spliced[0]).toBe(start[0]);
    expect(spliced[1]).toBe(start[1]);
  });
});
