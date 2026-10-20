/** One smoke step's outcome, as written to result.json and printed by scripts/smoke.ts. */
export interface SmokeStepResult {
  label: string;
  /** "ok…" when it passed; anything else says what went wrong. */
  result: string;
  ok: boolean;
  ms: number;
}

export interface SmokeStepOptions {
  /** How long the step may take before the run gives up on it. */
  timeoutMs?: number;
  /** Put the window back in a known state afterwards (close a dialog or menu the step left open). Off for steps run inside another step. */
  cleanup?: boolean;
  /** Run even when `only` leaves it out: the steps that open the session the later ones work in. */
  always?: boolean;
}

/** The result of a step skipped because an earlier one timed out (see `SmokeRun.stoppedBy`). */
export const NOT_RUN = 'not run';

/** What `step` returns for a step `only` left out; it is not recorded. */
export const SKIPPED = 'ok: skipped, not picked by --only';

/** Whether a step's result counts as a pass. */
export function isPass(result: string): boolean {
  return result.startsWith('ok');
}

/**
 * Runs the smoke steps one after another: times each one, turns a throw into a failed result, and stops
 * the run when a step takes too long. A step that times out may still be driving the window, so the
 * steps after it are reported as not run instead of failing one by one on a page in an unknown state.
 */
export class SmokeRun {
  readonly steps: SmokeStepResult[] = [];
  /** The step that timed out and stopped the run, if one did. */
  stoppedBy: string | null = null;
  /** How many top-level steps `only` picked (the `always` ones not counted). */
  matched = 0;
  /** Steps running right now: a step run inside another always runs with it. */
  private depth = 0;

  constructor(
    private readonly options: {
      /** Called after each step (unless it opts out); returns what it had to close, if anything. */
      cleanup?: () => Promise<string | null>;
      log?: (line: string) => void;
      defaultTimeoutMs?: number;
      /** Run only the top-level steps whose label this matches (npm run smoke -- --only "…"), plus the `always` ones. */
      only?: RegExp | null;
    } = {},
  ) {}

  async step(label: string, run: () => Promise<string | boolean>, options: SmokeStepOptions = {}): Promise<string> {
    if (this.stoppedBy) return this.record(label, NOT_RUN, 0, false);
    if (!this.selects(label, options)) return SKIPPED;
    const timeoutMs = options.timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000;
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    let result: string;
    this.depth++;
    try {
      const outcome = await Promise.race([run(), timedOut]);
      if (outcome === 'timeout') {
        this.stoppedBy = label;
        result = `failed: timed out after ${Math.round(timeoutMs / 1000)}s`;
      } else {
        result = outcome === true ? 'ok' : outcome === false ? 'failed' : outcome;
      }
    } catch (error) {
      result = `failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      clearTimeout(timer);
      this.depth--;
    }
    const ms = Math.round(performance.now() - started);
    if (!this.stoppedBy && options.cleanup !== false && this.options.cleanup) {
      const closed = await this.options.cleanup().catch((error: Error) => `cleanup failed: ${error.message}`);
      if (closed) this.options.log?.(`[smoke] after "${label}": ${closed}`);
    }
    return this.record(label, result, ms);
  }

  /** Whether `only` picks this step. Steps inside a running one always run, so they go with their parent. */
  selects(label: string, options: SmokeStepOptions = {}): boolean {
    const { only } = this.options;
    if (!only || this.depth > 0 || options.always) return true;
    if (!only.test(label)) return false;
    this.matched++;
    return true;
  }

  /** The steps that took longest, slowest first. */
  slowest(count: number): SmokeStepResult[] {
    return [...this.steps].sort((a, b) => b.ms - a.ms).slice(0, count);
  }

  private record(label: string, result: string, ms: number, log = true): string {
    const ok = isPass(result);
    this.steps.push({ label, result, ok, ms });
    if (log) this.options.log?.(`[smoke] ${ok ? '✓' : '✗'} ${label} (${ms}ms)${ok ? '' : `: ${result}`}`);
    return result;
  }
}
