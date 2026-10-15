import { Check, Image, Pencil, Plus, RotateCcw, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ListedAction, ProjectDefaults, ProjectInfo, WorktreeStatus } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { formatShortcut } from '../../lib/shortcuts.ts';
import { useBranchRows } from '../../state/branchesStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { openProject, type ProjectTab } from '../../state/projectPageStore.ts';
import { useProfile, useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { projectOf } from '../../state/queue.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { sidebarGroups, sidebarOrder } from '../../state/sidebarOrder.ts';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { buildSessionList, GROUP_LABEL as SESSION_GROUP_LABEL, rowStatus, waitingLabel } from '../../state/sidebarRows.ts';
import { useListedRows, useQueue } from '../../state/useQueue.ts';
import { useWorktreeRows, useWorktreeSizes } from '../../state/worktreesStore.ts';
import { ActionEditor } from '../actions/ActionEditor.tsx';
import { branchSummary } from '../branches/branchGroups.ts';
import { ACTION_ICON } from '../actions/actionIcon.ts';
import { useProjectActionList } from '../actions/useActions.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { QueuedInProject } from '../queue/QueuedInProject.tsx';
import { reviewOf, SessionRow } from '../sidebar/Sidebar.tsx';
import { useSessionMenu } from '../sidebar/useSessionMenu.tsx';
import { useProjectActions } from '../sidebar/ProjectMenu.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { Select } from '../ui/Select.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { formatBytes, worktreeSummary } from '../worktrees/worktreeGroups.ts';
import { ProjectDefaultsEditor } from './ProjectDefaultsEditor.tsx';
import { indexLevel } from '../memory/loadOrderView.ts';
import { useMemoryList } from '../memory/useMemoryList.ts';
import { LEVEL_TEXT } from '../../lib/levels.ts';
import { MEMORY_INDEX_LIMIT } from '@switchboard/protocol/client';
import { RenameProjectDialog } from './RenameProjectDialog.tsx';

/** Re-renders relative ages once a minute. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The sessions the sidebar lists in one project. */
export function useProjectSessionRows(root: string) {
  const rows = useListedRows();
  return useMemo(() => rows.filter((row) => row.projectRoot === root), [rows, root]);
}

/** The project's queued prompts. */
export function useProjectQueue(root: string) {
  const { entries } = useQueue();
  return useMemo(() => entries.filter((e) => projectOf(e.item.cwd) === root), [entries, root]);
}

/** One of the Overview's cards: a small heading and a line, opening its tab. */
function OverviewCard({ title, tab, root, children }: { title: string; tab: ProjectTab; root: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => openProject(root, tab)} className="grid gap-1.5 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-border/30" data-overview-card={tab}>
      <SectionHeader>{title}</SectionHeader>
      <span className="truncate text-body">{children}</span>
    </button>
  );
}

const sep = <span className="text-faint"> · </span>;

