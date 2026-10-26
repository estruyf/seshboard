import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { TranscriptDiagnosis, TranscriptFileCheck, TranscriptFinding, TranscriptProfileCheck } from '@seshboard/protocol';
import type { SessionSource } from '../claude/sessionSource.ts';

export interface DiagnosisProfile {
  profileId: string;
  /** The folder holding `projects/`. */
  configDir: string;
  source: SessionSource;
}

const STACK_LINES = 12;
const STACK_CHARS = 4000;

/**
 * Checks a session's transcript for the "Check transcript" dialog: every `<id>.jsonl` in each
 * profile's `projects/` folders, counted line by line, and what Claude Code's reader returns for it.
 * This is the one place outside the SDK that looks inside transcript files, and only to count:
 * it never decides what the conversation is.
 */
export async function diagnoseTranscript(sessionId: string, indexedPath: string | null, profiles: readonly DiagnosisProfile[]): Promise<TranscriptDiagnosis> {
  const checks: TranscriptProfileCheck[] = [];
  for (const profile of profiles) {
    const files: TranscriptFileCheck[] = [];
    for (const path of await transcriptFiles(join(profile.configDir, 'projects'), sessionId)) {
      const file = await checkFile(path).catch(() => null);
      if (file) files.push(file);
    }
    const started = performance.now();
    let read: number | null = null;
    let error: string | null = null;
    let stack: string | null = null;
    try {
      read = (await profile.source.messages(sessionId)).length;
    } catch (e) {
      error = (e as Error)?.message || String(e);
      stack = typeof (e as Error)?.stack === 'string' ? (e as Error).stack!.split('\n').slice(0, STACK_LINES).join('\n').slice(0, STACK_CHARS) : null;
    }
    checks.push({ profileId: profile.profileId, configDir: profile.configDir, files, read, readMs: Math.round(performance.now() - started), error, stack });
  }
  return { sessionId, checkedAt: Date.now(), indexedPath, profiles: checks, findings: transcriptFindings(checks, indexedPath, profiles.length > 1) };
}

/** `<projects>/<any folder>/<id>.jsonl`, in every project folder (the same session can be in more than one). */
async function transcriptFiles(projectsDir: string, sessionId: string): Promise<string[]> {
  let dirs: string[];
  try {
    dirs = (await readdir(projectsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const dir of dirs) {
    const path = join(projectsDir, dir, `${sessionId}.jsonl`);
    if (await stat(path).then((s) => s.isFile(), () => false)) found.push(path);
  }
  return found;
}

async function checkFile(path: string): Promise<TranscriptFileCheck> {
  const info = await stat(path);
  const check: TranscriptFileCheck = { path, size: info.size, modifiedAt: info.mtimeMs, lines: 0, badLines: 0, messages: 0, compactions: 0, complete: true };
  let last = '';
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    last = line;
    if (!line.trim()) continue;
    check.lines++;
    let entry: { type?: unknown; subtype?: unknown };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      check.badLines++;
      continue;
    }
    if (entry.type === 'user' || entry.type === 'assistant') check.messages++;
    else if (entry.type === 'system' && entry.subtype === 'compact_boundary') check.compactions++;
  }
  // readline drops the final newline, so a last line that is still being written shows up as non-empty text.
  if (info.size > 0 && last !== '') check.complete = await endsWithNewline(path, info.size);
  return check;
}

async function endsWithNewline(path: string, size: number): Promise<boolean> {
  const stream = createReadStream(path, { start: size - 1, end: size - 1 });
  for await (const chunk of stream) return (chunk as Buffer)[0] === 0x0a;
  return true;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const ORDER: Record<TranscriptFinding['tone'], number> = { error: 0, warn: 1, info: 2, ok: 3 };

/** What the checks mean, in plain sentences, most serious first. Pure, so it is unit tested. */
export function transcriptFindings(profiles: readonly TranscriptProfileCheck[], indexedPath: string | null, multipleProfiles = false): TranscriptFinding[] {
  const findings: TranscriptFinding[] = [];
  const files = profiles.flatMap((p) => p.files);
  const reads = profiles.map((p) => p.read).filter((n): n is number => n !== null);
  const read = reads.length ? Math.max(...reads) : null;
  const where = (p: TranscriptProfileCheck) => (multipleProfiles ? ` (in ${p.configDir})` : '');

  if (files.length === 0) {
    findings.push({ tone: 'error', text: "There is no transcript file for this session in any Claude profile's folder. It may have been moved or deleted, or Claude Code hasn't written it yet." });
  }
  for (const p of profiles) {
    if (p.error !== null) findings.push({ tone: 'error', text: `Claude Code's reader failed${where(p)}: ${p.error}` });
    if (p.files.length > 1) {
      findings.push({ tone: 'warn', text: `This session has ${p.files.length} transcript files in different project folders${where(p)}. Claude Code's reader uses the first one it finds, which may not be the one with the conversation.` });
    }
  }
  const inFiles = Math.max(0, ...files.map((f) => f.messages));
  if (read === 0 && inFiles > 0 && profiles.every((p) => p.error === null)) {
    findings.push({ tone: 'error', text: `The file holds ${plural(inFiles, 'message')}, but Claude Code's reader returned none.` });
  }
  if (indexedPath !== null && files.length > 0 && !files.some((f) => f.path === indexedPath)) {
    findings.push({ tone: 'warn', text: `Seshboard's session list points at a file that isn't there anymore: ${indexedPath}. Refreshing the session list fixes that.` });
  }
  const bad = files.reduce((n, f) => n + f.badLines, 0);
  if (bad > 0) findings.push({ tone: 'warn', text: `${plural(bad, 'line')} in the transcript ${bad === 1 ? "isn't" : "aren't"} valid JSON and ${bad === 1 ? 'is' : 'are'} skipped.` });
  if (files.some((f) => !f.complete)) findings.push({ tone: 'info', text: "The transcript's last line is incomplete: Claude Code may still be writing it." });
  const compactions = Math.max(0, ...files.map((f) => f.compactions));
  if (compactions > 0 && read !== null && read > 0) {
    findings.push({ tone: 'info', text: `The conversation was compacted ${compactions === 1 ? 'once' : `${compactions} times`}. Seshboard shows all of it, with a line where each compaction was; Claude only has the summary of what came before the last one.` });
  }
  if (!findings.some((f) => f.tone === 'error' || f.tone === 'warn') && read !== null) {
    findings.push({ tone: 'ok', text: read > 0 ? `The transcript reads fine: ${plural(read, 'message')}.` : 'The transcript reads fine, but has no messages yet.' });
  }
  return findings.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
}
