import { ChevronDown, ChevronRight, Square } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { isPaused, NOTIFICATION_PAUSES, pauseUntil, type NotificationPause } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { matches } from '../../lib/shortcuts.ts';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useListedRows, useProjectName } from '../../state/useQueue.ts';
import { projectProfile, quickSetup, startQuickSession } from '../quickStart/quickStartSession.ts';
import { useQuickProjects } from '../quickStart/useQuickProjects.ts';
import { ProfileBadge } from '../profiles/ProfileBadge.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { tileOf } from '../theme/AppIconSettings.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { WorkingPanel } from '../ui/WorkingPanel.tsx';
import { useUsageLines } from '../UsageBand.tsx';
import { menuBarRows, nextRow, SECTION_TITLES, type MenuBarRow, type MenuBarSection } from './menuBarModel.ts';

const bridge = () => window.seshboard;
/** Opens a session in the main window; the panel goes. */
const openSession = (id: string) => {
  bridge()?.showSession(id);
  bridge()?.menuBarCommand('close');
};

/** The section headings' colours: needs you in `warn`, working in `accent-ink`, finished quiet. */
const SECTION_TONE: Record<MenuBarSection, string> = { 'needs-you': 'text-warn', working: 'text-accent-ink', finished: 'text-faint' };
const SECTIONS: readonly MenuBarSection[] = ['needs-you', 'working', 'finished'];

/** A clock that ticks every 30 seconds, for the ages. */
function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The menu bar's panel (its own small window, `MenuBarApp`): what needs you with Allow right there, what works with
 * Stop, what finished, and a box that starts new work in the background. A dialog labelled Seshboard: focus starts on
 * the first row (or the box), ↑ and ↓ move through the rows, ↩ opens one, and Esc closes the panel.
 */
export function MenuBarPanel() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const listed = useListedRows();
  const permissions = useHosts((s) => s.permissions);
  const catchUps = useCatchUp((s) => s.cards);
  const projectName = useProjectName();
  const now = useMinuteClock();
  const rows = useMemo(() => menuBarRows({ rows: listed, permissions: permissions.values(), catchUps, projectName, now }), [listed, permissions, catchUps, projectName, now]);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  /** What is open inside and wants Esc first (the project list, the pause choices): Esc closes those before the panel. */
  const innerEscape = useRef(new Set<() => void>());
  /**
   * Whether the keys are in use: the focused row is highlighted only then, so it never shows next to the row under the
   * pointer. On while the panel opens (focus is on the first row for ↩), off once the pointer moves, on again with a key.
   */
  const [keys, setKeys] = useState(true);

  // The window fits what it shows (main keeps it under 70% of the screen; past that, this scrolls).
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const report = () => bridge()?.menuBarResize(el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Focus on the first row, or on the new work box when there are none. */
  const focusStart = () => {
    const first = rootRef.current?.querySelector<HTMLElement>('[data-menubar-row]');
    (first ?? boxRef.current)?.focus();
  };
  const rowCount = rows.length;
  useEffect(() => {
    focusStart();
    return bridge()?.onMenuBarShown(() => {
      // Projects added or changed in the main window since the panel last showed.
      useProjects.getState().reload();
      setKeys(true);
      requestAnimationFrame(focusStart);
    });
    // Once, and again each time the icon opens the panel: never while you are using it.
  }, []);
  // The first rows can arrive after the panel opened: focus moves to them unless you already went somewhere.
  useEffect(() => {
    if (rowCount > 0 && (document.activeElement === document.body || document.activeElement === boxRef.current) && !boxRef.current?.value) focusStart();
  }, [rowCount > 0]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (innerEscape.current.size) {
        for (const close of [...innerEscape.current]) close();
        return;
      }
      bridge()?.menuBarCommand('close');
      return;
    }
    if (event.key === 'Tab') setKeys(true);
    const target = event.target as HTMLElement;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    setKeys(true);
    // ↑ and ↓ move through the rows; in the box and the lists they stay theirs.
    if (!target.matches('[data-menubar-row]')) return;
    const all = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-menubar-row]') ?? [])];
    const next = nextRow(all.length, all.indexOf(target), event.key);
    if (next >= 0) {
      event.preventDefault();
      all[next]!.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Seshboard"
      className="h-full overflow-y-auto bg-bg text-text"
      onKeyDown={onKeyDown}
      onPointerMove={() => keys && setKeys(false)}
      data-menubar-panel
      data-menubar-keys={keys || undefined}
    >
      <div ref={contentRef} className="grid gap-1 p-2.5">
        <Header />
        {rows.length === 0 ? (
          <p className="px-2.5 py-3 text-ui text-muted" data-menubar-empty>
            Nothing running. Start something below.
          </p>
        ) : (
          SECTIONS.map((section) => {
            const inSection = rows.filter((row) => row.section === section);
            if (!inSection.length) return null;
            return (
              <section key={section} aria-label={SECTION_TITLES[section]} data-menubar-section={section}>
                <h2 className={`px-2.5 pt-2 pb-0.5 text-meta font-semibold tracking-wide uppercase ${SECTION_TONE[section]}`}>{SECTION_TITLES[section]}</h2>
                {inSection.map((row) => (
                  <Row key={row.id} row={row} client={client} />
                ))}
              </section>
            );
          })
        )}
        <NewWork boxRef={boxRef} innerEscape={innerEscape} />
        <div className="mx-1.5 my-1 h-px bg-border" aria-hidden />
        <Footer innerEscape={innerEscape} />
      </div>
    </div>
  );
}

