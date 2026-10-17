import { MAX_PROMPT_LENGTH, type CheckBucket, type CheckLog, type ChecksFinished, type ChecksSummary, type PrCheck, type PrChecks } from '@switchboard/protocol';
import { classifyGhFailure, firstUsefulLine, runGh, type GhCommand, type RunResult } from './pullRequest.ts';

/** The fields `gh pr checks --json` is asked for. */
export const CHECK_FIELDS = 'name,state,bucket,link,workflow,description,startedAt,completedAt';
/** Lines kept from the end of each failed job's log. */
export const LOG_LINES = 150;
/** Room left in a message for the text around the logs. */
const PROMPT_ROOM = 20_000;

const BUCKETS: readonly CheckBucket[] = ['pass', 'fail', 'pending', 'skipping', 'cancel'];
const ORDER: Record<CheckBucket, number> = { fail: 0, pending: 1, cancel: 2, pass: 3, skipping: 4 };

const text = (value: unknown) => (typeof value === 'string' ? value : '');
/** gh writes `0001-01-01T00:00:00Z` for a time that hasn't come yet. */
const time = (value: unknown) => (typeof value === 'string' && value && !value.startsWith('0001-') ? value : null);

/**
 * The checks in what `gh pr checks --json` printed, failed ones first, or null when it isn't that list. gh exits with 8
 * while checks are pending and with 1 when one failed, and prints the list both times, so the exit code says nothing.
 */
export function parseChecks(stdout: string): PrCheck[] | null {
  let list: unknown;
  try {
    list = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const checks: PrCheck[] = [];
  for (const raw of list as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    const bucket = BUCKETS.find((b) => b === raw.bucket) ?? bucketOfState(text(raw.state));
    checks.push({ name: text(raw.name) || 'Check', bucket, workflow: text(raw.workflow), description: text(raw.description), link: text(raw.link), startedAt: time(raw.startedAt), completedAt: time(raw.completedAt) });
  }
  return checks.sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket] || a.name.localeCompare(b.name));
}

/** For a gh that sent no `bucket`: the state's bucket, as gh itself maps it. */
function bucketOfState(state: string): CheckBucket {
  const s = state.toUpperCase();
  if (s === 'SUCCESS') return 'pass';
  if (s === 'FAILURE' || s === 'ERROR' || s === 'TIMED_OUT' || s === 'ACTION_REQUIRED' || s === 'STARTUP_FAILURE') return 'fail';
  if (s === 'SKIPPED' || s === 'NEUTRAL') return 'skipping';
  if (s === 'CANCELLED' || s === 'STALE') return 'cancel';
  return 'pending';
}

/** One failed check is enough to say failed (you can start on it while the rest run); then running; then passed. */
export function summarize(checks: readonly PrCheck[]): ChecksSummary {
  if (checks.length === 0) return 'none';
  if (checks.some((c) => c.bucket === 'fail')) return 'fail';
  if (checks.some((c) => c.bucket === 'pending')) return 'pending';
  return 'pass';
}

/** No check is still running. */
export const allDone = (checks: readonly PrCheck[]) => checks.length > 0 && !checks.some((c) => c.bucket === 'pending');

/** What `gh pr checks` said, as the checks of `pr` (or why they couldn't be read). */
export function checksFrom(result: RunResult, base: Pick<PrChecks, 'path' | 'branch' | 'pr'>, at: number): PrChecks {
  const checks = result.missing ? null : parseChecks(result.stdout);
  if (checks) return { ...base, checks, summary: summarize(checks), error: null, at };
  // A pull request without checks: gh says so on stderr and exits with 1.
  if (/no checks reported/i.test(`${result.stderr}\n${result.stdout}`)) return { ...base, checks: [], summary: 'none', error: null, at };
  const failure = classifyGhFailure(result);
  const code = failure.code === 'GH_MISSING' || failure.code === 'GH_AUTH' ? failure.code : 'UNKNOWN';
  return { ...base, checks: [], summary: 'none', error: { code, message: failure.message }, at };
}

/** Reads the checks of pull request `pr` with gh, in `path`. */
export async function readChecks(gh: GhCommand, base: Pick<PrChecks, 'path' | 'branch' | 'pr'>, env: Record<string, string>, now = Date.now): Promise<PrChecks> {
  const result = await runGh(gh, ['pr', 'checks', String(base.pr.number), `--json=${CHECK_FIELDS}`], { cwd: base.path, env, timeout: 30_000 });
  return checksFrom(result, base, now());
}

