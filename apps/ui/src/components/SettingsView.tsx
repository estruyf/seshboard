import { currentPlatform, fileManagerName } from '../lib/platform.ts';
import { Activity, Archive, ArchiveRestore, Bell, Brain, Info, MessageSquare, Palette, PanelLeft, SlidersHorizontal, SquareCode, Target, Users, X, type LucideIcon, Smartphone } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { FileLinkClick, NewSessionMode, ProjectOrder, SidebarCollapsed, SidebarStyle, StartupView, ToolActivity, WhileWorking } from '@switchboard/protocol/bridge';
import { MODE_CHOICES, MODE_LABEL } from '../lib/modes.ts';
import { usePreferences } from '../state/preferencesStore.ts';
import { MemorySettings } from './memory/MemorySettings.tsx';
import { NotificationsSettings } from './notifications/NotificationsSettings.tsx';
import { SessionsSettings } from './sessions/SessionsSettings.tsx';
import { useSessions, type SettingsSection } from '../state/sessionsStore.ts';
import { useSidebar } from '../state/sidebarStore.ts';
import { BackupSettings } from './backup/BackupSettings.tsx';
import { CompanionSettings } from './companion/CompanionSettings.tsx';
import { RemoteSettings } from './remote/RemoteSettings.tsx';
import { EngineDiagnostics } from './EngineDiagnostics.tsx';
import { AutoModelSettings } from './session/AutoModelSettings.tsx';
import { CatchUpSettings } from './catchUp/CatchUpSettings.tsx';
import { FocusSettings } from './focus/FocusSettings.tsx';
import { ProfilesSettings } from './profiles/ProfilesSettings.tsx';
import { ThemeSettings } from './theme/ThemeSettings.tsx';
import { AboutSettings, SettingsVersion } from './updates/AboutSettings.tsx';
import { Button } from './ui/Button.tsx';
import { Choice } from './ui/Choice.tsx';
import { Radio, RadioGroup } from './ui/Radio.tsx';
import { SegmentedControl } from './ui/SegmentedControl.tsx';
import { Select } from './ui/Select.tsx';
import { Toggle } from './ui/Toggle.tsx';
import { clickKeysFor, formatKeys, keysFor, matches } from '../lib/shortcuts.ts';
import { groupByPage, searchSettings, type SettingEntry } from './settingsSearch/searchSettings.ts';
import { jumpToSetting, resultId, SettingsSearchField, SettingsSearchResults } from './settingsSearch/SettingsSearch.tsx';
import { settingsIndex } from './settingsSearch/settingsIndex.ts';

