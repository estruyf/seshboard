import { currentPlatform } from '../lib/platform.ts';
import { Activity, ArchiveRestore, Brain, Info, MessageSquare, Palette, PanelLeft, SlidersHorizontal, SquareCode, Target, Users, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import type { ProjectOrder, SidebarCollapsed, SidebarStyle, StartupView, ToolActivity } from '@switchboard/protocol/bridge';
import { usePreferences } from '../state/preferencesStore.ts';
import { MemorySettings } from './memory/MemorySettings.tsx';
import { useSessions, type SettingsSection } from '../state/sessionsStore.ts';
import { useSidebar } from '../state/sidebarStore.ts';
import { BackupSettings } from './backup/BackupSettings.tsx';
import { CompanionSettings } from './companion/CompanionSettings.tsx';
import { EngineDiagnostics } from './EngineDiagnostics.tsx';
import { FocusSettings } from './focus/FocusSettings.tsx';
import { ProfilesSettings } from './profiles/ProfilesSettings.tsx';
import { ThemeSettings } from './theme/ThemeSettings.tsx';
import { AboutSettings, SettingsVersion } from './updates/AboutSettings.tsx';
import { Button } from './ui/Button.tsx';
import { Choice } from './ui/Choice.tsx';
import { Radio, RadioGroup } from './ui/Radio.tsx';
import { SegmentedControl } from './ui/SegmentedControl.tsx';
import { Toggle } from './ui/Toggle.tsx';
import { formatKeys, keysFor, matches } from '../lib/shortcuts.ts';

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

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: LucideIcon }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'theme', label: 'Theme', icon: Palette },
  { id: 'sidebar', label: 'Sidebar', icon: PanelLeft },
  { id: 'conversation', label: 'Conversation', icon: MessageSquare },
  { id: 'focus', label: 'Focus', icon: Target },
  { id: 'profiles', label: 'Claude profiles', icon: Users },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'vscode', label: 'VS Code', icon: SquareCode },
  { id: 'backup', label: 'Backup', icon: ArchiveRestore },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
  { id: 'about', label: 'About', icon: Info },
];

const close = () => useSessions.getState().closeSettings();

/**
 * Escape closes Settings, unless it belongs to an open dialog, menu or dropdown, or to a field being
 * edited. The sheet is a region rather than a dialog, so any of those on screen takes the key.
 */
function useEscapeToClose(sheet: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!matches(event, 'settings.close') || event.defaultPrevented) return;
      const overlays = [...document.querySelectorAll('[role=dialog], [role=alertdialog], [role=menu], [role=listbox]')];
      if (overlays.some((el) => el !== sheet.current)) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable=true]')) return;
      // The session behind keeps its own Escape (deny a permission, stop Claude): this press is ours.
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);
}

/** One page of Settings: everything for the section chosen in its sidebar. */
function SectionPage({ section }: { section: SettingsSection }) {
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
          <div className="flex items-center justify-between gap-4">
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
    case 'conversation':
      return (
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
          description="Use more than one Claude account, for example a personal plan and a work one. Each profile is a Claude Code config folder with its own login. Link a project to a profile from its menu or the Projects view; other projects use the default."
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
          <Section title="Projects">
            <div className="flex items-center justify-between gap-4">
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

/** Settings' sections, on the left of the Settings sheet. */
export function SettingsNav() {
  const section = useSessions((s) => s.settingsSection);
  const openSettings = useSessions((s) => s.openSettings);
  // With the sidebar closed, the traffic lights sit above this list (macOS; elsewhere they're in the title bar).
  const sidebarClosed = useSidebar((s) => s.state === 'closed') && currentPlatform() === 'darwin';
  return (
    <nav aria-label="Settings sections" className={`flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2 ${sidebarClosed ? 'pt-12' : 'pt-3'}`} data-settings-nav>
      <h2 id="settings-title" className="px-2.5 pt-2 pb-3 text-title font-semibold">
        Settings
      </h2>
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => openSettings(id)}
          aria-current={section === id ? 'page' : undefined}
          data-settings-section={id}
          className={`flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-ui ${section === id ? 'bg-selected font-semibold text-text' : 'text-muted hover:bg-border/45 hover:text-text'}`}
        >
          <Icon size={15} aria-hidden className={`shrink-0 ${section === id ? 'text-accent-ink' : ''}`} />
          <span className="truncate">{label}</span>
        </button>
      ))}
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
  const sheet = useRef<HTMLDivElement>(null);
  // Start keyboard focus in Settings (not a trap: the sidebar stays reachable with Tab).
  useEffect(() => {
    if (!sheet.current?.contains(document.activeElement)) sheet.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  }, []);
  useEscapeToClose(sheet);

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
        <SettingsNav />
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* The top strip keeps the window draggable, like every other view's header. */}
          {/* Same padding as the session header, so the close button stays put when Settings opens over it. */}
          <div className="drag flex h-13 shrink-0 items-center justify-end px-6">
            <Button variant="quiet" iconOnly icon={<X size={15} aria-hidden />} shortcut="settings.close" onClick={close} data-close-settings data-tooltip={`Close (${formatKeys(keysFor('settings.close'))})`} aria-label="Close settings" className="no-drag" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={`mx-auto min-w-0 px-8 ${section === 'diagnostics' ? 'max-w-3xl' : 'max-w-2xl'}`} data-settings-page={section}>
              <SectionPage section={section} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