/** Overview: one card per area (sessions, worktrees, branches, the queue, git), each opening its tab. */
export function ProjectOverview({ root, status }: { root: string; status: WorktreeStatus | null }) {
  const sessions = useProjectSessionRows(root);
  const memory = useMemoryList(root);
  const queue = useProjectQueue(root);
  const { state, rows } = useWorktreeRows(root);
  const sizes = useWorktreeSizes(state.list);
  const branches = useBranchRows(root);
  const branchCounts = branchSummary(branches.rows);
  const working = sessions.filter((row) => rowStatus(row) === 'running').length;
  const needsYou = sessions.filter((row) => rowStatus(row) === 'needs-you').length;
  const summary = worktreeSummary(rows, sizes);
  const ready = queue.filter((e) => e.state === 'ready').length;
  const remote = status?.upstream?.split('/')[0] ?? 'origin';
  return (
    <div className="grid grid-cols-2 gap-3 @max-[640px]:grid-cols-1" data-project-overview>
      <OverviewCard title="Sessions" tab="sessions" root={root}>
        {working > 0 && (
          <>
            <span className="text-accent-ink">{working} working</span>
            {sep}
          </>
        )}
        {needsYou > 0 && (
          <>
            <span className="text-warn">{needsYou} needs you</span>
            {sep}
          </>
        )}
        {sessions.length} total
      </OverviewCard>
      <OverviewCard title="Worktrees" tab="worktrees" root={root}>
        {state.notRepo ? (
          <span className="text-muted">Not a git repository</span>
        ) : !state.list ? (
          <span className="text-muted">Reading…</span>
        ) : (
          <>
            {summary.count}
            {summary.bytes > 0 && (
              <>
                {sep}
                {formatBytes(summary.bytes)}
              </>
            )}
            {sep}
            <span className={summary.safe ? 'text-ok' : 'text-muted'}>{summary.safe} safe to remove</span>
          </>
        )}
      </OverviewCard>
      <OverviewCard title="Branches" tab="branches" root={root}>
        {branches.state.notRepo ? (
          <span className="text-muted">Not a git repository</span>
        ) : !branches.state.list ? (
          <span className="text-muted">Reading…</span>
        ) : (
          <>
            {branchCounts.local} local
            {branchCounts.remote > 0 && (
              <>
                {sep}
                {branchCounts.remote} on {branches.state.list.remotes.length === 1 ? branches.state.list.remotes[0] : 'remotes'}
              </>
            )}
            {sep}
            <span className={branchCounts.safe ? 'text-ok' : 'text-muted'}>{branchCounts.safe} safe to delete</span>
          </>
        )}
      </OverviewCard>
      <OverviewCard title="Memory" tab="memory" root={root}>
        {!memory.list ? (
          <span className="text-muted">Reading…</span>
        ) : (
          <>
            {memory.list.memories.length} {memory.list.memories.length === 1 ? 'memory' : 'memories'}
            {memory.list.indexLines > 0 && (
              <>
                {sep}
                <span className={LEVEL_TEXT[indexLevel(memory.list.indexLines)] || 'text-muted'}>
                  MEMORY.md {memory.list.indexLines}/{MEMORY_INDEX_LIMIT}
                </span>
              </>
            )}
          </>
        )}
      </OverviewCard>
      {queue.length > 0 && (
        <OverviewCard title="Queue" tab="sessions" root={root}>
          {queue.length} queued
          {ready > 0 && (
            <>
              {sep}
              <span className="text-ok">{ready} ready</span>
            </>
          )}
        </OverviewCard>
      )}
      <OverviewCard title="Git" tab="branches" root={root}>
        {status ? (
          <>
            {status.branch ?? 'detached HEAD'}
            {status.behindUpstream ? (
              <>
                {sep}
                {status.behindUpstream} behind {remote}
              </>
            ) : null}
            {status.unpushed ? (
              <>
                {sep}
                {status.unpushed} to push
              </>
            ) : null}
            {sep}
            {status.uncommitted === 0 ? 'no changes' : `${status.uncommitted} changed ${status.uncommitted === 1 ? 'file' : 'files'}`}
          </>
        ) : (
          <span className="text-muted">{state.notRepo ? 'Not a git repository' : 'Reading…'}</span>
        )}
      </OverviewCard>
    </div>
  );
}

/**
 * Sessions: the project's sessions with the sidebar's rows and grouping (Needs you, Working, then by day), its queue,
 * and its archived sessions in their own section at the end, closed unless nothing else is listed.
 */