/** A session row in miniature, drawn with the live theme tokens. */
function RowPreview({ style }: { style: SidebarStyle }) {
  const icon = (size: number) => <div className="shrink-0 rounded-[4px] bg-accent" style={{ width: size, height: size }} />;
  const line = (width: string, strong = false) => <div className={`h-1.5 rounded-full ${strong ? 'bg-text/70' : 'bg-faint/50'}`} style={{ width }} />;
  const rows = [0, 1, 2];
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-1.5 bg-sidebar px-3">
      {rows.map((i) =>
        style === 'compact' ? (
          <div key={i} className={`flex items-center gap-1.5 rounded px-1.5 py-1 ${i === 0 ? 'bg-selected' : ''}`}>
            {icon(8)}
            {line('60%', true)}
          </div>
        ) : (
          <div key={i} className={`flex items-center gap-2 rounded px-1.5 py-1 ${i === 0 ? 'bg-selected' : ''} ${i === 2 ? 'hidden' : ''}`}>
            {style === 'large' && icon(20)}
            <div className="grid flex-1 gap-1">
              <div className="flex items-center gap-1">
                {style === 'standard' && icon(6)}
                {line('40%')}
              </div>
              {line('75%', true)}
              {line('30%')}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/** A conversation in miniature: Claude's messages, with its steps summarised or listed. */
function ActivityPreview({ mode }: { mode: ToolActivity }) {
  const line = (width: string, strong = false) => <div className={`h-1.5 rounded-full ${strong ? 'bg-text/60' : 'bg-faint/50'}`} style={{ width }} />;
  const step = (width: string) => (
    <div className="flex items-center gap-1.5 rounded border border-border px-1.5 py-[3px]">
      <div className="size-1.5 rounded-full bg-ok" />
      {line(width)}
    </div>
  );
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-1.5 bg-bg px-3">
      {line('70%', true)}
      {mode === 'summary' ? (
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="flex gap-[2px]">
            <span className="size-1 rounded-full bg-accent-ink" />
            <span className="size-1 rounded-full bg-accent-ink/60" />
            <span className="size-1 rounded-full bg-accent-ink/30" />
          </span>
          {line('45%')}
          <span className="text-[8px] leading-none text-faint">›</span>
        </div>
      ) : (
        <>
          {step('50%')}
          {step('35%')}
          {step('42%')}
        </>
      )}
      {line('55%', true)}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId();
  // minmax(0, 1fr): a long path or command inside wraps or truncates instead of widening the page.
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-3 py-6" aria-labelledby={id}>
      <div>
        <h2 id={id} className="text-body font-semibold">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-ui text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const ACTIVITY: Array<{ value: ToolActivity; label: string }> = [
  { value: 'summary', label: 'Summarised' },
  { value: 'steps', label: 'Every step' },
];

const STYLES: Array<{ value: SidebarStyle; label: string }> = [
  { value: 'large', label: 'Large icons' },
  { value: 'standard', label: 'Standard' },
  { value: 'compact', label: 'Compact' },
];

const STARTUP: Array<{ value: StartupView; label: string; detail: string }> = [
  { value: 'home', label: 'Home', detail: 'Shows what needs you, what is working, and your projects.' },
  { value: 'last', label: 'The last session', detail: 'Opens the session you had open, if the sidebar lists it. Otherwise New session.' },
  { value: 'new', label: 'New session', detail: 'Starts ready for a new prompt.' },
];

/** The permission mode new sessions start in: the one picked last, or one of the modes the menus offer. */
const NEW_SESSION_MODE_OPTIONS: Array<{ value: NewSessionMode; label: string }> = [{ value: 'last', label: 'The last one you picked' }, ...MODE_CHOICES.map((mode) => ({ value: mode as NewSessionMode, label: MODE_LABEL[mode] }))];

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: LucideIcon }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'theme', label: 'Theme', icon: Palette },
  { id: 'sidebar', label: 'Sidebar', icon: PanelLeft },
  { id: 'sessions', label: 'Sessions', icon: Archive },
  { id: 'conversation', label: 'Conversation', icon: MessageSquare },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'focus', label: 'Focus', icon: Target },
  { id: 'profiles', label: 'Claude profiles', icon: Users },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'vscode', label: 'VS Code', icon: SquareCode },
  { id: 'remote', label: 'Remote', icon: Smartphone },
  { id: 'backup', label: 'Backup', icon: ArchiveRestore },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
  { id: 'about', label: 'About', icon: Info },
];

/** A Settings page's name, as its sidebar lists it. */
export const settingsSectionLabel = (section: SettingsSection) => SECTIONS.find((s) => s.id === section)?.label ?? 'Settings';

const close = () => useSessions.getState().closeSettings();

/**
 * Escape closes Settings, unless it belongs to an open dialog, menu or dropdown, or to a field being
 * edited. The sheet is a region rather than a dialog, so any of those on screen takes the key.
 */
function useEscapeToClose(sheet: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!matches(event, 'settings.close') || event.defaultPrevented) return;
      // Search's results are a listbox too, but part of the page rather than a dropdown over it.
      const overlays = [...document.querySelectorAll('[role=dialog], [role=alertdialog], [role=menu], [role=listbox]')].filter((el) => !el.closest('[data-settings-results]'));
      if (overlays.some((el) => el !== sheet.current)) return;
      // The window's terminal can sit next to Settings: Esc there belongs to the program in it, or restores the panel.
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable=true], [data-terminal-panel]')) return;
      // The session behind keeps its own Escape (deny a permission, stop Claude): this press is ours.
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);
}