/** The run and job of a GitHub Actions check, from its link (`…/actions/runs/<run>/job/<job>`); null for other checks. */
export function actionsJob(link: string): { run: string; job: string } | null {
  const match = /\/actions\/runs\/(\d+)\/job(?:s)?\/(\d+)(?:[/?#]|$)/.exec(link);
  return match ? { run: match[1]!, job: match[2]! } : null;
}

// Colours and cursor moves (CSI), and window titles and links (OSC).
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const TIMESTAMP = /^\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;

/**
 * A job's log as `gh run view --log-failed` prints it (`job<TAB>step<TAB>timestamp text`), as plain lines: no job
 * name, timestamps or colours, GitHub's `##[group]` markers dropped, and a `Step: <name>` line where a step starts.
 */
export function cleanLog(raw: string): string {
  const out: string[] = [];
  let step: string | null = null;
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const parts = line.split('\t');
    let body = line;
    if (parts.length >= 3) {
      const name = parts[1]!.trim();
      if (name && name !== step) {
        step = name;
        out.push(`Step: ${name}`);
      }
      body = parts.slice(2).join('\t');
    }
    body = body.replace(TIMESTAMP, '').replace(ANSI, '').replace(/\uFEFF/g, '');
    if (/^##\[endgroup\]/.test(body)) continue;
    body = body.replace(/^##\[group\]/, '').replace(/^##\[error\]/, 'Error: ').replace(/^##\[warning\]/, 'Warning: ');
    out.push(body.trimEnd());
  }
  while (out.length && !out.at(-1)) out.pop();
  return out.join('\n');
}

/** The last `lines` lines of `text`, within `chars` characters (the end is what says what failed). */
export function tail(text: string, lines: number, chars = Infinity): string {
  let kept = text.split('\n').slice(-lines).join('\n');
  if (kept.length > chars) {
    kept = kept.slice(kept.length - chars);
    const newline = kept.indexOf('\n');
    if (newline >= 0 && newline < kept.length - 1) kept = kept.slice(newline + 1);
  }
  return kept;
}

/**
 * The end of each failed check's log, in the order asked. Checks that aren't GitHub Actions jobs get no log (their
 * name, description and link say what there is). Each log keeps its last `LOG_LINES` lines, and together they stay
 * within what a message can hold.
 */
export async function readCheckLogs(gh: GhCommand, cwd: string, env: Record<string, string>, checks: ReadonlyArray<{ name: string; workflow: string; link: string }>): Promise<CheckLog[]> {
  const share = Math.floor((MAX_PROMPT_LENGTH - PROMPT_ROOM) / Math.max(1, checks.length));
  // A few at a time: each is a download.
  const results: CheckLog[] = new Array(checks.length);
  let next = 0;
  const worker = async () => {
    while (next < checks.length) {
      const index = next++;
      const check = checks[index]!;
      const job = actionsJob(check.link);
      const base = { name: check.name, workflow: check.workflow, link: check.link };
      if (!job) {
        results[index] = { ...base, log: null, note: null };
        continue;
      }
      const result = await runGh(gh, ['run', 'view', job.run, `--job=${job.job}`, '--log-failed'], { cwd, env, timeout: 60_000 });
      const log = result.code === 0 && !result.missing ? tail(cleanLog(result.stdout), LOG_LINES, share) : '';
      if (log.trim()) results[index] = { ...base, log, note: null };
      else if (result.code === 0) results[index] = { ...base, log: null, note: 'GitHub has no log of a failed step for it.' };
      else results[index] = { ...base, log: null, note: `Couldn't read its log: ${result.missing ? "GitHub CLI isn't installed." : firstUsefulLine(`${result.stderr}\n${result.stdout}`) || 'gh failed.'}` };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, checks.length) }, worker));
  return results;
}

export interface ChecksWatcherOptions {
  /** Reads the checks of the open pull request of the branch checked out at `cwd` now; null without one. */
  read(cwd: string): Promise<PrChecks | null>;
  /** Every read goes out (`git.checks`). */
  emit(checks: PrChecks): void;
  /** Checks that were running all finished, for the session that asked last (`git.checksFinished`). */
  finished(event: ChecksFinished): void;
  now?: () => number;
}

/** How often running checks are read again: while a window has focus, and while none has. */
export const FOREGROUND_POLL_MS = 30_000;
export const BACKGROUND_POLL_MS = 5 * 60_000;
/** After a push, checks that haven't started yet are looked for this often, for this long. */
export const AFTER_PUSH_POLL_MS = 15_000;
export const AFTER_PUSH_WINDOW_MS = 2 * 60_000;
/** A read this recent is reused. */
export const REUSE_MS = 20_000;
/** Checks still running after this long aren't read again by themselves (a stuck job shouldn't poll forever). */
export const WATCH_LIMIT_MS = 3 * 60 * 60_000;

interface Watch {
  cwd: string;
  sessionId: string | null;
  last: PrChecks | null;
  /** Running checks have been seen for this pull request, so finishing is news. */
  running: boolean;
  since: number;
  expectUntil: number;
  timer: ReturnType<typeof setTimeout> | null;
  due: number;
  reading: Promise<PrChecks | null> | null;
}

/**
 * Keeps reading the checks of pull requests while some are running, so the git button and the notification follow
 * them without a window asking. Keyed by the checkout's folder; a pull request with every check done is left alone
 * until someone asks again.
 */
export class ChecksWatcher {
  private readonly watches = new Map<string, Watch>();
  private foreground = true;
  private readonly now: () => number;

  constructor(private readonly options: ChecksWatcherOptions) {
    this.now = options.now ?? Date.now;
  }

  /** The checks for `cwd`: a recent read unless `fresh`. `sessionId` hears when they finish. */
  async get(cwd: string, request: { sessionId?: string; fresh?: boolean; afterPush?: boolean } = {}): Promise<PrChecks | null> {
    const watch = this.watches.get(cwd) ?? this.add(cwd);
    if (request.sessionId) watch.sessionId = request.sessionId;
    if (request.afterPush) watch.expectUntil = this.now() + AFTER_PUSH_WINDOW_MS;
    if (watch.reading) return watch.reading;
    if (!request.fresh && !request.afterPush && watch.last && this.now() - watch.last.at < REUSE_MS) return watch.last;
    return this.read(watch);
  }

  /** Whether a window has focus: running checks are read every 30 seconds then, else every 5 minutes. */
  setForeground(foreground: boolean): void {
    if (this.foreground === foreground) return;
    this.foreground = foreground;
    // Back to the window: what was waiting for the slow pace is read soon.
    if (foreground) for (const watch of this.watches.values()) if (watch.timer && watch.due - this.now() > FOREGROUND_POLL_MS) this.schedule(watch, FOREGROUND_POLL_MS);
  }

  close(): void {
    for (const watch of this.watches.values()) if (watch.timer) clearTimeout(watch.timer);
    this.watches.clear();
  }

  private add(cwd: string): Watch {
    const watch: Watch = { cwd, sessionId: null, last: null, running: false, since: this.now(), expectUntil: 0, timer: null, due: 0, reading: null };
    this.watches.set(cwd, watch);
    return watch;
  }

  private read(watch: Watch): Promise<PrChecks | null> {
    if (watch.timer) clearTimeout(watch.timer);
    watch.timer = null;
    const reading = this.options
      .read(watch.cwd)
      .catch(() => null)
      .then((checks) => {
        watch.reading = null;
        this.settle(watch, checks);
        return checks;
      });
    watch.reading = reading;
    return reading;
  }

  private settle(watch: Watch, checks: PrChecks | null): void {
    const previous = watch.last;
    watch.last = checks;
    if (!checks) {
      // No pull request (any more): nothing to follow.
      watch.running = false;
      return;
    }
    // Another pull request (the branch changed) starts over.
    if (previous && (previous.pr.number !== checks.pr.number || previous.path !== checks.path)) watch.running = false;
    this.options.emit(checks);
    const running = checks.checks.some((c) => c.bucket === 'pending');
    if (running && !watch.running) watch.since = this.now();
    if (!running && watch.running && allDone(checks.checks) && watch.sessionId && !checks.error) {
      const failed = checks.checks.filter((c) => c.bucket === 'fail').length;
      this.options.finished({ sessionId: watch.sessionId, path: checks.path, branch: checks.branch, pr: checks.pr, outcome: failed ? 'fail' : 'pass', failed, total: checks.checks.length });
    }
    if (checks.error) watch.running = false;
    else if (running) watch.running = true;
    else if (checks.checks.length) watch.running = false;
    // Checks aren't there right after a push: look again for a little while. Once they are, follow them.
    if (running && this.now() - watch.since < WATCH_LIMIT_MS) this.schedule(watch, this.foreground ? FOREGROUND_POLL_MS : BACKGROUND_POLL_MS);
    else if ((checks.summary === 'none' || allDone(checks.checks)) && !checks.error && this.now() < watch.expectUntil) this.schedule(watch, AFTER_PUSH_POLL_MS);
  }

  private schedule(watch: Watch, delay: number): void {
    if (watch.timer) clearTimeout(watch.timer);
    watch.due = this.now() + delay;
    watch.timer = setTimeout(() => {
      watch.timer = null;
      void this.read(watch);
    }, delay);
    watch.timer.unref?.();
  }
}