export function ProjectSessions({ root, name }: { root: string; name: string }) {
  const rows = useProjectSessionRows(root);
  const now = useNow();
  const permissions = useHosts((s) => s.permissions);
  const catchUps = useCatchUp((s) => s.cards);
  const archiveAfterDays = usePreferences((s) => s.prefs.archiveAfterDays);
  const groups = useMemo(() => sidebarGroups(rows, { now, archiveAfterDays, project: root }), [rows, now, archiveAfterDays, root]);
  const archived = useMemo(() => buildSessionList(rows, { search: '', project: root, now, archiveAfterDays }).archived, [rows, now, archiveAfterDays, root]);
  const [archivedOpen, setArchivedOpen] = useState<boolean | null>(null);
  const showArchived = archivedOpen ?? groups.length === 0;
  const order = useMemo(() => [...sidebarOrder(groups), ...(showArchived ? archived : [])].map((row) => row.id), [groups, archived, showArchived]);
  const menus = useSessionMenu(order);
  const waitingTool = useMemo(() => new Map([...permissions.values()].map((p) => [p.sessionId, p.toolName])), [permissions]);
  const startHere = () => {
    useProjects.getState().startIn(root);
    useSessions.getState().openNewSession();
  };
  const row = (data: SessionRowData, isArchived: boolean) => (
    <SessionRow
      key={data.id}
      data={data}
      selected={false}
      archived={isArchived}
      picked={false}
      picking={false}
      now={now}
      tabbable
      waitingFor={rowStatus(data) === 'needs-you' ? waitingLabel(waitingTool.get(data.id) ?? null) : null}
      draft={null}
      review={reviewOf(catchUps.get(data.id))}
      outside={(catchUps.get(data.id)?.signals.outOfScope.length ?? 0) > 0}
      onClick={(event, clicked) => (event.altKey ? useSessions.getState().openBeside(clicked.id) : useSessions.getState().select(clicked.id))}
      onTogglePick={() => {}}
      onMenu={menus.openSessionMenu}
      onMiddleClick={menus.middleClick}
    />
  );
  return (
    <div className="grid gap-4" data-project-sessions>
      <QueuedInProject cwd={root} projectName={name} now={now} />
      {rows.length === 0 ? (
        <div className="grid justify-items-start gap-2 rounded-xl border border-dashed border-border px-4 py-5">
          <p className="text-ui text-muted">No sessions in {name} yet.</p>
          <Button onClick={startHere}>New session</Button>
        </div>
      ) : (
        groups.map(({ group, rows: inGroup }) => (
          <section key={group} aria-label={SESSION_GROUP_LABEL[group]} className="grid gap-1">
            <SectionHeader count={inGroup.length} tone={group === 'needs-you' || group === 'working' ? group : 'neutral'} className="px-3">
              {SESSION_GROUP_LABEL[group]}
            </SectionHeader>
            <div className="grid gap-1">{inGroup.map((r) => row(r, false))}</div>
          </section>
        ))
      )}
      {archived.length > 0 && (
        <section aria-label="Archived" className="grid gap-1" data-project-archived>
          <SectionHeader
            count={archived.length}
            toggle={{
              expanded: showArchived,
              onToggle: () => setArchivedOpen(!showArchived),
              leading: true,
              tooltip: `Quiet for ${archiveAfterDays === 1 ? 'a day' : `${archiveAfterDays} days`}, or archived by you. They come back when there is something new.`,
              data: { 'data-archived-toggle': true, 'data-open': showArchived },
            }}
            className="h-[22px] px-3"
          >
            Archived
          </SectionHeader>
          {showArchived && <div className="grid gap-1">{archived.map((r) => row(r, true))}</div>}
        </section>
      )}
      {menus.overlays}
    </div>
  );
}

const SCOPE_LABEL: Record<ListedAction['scope'], string> = { project: 'This project', shared: 'Shared (.switchboard.json)', global: 'Every project' };