/** One page of Settings: everything for the section chosen in its sidebar. */
function SectionPage({ section, scrollRef }: { section: SettingsSection; scrollRef: RefObject<HTMLDivElement | null> }) {
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);

  switch (section) {
    case 'theme':
      return <ThemeSettings />;
    case 'sidebar':
      return (
        <Section title="Sidebar" description="How sessions are listed. Large icons makes each session's project easy to spot.">
          <RadioGroup label="Sidebar style" className="grid grid-cols-3 gap-4">
            {STYLES.map(({ value, label }) => (
              <Choice key={value} value={value} current={prefs.sidebarStyle} label={label} attr="data-sidebar-style" onSelect={(sidebarStyle) => update({ sidebarStyle })}>
                <RowPreview style={value} />
              </Choice>
            ))}
          </RadioGroup>
          <div className="flex items-center justify-between gap-4" data-setting-row>
            <span>
              <span className="block text-ui">When collapsed</span>
              <span className="block text-meta text-muted">What {formatKeys(keysFor('sidebar.toggle'))} and the sidebar button do: a narrow rail of project icons, or hide the sidebar.</span>
            </span>
            <SegmentedControl<SidebarCollapsed>
              mode="radio"
              label="When collapsed"
              value={prefs.sidebarCollapsed}
              onChange={(sidebarCollapsed) => update({ sidebarCollapsed })}
              segments={[
                { value: 'minimal', label: 'Minimal rail', data: { 'data-sidebar-collapsed': 'minimal' } },
                { value: 'closed', label: 'Hidden', data: { 'data-sidebar-collapsed': 'closed' } },
              ]}
              className="shrink-0"
            />
          </div>
          <Toggle
            label="Show sessions from other apps"
            detail="Also list sessions from Terminal, Claude desktop and your editor. Off shows only sessions you started or continued in Switchboard."
            checked={prefs.sessionScope === 'all'}
            attr="data-session-scope"
            onChange={(all) => update({ sessionScope: all ? 'all' : 'switchboard' })}
          />
        </Section>
      );
    case 'sessions':
      return <SessionsSettings scrollRef={scrollRef} />;
    case 'conversation':
      return (
        <>
          <Section
            title="Conversation"
            description="Summarised shows each run of tool calls as one line, like Claude Code: what Claude is doing, or what it did. Click it to see the steps."
          >
            <RadioGroup label="Tool activity" className="grid grid-cols-3 gap-4">
              {ACTIVITY.map(({ value, label }) => (
                <Choice key={value} value={value} current={prefs.toolActivity} label={label} attr="data-tool-activity" onSelect={(toolActivity) => update({ toolActivity })}>
                  <ActivityPreview mode={value} />
                </Choice>
              ))}
            </RadioGroup>
          </Section>
          <Section title="File links">
            <div className="flex items-center justify-between gap-4" data-setting-row>
              <span>
                <span className="block text-ui">Clicking a file link</span>
                <span className="block text-meta text-muted">
                  What a click does on a file in Claude’s replies. {formatKeys(clickKeysFor('transcript.file-link-other'))} does the other, and right-click lists both.
                </span>
              </span>
              <Select<FileLinkClick>
                label="What clicking a file link does"
                value={prefs.fileLinkClick}
                onChange={(fileLinkClick) => update({ fileLinkClick })}
                options={[
                  { value: 'file-manager', label: `Show in ${fileManagerName()}` },
                  { value: 'editor', label: 'Open in editor' },
                ]}
                menuWidth={200}
                className="h-7 shrink-0 rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink/60"
                dataAttrs={{ 'data-file-link-click': true }}
              />
            </div>
          </Section>
          <Section title="While Claude is working">
            <div className="flex items-center justify-between gap-4" data-setting-row>
              <span>
                <span className="block text-ui">Enter</span>
                <span className="block text-meta text-muted">
                  Queue holds your message in Up next until Claude finishes the turn. Steer gives it to Claude now, and Claude reads it at its next step. {formatKeys(keysFor('composer.send-now'))} always stops Claude and sends at once.
                </span>
              </span>
              <SegmentedControl<WhileWorking>
                mode="radio"
                label="What Enter does while Claude is working"
                value={prefs.whileWorking}
                onChange={(whileWorking) => update({ whileWorking })}
                segments={[
                  { value: 'queue', label: 'Queue', data: { 'data-while-working': 'queue' } },
                  { value: 'steer', label: 'Steer', data: { 'data-while-working': 'steer' } },
                ]}
                className="shrink-0"
              />
            </div>
          </Section>
          <Section title="Catch-up">
            <CatchUpSettings />
          </Section>
          <Section title="Auto model" description="Haiku reads the first prompt of a new session and picks the model it starts on. Picked once; after that, Auto only suggests.">
            <AutoModelSettings />
          </Section>
        </>
      );
    case 'notifications':
      return (
        <Section title="Notifications and sounds" description="How Switchboard gets your attention while you work in another session or app. Nothing for the session you are looking at.">
          <NotificationsSettings />
        </Section>
      );
    case 'focus':
      return (
        <Section title="Focus">
          <FocusSettings />
        </Section>
      );
    case 'profiles':
      return (
        <Section
          title="Claude profiles"
          description="Use more than one Claude account, for example a personal plan and a work one. Each profile is a Claude Code config folder with its own login. Link a project to a profile from its menu or the Projects view; other projects use the default. Each profile can have defaults for new sessions, which a project's own settings override."
        >
          <ProfilesSettings />
        </Section>
      );
    case 'memory':
      return (
        <Section
          title="Memory"
          description="What Claude Code remembers about you and your projects. Personal memory sits in a folder you choose (iCloud, Dropbox, git) and loads in every project; nothing is locked into Switchboard."
        >
          <MemorySettings />
        </Section>
      );
    case 'general':
      return (
        <>
          <Section title="On startup" description="What Switchboard shows when it opens.">
            <RadioGroup label="On startup" className="grid gap-2.5">
              {STARTUP.map(({ value, label, detail }) => (
                <Radio key={value} checked={prefs.startupView === value} onSelect={() => update({ startupView: value })} dataAttrs={{ 'data-startup-view': value }}>
                  <span className="block text-ui text-text">{label}</span>
                  <span className="block text-ui text-muted">{detail}</span>
                </Radio>
              ))}
            </RadioGroup>
          </Section>
          <Section title="New sessions">
            <div className="flex items-center justify-between gap-4" data-setting-row>
              <span>
                <span className="block text-ui">Permission mode</span>
                <span className="block text-meta text-muted">What New session starts in. A project’s or profile’s own default comes first, and a link never starts in Auto mode.</span>
              </span>
              <Select<NewSessionMode>
                label="Permission mode for new sessions"
                value={prefs.newSessionMode}
                onChange={(newSessionMode) => update({ newSessionMode })}
                options={NEW_SESSION_MODE_OPTIONS}
                menuWidth={200}
                className="h-7 shrink-0 rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink/60"
                dataAttrs={{ 'data-new-session-mode': true }}
              />
            </div>
          </Section>
          <Section title="Projects">
            <div className="flex items-center justify-between gap-4" data-setting-row>
              <span>
                <span className="block text-ui">Project order</span>
                <span className="block text-meta text-muted">How New session, Home and the command palette list your projects: the ones you used last first, or the order you set in Projects.</span>
              </span>
              <SegmentedControl<ProjectOrder>
                mode="radio"
                label="Project order"
                value={prefs.projectOrder}
                onChange={(projectOrder) => update({ projectOrder })}
                segments={[
                  { value: 'recent', label: 'Recent', data: { 'data-project-order': 'recent' } },
                  { value: 'yours', label: 'Your order', data: { 'data-project-order': 'yours' } },
                ]}
                className="shrink-0"
              />
            </div>
          </Section>
          <Section title="Quitting">
            <Toggle
              label="Ask before quitting"
              detail={`${formatKeys(keysFor('quit'))} shows a prompt first; pressing ${formatKeys(keysFor('quit'))} again quits.`}
              checked={prefs.confirmQuit}
              attr="data-confirm-quit"
              onChange={(confirmQuit) => update({ confirmQuit })}
            />
          </Section>
        </>
      );
    case 'vscode':
      return (
        <Section
          title="VS Code"
          description="The Switchboard extension for VS Code (also Cursor and Windsurf) sends what you're looking at in the editor to a session, as chips above the message box. Nothing goes to Claude until you send."
        >
          <CompanionSettings />
        </Section>
      );
    case 'remote':
      return (
        <Section
          title="Remote"
          description="Follow your sessions from your phone, answer Claude when it needs you, and send prompts, wherever you are. Everything else stays on this computer."
        >
          <RemoteSettings />
        </Section>
      );
    case 'backup':
      return (
        <Section
          title="Backup"
          description="Move your setup to another Mac, restore it after a reset, or share your actions: preferences, projects with their icons, and project actions. Your sessions stay in ~/.claude."
        >
          <BackupSettings />
        </Section>
      );
    case 'diagnostics':
      return (
        <Section title="Diagnostics" description="The engine behind Switchboard, the Claude Code it runs, and its recent log.">
          <EngineDiagnostics />
        </Section>
      );
    case 'about':
      return (
        <Section title="About">
          <AboutSettings />
        </Section>
      );
  }
}

