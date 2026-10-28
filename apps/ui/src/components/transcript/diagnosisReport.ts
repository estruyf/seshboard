import type { TranscriptDiagnosis } from '@seshboard/protocol/client';

/** 1.5 MB, 820 KB, 12 B. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

const TONE_LABEL = { error: 'Error', warn: 'Warning', info: 'Note', ok: 'OK' } as const;

/**
 * The "Check transcript" result as plain text, for "Copy details": what someone pastes into a bug
 * report. Paths stay in (they are what the report is about); message text never is.
 */
export function diagnosisReport(diagnosis: TranscriptDiagnosis, extra: { title?: string | null; version?: string | null } = {}): string {
  const lines = [`Seshboard transcript check${extra.version ? ` (Seshboard ${extra.version})` : ''}`, `Session: ${diagnosis.sessionId}${extra.title ? ` (${extra.title})` : ''}`, `Checked: ${new Date(diagnosis.checkedAt).toISOString()}`];
  if (diagnosis.indexedPath) lines.push(`Session list file: ${diagnosis.indexedPath}`);
  lines.push('', 'Findings:');
  for (const finding of diagnosis.findings) lines.push(`- ${TONE_LABEL[finding.tone]}: ${finding.text}`);
  for (const profile of diagnosis.profiles) {
    lines.push('', `Profile ${profile.profileId} (${profile.configDir})`);
    if (profile.files.length === 0) lines.push('  No transcript file');
    for (const file of profile.files) {
      lines.push(
        `  ${file.path}`,
        `    ${formatBytes(file.size)}, modified ${new Date(file.modifiedAt).toISOString()}, ${file.lines} lines (${file.badLines} invalid), ${file.messages} messages, ${file.compactions} compactions${file.complete ? '' : ', last line incomplete'}`,
      );
    }
    lines.push(profile.error !== null ? `  Reader failed after ${profile.readMs} ms: ${profile.error}` : `  Reader returned ${profile.read} messages in ${profile.readMs} ms`);
    if (profile.stack) lines.push(...profile.stack.split('\n').map((line) => `    ${line}`));
  }
  return lines.join('\n');
}
