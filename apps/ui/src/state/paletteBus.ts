import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { ImageAttachment, PromptScope, SavedPrompt } from '@switchboard/protocol/client';
import type { NewSessionRequest, SessionRequest } from '../components/palette/commands.ts';
import type { Choices } from '../components/newSession/choices.ts';
import { useSessions } from './sessionsStore.ts';

/** What the active session view tells the palette about its conversation: your prompts (to fork from or rewind to) and Claude's last reply. */
export interface SessionDigest {
  sessionId: string;
  /** Your top-level prompts, oldest first, with the message before each (forking there leaves the prompt out). */
  prompts: Array<{ uuid: string; text: string; at: number | null; before: string | null }>;
  /** The newest message (forking there copies the whole conversation). */
  lastUuid: string | null;
  lastReply: string | null;
}

/** What New session tells the palette, so its commands only show when they can do something. */
export interface NewSessionInfo {
  canWorktree: boolean;
  canSaveDefaults: boolean;
  /** There is a prompt and a folder: it can go to the queue. */
  canQueue: boolean;
  /** The picked folder is a git checkout with a remote: it can fetch, and pull when behind. */
  canCatchUp: boolean;
  /** The picked folder (not a quick question's): New session from an issue or pull request works on it. */
  root?: string | null;
}

/** Dialogs a palette command opens after the palette has closed. `PaletteDialogs` renders them. */
export type PaletteDialog =
  | { kind: 'rename-session'; sessionId: string; title: string }
  | { kind: 'delete-session'; sessionId: string; title: string }
  | { kind: 'rename-project'; root: string }
  | { kind: 'revert-all'; cwd: string; paths: string[] }
  | { kind: 'transcript-diagnosis'; sessionId: string; title: string | null }
  | { kind: 'share-memory'; root: string; memoryPath: string; name: string }
  | { kind: 'copy-section'; root: string; file: string }
  | { kind: 'memory-import'; source: { kind: 'export'; paths: string[] } | { kind: 'paste' } }
  | { kind: 'memory-copy-app' }
  | { kind: 'remember'; text: string; from: 'user' | 'claude'; sessionId: string | null; root: string | null }
  /** New session from an issue or pull request: the # list on its own, for `root`. */
  | { kind: 'github-start'; type: 'issue' | 'pr'; root: string }
  /**
   * The saved prompt editor: New prompt (`editing` null), Edit, or Save as prompt (`text` from a sent message, whose
   * links, branches and paths it offers as blanks). `root` is the project it was opened in (null: none), `scope` where
   * a new one goes.
   */
  | { kind: 'prompt-editor'; editing: SavedPrompt | null; text?: string; fromMessage?: boolean; root: string | null; scope?: PromptScope };

/** A prompt the palette moves into the full New session view (⌘E), with the choices made there. */
export interface NewSessionHandoff {
  root: string;
  prompt: string;
  attachments: ImageAttachment[];
  choices: Choices;
  worktree: boolean;
  profileId: string | null;
  nonce: number;
}

interface PaletteBusState {
  /** The active session view opens a dialog or menu it owns (`rewind` carries the message). */
  sessionRequest: { kind: SessionRequest | 'rewind'; arg?: string; nonce: number } | null;
  newSessionRequest: { kind: NewSessionRequest; nonce: number } | null;
  handoff: NewSessionHandoff | null;
  newSessionInfo: NewSessionInfo | null;
  digest: SessionDigest | null;
  dialog: PaletteDialog | null;
  requestSession(kind: SessionRequest | 'rewind', arg?: string): void;
  requestNewSession(kind: NewSessionRequest): void;
  handOff(handoff: Omit<NewSessionHandoff, 'nonce'>): void;
  /** New session takes the hand-off once. */
  takeHandoff(): NewSessionHandoff | null;
  showDialog(dialog: PaletteDialog | null): void;
}

let nonce = 0;

/** Requests from the command palette to the views that own what a command opens, and what those views publish back. */
export const usePaletteBus = create<PaletteBusState>()((set, get) => ({
  sessionRequest: null,
  newSessionRequest: null,
  handoff: null,
  newSessionInfo: null,
  digest: null,
  dialog: null,
  requestSession: (kind, arg) => set({ sessionRequest: { kind, arg, nonce: ++nonce } }),
  requestNewSession: (kind) => set({ newSessionRequest: { kind, nonce: ++nonce } }),
  handOff: (handoff) => set({ handoff: { ...handoff, nonce: ++nonce } }),
  takeHandoff: () => {
    const handoff = get().handoff;
    if (handoff) set({ handoff: null });
    return handoff;
  },
  showDialog: (dialog) => set({ dialog }),
}));

export type SessionRequestMessage = NonNullable<PaletteBusState['sessionRequest']>;

/**
 * Calls `handle` for each request the palette sends the session view, while `enabled` (the active pane,
 * with the session view on screen). Requests from before the caller mounted, or sent to the other pane, are passed over.
 */
export function useSessionRequests(enabled: boolean, handle: (request: SessionRequestMessage) => void): void {
  const request = usePaletteBus((s) => s.sessionRequest);
  const seen = useRef(usePaletteBus.getState().sessionRequest?.nonce ?? 0);
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    if (!request || request.nonce === seen.current) return;
    seen.current = request.nonce;
    if (enabled && useSessions.getState().view === 'session') latest.current(request);
  }, [request, enabled]);
}