/** Settings' search, as the list and the page share it: the query, what it found and the result the keyboard is on. */
interface SearchState {
  query: string;
  setQuery(query: string): void;
  /** Results per page, for the counts in the list; empty while there is no query. */
  counts: Map<SettingsSection, number>;
  field: ReactNode;
}

/** Settings' sections, on the left of the Settings sheet, under the search field. */
export function SettingsNav({ search }: { search: SearchState }) {
  const section = useSessions((s) => s.settingsSection);
  const openSettings = useSessions((s) => s.openSettings);
  const searching = search.query.trim() !== '';
  // With the sidebar closed, the traffic lights sit above this list (macOS; elsewhere they're in the title bar).
  const sidebarClosed = useSidebar((s) => s.state === 'closed') && currentPlatform() === 'darwin';
  return (
    <nav aria-label="Settings sections" className={`flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2 ${sidebarClosed ? 'pt-12' : 'pt-3'}`} data-settings-nav>
      <h2 id="settings-title" className="px-2.5 pt-2 pb-3 text-title font-semibold">
        Settings
      </h2>
      {search.field}
      {SECTIONS.map(({ id, label, icon: Icon }) => {
        // While searching, no page is the one on screen: each says how many results it has.
        const current = !searching && section === id;
        const count = search.counts.get(id) ?? 0;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              search.setQuery('');
              openSettings(id);
            }}
            aria-current={current ? 'page' : undefined}
            data-settings-section={id}
            className={`flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-ui ${current ? 'bg-selected font-semibold text-text' : 'text-muted hover:bg-border/45 hover:text-text'} ${searching && count === 0 ? 'opacity-50' : ''}`}
          >
            <Icon size={15} aria-hidden className={`shrink-0 ${current ? 'text-accent-ink' : ''}`} />
            <span className="truncate">{label}</span>
            {searching && count > 0 && (
              <span className="ml-auto text-meta text-faint tabular-nums" data-settings-section-count>
                {count}
                <span className="sr-only"> found</span>
              </span>
            )}
          </button>
        );
      })}
      <div className="mt-auto">
        <SettingsVersion />
      </div>
    </nav>
  );
}

