import type { CheckLog, ContextItem, PrCheck, PrChecks } from '@seshboard/protocol/client';

/** At most this many checks are listed in the git menu; the rest are a link to the pull request's checks. */
export const MENU_CHECKS = 8;
/** Logs of at most this many failed checks go in one message. */
export const MAX_FIX_CHECKS = 20;

export const failedChecks = (checks: readonly PrCheck[]) => checks.filter((check) => check.bucket === 'fail');

const count = (n: number, word = 'check') => `${n} ${n === 1 ? word : `${word}s`}`;

/** "3 checks passed", "1 of 5 checks failed", "2 checks running", "1 of 5 checks failed, 2 running", or why gh couldn't say. */
export function checksLine(checks: PrChecks): string {
  if (checks.error) return checks.error.message;
  const of = (bucket: PrCheck['bucket']) => checks.checks.filter((check) => check.bucket === bucket).length;
  const [failed, running, passed, cancelled] = [of('fail'), of('pending'), of('pass'), of('cancel')];
  const total = checks.checks.length - of('skipping');
  if (checks.checks.length === 0) return 'No checks';
  if (failed) return `${failed} of ${count(total)} failed${running ? `, ${running} running` : ''}`;
  if (running) return `${count(running)} running`;
  if (total === 0) return 'All checks were skipped';
  return `${count(passed)} passed${cancelled ? `, ${cancelled} cancelled` : ''}`;
}

/** 42s, 4m 12s, 1h 5m. */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The time on a check's row: how long it ran, how long it has been running, or what became of it. */
export function checkTime(check: PrCheck, now: number): string {
  if (check.bucket === 'skipping') return 'Skipped';
  if (check.bucket === 'cancel') return 'Cancelled';
  const started = check.startedAt ? Date.parse(check.startedAt) : NaN;
  if (check.bucket === 'pending') return Number.isNaN(started) ? 'Queued' : duration(now - started);
  const completed = check.completedAt ? Date.parse(check.completedAt) : NaN;
  return Number.isNaN(started) || Number.isNaN(completed) || completed < started ? '' : duration(completed - started);
}

/** "test (ubuntu-latest), workflow CI". */
export const checkTitle = (check: Pick<PrCheck, 'name' | 'workflow'>) => (check.workflow ? `${check.name}, workflow ${check.workflow}` : check.name);

const chipLabel = (text: string) => (text.length > 200 ? `${text.slice(0, 199)}…` : text);

/**
 * What Fix failing checks with Claude puts in the message box: a short prompt naming the failed checks, and each log
 * as a chip (short in the box, complete in what is sent). A check without a log (not a GitHub Actions job, or its
 * log couldn't be read) is named with its description, why and its link.
 */
export function fixChecksDraft(checks: Pick<PrChecks, 'pr' | 'branch'>, failed: readonly PrCheck[], logs: readonly CheckLog[]): { text: string; items: ContextItem[] } {
  const items: ContextItem[] = [];
  const lines = failed.map((check, i) => {
    const log = logs[i];
    if (log?.log) {
      items.push({ kind: 'text', source: 'checks', label: chipLabel(checkTitle(check)), text: log.log });
      return `- ${checkTitle(check)}`;
    }
    const about = [check.description.trim().replace(/\.?$/, '.'), log?.note ?? ''].filter((part) => part && part !== '.').join(' ');
    return `- ${checkTitle(check)}${about ? `: ${about}` : ''}${check.link ? ` ${check.link}` : ''}`;
  });
  const which = failed.length === 1 ? 'This check' : 'These checks';
  const text = `${which} failed on PR #${checks.pr.number} (${checks.branch}):\n\n${lines.join('\n')}\n\nFind the cause, fix it, and run the failing test locally if you can.`;
  return { text, items };
}
