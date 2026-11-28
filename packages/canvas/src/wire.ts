/*
 * What Seshboard and a canvas's process say to each other, over Node's IPC channel (docs/canvases.md). Plain
 * TypeScript: the engine reads it, and so does the SDK the canvas imports.
 */

/** The API version a canvas is written for. Seshboard keeps the older ones working. */
export const CANVAS_API = 1;

/** An action as the agent sees it: its handler stays in the canvas's process. */
export interface CanvasActionInfo {
  name: string;
  description: string;
  /** JSON Schema of its input. */
  input?: unknown;
}

/** What a canvas says about itself once its process runs. */
export interface CanvasInfo {
  api: number;
  name: string;
  description: string;
  actions: CanvasActionInfo[];
}

/** What every handler gets: which instance, and where it runs. */
export interface CanvasContext {
  /** One per canvas and folder: opening it again shows the same page. */
  instance: string;
  /** The folder the canvas works in: the session's checkout (a worktree has its own). */
  folder: string;
  /** What `open` was asked to show, when the caller said. */
  input?: unknown;
}

export type CanvasLogLevel = 'info' | 'warn' | 'error';

/** What Seshboard tells a canvas about where it shows. */
export interface CanvasHostContext {
  /** The folder the canvas works in. */
  folder: string;
  /** The folder's git branch, when it has one. */
  branch: string | null;
  /** Seshboard's look now. The page's own `prefers-color-scheme` follows it too. */
  theme: 'light' | 'dark';
  /** The session whose panel showed the canvas last, or null before any did. */
  session: { id: string; title: string } | null;
}

/**
 * Something for the message box, next to the text: a file (with lines `[start, end]`, counted from 1), or text that is
 * not a file on disk, under a title. Paths are absolute, or from the canvas's folder.
 */
export type CanvasChip = { file: string; lines?: [number, number] } | { title: string; text: string; file?: string; lines?: [number, number]; language?: string };

/** What `host.compose` puts in the message box of the session that shows the canvas. Nothing is sent. */
export interface CanvasCompose {
  text?: string;
  chips?: CanvasChip[];
}

/** Seshboard to the canvas. Each gets one `result` with the same `id`. */
export type ToCanvas =
  | { type: 'open'; id: number; ctx: CanvasContext }
  | { type: 'close'; id: number; ctx: CanvasContext }
  | { type: 'action'; id: number; name: string; input: unknown; ctx: CanvasContext }
  /** Where the canvas shows changed (a theme switch, another session, a branch). No answer. */
  | { type: 'context'; context: CanvasHostContext };

/** The canvas to Seshboard. */
export type FromCanvas =
  | { type: 'ready'; canvas: CanvasInfo }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: string }
  | { type: 'log'; level: CanvasLogLevel; message: string }
  | { type: 'compose'; compose: CanvasCompose };

const ACTION_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

/** A canvas's registration as Seshboard accepts it, or what is wrong with it, in words for the person who wrote it. */
export function readCanvasInfo(raw: unknown): CanvasInfo | string {
  const info = (raw ?? {}) as Record<string, unknown>;
  if (info.api !== CANVAS_API) return `This canvas is written for API ${String(info.api)}. This Seshboard runs API ${CANVAS_API}.`;
  if (!text(info.name, 40)) return 'A canvas needs a name of at most 40 characters.';
  if (!text(info.description, 300)) return 'A canvas needs a description of at most 300 characters.';
  if (!Array.isArray(info.actions) || info.actions.length > 50) return 'A canvas has at most 50 actions.';
  const actions: CanvasActionInfo[] = [];
  for (const action of info.actions as Array<Record<string, unknown>>) {
    if (!text(action?.name, 64) || !ACTION_NAME.test(action.name)) return `An action's name is lowercase letters, digits and underscores: ${String(action?.name)}`;
    if (!text(action.description, 300)) return `The action ${action.name} needs a description of at most 300 characters.`;
    if (actions.some((a) => a.name === action.name)) return `Two actions are named ${action.name}.`;
    actions.push({ name: action.name, description: action.description, ...(action.input !== undefined ? { input: action.input } : {}) });
  }
  return { api: CANVAS_API, name: info.name, description: info.description, actions };
}

/** A message from the canvas's process, or null for anything else. */
export function readFromCanvas(raw: unknown): FromCanvas | null {
  const message = raw as Record<string, unknown> | null;
  if (!message || typeof message !== 'object') return null;
  if (message.type === 'ready') return { type: 'ready', canvas: message.canvas as CanvasInfo };
  if (message.type === 'log' && typeof message.message === 'string') {
    const level = message.level === 'warn' || message.level === 'error' ? message.level : 'info';
    return { type: 'log', level, message: message.message.slice(0, 4000) };
  }
  if (message.type === 'compose' && message.compose && typeof message.compose === 'object') {
    const compose = message.compose as Record<string, unknown>;
    return { type: 'compose', compose: { ...(typeof compose.text === 'string' ? { text: compose.text } : {}), ...(Array.isArray(compose.chips) ? { chips: compose.chips.slice(0, 20) as CanvasChip[] } : {}) } };
  }
  if (message.type === 'result' && typeof message.id === 'number') {
    return message.ok === true ? { type: 'result', id: message.id, ok: true, value: message.value } : { type: 'result', id: message.id, ok: false, error: typeof message.error === 'string' ? message.error.slice(0, 2000) : 'The canvas failed.' };
  }
  return null;
}
