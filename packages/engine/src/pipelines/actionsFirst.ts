import { spawn } from 'node:child_process';
import { ACTION_TAIL_LINES, type ListedAction, type StepActionResult } from '@switchboard/protocol';

/** How long one action may run before a step stops waiting for it. */
export const ACTION_TIMEOUT_MS = 15 * 60_000;
/** Output kept while an action runs: enough for its last lines, however chatty it is. */
const KEEP_BYTES = 256_000;

/** The last `lines` lines of an output, without colour codes and carriage-return redraws. */
export function outputTail(output: string, lines = ACTION_TAIL_LINES): string {
  const plain = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r\n/g, '\n').split('\n').map((line) => line.slice(line.lastIndexOf('\r') + 1));
  while (plain.length && !plain.at(-1)!.trim()) plain.pop();
  return plain.slice(-lines).join('\n');
}

/** The action a step names: the same name in any case, the project's own before a global one. */
export const findNamed = (actions: readonly ListedAction[], name: string) => actions.find((a) => a.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

export interface ActionsFirstDeps {
  /** The project's actions (yours, global and shared), with whether each is approved. */
  actions: readonly ListedAction[];
  /** The command line with its variables filled in. */
  expand(action: ListedAction): string;
  /** Where it runs: the run's folder, or the project root for an action that says so. */
  cwd(action: ListedAction): string;
  /** The shell's file and its arguments for one command line, and the environment. */
  shell: { file: string; run(command: string): string[] };
  env: Record<string, string>;
  timeoutMs?: number;
  now?(): number;
}

/**
 * Runs a step's `actionsFirst`, one after the other, and keeps each one's exit code and the end of its output for the
 * prompt. One that isn't here, isn't approved or is a prompt action doesn't run, and says why: the step still starts.
 */
export async function runActionsFirst(names: readonly string[], deps: ActionsFirstDeps): Promise<StepActionResult[]> {
  const now = deps.now ?? Date.now;
  const results: StepActionResult[] = [];
  for (const name of names) {
    const action = findNamed(deps.actions, name);
    if (!action) {
      results.push({ name, exitCode: null, tail: `There is no project action called ${name} here.`, ms: 0 });
      continue;
    }
    if (action.type !== 'shell') {
      results.push({ name: action.name, exitCode: null, tail: `${action.name} sends a prompt, so it doesn't run before a step.`, ms: 0 });
      continue;
    }
    if (!action.trusted) {
      results.push({ name: action.name, exitCode: null, tail: `${action.name} comes from .switchboard.json and hasn't been approved yet.`, ms: 0 });
      continue;
    }
    const started = now();
    const { code, output } = await runCommand(deps.shell, deps.expand(action), deps.cwd(action), deps.env, deps.timeoutMs ?? ACTION_TIMEOUT_MS);
    results.push({ name: action.name, exitCode: code, tail: outputTail(output).slice(-20_000), ms: Math.max(0, now() - started) });
  }
  return results;
}

/** Runs a command line in the user's shell; its exit code (-1 when it couldn't run or ran too long) and its output. */
export function runCommand(shell: ActionsFirstDeps['shell'], command: string, cwd: string, env: Record<string, string>, timeoutMs: number): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-KEEP_BYTES);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell.file, shell.run(command), { cwd, env: { ...env, CI: env.CI ?? '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      resolve({ code: -1, output: error instanceof Error ? error.message : String(error) });
      return;
    }
    const timer = setTimeout(() => {
      output += `\nStopped after ${Math.round(timeoutMs / 60_000)} minutes.`;
      child.kill();
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `${output}\n${error.message}`.trim() });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}
