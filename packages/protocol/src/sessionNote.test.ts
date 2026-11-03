import { describe, expect, it } from 'vitest';
import { cleanNote, SESSION_NOTE_MAX } from './sessionNote.ts';

describe('cleanNote', () => {
  it('keeps one trimmed line, at most the limit, and empty is no note', () => {
    expect(cleanNote('  push after review ')).toBe('push after review');
    expect(cleanNote('waiting\non   Jan')).toBe('waiting on Jan');
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote('x'.repeat(200))).toHaveLength(SESSION_NOTE_MAX);
  });
});
