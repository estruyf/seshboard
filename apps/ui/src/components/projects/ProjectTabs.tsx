import { Check, FolderOpen, GitBranch, Image, Plus, RotateCcw, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ListedAction, ProjectDefaults, ProjectInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { formatShortcut } from '../../lib/shortcuts.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { cleanUpWorktrees, openProject, type ProjectTab } from '../../state/projectPageStore.ts';
import { agoText, basename, shortAge, tildify } from '../../lib/format.ts';
import { fileManagerName } from '../../lib/platform.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { useTriggers } from '../../state/triggersStore.ts';
import { useMultipleProfiles, useProfile, useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { projectOf } from '../../state/queue.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { sidebarGroups, sidebarOrder } from '../../state/sidebarOrder.ts';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { buildSessionList, GROUP_LABEL as SESSION_GROUP_LABEL, rowStatus, waitingLabel } from '../../state/sidebarRows.ts';
import { useListedRows, useQueue } from '../../state/useQueue.ts';
import { useWorktreeRows } from '../../state/worktreesStore.ts';
import { ActionEditor } from '../actions/ActionEditor.tsx';
import { ACTION_ICON } from '../actions/actionIcon.ts';
import { useProjectActionList } from '../actions/useActions.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { QueuedInProject } from '../queue/QueuedInProject.tsx';
import { ProjectSchedules } from '../schedules/SchedulesCard.tsx';
import { reviewOf, SessionRow } from '../sidebar/Sidebar.tsx';
import { useSessionMenu } from '../sidebar/useSessionMenu.tsx';
import { RemoveProjectDialog, useProjectActions } from '../sidebar/ProjectMenu.tsx';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import { Pill } from '../ui/Pill.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { Select } from '../ui/Select.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { describeDefaults, hasDefaults, ProjectDefaultsEditor } from './ProjectDefaultsEditor.tsx';
import { defaultChips, overviewWorktrees, recentSessions, sessionState } from './projectOverview.ts';

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

/** A number in the Overview's top row, opening its tab where there is one. */
function Stat({ value, label, tab, root, tone = '' }: { value: React.ReactNode; label: React.ReactNode; tab?: ProjectTab; root: string; tone?: string }) {
  const body = (
    <>
      <span className={`text-title font-semibold tabular-nums ${tone}`}>{value}</span>
      <span className="truncate text-meta text-muted">{label}</span>
    </>
  );
  return tab ? (
    <button type="button" onClick={() => openProject(root, tab)} className="grid min-w-0 justify-items-start gap-0.5 rounded-md px-2 py-1 text-left hover:bg-border/45" data-overview-card={tab}>
      {body}
    </button>
  ) : (
    <div className="grid min-w-0 justify-items-start gap-0.5 px-2 py-1" data-overview-stat>
      {body}
    </div>
  );
}

/** One of the Overview's panels: a heading with a link to its tab ("All 205 ›"), and its rows. */
function OverviewPanel({ title, link, children, ...rest }: { title: string; link?: { label: string; onClick(): void; data?: Record<`data-${string}`, boolean> } | null; children: React.ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <section aria-label={title} className="grid min-w-0 content-start gap-2 rounded-xl border border-border bg-card px-4 py-3" {...rest}>
      <div className="flex items-center gap-2">
        <SectionHeader className="flex-1">{title}</SectionHeader>
        {link && (
          <button type="button" onClick={link.onClick} className="shrink-0 rounded text-ui font-semibold text-accent-ink hover:underline" {...link.data}>
            {link.label} ›
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

const WORKTREE_BADGE_TONE = { accent: 'accent', ok: 'ok', muted: 'muted' } as const;

/**
 * Overview: a row of numbers (working now, sessions, last active, worktrees, queued, triggers), each opening its
 * tab; the four newest sessions; the worktrees in use or ready to go, with Clean up; and how sessions start here.
 */
export function ProjectOverview({ project }: { project: ProjectInfo }) {
  const root = project.root;
  const sessions = useProjectSessionRows(root);
  const queue = useProjectQueue(root);
  const { state, rows } = useWorktreeRows(project.exists ? root : null);
  const triggers = useTriggers((s) => s.triggers.filter((t) => t.projectRoot === root).length);
  const profile = useProfile(project.profileId);
  const multipleProfiles = useMultipleProfiles();
  const now = useNow();
  const working = sessions.filter((row) => rowStatus(row) === 'running' || rowStatus(row) === 'needs-you').length;
  const others = rows.filter((r) => r.group !== 'main');
  const safe = others.filter((r) => r.group === 'safe').length;
  const recent = recentSessions(sessions);
  const worktrees = overviewWorktrees(rows);
  const chips = defaultChips(describeDefaults(project.defaults, hasDefaults(profile?.defaults) ? 'Profile defaults' : 'Global defaults'));
  return (
    <div className="grid gap-3" data-project-overview>
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-3 py-2.5" data-overview-stats>
        <Stat value={working} label="working now" tab="sessions" root={root} tone={working ? 'text-accent-ink' : ''} />
        <Stat value={sessions.length} label="sessions" tab="sessions" root={root} />
        <Stat value={project.lastActivity === null ? 'Never' : agoText(project.lastActivity, now)} label="last active" root={root} />
        {project.exists && !state.notRepo && (
          <Stat value={state.list ? others.length : '…'} label={<>worktrees{safe > 0 && <span className="text-ok"> · {safe} can go</span>}</>} tab="worktrees" root={root} />
        )}
        <Stat value={queue.length} label="queued" tab="sessions" root={root} />
        <Stat value={triggers} label="triggers" tab="triggers" root={root} />
      </div>
      <div className="grid grid-cols-2 gap-3 @max-[720px]:grid-cols-1">
        <OverviewPanel title="Recent sessions" link={sessions.length > 0 ? { label: `All ${sessions.length}`, onClick: () => openProject(root, 'sessions'), data: { 'data-overview-all-sessions': true } } : null} data-overview-recent>
          {recent.length === 0 ? (
            <p className="text-ui text-muted">No sessions in {project.name} yet.</p>
          ) : (
            <ul className="grid">
              {recent.map((row) => {
                const { label, dot } = sessionState(rowStatus(row));
                return (
                  <li key={row.id} className="border-t border-border first:border-t-0">
                    <button type="button" onClick={() => useSessions.getState().select(row.id)} className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-1 py-1.5 text-left hover:bg-border/45" data-overview-session={row.id}>
                      <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate text-ui font-semibold">{row.title}</span>
                        <span className="truncate text-meta text-muted">
                          {label}
                          {row.branch && ` · ${row.branch}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-meta text-muted tabular-nums">{shortAge(row.updatedAt, now)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </OverviewPanel>
        <OverviewPanel title="Worktrees" link={safe > 0 ? { label: `Clean up ${safe}`, onClick: () => cleanUpWorktrees(root), data: { 'data-overview-cleanup': true } } : null} data-overview-worktrees>
          {!project.exists || state.notRepo ? (
            <p className="text-ui text-muted">Not a git repository.</p>
          ) : !state.list ? (
            <p className="text-ui text-muted">Reading…</p>
          ) : worktrees.length === 0 ? (
            <p className="text-ui text-muted">{others.length === 0 ? 'No worktrees besides the main checkout.' : 'None in use, and none ready to remove.'}</p>
          ) : (
            <ul className="grid">
              {worktrees.map(({ row, badge }) => (
                <li key={row.entry.path} className="border-t border-border first:border-t-0">
                  <button type="button" onClick={() => openProject(root, 'worktrees')} className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-1 py-1.5 text-left hover:bg-border/45" data-overview-worktree={row.entry.path}>
                    <GitBranch size={13} className="shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-ui">{basename(row.entry.path)}</span>
                    <Pill tone={WORKTREE_BADGE_TONE[badge.tone]}>{badge.label}</Pill>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </OverviewPanel>
      </div>
      <OverviewPanel title="How sessions start here" link={{ label: 'Change in Settings', onClick: () => openProject(root, 'settings'), data: { 'data-overview-settings': true } }} data-overview-defaults>
        <div className="flex flex-wrap gap-1.5">
          {multipleProfiles && profile && (
            <Pill icon={<ProfileDot color={profile.color} />} data-overview-profile>
              {profile.name}
            </Pill>
          )}
          {chips.map((chip) => (
            <Pill key={chip}>{chip}</Pill>
          ))}
        </div>
      </OverviewPanel>
    </div>
  );
}

/**
 * Sessions: the project's sessions with the sidebar's rows and grouping (Needs you, Working, then by day), its queue,
 * its schedules,
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
      <ProjectSchedules root={root} now={now} />
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
          onSaved={(_saved, _previous, another) => {
            if (!another) setEditing(null);
            flash('Action saved');
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** One row of a project's Settings: the label on the left, the setting on the right, a line under it. */
function SettingRow({ label, hint, children, ...rest }: { label: string; hint?: React.ReactNode; children: React.ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-start gap-3 border-t border-border py-3 first:border-t-0 @max-[560px]:grid-cols-1 @max-[560px]:gap-1" {...rest}>
      <span className="pt-1.5 text-ui text-muted">{label}</span>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
        {hint && <p className="text-meta text-muted">{hint}</p>}
      </div>
    </div>
  );
}

/** The project's name in Switchboard, edited in place: ↩ or leaving the field saves it, Esc puts it back, empty is the folder's name. */
function NameField({ project }: { project: ProjectInfo }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const reload = useProjects((s) => s.reload);
  const [value, setValue] = useState(project.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Another project, or a rename from somewhere else (the row menu's dialog): show the name as it is now.
  useEffect(() => setValue(project.name), [project.root, project.name]);
  const folder = basename(project.root);
  const save = async () => {
    const next = value.replace(/\s+/g, ' ').trim();
    if (next === project.name || saving) return;
    if (!client) return setError('Not connected to the engine');
    setSaving(true);
    setError(null);
    try {
      await client.call('projects.rename', { root: project.root, name: next && next !== folder ? next : null });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          } else if (e.key === 'Escape' && value !== project.name) {
            e.preventDefault();
            setValue(project.name);
          }
        }}
        placeholder={folder}
        aria-label="Name"
        aria-busy={saving || undefined}
        className="h-8 w-72 max-w-full min-w-0 rounded-md border border-border bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink/60"
        data-project-name-input
      />
      {error && (
        <p role="alert" className="w-full text-meta text-error">
          Couldn't rename it: {error}
        </p>
      )}
    </>
  );
}

/** Settings: one row per setting (name, icon, folder, Claude profile, defaults), and Remove at the end. */
export function ProjectSettingsTab({ project, isGitRepo }: { project: ProjectInfo; isGitRepo: boolean }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const reload = useProjects((s) => s.reload);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const projectActions = useProjectActions();
  const profiles = useProfiles((s) => s.profiles);
  const home = useHomeFolder();
  // Fields the project leaves unset come from its profile's defaults.
  const profile = useProfile(project.profileId);
  const fallback = profiles.find((p) => p.isDefault);
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
    <div className="grid max-w-3xl" data-project-defaults-tab>
      <SettingRow label="Name" hint={`Only Switchboard uses this name. The folder stays ${basename(project.root)}.`}>
        <NameField project={project} />
      </SettingRow>
      <SettingRow label="Icon">
        <ProjectIcon project={project} root={project.root} size={22} />
        <Button size="sm" icon={<Image size={12} aria-hidden />} onClick={() => void projectActions.chooseImage(project.root)} data-project-choose-image>
          Choose image…
        </Button>
        {/* Back to the icon found in the folder (or the letter) after picking one. */}
        {project.iconSource === 'custom' ? (
          <Button size="sm" variant="quiet" icon={<RotateCcw size={12} aria-hidden />} onClick={() => void projectActions.setIcon(project.root, { kind: 'auto' })} data-project-reset-icon>
            Detect automatically
          </Button>
        ) : (
          <span className="text-meta text-muted">{project.iconSource === 'detected' ? "Found in the folder, such as the site's favicon" : 'The first letter of the name'}</span>
        )}
      </SettingRow>
      <SettingRow label="Folder">
        <span className="min-w-0 truncate font-mono text-ui" data-tooltip={project.root}>
          {tildify(project.root, home)}
        </span>
        <Button
          size="sm"
          icon={<FolderOpen size={12} aria-hidden />}
          disabled={!client || !project.exists}
          onClick={() => void client?.call('editors.open', { path: project.root, editorId: 'finder' }).catch(() => {})}
          data-tooltip={`Show in ${fileManagerName()}`}
          data-project-show-folder
        >
          Show
        </Button>
        {!project.exists && <span className="text-meta text-warn">Folder not found</span>}
      </SettingRow>
      {profiles.length > 1 && (
        <SettingRow label="Claude profile">
          <Select
            label="Claude profile"
            className="h-8 min-w-0 rounded-md border border-border bg-bg px-2 text-ui text-text outline-none focus:border-accent-ink/60"
            value={project.profileId ?? ''}
            onChange={(value) => void projectActions.setProfile(project.root, value || null)}
            options={[{ value: '', label: `Default${fallback ? ` (${fallback.name})` : ''}` }, ...profiles.map((p) => ({ value: p.id, label: p.name, hint: p.account?.email ?? undefined }))]}
            menuWidth={320}
            dataAttrs={{ 'data-project-profile': true }}
          />
        </SettingRow>
      )}
      <SettingRow label="Defaults" hint={`New sessions in ${project.name} start with these. The New session view can still change them for one session.`}>
        <div className="grid w-full min-w-0 gap-2">
          <ProjectDefaultsEditor root={project.root} defaults={project.defaults} isGitRepo={isGitRepo} profile={profile?.defaults} onSave={(d) => void save(d)} />
          {error && (
            <p role="alert" className="text-ui text-error">
              Couldn't save the defaults: {error}
            </p>
          )}
        </div>
      </SettingRow>
      <SettingRow
        label="Remove"
        hint="Removing a project only takes it off Switchboard's lists: nothing on disk changes, and its sessions stay in search and under sessions from other apps."
      >
        <Button variant="danger" onClick={() => setRemoving(true)} data-project-remove>
          Remove from Switchboard…
        </Button>
      </SettingRow>
      {removing && <RemoveProjectDialog root={project.root} name={project.name} onClose={() => setRemoving(false)} />}
    </div>
  );
}
