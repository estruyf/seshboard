import { Bot, Code, Ellipsis, Pencil, Play, ScrollText, Sparkles, Square, Stethoscope } from 'lucide-react';
import { useRef, useState } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { toast } from '../../state/toastStore.ts';
import { useMultipleProfiles, useProfile } from '../../state/profilesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { startAfter } from '../../state/startAfterStore.ts';
import { openTerminal } from '../../state/terminalsStore.ts';
import type { ActionsMenu } from '../actions/useActionsMenu.tsx';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { useOpenInEntries } from '../OpenInButton.tsx';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import { sessionMemoryEntries, useSessionMemories } from '../memory/sessionMemories.tsx';
import { RenameSessionDialog } from '../RenameSessionDialog.tsx';
import { Button } from '../ui/Button.tsx';

const MENU_WIDTH = 260;

/**
 * The session header's "⋯" menu: opening the folder in an editor, terminal or Finder (⌘O opens the
 * default one), opening the session in Claude Code's terminal interface, the project's actions (and "Edit actions…"), the agents Claude
 * started, the Claude profile the session bills to, renaming the session, checking its transcript, and stopping its Claude Code process.
 * A dot on the button says agents are running. The project actions come from the session view's
 * single `useActionsMenu` (it also feeds the pills above the message box and renders the dialogs).
 */
