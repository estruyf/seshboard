/**
 * The command palette's state, without React: which mode it is in, what is typed, and the steps a
 * command that needs more input has gone through. The palette keeps one of these and moves it along
 * with the functions below, so typing, ⌫ and picking behave the same everywhere (and can be tested).
 */

/** `goto`: sessions and projects (⌘P). The others start with a prefix character. */
export type PaletteMode = 'goto' | 'commands' | 'new' | 'actions' | 'help';

/** The character that switches to each mode when typed first, as in VS Code. */
export const PREFIXES = { commands: '>', new: '+', actions: '!', help: '?' } as const satisfies Record<Exclude<PaletteMode, 'goto'>, string>;

/** The mode a typed character switches to, or null when it isn't a prefix. */
export function modeForPrefix(char: string | undefined): Exclude<PaletteMode, 'goto'> | null {
  for (const [mode, prefix] of Object.entries(PREFIXES)) if (prefix === char) return mode as Exclude<PaletteMode, 'goto'>;
  return null;
}

/** Lists a `pick` step chooses from. */
export type PickList = 'model' | 'effort' | 'mode' | 'fork' | 'rewind' | 'focus-limit' | 'queue' | 'memory';

/**
 * One step of a command that needs more input. `chip` is how it shows in the input; `from` is the
 * project a prompt was written for before its project was changed, so the prompt moves along.
 */
export type PaletteStep =
  | { kind: 'projects'; purpose: 'new-session' | 'rename-project' | 'worktrees' | 'branches'; worktree: boolean; chip: string; from?: string }
  | { kind: 'prompt'; root: string; worktree: boolean; chip: string; from?: string }
  | { kind: 'pick'; list: PickList; chip: string };

export interface PaletteState {
  mode: PaletteMode;
  query: string;
  steps: PaletteStep[];
  /** What was typed before each step, given back when ⌫ returns to it. */
  saved: string[];
}

/** The step that starts a new session: pick a project. */
export const NEW_SESSION_STEP: PaletteStep = { kind: 'projects', purpose: 'new-session', worktree: false, chip: 'New session' };

/** The palette as it opens. "+" (new session) goes straight to picking a project. */
export function initialState(mode: PaletteMode): PaletteState {
  return mode === 'new' ? { mode, query: '', steps: [NEW_SESSION_STEP], saved: [''] } : { mode, query: '', steps: [], saved: [] };
}

export const currentStep = (state: PaletteState): PaletteStep | null => state.steps.at(-1) ?? null;

/**
 * The input changed. Outside a step, a prefix typed (or pasted) at the start switches mode and the
 * rest stays as the query; inside a step everything typed is the query.
 */
export function typeQuery(state: PaletteState, value: string): PaletteState {
  const mode = state.steps.length === 0 ? modeForPrefix(value[0]) : null;
  if (mode) return { ...initialState(mode), query: value.slice(1) };
  return { ...state, query: value };
}

/** A command needs more input: show its next step, with an empty query. */
export function pushStep(state: PaletteState, step: PaletteStep): PaletteState {
  return { ...state, steps: [...state.steps, step], saved: [...state.saved, state.query], query: '' };
}

/** Switches mode from a command or the help list (Go to session…, Keyboard shortcuts). */
export function switchMode(mode: PaletteMode): PaletteState {
  return initialState(mode);
}

/**
 * ⌫ on an empty input: back one step (with what was typed before it), or out of a prefix mode to
 * go-to. Null when there is nowhere to go back to, so the key does nothing.
 */
export function back(state: PaletteState): PaletteState | null {
  if (state.steps.length > 0) {
    const steps = state.steps.slice(0, -1);
    const query = state.saved.at(-1) ?? '';
    // "+" has no list of its own before its first step: leaving that step leaves the mode.
    if (steps.length === 0 && state.mode === 'new') return { mode: 'goto', query: '', steps: [], saved: [] };
    return { ...state, steps, saved: state.saved.slice(0, -1), query };
  }
  if (state.mode !== 'goto') return initialState('goto');
  return null;
}

/**
 * The project in the prompt step was clicked: pick another one from the whole list, taking the
 * prompt along (`from`). Back to the project list it came from, or one in its place when the step
 * was opened straight for a project (New session in this project).
 */
export function changeProject(state: PaletteState): PaletteState {
  const step = currentStep(state);
  if (step?.kind !== 'prompt') return state;
  const before = state.steps.at(-2);
  if (before?.kind === 'projects' && before.purpose === 'new-session') {
    return { ...state, steps: [...state.steps.slice(0, -2), { ...before, from: step.root }], saved: state.saved.slice(0, -1), query: '' };
  }
  const projects: PaletteStep = { kind: 'projects', purpose: 'new-session', worktree: step.worktree, chip: step.chip, from: step.root };
  return { ...state, steps: [...state.steps.slice(0, -1), projects], query: '' };
}
