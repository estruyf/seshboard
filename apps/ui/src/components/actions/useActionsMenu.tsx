import { Settings2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isAbsolutePath, type ListedAction } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { passFocusGate } from '../../state/focusGate.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { useSessionRequests } from '../../state/paletteBus.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import type { MenuEntry } from '../Menu.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { ActionEditor, DeleteActionDialog } from './ActionEditor.tsx';
import { applySavedAction, withoutAction } from './actionForm.ts';
import { appKeyInTerminal, sameShortcut } from '../../lib/shortcuts.ts';
import { ACTION_ICON, formatShortcut, shortcutFromEvent, useProjectActionList } from './useActions.ts';

export interface ActionsMenu {
  entries: MenuEntry[];
  overlays: ReactNode;
  error: string | null;
  /** The project's actions, for the pills above the message box. */
  actions: ListedAction[];
  /** Runs an action (asking first when it needs trust or confirmation). */
  run: (action: ListedAction) => void;
  /** Opens the action editor; null when the session has no project to keep actions for. */
  openEditor: (() => void) | null;
  /** Opens the editor on one action (Edit… in its context menu). */
  edit: (action: ListedAction) => void;
  /** Asks, then deletes the action (Delete… in its context menu). */
  askDelete: (action: ListedAction) => void;
  /** A short confirmation after a save or delete ("Action saved"), cleared after a moment. */
  status: string | null;
}

/**
 * Project actions for the session view: a menu entry per action (with its shortcut) and
 * "Edit actions…", plus the dialogs they open (`overlays`, rendered by the caller). Also runs actions
 * from their shortcuts and from the command palette. Shell actions open a terminal tab; prompt
 * actions message Claude. `error`: the last run that failed.
 * Call it once per session view: every call adds its own shortcut listener and dialogs. With two panes
 * both views call it, so only the `active` one answers shortcuts and palette requests, and only while
 * the session view is on screen (it stays mounted behind Settings).
 */
