import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { git, topLevel } from './gitChanges.ts';

/**
 * Writing a commit message without the session: Haiku gets the change itself (the files, the stat and the patch,
 * capped) and the last few subjects for the style, in a call of its own. Sending "commit this" to the session instead
 * makes the model read the whole conversation again, which in a long session is most of a million tokens.
 */

/** How much of the patch Haiku reads (about 10,000 tokens), and of any one file in it, so one big file can't take it all. */
const PATCH_BUDGET = 40_000;
const FILE_BUDGET = 8_000;
const FILES_BUDGET = 6_000;
/** Files whose diff says nothing a commit message needs: listed, never shown. */
const NOISE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|go\.sum)$|\.(min\.(js|css)|map|snap|svg)$/;

export const COMMIT_SYSTEM_PROMPT = `You write git commit messages. You get the branch, the repository's recent commit subjects, the files that changed, a diff stat and the patch (parts of it can be left out).

Answer with the commit message only: no quotes, no code fences, no preamble.
- First line: the subject, imperative, at most 72 characters, no trailing period. Follow the style of the recent subjects (for example "type(scope): subject" when they use Conventional Commits).
- Then, only when the change needs it, a blank line and a short body: what changed and why, in a few lines or "- " bullets.
- Describe the change that matters to someone reading the history, not every file.`;

export interface CommitContext {
  branch: string | null;
  /** Recent subjects, newest first. */
  recent: string[];
  /** `git diff --name-status` of what the commit takes. */
  files: string;
  stat: string;
  patch: string;
}

/**
 * What a commit made now would take, the way `git.commit` stages it: what is staged, or every change (untracked files
 * too) when nothing is. The second is read through a copy of the index, so the real one is left as it was.
 * Null when there is nothing to commit.
 */
export async function commitContext(cwd: string): Promise<CommitContext | null> {
  const root = await topLevel(cwd);
  const [branch, recent] = await Promise.all([
    git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowExitCodes: [1, 128] }).then((out) => out.trim() || null),
    git(root, ['log', '-n', '10', '--format=%s'], { allowExitCodes: [128] }).then((out) => out.split('\n').filter(Boolean)),
  ]);
  const diff = (env: Record<string, string> | undefined, args: string[]) => git(root, ['diff', '--cached', '--no-ext-diff', '--no-color', ...args], env ? { env } : {});
  const read = async (env?: Record<string, string>): Promise<CommitContext | null> => {
    const files = (await diff(env, ['--name-status'])).trim();
    if (!files) return null;
    const [stat, patch] = await Promise.all([
      diff(env, ['--stat=120']),
      // Past git's 32 MB buffer the patch can't be read: the files and the stat still say a lot.
      diff(env, ['--patch', '--minimal']).catch(() => ''),
    ]);
    return { branch, recent, files, stat: stat.trimEnd(), patch };
  };
  const staged = await read();
  if (staged) return staged;
  const dir = mkdtempSync(join(tmpdir(), 'seshboard-commit-'));
  try {
    const indexPath = (await git(root, ['rev-parse', '--git-path', 'index'])).trim();
    const index = isAbsolute(indexPath) ? indexPath : resolve(root, indexPath);
    const env = { GIT_INDEX_FILE: join(dir, 'index') };
    if (existsSync(index)) copyFileSync(index, env.GIT_INDEX_FILE);
    await git(root, ['add', '-A'], { env });
    return await read(env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The patch cut to the budget: lock files and generated files left out, each file capped, then the whole. */
export function trimPatch(patch: string, budget = PATCH_BUDGET, perFile = FILE_BUDGET): string {
  const parts = patch.split(/^(?=diff --git )/m).filter(Boolean);
  const left: string[] = [];
  let out = '';
  for (const part of parts) {
    const path = /^diff --git a\/(.+?) b\//.exec(part)?.[1] ?? '';
    if (NOISE.test(path)) {
      left.push(path);
      continue;
    }
    const piece = part.length > perFile ? `${part.slice(0, perFile)}\n[rest of this file left out]\n` : part;
    if (out.length + piece.length > budget) {
      left.push(path);
      continue;
    }
    out += piece;
  }
  return left.length ? `${out}\n[patch left out for: ${left.join(', ')}]` : out;
}

/** What Haiku reads: plain text, short enough to be cheap whatever the change. */
export function commitMessageInput(context: CommitContext): string {
  const cap = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}\n[cut]` : text);
  return [
    `Branch: ${context.branch ?? '(detached)'}`,
    '',
    'Recent subjects:',
    context.recent.length ? context.recent.map((s) => `- ${s}`).join('\n') : '(none yet)',
    '',
    'Files:',
    cap(context.files, FILES_BUDGET),
    '',
    'Stat:',
    cap(context.stat, FILES_BUDGET),
    '',
    'Patch:',
    trimPatch(context.patch) || '(none)',
  ].join('\n');
}

/** Haiku's answer as a commit message: fences, quotes and a "Commit message:" lead taken off. Null when nothing is left. */
export function parseCommitMessage(text: string | null): string | null {
  if (!text) return null;
  let message = text.trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(message);
  if (fenced) message = fenced[1]!.trim();
  message = message.replace(/^(commit message|message)\s*:\s*/i, '').trim();
  if (/^(["'`]).*\1$/s.test(message)) message = message.slice(1, -1).trim();
  const lines = message.split('\n').map((line) => line.trimEnd());
  const subject = lines[0]?.trim().replace(/\.$/, '') ?? '';
  if (!subject) return null;
  const body = lines.slice(1).join('\n').trim();
  return body ? `${subject}\n\n${body}` : subject;
}

/** The smoke run's and the screenshots' message: no model is called. */
export function stubCommitMessage(input: string): string {
  const files = /^Files:\n([\s\S]*?)\n\n/m.exec(input)?.[1]?.split('\n').filter(Boolean).length ?? 0;
  return `Update ${files === 1 ? 'one file' : `${files} files`}`;
}
