import { runQuery, TRIGGER_LOG_LINES, type CiRunItem } from '@seshboard/protocol';
import { cleanLog, tail } from '../../git/prChecks.ts';
import { json, readFailure, type GhRun, type SourceRead } from './gh.ts';

/**
 * CI fails on a branch: the failed workflow runs on the branch, newest first, as `gh run list` gives them, of the
 * trigger's workflows (all of them when it names none).
 */
export async function readFailedRuns(gh: GhRun, root: string, branch: string, workflows: readonly string[]): Promise<SourceRead<CiRunItem[]>> {
  const result = await gh(runQuery(branch), root, 20_000);
  if (result.code !== 0 || result.missing) return readFailure(result);
  const raw = json(result.stdout);
  if (!Array.isArray(raw)) return { ok: false, message: "gh's answer didn't read", rateLimited: false };
  const wanted = new Set(workflows.map((w) => w.toLowerCase()));
  const runs = raw.flatMap((r): CiRunItem[] => {
    const run = r as Partial<CiRunItem> | null;
    if (!run || typeof run.databaseId !== 'number' || typeof run.workflowName !== 'string' || typeof run.headSha !== 'string' || typeof run.url !== 'string') return [];
    if (wanted.size > 0 && !wanted.has(run.workflowName.toLowerCase())) return [];
    return [
      {
        databaseId: run.databaseId,
        number: typeof run.number === 'number' ? run.number : undefined,
        workflowName: run.workflowName,
        headSha: run.headSha,
        headBranch: typeof run.headBranch === 'string' ? run.headBranch : branch,
        url: run.url,
        createdAt: typeof run.createdAt === 'string' ? run.createdAt : '',
        displayTitle: typeof run.displayTitle === 'string' ? run.displayTitle : '',
      },
    ];
  });
  return { ok: true, value: runs };
}

/** The end of a failed run's log (`gh run view --log-failed`), its last `TRIGGER_LOG_LINES` lines; null when it can't be read. */
export async function readFailedLog(gh: GhRun, root: string, runId: string): Promise<string | null> {
  const result = await gh(['run', 'view', runId, '--log-failed'], root, 60_000);
  if (result.code !== 0 || result.missing) return null;
  const log = tail(cleanLog(result.stdout), TRIGGER_LOG_LINES);
  return log.trim() ? log : null;
}

/** The workflows of the project's repository, for the editor's chips. */
export async function readWorkflows(gh: GhRun, root: string): Promise<SourceRead<string[]>> {
  const result = await gh(['workflow', 'list', '--json', 'name', '--limit', '50'], root, 15_000);
  if (result.code !== 0 || result.missing) return readFailure(result);
  const raw = json(result.stdout);
  if (!Array.isArray(raw)) return { ok: false, message: "gh's answer didn't read", rateLimited: false };
  const names = raw.flatMap((w) => (typeof (w as { name?: unknown })?.name === 'string' ? [(w as { name: string }).name] : []));
  return { ok: true, value: [...new Set(names)] };
}