export function useActionsMenu({
  sessionId,
  projectRoot: root,
  cwd,
  active = true,
}: {
  sessionId: string;
  projectRoot: string | null;
  cwd: string | null;
  /** The pane people are working in; the other pane leaves shortcuts and palette requests to it. */
  active?: boolean;
}): ActionsMenu {
  // A session whose folder is unknown has no real project to keep actions for: saving would be refused.
  const projectRoot = root && isAbsolutePath(root) ? root : null;
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const { actions, sharedFile, errors, reload, update } = useProjectActionList(projectRoot);
  const togglePanel = useTerminals((s) => s.togglePanel);
  const setActive = useTerminals((s) => s.setActive);
  /** The open editor, and the action it starts on (`fresh`: a new action, from the palette's New action…). */
  const [editor, setEditor] = useState<{ action: ListedAction | null; fresh?: boolean } | null>(null);
  const [deleting, setDeleting] = useState<ListedAction | null>(null);
  const [status, flash] = useFlash();
  const [pending, setPending] = useState<{ action: ListedAction; reason: 'confirm' | 'trust' } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = async (action: ListedAction) => {
    if (!client || !projectRoot || !cwd) return;
    setError(null);
    // A prompt action messages Claude: through the focus limit's gate, like a message typed in the box. Shell actions don't start Claude.
    if (action.type === 'prompt' && (await passFocusGate({ target: sessionId })) !== 'start') return;
    try {
      const result = await client.call('actions.run', { sessionId, projectRoot, cwd, id: action.id });
      if (result.kind === 'terminal') {
        togglePanel(sessionId, true);
        setActive(sessionId, result.terminalId);
      }
    } catch (e) {
      setError(`Couldn't run “${action.name}”: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const run = (action: ListedAction) => {
    if (!action.trusted) setPending({ action, reason: 'trust' });
    else if (action.confirm) setPending({ action, reason: 'confirm' });
    else void execute(action);
  };

  // The command palette asks for an action by id. Only the active pane takes the request, so it runs once.
  const actionRequest = useOverlay((s) => s.actionRequest);
  useEffect(() => {
    if (!actionRequest || !active || useSessions.getState().view !== 'session') return;
    const action = actions.find((a) => a.id === actionRequest.id);
    useOverlay.getState().requestAction(null);
    if (action) runRef.current(action);
  }, [actionRequest, actions, active]);

  // Action shortcuts while this session is on screen.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const withShortcut = actions.filter((a) => a.shortcut);
    if (withShortcut.length === 0 || !active) return;
    const onKey = (event: KeyboardEvent) => {
      // Something else took the key (recording a shortcut in the action editor), a dialog is open, or
      // the session isn't on screen (Settings or another view is over it).
      if (event.defaultPrevented || useSessions.getState().view !== 'session' || document.querySelector('[aria-modal="true"]')) return;
      // In a terminal, the shell's keys stay the shell's (⌃C stops a running action): only ⌘ shortcuts run actions
      // there on macOS, Ctrl+Shift ones elsewhere.
      if (!appKeyInTerminal(event) && (event.target as HTMLElement | null)?.closest?.('.xterm')) return;
      const shortcut = shortcutFromEvent(event);
      const action = shortcut && withShortcut.find((a) => sameShortcut(a.shortcut!, shortcut));
      if (action) {
        event.preventDefault();
        runRef.current(action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, active]);

  // The palette's Edit actions… and New action…: only the active pane opens the editor.
  useSessionRequests(active && projectRoot !== null, (request) => {
    if (request.kind === 'edit-actions') setEditor({ action: null });
    else if (request.kind === 'new-action') setEditor({ action: null, fresh: true });
  });

  const edit = (action: ListedAction) => setEditor({ action });
  const askDelete = (action: ListedAction) => action.scope !== 'shared' && setDeleting(action);
  if (!projectRoot) return { entries: [], overlays: null, error: null, actions: [], run, openEditor: null, edit, askDelete, status: null };
  const openEditor = () => setEditor({ action: null });
  const entries: MenuEntry[] = [
    { heading: 'Project actions' },
    ...actions.map((a) => {
      const Icon = ACTION_ICON[a.icon];
      return {
        label: a.name,
        icon: <Icon size={13} />,
        ...(a.shortcut ? { hint: formatShortcut(a.shortcut) } : {}),
        onSelect: () => run(a),
        // What it runs, as on the buttons it used to have.
        data: { 'data-action': a.id, 'data-tooltip': `${a.type === 'prompt' ? 'Ask Claude: ' : ''}${a.command}` },
      } satisfies MenuEntry;
    }),
    { label: actions.length ? 'Edit actions…' : 'Add an action…', icon: <Settings2 size={13} />, onSelect: openEditor, data: { 'data-edit-actions': true } },
  ];

  const overlays = (
    <>
      {editor && (
        <ActionEditor
          projectRoot={projectRoot}
          actions={actions}
          sharedFile={sharedFile}
          errors={errors}
          initialAction={editor.action}
          initial={editor.fresh ? {} : null}
          onChanged={reload}
          onSaved={(saved, previous) => {
            // The pill changes now; the reload that follows confirms it.
            update((list) => applySavedAction(list, saved, previous));
            setEditor(null);
            flash('Action saved');
          }}
          onClose={() => setEditor(null)}
        />
      )}
      {deleting && (
        <DeleteActionDialog
          action={deleting}
          onConfirm={async () => {
            if (!client) throw new Error('Not connected to the engine');
            await client.call('actions.delete', { projectRoot: deleting.scope === 'global' ? null : projectRoot, id: deleting.id });
            update((list) => withoutAction(list, deleting));
            reload();
            flash('Action deleted');
          }}
          onClose={() => setDeleting(null)}
        />
      )}
      {pending && (
        <ConfirmDialog
          title={pending.reason === 'trust' ? `Run “${pending.action.name}” ${pending.action.scope === 'shared' ? 'from this repository' : 'from imported settings'}?` : `Run “${pending.action.name}”?`}
          confirmLabel={pending.reason === 'trust' ? 'Approve and run' : 'Run'}
          body={
            <>
              {pending.reason === 'trust' && (
                <p className="mb-2">
                  {pending.action.scope === 'shared' ? (
                    <>
                      This action comes from the project’s <code className="font-mono">.switchboard.json</code>. Check the command before you approve it; you won’t be asked
                      again unless it changes.
                    </>
                  ) : (
                    <>This action was imported from a settings file. Check the command before you approve it; you won’t be asked again.</>
                  )}
                </p>
              )}
              <pre className="max-h-48 overflow-auto rounded-md bg-sidebar px-2.5 py-1.5 font-mono text-ui whitespace-pre-wrap text-text">{pending.action.command}</pre>
            </>
          }
          onConfirm={async () => {
            if (pending.reason === 'trust' && client && projectRoot) {
              await client.call('actions.trust', { projectRoot, id: pending.action.id });
              reload();
            }
            await execute(pending.action);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
  return { entries, overlays, error, actions, run, openEditor, edit, askDelete, status };
}
