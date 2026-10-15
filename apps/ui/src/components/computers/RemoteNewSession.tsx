import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Computer, Contract, Effort, RemoteOptions, RemotePermissionMode, RemoteProject, RpcClient } from '@switchboard/protocol/client';
import { MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
import { comboPresses, matches, shortcutById } from '../../lib/shortcuts.ts';
import { useComputers } from '../../state/computersStore.ts';
import { remoteProjectKey } from '../../state/remoteRows.ts';
import { useRunOn } from '../../state/runOnStore.ts';
import { toast } from '../../state/toastStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { RunOnSwitch } from '../newSession/RunOnSwitch.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Notice } from '../ui/Notice.tsx';
import { callComputer } from './callComputer.ts';
import { ComputerChip } from './ComputerChip.tsx';
import { remoteProjectTiles, type RemoteTile } from './remoteNewSession.ts';

/** Tiles before "+N more on …": the fifth place is that tile. */
const QUICK = 4;

const TONE_DOT = { 'needs-you': 'bg-warn animate-pulse', working: 'bg-accent-ink', idle: 'bg-faint/60' } as const;
const TONE_TEXT = { 'needs-you': 'text-warn', working: 'text-accent-ink', idle: 'text-muted' } as const;
const TILE = 'flex min-w-0 items-center gap-2 rounded-lg border p-2.5 text-left transition-[background-color,border-color,box-shadow,translate] @max-[600px]:flex-col @max-[600px]:items-start @max-[600px]:gap-1.5';

/** What New session sends with the prompt; null leaves it to that computer (the project's default, then its profile's). */
interface Choices {
  model: string | null;
  effort: Effort | null;
  permissionMode: RemotePermissionMode | null;
  worktree: boolean | null;
}

const NO_CHOICES: Choices = { model: null, effort: null, permissionMode: null, worktree: null };

/**
 * New session with another computer picked in Run on (docs/remote-access.md, Other computers): that computer's projects
 * as tiles (⌘1 to ⌘9 still pick), the route tray with its chip, and Start, which asks it to start the session with
 * `session.create` and opens it here. Model, effort, mode and where only show when that computer answers
 * `options.get` (an older Switchboard doesn't). Folders there can't be picked from here, images can't be sent yet, and
 * Quick question, the queue and the focus limit are this computer's.
 */