/** Actions: the project's actions (yours, shared and global), each opening the editor; New action starts one. */
export function ProjectActionsTab({ root }: { root: string }) {
  const { actions, sharedFile, errors, reload } = useProjectActionList(root);
  const [editing, setEditing] = useState<{ action: ListedAction | null } | null>(null);
  const [status, flash] = useFlash();
  return (
    <div className="grid gap-3" data-project-actions-tab>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-ui text-muted">Actions run from the pills above the message box, the ⋯ menu and the command palette. Shell actions open a terminal tab; prompt actions message the session.</p>
        {status && (
          <Notice inline tone="success" icon={<Check size={12} aria-hidden />} data-action-status>
            {status}
          </Notice>
        )}
        <Button icon={<Settings2 size={13} aria-hidden />} onClick={() => setEditing({ action: actions[0] ?? null })} disabled={actions.length === 0} data-project-actions>
          Edit actions…
        </Button>
        <Button icon={<Plus size={13} aria-hidden />} onClick={() => setEditing({ action: null })} data-project-new-action>
          New action…
        </Button>
      </div>
      {errors.map((error) => (
        <Notice key={error} tone="warn">
          {error}
        </Notice>
      ))}
      {actions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-5 text-ui text-muted">No actions yet. New action… suggests some from the project's scripts.</div>
      ) : (
        <ul className="grid rounded-xl border border-border bg-card">
          {actions.map((action) => {
            const Icon = ACTION_ICON[action.icon];
            return (
              <li key={`${action.scope}:${action.id}`} className="border-t border-border first:border-t-0">
                <button type="button" onClick={() => setEditing({ action })} className="flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left hover:bg-border/45" data-project-action={action.id}>
                  <Icon size={14} className="shrink-0 text-muted" aria-hidden />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-ui font-semibold">{action.name}</span>
                    <span className="truncate font-mono text-meta text-muted">{action.command}</span>
                  </span>
                  <span className="shrink-0 text-meta text-faint">{SCOPE_LABEL[action.scope]}</span>
                  {action.shortcut && <Kbd keys={action.shortcut} aria-label={formatShortcut(action.shortcut)} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <ActionEditor
          projectRoot={root}
          actions={actions}
          sharedFile={sharedFile}
          errors={errors}
          initialAction={editing.action}
          initial={editing.action ? null : {}}
          onChanged={reload}
          onSaved={() => {
            setEditing(null);
            flash('Action saved');
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Which Claude profile (account) new sessions in the project use; shown once there is more than one. */
function ProfilePicker({ project }: { project: ProjectInfo }) {
  const profiles = useProfiles((s) => s.profiles);
  const actions = useProjectActions();
  if (profiles.length < 2) return null;
  const fallback = profiles.find((p) => p.isDefault);
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 @max-[560px]:grid-cols-1 @max-[560px]:gap-1">
      <span className="text-ui text-muted">Claude profile</span>
      <span className="flex min-w-0 items-center gap-2">
        <Select
          label="Claude profile"
          className="h-7 min-w-0 rounded-md border border-border bg-bg px-2 text-ui text-text outline-none focus:border-accent-ink/60"
          value={project.profileId ?? ''}
          onChange={(value) => void actions.setProfile(project.root, value || null)}
          options={[{ value: '', label: `Default${fallback ? ` (${fallback.name})` : ''}` }, ...profiles.map((p) => ({ value: p.id, label: p.name, hint: p.account?.email ?? undefined }))]}
          menuWidth={320}
          dataAttrs={{ 'data-project-profile': true }}
        />
      </span>
    </div>
  );
}

/** Settings: the profile and choices new sessions in the project start with, and its name and icon in Switchboard. */
export function ProjectSettingsTab({ project, isGitRepo }: { project: ProjectInfo; isGitRepo: boolean }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const reload = useProjects((s) => s.reload);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const projectActions = useProjectActions();
  // Fields the project leaves unset come from its profile's defaults.
  const profile = useProfile(project.profileId);
  const save = async (defaults: ProjectDefaults) => {
    if (!client) return;
    try {
      setError(null);
      await client.call('projects.setDefaults', { root: project.root, defaults });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="grid max-w-2xl gap-3" data-project-defaults-tab>
      <p className="text-ui text-muted">New sessions in {project.name} start with these. The New session view can still change them for one session.</p>
      <ProfilePicker project={project} />
      <ProjectDefaultsEditor root={project.root} defaults={project.defaults} isGitRepo={isGitRepo} profile={profile?.defaults} onSave={(d) => void save(d)} />
      {error && (
        <p role="alert" className="text-ui text-error">
          Couldn't save the defaults: {error}
        </p>
      )}
      <div className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 border-t border-border pt-3 @max-[560px]:grid-cols-1 @max-[560px]:gap-1">
        <span className="text-ui text-muted">Name</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-ui">{project.name}</span>
          <Button size="sm" icon={<Pencil size={12} aria-hidden />} onClick={() => setRenaming(true)} data-project-rename>
            Rename…
          </Button>
        </span>
        <span className="text-ui text-muted">Icon</span>
        <span className="flex min-w-0 items-center gap-2">
          <ProjectIcon project={project} root={project.root} size={20} />
          <Button size="sm" icon={<Image size={12} aria-hidden />} onClick={() => void projectActions.chooseImage(project.root)} data-project-choose-image>
            Choose image…
          </Button>
          {/* Back to the icon found in the folder (or the letter) after picking one. */}
          {project.iconSource === 'custom' && (
            <Button size="sm" variant="quiet" icon={<RotateCcw size={12} aria-hidden />} onClick={() => void projectActions.setIcon(project.root, { kind: 'auto' })} data-project-reset-icon>
              Detect automatically
            </Button>
          )}
        </span>
      </div>
      {renaming && <RenameProjectDialog root={project.root} onClose={() => setRenaming(false)} />}
    </div>
  );
}