/** The app's mark, its name, and the default profile's usage ("5h 17% · Week 19%"). */
function Header() {
  const appIcon = usePreferences((s) => s.prefs.appIcon);
  const defaultId = useProfiles((s) => s.defaultId);
  const lines = useUsageLines(defaultId);
  return (
    <div className="flex items-center gap-2 px-1.5 pt-1 pb-2">
      <img src={tileOf(appIcon)} alt="" width={18} height={18} draggable={false} className="size-4.5 shrink-0" />
      <span className="text-body font-semibold">Seshboard</span>
      <span className="flex-1" />
      {lines.length > 0 && (
        <span className="text-meta text-faint tabular-nums" data-menubar-usage>
          {lines.map((line) => `${line.label} ${Math.round(line.percent)}%`).join(' · ')}
        </span>
      )}
    </div>
  );
}

function Row({ row, client }: { row: MenuBarRow; client: ReturnType<typeof useClient> }) {
  const projects = useProjects((s) => s.projects);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await what();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  // The same call as the permission card's Allow, and the session's own Stop.
  const allow = () => run(() => client!.call('session.respond', { requestId: row.request!.requestId, decision: { behavior: 'allow', always: false } }));
  const stop = () => run(() => client!.call('session.interrupt', { sessionId: row.id }));
  // The row lights up under the pointer only over the part that opens it, so Allow, Open and Stop show their own hover;
  // with the keys, while its row has focus.
  return (
    <div
      className="group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 has-[[data-menubar-row]:hover]:bg-border/45 in-data-menubar-keys:has-[[data-menubar-row]:focus]:bg-border/45"
      data-menubar-session={row.id}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none" onClick={() => openSession(row.id)} data-menubar-row aria-label={`${row.title}: ${row.detail}`}>
        <ProjectIcon project={projects.get(row.projectRoot)} root={row.projectRoot} size={18} />
        <span className="grid min-w-0 flex-1 gap-px">
          <span className="truncate text-body">{row.title}</span>
          <span className={`truncate text-meta ${row.section === 'needs-you' ? 'text-warn' : 'text-faint'}`}>{error ?? row.detail}</span>
        </span>
      </button>
      {row.section === 'needs-you' && (
        <>
          {row.allowable && (
            <Button variant="primary" size="sm" onClick={allow} disabled={!client || busy} aria-busy={busy} aria-label={`Allow ${row.title}`} data-menubar-allow={row.id}>
              {busy ? 'Allowing…' : 'Allow'}
            </Button>
          )}
          <Button size="sm" onClick={() => openSession(row.id)} aria-label={`Open ${row.title}`}>
            Open
          </Button>
        </>
      )}
      {row.section === 'working' && (
        <>
          <span className="shrink-0 text-meta text-faint tabular-nums group-hover:hidden in-data-menubar-keys:group-focus-within:hidden">{row.age}</span>
          {/* Stop shows on hover (and with the keys, with focus in the row), in place of the age. */}
          <span className="hidden group-hover:flex in-data-menubar-keys:group-focus-within:flex">
            <Button size="sm" iconOnly icon={<Square size={11} aria-hidden />} onClick={stop} disabled={!client || busy} aria-busy={busy} aria-label={`Stop ${row.title}`} data-tooltip="Stop" data-menubar-stop={row.id} />
          </span>
        </>
      )}
      {row.section === 'finished' && <span className="shrink-0 text-meta text-faint tabular-nums">{row.age}</span>}
    </div>
  );
}

/** While `open`, Esc in the panel calls `close` instead of closing the panel. */
function useOpenOnEscape(open: boolean, close: () => void, closers: RefObject<Set<() => void>>): void {
  useEffect(() => {
    if (!open) return;
    const set = closers.current;
    set.add(close);
    return () => void set.delete(close);
  }, [open]);
}