export function RemoteNewSession({ client, computer }: { client: RpcClient<Contract> | null; computer: Computer }) {
  const [projects, setProjects] = useState<RemoteProject[] | null>(null);
  const [options, setOptions] = useState<RemoteOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [starting, setStarting] = useState(false);
  const [choices, setChoices] = useState<Choices>(NO_CHOICES);
  const picked = useRunOn((s) => s.projects[computer.id] ?? null);
  const list = useComputers((s) => s.lists.get(computer.id) ?? null);
  const box = useRef<HTMLTextAreaElement>(null);
  const name = computer.name;
  const connected = computer.state === 'connected';

  useEffect(() => {
    if (!client || !connected) return;
    let current = true;
    setLoadError(null);
    void callComputer(client, computer.id, 'projects.list', {}).then(
      (result) => current && setProjects(result.projects),
      (e: Error) => current && setLoadError(e.message),
    );
    // An older Switchboard there has no options.get: then New session sends only the project and the prompt.
    void callComputer(client, computer.id, 'options.get', {}).then(
      (result) => current && setOptions(result),
      () => current && setOptions(null),
    );
    return () => {
      current = false;
    };
  }, [client, computer.id, connected]);

  const tiles = useMemo(() => remoteProjectTiles(projects ?? [], list), [projects, list]);
  const project = tiles.find((t) => t.id === picked)?.project ?? null;
  const pick = (id: string) => {
    useRunOn.getState().setProject(computer.id, id);
    setChoices(NO_CHOICES);
    requestAnimationFrame(() => box.current?.focus());
  };
  // A picked tile that is past the quick ones shows anyway, as in the local picker.
  const shown = expanded ? tiles : tiles.slice(0, tiles.length > QUICK + 1 ? QUICK : QUICK + 1);
  const more = expanded ? 0 : tiles.length - shown.length;

  const pickRef = useRef<(index: number) => void>(() => {});
  pickRef.current = (index) => {
    const tile = shown[index];
    if (tile) pick(tile.id);
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!matches(event, 'new-session.pick')) return;
      if (document.querySelector('[role=dialog], [role=alertdialog], [role=menu]')) return;
      event.preventDefault();
      pickRef.current(Number(event.key) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const defaults = options && project ? (options.projects.find((p) => p.id === project.id)?.defaults ?? null) : null;
  const model = choices.model ?? defaults?.model ?? null;
  const effort = choices.effort ?? defaults?.effort ?? null;
  const mode = (choices.permissionMode ?? (defaults?.permissionMode && options?.modes.includes(defaults.permissionMode as RemotePermissionMode) ? (defaults.permissionMode as RemotePermissionMode) : null)) as RemotePermissionMode | null;
  const worktree = choices.worktree ?? defaults?.worktree ?? false;

  const blocked = !client ? 'Connecting to the engine…' : !connected ? `${name} is not connected` : !project ? 'Choose a project first' : !prompt.trim() ? 'Type a message first' : null;
  const start = async () => {
    if (blocked || starting || !client || !project) return;
    setStarting(true);
    try {
      const { sessionId } = await callComputer(client, computer.id, 'session.create', {
        projectId: project.id,
        prompt: prompt.trim(),
        ...(options && choices.model !== null ? { model: choices.model } : {}),
        ...(options && choices.effort !== null ? { effort: choices.effort } : {}),
        ...(options && choices.permissionMode !== null ? { permissionMode: choices.permissionMode } : {}),
        ...(options && choices.worktree !== null ? { worktree: choices.worktree } : {}),
      });
      setPrompt('');
      useComputers.getState().openSession({ computerId: computer.id, sessionId }, { starting: true });
    } catch (e) {
      toast((e as Error).message, { body: `It didn’t start on ${name}.` });
    } finally {
      setStarting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) || matches(event.nativeEvent, 'new-session.start')) {
      event.preventDefault();
      void start();
    }
  };
  // Images and files stay on this computer for now.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if ([...event.clipboardData.items].some((item) => item.kind === 'file')) {
      event.preventDefault();
      toast(`Images can’t go to ${name} yet`, { body: 'Send the text, and add the image on that computer.' });
    }
  };

  const keys = comboPresses(shortcutById('new-session.pick').keys[0]!);
  return (
    <div className="flex h-full min-h-0 flex-col" data-remote-new-session={computer.id}>
      <div className="drag flex h-13 shrink-0 items-center justify-between px-4">
        <SidebarToggle />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto my-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-5 px-6 pt-2 pb-12" data-new-session-view>
          <div className="grid gap-3 text-center">
            <div>
              <h1 className="text-hero leading-tight font-semibold">Where do we start?</h1>
              <p className="mt-1 text-ui text-muted">
                <Kbd keys={keys[0]!} /> to <Kbd keys={keys.at(-1)!} /> picks a project
              </p>
            </div>
            <RunOnSwitch />
          </div>

          {loadError && <Notice tone="error">{loadError}</Notice>}
          <div className="@container">
            {projects === null && !loadError ? (
              <p className="py-3 text-center text-ui text-muted">{connected ? `Loading the projects on ${name}…` : `The projects show once ${name} is back.`}</p>
            ) : tiles.length === 0 && !loadError ? (
              <Notice>No projects on {name} yet. Add one in Switchboard there, and it shows here.</Notice>
            ) : (
              <div role="group" aria-label={`Projects on ${name}`} className={`grid gap-2 ${expanded || more === 0 ? 'grid-cols-4' : 'grid-cols-5'}`} data-remote-projects>
                {shown.map((tile, index) => (
                  <Tile key={tile.id} tile={tile} index={index} computerId={computer.id} selected={tile.id === picked} onPick={() => pick(tile.id)} />
                ))}
                {more > 0 && (
                  <button type="button" onClick={() => setExpanded(true)} className={`${TILE} justify-center border-dashed border-border text-ui text-muted hover:bg-border/45 hover:text-text`} data-remote-more-projects>
                    +{more} more on {name}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl">
            <div className="flex min-h-10 min-w-0 items-center gap-1 rounded-t-xl border border-b-0 border-remote/45 bg-border/25 px-1.5 py-1" data-route-tray>
              <ComputerChip name={name} size="header" offline={!connected} />
              <span aria-hidden className="px-0.5 text-faint">
                /
              </span>
              {project ? (
                <span className="flex min-w-0 items-center gap-1.5 px-1 text-ui font-semibold text-text" data-route-project>
                  <ProjectIcon project={undefined} root={remoteProjectKey(computer.id, project.id)} name={project.name} size={16} />
                  <span className="truncate">{project.name}</span>
                </span>
              ) : (
                <span className="min-w-0 truncate px-1.5 text-ui text-muted" data-route-hint>
                  Choose a project on {name}
                </span>
              )}
              {options && project && (
                <>
                  <span aria-hidden className="px-0.5 text-faint">
                    /
                  </span>
                  <ChipMenu
                    label={`Where: ${worktree ? 'New worktree' : 'Current checkout'}`}
                    value={worktree ? 'New worktree' : 'Current checkout'}
                    entries={[
                      { label: 'Current checkout', checked: !worktree, onSelect: () => setChoices((c) => ({ ...c, worktree: false })) },
                      { label: 'New worktree', checked: worktree, onSelect: () => setChoices((c) => ({ ...c, worktree: true })) },
                    ]}
                    data-route-where
                  />
                </>
              )}
            </div>
            <div className="rounded-xl rounded-t-none border border-remote/45 bg-card px-3 pt-2.5 pb-2 shadow-sm" data-remote-composer>
              <textarea
                ref={box}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                rows={1}
                autoFocus
                disabled={!connected}
                placeholder={`What should Claude work on? It runs on ${name}.`}
                aria-label={`Message to Claude on ${name}`}
                className="block field-sizing-content max-h-80 min-h-24 w-full min-w-0 resize-none bg-transparent px-1 pt-1 text-title leading-relaxed font-normal text-text outline-none placeholder:text-faint disabled:opacity-60"
                data-composer
              />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <div className="-ml-1.5 flex min-w-0 flex-1 items-center gap-0.5">
                  {options && project && (
                    <>
                      <span className="flex items-center gap-1.5 px-1.5 text-ui text-muted" data-tooltip={`Claude runs with ${name}’s Claude profile`}>
                        <span aria-hidden className="size-1.5 rounded-full bg-ok" />
                        {name}’s profile
                      </span>
                      <ChipMenu
                        label={`Model: ${modelName(options, model)}`}
                        value={modelName(options, model)}
                        entries={[
                          { label: 'Default', checked: model === null, onSelect: () => setChoices((c) => ({ ...c, model: null })) },
                          ...options.models.map((m) => ({ label: m.displayName, detail: m.description, checked: model === m.value, onSelect: () => setChoices((c) => ({ ...c, model: m.value })) })),
                        ]}
                        data-remote-model
                      />
                      {options.efforts.length > 0 && (
                        <ChipMenu
                          label={`Effort: ${effort ?? 'default'}`}
                          value={`Effort: ${effort ?? 'default'}`}
                          entries={[
                            { label: 'Default', checked: effort === null, onSelect: () => setChoices((c) => ({ ...c, effort: null })) },
                            ...options.efforts.map((e) => ({ label: e[0]!.toUpperCase() + e.slice(1), checked: effort === e, onSelect: () => setChoices((c) => ({ ...c, effort: e })) })),
                          ]}
                          data-remote-effort
                        />
                      )}
                      <ChipMenu
                        label={`Mode: ${mode ? MODE_LABEL[mode] : 'Default'}`}
                        value={mode ? MODE_LABEL[mode] : 'Default mode'}
                        dot={mode ? (MODE_DOT[mode] ?? 'bg-faint') : 'bg-faint'}
                        entries={[
                          { label: 'Default', checked: mode === null, onSelect: () => setChoices((c) => ({ ...c, permissionMode: null })) },
                          ...options.modes.map((m) => ({ label: MODE_LABEL[m], checked: mode === m, onSelect: () => setChoices((c) => ({ ...c, permissionMode: m })) })),
                        ]}
                        data-remote-mode
                      />
                    </>
                  )}
                </div>
                <span className="flex" data-tooltip={!starting ? (blocked ?? undefined) : undefined}>
                  <Button variant="primary" size="lg" shortcut="new-session.start" disabled={!!blocked || starting} onClick={() => void start()} className="disabled:pointer-events-none" data-composer-submit data-remote-start>
                    {starting ? 'Starting…' : `Start on ${name}`}
                  </Button>
                </span>
              </div>
            </div>
          </div>
          <p className="-mt-2 text-center text-meta text-muted" data-remote-start-note>
            Claude runs on {name}, in its folders and with its Claude profile. You follow it from here.
          </p>
        </div>
      </div>
    </div>
  );
}

function modelName(options: RemoteOptions, model: string | null): string {
  if (model === null) return 'Default model';
  return options.models.find((m) => m.value === model)?.displayName ?? model;
}

function Tile({ tile, index, computerId, selected, onPick }: { tile: RemoteTile; index: number; computerId: string; selected: boolean; onPick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      data-remote-project={tile.id}
      data-tooltip={tile.project.name}
      className={`${TILE} ${selected ? '-translate-y-px border-remote/70 bg-selected' : 'border-border bg-card hover:bg-border/45'}`}
    >
      <ProjectIcon project={undefined} root={remoteProjectKey(computerId, tile.id)} name={tile.project.name} size={24} remote />
      <span className="grid min-w-0 flex-1 content-start gap-0.5 @max-[600px]:w-full">
        <span className="truncate text-ui font-semibold text-text">{tile.project.name}</span>
        <span className={`flex min-w-0 items-center gap-1.5 text-meta ${TONE_TEXT[tile.tone]}`}>
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[tile.tone]}`} />
          <span className="truncate">{tile.label}</span>
        </span>
      </span>
      {index < 9 && <Kbd keys={`⌘${index + 1}`} tone="plain" className="@max-[680px]:hidden" />}
    </button>
  );
}

/** A quiet chip that opens a menu of choices, like the message box's chips: it shows the value, its label says what it is. */
function ChipMenu({ label, value, entries, dot, ...rest }: { label: string; value: ReactNode; entries: MenuEntry[]; dot?: string; [data: `data-${string}`]: unknown }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-label={label}
        data-tooltip={label}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: rect.left, y: rect.top - 4 });
        }}
        className="flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 text-ui text-muted hover:bg-border/50 hover:text-text"
        {...rest}
      >
        {dot && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />}
        <span className="truncate">{value}</span>
        <ChevronDown size={12} className="shrink-0 text-faint" aria-hidden />
      </button>
      {at && <Menu x={at.x} y={at.y} above entries={entries} anchor={ref} label={label} onClose={() => setAt(null)} />}
    </>
  );
}