/**
 * Settings fills the main area, with its sections on the left and the page on the right. The app
 * sidebar keeps its session list next to it, so what needs you stays in sight.
 */
export function SettingsView() {
  const section = useSessions((s) => s.settingsSection);
  const openSettings = useSessions((s) => s.openSettings);
  const sheet = useRef<HTMLDivElement>(null);
  /** The page's scroll area: long pages (all sessions) virtualise their lists against it. */
  const scroller = useRef<HTMLDivElement>(null);
  // What had focus before Settings opened (its button, the message box), read before the effect below moves it.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  // Start keyboard focus in Settings (not a trap: the sidebar stays reachable with Tab), and give it back
  // on close. The sheet is a region, not a dialog, so `useModalFocus` doesn't do this; by the time this
  // runs the sheet has left the page and its focus fell to `body`, unless something else took it.
  useEffect(() => {
    const root = sheet.current;
    if (!root?.contains(document.activeElement)) root?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    return () => {
      const active = document.activeElement;
      if (!opener?.isConnected || opener === document.body || root?.contains(opener)) return;
      if (!active || active === document.body || root?.contains(active)) opener.focus({ preventScroll: true });
    };
  }, [opener]);
  useEscapeToClose(sheet);

  // Search: while there is a query, the page shows what it found in every page instead.
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  const entries = useMemo(settingsIndex, []);
  const found = useMemo(() => searchSettings(query, entries, settingsSectionLabel, currentPlatform()), [query, entries]);
  const groups = useMemo(() => groupByPage(found), [found]);
  /** The results in the order they show, for ↑ ↓. */
  const ordered = useMemo(() => groups.flatMap((group) => group.matches), [groups]);
  const counts = useMemo(() => new Map(groups.map((group) => [group.page, group.matches.length])), [groups]);
  const searching = query.trim() !== '';
  const changeQuery = (next: string) => {
    setQuery(next);
    setActive(0);
  };
  const [jump, setJump] = useState<{ entry: SettingEntry; nonce: number } | null>(null);
  const choose = (entry: SettingEntry) => {
    changeQuery('');
    openSettings(entry.page);
    setJump((j) => ({ entry, nonce: (j?.nonce ?? 0) + 1 }));
  };
  // Once its page is on screen, bring the setting into view, once per choice.
  const jumped = useRef(0);
  useEffect(() => {
    if (!jump || jump.nonce === jumped.current || jump.entry.page !== section || searching) return;
    jumped.current = jump.nonce;
    jumpToSetting(jump.entry);
  }, [jump, section, searching]);
  // The result the keyboard is on stays in view.
  useEffect(() => {
    if (searching) document.getElementById(resultId(listId, active))?.scrollIntoView({ block: 'nearest' });
  }, [active, listId, searching]);
  // ⌘F puts the keyboard in the search field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matches(event, 'settings.search')) return;
      const overlays = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')];
      if (overlays.some((el) => el !== sheet.current)) return;
      event.preventDefault();
      field.current?.focus();
      field.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onFieldKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const last = ordered.length - 1;
      setActive((a) => (event.key === 'ArrowDown' ? Math.min(a + 1, last) : Math.max(a - 1, 0)));
    } else if (event.key === 'Enter' && ordered[active]) {
      event.preventDefault();
      choose(ordered[active].entry);
    } else if (event.key === 'Escape') {
      // Escape empties the field first; in an empty field it closes Settings, as it does elsewhere.
      event.preventDefault();
      if (query) changeQuery('');
      else close();
    }
  };
  const search: SearchState = {
    query,
    setQuery: changeQuery,
    counts,
    field: <SettingsSearchField query={query} onQuery={changeQuery} onKeyDown={onFieldKey} inputRef={field} listId={listId} activeIndex={active} count={ordered.length} />,
  };

  // Settings takes the whole main area (the sidebar keeps its session list next to it). The view it
  // was opened from stays mounted, inert, underneath, so closing returns to it as it was.
  return (
    <div
      ref={sheet}
      role="region"
      aria-labelledby="settings-title"
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-bg"
      data-settings
    >
      <div className="flex min-h-0 flex-1">
        <SettingsNav search={search} />
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* The top strip keeps the window draggable, like every other view's header. */}
          {/* Same padding as the session header, so the close button stays put when Settings opens over it. */}
          <div className="drag flex h-13 shrink-0 items-center justify-end px-6">
            <Button variant="quiet" iconOnly icon={<X size={15} aria-hidden />} shortcut="settings.close" onClick={close} data-close-settings data-tooltip={`Close (${formatKeys(keysFor('settings.close'))})`} aria-label="Close settings" className="no-drag" />
          </div>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            {searching ? (
              <div className="mx-auto min-w-0 max-w-2xl px-8">
                <SettingsSearchResults query={query} groups={groups} pages={SECTIONS} listId={listId} activeIndex={active} onHover={setActive} onChoose={choose} />
              </div>
            ) : (
              <div className={`mx-auto min-w-0 px-8 ${section === 'sessions' ? 'max-w-5xl' : section === 'diagnostics' ? 'max-w-3xl' : 'max-w-2xl'}`} data-settings-page={section}>
                <SectionPage section={section} scrollRef={scroller} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