function useClient() {
  const connection = useEngineConnection();
  return connection.status === 'connected' ? connection.client : null;
}

/**
 * New work: a project (in New session's order, with Find), its profile, a box, and Start (⌘↩), in the background. The
 * list and the start are quick start's (`useQuickProjects`, `startQuickSession`), so the two never differ.
 */
function NewWork({ boxRef, innerEscape }: { boxRef: RefObject<HTMLTextAreaElement | null>; innerEscape: RefObject<Set<() => void>> }) {
  const client = useClient();
  const projects = useProjects((s) => s.projects);
  const profiles = useProfiles((s) => s.profiles);
  const defaultProfile = useProfiles((s) => s.defaultId);
  const prefs = usePreferences((s) => s.prefs);
  const [root, setRoot] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<{ sessionId: string; root: string; prompt: string } | null>(null);
  const listed = useQuickProjects('');
  // The first project in the list until you pick one.
  const chosen = root && projects.get(root)?.exists ? root : (listed[0]?.root ?? null);
  const project = chosen ? projects.get(chosen) : undefined;
  const profileId = projectProfile(project, profiles, defaultProfile);

  useOpenOnEscape(picking, () => setPicking(false), innerEscape);

  const start = async () => {
    const prompt = text.trim();
    if (!client || !chosen || !prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The project's defaults, as New session starts with them: its own, then its profile's, then Settings'.
      const profile = profiles.find((p) => p.id === profileId);
      const setup = await quickSetup(client, { root: chosen, project, profile, prefs, question: false });
      if (!setup.exists) throw new Error(`${project?.name ?? chosen}’s folder is gone`);
      const outcome = await startQuickSession(client, {
        root: chosen,
        prompt,
        choices: setup.choices,
        worktree: setup.choices.workspace === 'worktree' && setup.isGitRepo,
        profileId,
        setup,
        autoEnabled: prefs.autoModel.enabled,
        provider: !!profile && profile.provider !== 'claude',
      });
      // In the background: the main window stays where it was.
      if (outcome.kind === 'started') {
        setStarted({ sessionId: outcome.sessionId, root: chosen, prompt });
        setText('');
      }
    } catch (e) {
      setError(`Couldn't start: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (started) {
    const name = projects.get(started.root)?.name ?? started.root;
    return (
      <div className="mx-1 mt-2 grid gap-2.5 rounded-xl border border-edge bg-card p-3.5" data-menubar-started={started.sessionId}>
        <div className="flex items-center gap-2">
          <WorkingPanel size={18} />
          <span className="min-w-0 truncate text-body font-semibold">Started in {name}</span>
          <span className="flex-1" />
          <span className="shrink-0 text-meta text-faint">just now</span>
        </div>
        <p className="line-clamp-3 text-ui text-muted">“{started.prompt}” It shows under Working here and in the app. The window stays where it was.</p>
        <div className="flex gap-2">
          <Button onClick={() => openSession(started.sessionId)} data-menubar-open-started>
            Open it
          </Button>
          <Button
            onClick={() => {
              setStarted(null);
              requestAnimationFrame(() => boxRef.current?.focus());
            }}
            data-menubar-done
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-1 mt-2 rounded-xl border border-edge bg-card" data-menubar-new-work>
      <div className="flex items-center gap-1.5 border-b border-edge px-2.5 py-1.5">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-ui font-semibold hover:bg-border/50"
          onClick={() => setPicking((open) => !open)}
          aria-expanded={picking}
          aria-label={project ? `Project: ${project.name}. Change` : 'Pick a project'}
          data-menubar-project={chosen ?? ''}
        >
          {project && chosen && <ProjectIcon project={project} root={chosen} size={16} />}
          <span className="truncate">{project?.name ?? 'Pick a project'}</span>
          <ChevronDown size={12} aria-hidden className="shrink-0 text-muted" />
        </button>
        <span className="flex-1" />
        <ProfileBadge profileId={profileId} className="text-meta" />
      </div>
      {picking && (
        <ProjectPicker
          onPick={(picked) => {
            setRoot(picked);
            setPicking(false);
            requestAnimationFrame(() => boxRef.current?.focus());
          }}
        />
      )}
      <textarea
        ref={boxRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (matches(event, 'menubar.start')) {
            event.preventDefault();
            void start();
          }
        }}
        rows={2}
        placeholder="New work for Claude…"
        aria-label={project ? `New work for Claude in ${project.name}` : 'New work for Claude'}
        className="block max-h-40 w-full resize-none bg-transparent px-3 pt-2 pb-1 text-body outline-none placeholder:text-faint"
        data-menubar-box
      />
      {error && <p className="px-3 pb-1 text-meta text-error">{error}</p>}
      <div className="flex items-center gap-2 px-2.5 pt-1 pb-2">
        <span className="text-meta text-faint">Runs in the background</span>
        <span className="flex-1" />
        <Button variant="primary" size="sm" shortcut="menubar.start" onClick={() => void start()} disabled={!client || !chosen || !text.trim() || busy} aria-busy={busy} data-menubar-start>
          {busy ? 'Starting…' : 'Start'}
        </Button>
      </div>
    </div>
  );
}

/** The projects in New session's order, with Find: ↑ ↓ and ↩ pick one, as clicking does. */
function ProjectPicker({ onPick }: { onPick(root: string): void }) {
  const projects = useProjects((s) => s.projects);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const found = useQuickProjects(query).slice(0, 6);
  return (
    <div className="border-b border-edge p-1.5" data-menubar-picker>
      <input
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => Math.max(0, Math.min(found.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1))));
          } else if (event.key === 'Enter' && found[active]) {
            event.preventDefault();
            onPick(found[active].root);
          }
        }}
        placeholder="Find a project"
        aria-label="Find a project"
        role="combobox"
        aria-expanded
        aria-controls="menubar-projects"
        aria-activedescendant={found[active] ? `menubar-project-${active}` : undefined}
        className="mb-1 w-full rounded-md border border-edge bg-bg px-2 py-1 text-ui outline-none"
      />
      <ul id="menubar-projects" role="listbox" aria-label="Projects" className="grid">
        {found.map((p, i) => (
          <li
            key={p.root}
            id={`menubar-project-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(p.root)}
            className={`flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-ui ${i === active ? 'bg-selected' : ''}`}
            data-menubar-pick={p.root}
          >
            <ProjectIcon project={projects.get(p.root)} root={p.root} size={14} />
            <span className="truncate">{p.name}</span>
          </li>
        ))}
        {found.length === 0 && <li className="px-2 py-1 text-ui text-faint">No project matches</li>}
      </ul>
    </div>
  );
}

