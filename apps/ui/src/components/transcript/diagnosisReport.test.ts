import { describe, expect, it } from 'vitest';
import type { TranscriptDiagnosis } from '@seshboard/protocol/client';
import { diagnosisReport, formatBytes } from './diagnosisReport.ts';

describe('diagnosisReport', () => {
  it('formats sizes', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(820_400)).toBe('820 KB');
    expect(formatBytes(1_500_000)).toBe('1.5 MB');
    expect(formatBytes(31_000_000)).toBe('31 MB');
  });

  it('lists the findings, the files and the reader error with its stack', () => {
    const diagnosis: TranscriptDiagnosis = {
      sessionId: 'abc',
      checkedAt: Date.UTC(2026, 9, 9),
      indexedPath: '/c/projects/-repo/abc.jsonl',
      findings: [{ tone: 'error', text: "Claude Code's reader failed: boom" }],
      profiles: [
        {
          profileId: 'default',
          configDir: '/c',
          files: [{ path: '/c/projects/-repo/abc.jsonl', size: 2_000_000, modifiedAt: Date.UTC(2026, 9, 8), lines: 10, badLines: 1, messages: 8, compactions: 2, complete: false }],
          read: null,
          readMs: 12,
          error: 'boom',
          stack: 'Error: boom\n    at read (sdk.mjs:1:1)',
        },
      ],
    };
    const report = diagnosisReport(diagnosis, { title: 'CI fix', version: '0.0.12' });
    expect(report).toContain('Seshboard transcript check (Seshboard 0.0.12)');
    expect(report).toContain('Session: abc (CI fix)');
    expect(report).toContain("- Error: Claude Code's reader failed: boom");
    expect(report).toContain('2.0 MB, modified 2026-10-08T00:00:00.000Z, 10 lines (1 invalid), 8 messages, 2 compactions, last line incomplete');
    expect(report).toContain('Reader failed after 12 ms: boom');
    expect(report).toContain('      at read (sdk.mjs:1:1)');
  });
});