export function MoreMenu({
  sessionId,
  actions,
  cwd,
  agents,
  onAgents,
  commands,
  onCommands,
  profileId,
  title,
  onStop,
}: {
  sessionId: string;
  actions: ActionsMenu;
  cwd: string | null;
  /** How many agents Claude started in this session, and how many of them still run. */
  agents: { total: number; running: number };
  /** Shows the Agents panel (or brings it to the front); null leaves the entry out. */
  onAgents: (() => void) | null;
  /** How many commands Claude ran in the background in this session, and how many of them still run. */
  commands: { total: number; running: number };
  /** Shows the Commands panel (or brings it to the front); null leaves the entry out. */
  onCommands: (() => void) | null;
  profileId: string | null;
  /** The session's title; null while it has no transcript to keep a new one in. */
  title: string | null;
  /** Stops the Claude Code process for this session; null when it isn't running here. */
  onStop: (() => void) | null;
}) {
  const menu = useMenu();
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Start after this one… opens New session on the session's project.
  const projectRoot = useSessions((s) => s.sessions.get(sessionId)?.projectRoot) ?? cwd;
  const { total, running } = agents;
  const [renaming, setRenaming] = useState(false);
  const multipleProfiles = useMultipleProfiles();
  const profile = useProfile(profileId);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;

  const memories = useSessionMemories(sessionId, !!menu.at);
  const openIn = useOpenInEntries(cwd);
  const hasVSCode = useHosts((s) => s.editors.some((e) => e.id === 'vscode'));
  const busy = useHosts((s) => {
    const state = s.hosts.get(sessionId)?.state;
    return state === 'starting' || state === 'running' || state === 'needs-you';
  });

  // Claude Code's own terminal interface on this session, in the terminal panel: with the editors under "Open in", before Copy path.
  const claudeTui: MenuEntry = {
    label: openIn.entries.length ? 'Claude Code' : 'Open in Claude Code',
    icon: <Sparkles size={13} />,
    hint: 'Terminal',
    disabled: !client || !cwd,
    onSelect: () => void (client && cwd && openTerminal(client, sessionId, cwd, 'claude')),
    data: { 'data-open-claude-tui': true, 'data-tooltip': "This session in Claude Code's terminal interface, in the terminal panel (mods, status line and every CLI feature)" },
  };
  const copyPath = openIn.entries.findIndex((e) => typeof e === 'object' && 'data' in e && e.data?.['data-copy-path']);
  const entries: MenuEntry[] = [...openIn.entries];
  entries.splice(copyPath < 0 ? entries.length : copyPath, 0, claudeTui);
  // Hands the conversation to Claude Code's VS Code extension: it stops here, then opens there.
  if (hasVSCode) {
    entries.splice(entries.indexOf(claudeTui) + 1, 0, {
      label: 'Continue in VS Code',
      icon: <Code size={13} />,
      disabled: !client || !cwd || title === null || busy,
      onSelect: () =>
        void client
          ?.call('session.continueInEditor', { sessionId, editorId: 'vscode' })
          .catch((error: Error) => toast(`Couldn't continue in VS Code: ${error.message}`)),
      data: {
        'data-continue-in-vscode': true,
        'data-tooltip': busy ? 'Wait for Claude to finish first' : "Stop the session here and open it in Claude Code's VS Code extension, in this folder's window",
      },
    });
  }
  entries.push('separator');
  entries.push(...actions.entries);
  if (actions.entries.length) entries.push('separator');
  entries.push(...sessionMemoryEntries(memories));
  // Like the profile badges elsewhere: only worth showing with more than one profile.
  if (multipleProfiles && profile) {
    entries.push({
      label: `Profile: ${profile.name}`,
      icon: <ProfileDot color={profile.color} />,
      hint: 'Switch…',
      onSelect: () => useSessions.getState().openSettings('profiles'),
      data: { 'data-profile-item': profile.id, 'data-tooltip': `Claude profile: ${profile.name}${profile.account?.email ? ` (${profile.account.email})` : ''}. Profiles are in Settings.` },
    });
  }
  entries.push(
    {
      label: 'Rename…',
      icon: <Pencil size={13} />,
      disabled: title === null,
      onSelect: () => setRenaming(true),
      data: { 'data-rename-session': true },
    },
    ...(onAgents
      ? [
          {
            label: 'Agents',
            icon: <Bot size={13} />,
            hint: running ? `${running} running` : total ? `${total} finished` : 'None',
            disabled: total === 0,
            onSelect: onAgents,
            data: { 'data-agents-button': true },
          },
        ]
      : []),
    ...(onCommands
      ? [
          {
            label: 'Commands',
            icon: <ScrollText size={13} />,
            hint: commands.running ? `${commands.running} running` : commands.total ? `${commands.total} finished` : 'None',
            disabled: commands.total === 0,
            onSelect: onCommands,
            data: { 'data-commands-button': true },
          },
        ]
      : []),
    {
      label: 'Start after this one…',
      icon: <Play size={12} />,
      disabled: !projectRoot,
      onSelect: () => projectRoot && startAfter({ id: sessionId, projectRoot }),
      data: { 'data-start-after': true, 'data-tooltip': 'Queue a prompt that starts by itself once this session finishes' },
    },
    {
      label: 'Check transcript…',
      icon: <Stethoscope size={13} />,
      disabled: !client,
      onSelect: () => usePaletteBus.getState().showDialog({ kind: 'transcript-diagnosis', sessionId, title }),
      data: { 'data-check-transcript': true, 'data-tooltip': 'Why the conversation shows the way it does: the transcript files, compactions and any error reading them' },
    },
    {
      label: 'Stop session',
      icon: <Square size={12} />,
      danger: true,
      disabled: onStop === null,
      onSelect: () => onStop?.(),
      data: { 'data-stop-session': true, 'data-tooltip': 'Stop the Claude Code process for this session. The conversation is kept; sending a message resumes it.' },
    },
  );

  const label = `More: open in, project actions, agents${running ? ` (${running} running)` : ''}, stop session`;
  const error = actions.error ?? openIn.error;
  return (
    <div className="no-drag relative flex shrink-0 items-center" data-actions-bar>
      {/* A failed action run: on the button's tooltip, and said out loud. */}
      {actions.error && (
        <span role="alert" className="sr-only">
          {actions.error}
        </span>
      )}
      {openIn.status}
      <Button
        ref={buttonRef}
        variant="quiet"
        iconOnly
        icon={<Ellipsis size={15} aria-hidden />}
        selected={menu.at !== null}
        data-more-menu
        // The project actions used to have their own ▾ button; the hook stays for tests.
        data-actions-menu
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (menu.at || !rect) menu.close();
          else menu.openAt(rect.right - MENU_WIDTH, rect.bottom + 4);
        }}
        data-tooltip={error ?? (running ? `More · ${running === 1 ? '1 agent' : `${running} agents`} running` : 'More: open in, project actions, agents, stop session')}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={menu.at !== null}
        className={`relative ${!menu.at && error ? 'text-error!' : ''}`}
      >
        {running > 0 && <span className="absolute top-0.5 right-0.5 size-1.5 animate-pulse rounded-full bg-accent-ink" aria-hidden />}
      </Button>
      {menu.at && <Menu x={menu.at.x} y={menu.at.y} width={MENU_WIDTH} entries={entries} onClose={menu.close} label="More" />}
      {renaming && title !== null && <RenameSessionDialog sessionId={sessionId} title={title} onClose={() => setRenaming(false)} />}
    </div>
  );
}