/** Open Seshboard (⌘0), Pause notifications with its choices, Settings… (⌘,) and Quit Seshboard (⌘Q, through the quit guard). */
function Footer({ innerEscape }: { innerEscape: RefObject<Set<() => void>> }) {
  const pausedUntil = usePreferences((s) => s.prefs.notificationsPausedUntil);
  const update = usePreferences((s) => s.update);
  const [choosing, setChoosing] = useState(false);
  const paused = isPaused(pausedUntil, Date.now());
  const until = paused && pausedUntil ? new Date(pausedUntil).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null;
  useOpenOnEscape(choosing, () => setChoosing(false), innerEscape);
  const pause = (choice: NotificationPause | null) => {
    update({ notificationsPausedUntil: choice ? pauseUntil(choice, new Date()) : null });
    setChoosing(false);
  };
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-left text-ui hover:bg-border/45';
  return (
    <div className="grid" data-menubar-footer>
      <button type="button" className={item} onClick={() => bridge()?.menuBarCommand('open')} data-menubar-open-app>
        <span className="flex-1">Open Seshboard</span>
        <Kbd shortcut="menubar.open" tone="plain" />
      </button>
      <button type="button" className={item} onClick={() => setChoosing((open) => !open)} aria-expanded={choosing} data-menubar-pause>
        <span className="flex-1">{paused ? 'Notifications paused' : 'Pause notifications'}</span>
        <span className="flex items-center gap-0.5 text-meta text-faint">
          {until && `Until ${until}`}
          <ChevronRight size={12} aria-hidden className={choosing ? 'rotate-90' : ''} />
        </span>
      </button>
      {choosing && (
        <div role="group" aria-label="Pause notifications" className="grid pl-4" data-menubar-pause-choices>
          {NOTIFICATION_PAUSES.map((choice) => (
            <button key={choice.id} type="button" className={item} onClick={() => pause(choice.id)} data-menubar-pause-choice={choice.id}>
              {choice.label}
            </button>
          ))}
          {paused && (
            <button type="button" className={item} onClick={() => pause(null)} data-menubar-pause-choice="resume">
              Resume notifications
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        className={item}
        onClick={() => {
          bridge()?.showInMain({ kind: 'settings', section: null });
          bridge()?.menuBarCommand('close');
        }}
        data-menubar-settings
      >
        <span className="flex-1">Settings…</span>
        <Kbd shortcut="settings" tone="plain" />
      </button>
      <button type="button" className={item} onClick={() => bridge()?.menuBarCommand('quit')} data-menubar-quit>
        <span className="flex-1">Quit Seshboard</span>
        <Kbd keys="mod+q" tone="plain" />
      </button>
    </div>
  );
}
