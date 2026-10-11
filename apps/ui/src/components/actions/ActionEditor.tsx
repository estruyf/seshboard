import { currentPlatform } from '../../lib/platform.ts';
import { MoreHorizontal, Plus, Share2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ACTION_ICONS, type ActionIcon, type ActionSuggestion, type ListedAction } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Pill } from '../ui/Pill.tsx';
import { RadioGroup } from '../ui/Radio.tsx';
import { Select } from '../ui/Select.tsx';
import { Switch } from '../ui/Toggle.tsx';
import {
  ACTION_VARIABLES,
  actionKey,
  EMPTY_DRAFT,
  friendlySaveError,
  groupActions,
  insertVariable,
  NAME_MAX,
  projectName,
  slug,
  validateDraft,
  visibleSuggestions,
  type ActionDraft,
  type DraftErrors,
} from './actionForm.ts';
import { ACTION_ICON, shortcutFromEvent } from './useActions.ts';

const field = 'h-7 w-full rounded-md border bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink disabled:opacity-70';
const fieldBorder = (invalid: boolean) => (invalid ? 'border-error' : 'border-edge');
const fieldLabel = 'text-ui text-muted';
/** How many icons the picker shows inline; the rest are behind its ⋯ button. */
const INLINE_ICONS = 4;

/** Readable names for the icon picker (the stored values are lucide-style ids such as `git-commit`). */
const ICON_NAME: Record<ActionIcon, string> = {
  play: 'Play',
  rocket: 'Rocket',
  'git-commit': 'Commit',
  'git-pull-request': 'Pull request',
  upload: 'Upload',
  flask: 'Flask',
  package: 'Package',
  terminal: 'Terminal',
  sparkles: 'Sparkles',
  wrench: 'Wrench',
  globe: 'Globe',
  bug: 'Bug',
  check: 'Check',
};

/** The form values of a listed action (`trusted` only matters in the list). */
function draftOf(a: ListedAction): ActionDraft {
  const { trusted, ...rest } = a;
  void trusted;
  return rest;
}

/**
 * Records a key combination, styled like an input: click (or press Space), then press the keys.
 * Escape stops recording, and doesn't close the dialog since the key event is marked handled.
 */
function ShortcutInput({
  value,
  onChange,
  labelId,
  check,
  invalid,
  buttonRef,
}: {
  value: string | null;
  onChange(value: string | null): void;
  labelId: string;
  /** Why a recorded shortcut can't be used (Switchboard or another action has it), or null. */
  check(shortcut: string): string | null;
  /** The form's message for the saved value, shown when nothing was recorded since. */
  invalid?: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [recording, setRecording] = useState(false);
  const [recordError, setError] = useState<string | null>(null);
  const error = recordError ?? invalid ?? null;
  const id = useId();
  return (
    <div className="grid gap-1">
      <div className={`${field} flex items-center gap-1 pr-1 focus-within:border-accent-ink ${recording ? 'border-accent-ink' : fieldBorder(Boolean(error))}`}>
        <button
          ref={buttonRef}
          type="button"
          aria-labelledby={`${labelId} ${id}-value`}
          aria-describedby={error ? `${id}-hint` : undefined}
          onClick={() => (setRecording(true), setError(null))}
          onBlur={() => setRecording(false)}
          onKeyDown={(e) => {
            if (!recording) return;
            e.preventDefault();
            if (e.key === 'Escape') return setRecording(false);
            const shortcut = shortcutFromEvent(e.nativeEvent);
            if (!shortcut) return;
            if (!shortcut.includes('+')) return setError(currentPlatform() === 'darwin' ? 'Include ⌘, ⌃ or ⌥' : 'Include Ctrl or Alt');
            const problem = check(shortcut);
            if (problem) return setError(problem);
            onChange(shortcut);
            setRecording(false);
          }}
          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none disabled:cursor-default"
          data-action-shortcut
        >
          <span id={`${id}-value`} className="min-w-0 flex-1 truncate">
            {recording ? <span className="text-accent-ink">Press keys, Esc cancels</span> : value ? <Kbd keys={value} className="text-text" /> : <span className="text-faint">None</span>}
          </span>
          {!recording && (
            <span className="shrink-0 text-muted" aria-hidden>
              {value ? 'Change' : 'Set'}
            </span>
          )}
        </button>
        {value && !recording && (
          <Button variant="quiet" size="sm" iconOnly icon={<X size={12} aria-hidden />} onClick={() => onChange(null)} aria-label="Clear the shortcut" data-tooltip="Clear" />
        )}
      </div>
      {error && (
        <span id={`${id}-hint`} role="alert" className="text-meta text-error">
          {error}
        </span>
      )}
    </div>
  );
}

/** One row of the left list: a real button inside an `<li>`. */
function Row({ selected, onClick, children, data }: { selected?: boolean; onClick(): void; children: ReactNode; data?: Record<`data-${string}`, string | boolean> }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? 'true' : undefined}
        className={`flex min-h-8 w-full items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-ui text-text ${selected ? 'bg-selected font-semibold' : 'hover:bg-border/45'}`}
        {...data}
      >
        {children}
      </button>
    </li>
  );
}

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <SectionHeader as="h3" headingId={id} className="mt-5 mb-1.5 px-2.5 first:mt-2">
      {children}
    </SectionHeader>
  );
}

/**
 * The icon choice, sized like a field: the first few icons inline (the chosen one always among them),
 * the rest in a listbox behind ⋯. While the listbox is open, Escape closes it rather than the dialog.
 */
function IconPicker({ value, onChange }: { value: ActionIcon; onChange(icon: ActionIcon): void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inline: ActionIcon[] = ACTION_ICONS.slice(0, INLINE_ICONS);
  if (!inline.includes(value)) inline[INLINE_ICONS - 1] = value;

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[aria-selected=true]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (icon: ActionIcon) => {
    onChange(icon);
    setOpen(false);
    moreRef.current?.focus();
  };

  const tile = (on: boolean) => `flex size-6 items-center justify-center rounded disabled:opacity-60 ${on ? 'bg-selected text-accent-ink' : 'text-muted hover:bg-border/50 hover:text-text'}`;

  return (
    <div ref={rootRef} className="relative flex h-7 items-center gap-0.5 rounded-md border border-edge bg-bg px-0.5" data-action-icon data-value={value}>
      <RadioGroup label="Icon" className="flex gap-0.5">
        {inline.map((icon) => {
          const Icon = ACTION_ICON[icon];
          const on = value === icon;
          return (
            <button key={icon} type="button" role="radio" aria-checked={on} aria-label={ICON_NAME[icon]} data-tooltip={ICON_NAME[icon]} tabIndex={on ? 0 : -1} onClick={() => onChange(icon)} className={tile(on)}>
              <Icon size={14} aria-hidden />
            </button>
          );
        })}
      </RadioGroup>
      <button ref={moreRef} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="More icons" data-tooltip="More icons" onClick={() => setOpen((o) => !o)} className={tile(open)}>
        <MoreHorizontal size={14} aria-hidden />
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Icon"
          className="absolute top-full right-0 z-10 mt-1 grid grid-cols-5 gap-0.5 rounded-lg border p-1 overlay"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
              moreRef.current?.focus();
              return;
            }
            const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 }[e.key];
            if (!step) return;
            e.preventDefault();
            const options = [...(listRef.current?.querySelectorAll<HTMLElement>('[role=option]') ?? [])];
            const next = options.indexOf(document.activeElement as HTMLElement) + step;
            options[Math.max(0, Math.min(options.length - 1, next))]?.focus();
          }}
        >
          {ACTION_ICONS.map((icon) => {
            const Icon = ACTION_ICON[icon];
            const on = value === icon;
            return (
              <button key={icon} type="button" role="option" aria-selected={on} aria-label={ICON_NAME[icon]} data-tooltip={ICON_NAME[icon]} tabIndex={on ? 0 : -1} onClick={() => pick(icon)} className={`size-7 ${tile(on)}`}>
                <Icon size={14} aria-hidden />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Asks before deleting one of your actions (from the editor or a pill's context menu). */
export function DeleteActionDialog({ action, onConfirm, onClose }: { action: ListedAction; onConfirm(): Promise<void>; onClose(): void }) {
  return (
    <ConfirmDialog
      title={`Delete ${action.name}?`}
      body={<>The action is removed from {action.scope === 'global' ? 'all your projects' : 'this project'}. Its command is not run.</>}
      confirmLabel="Delete"
      danger
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

/**
 * Add, edit and remove project actions: the list on the left, the selected action's form on the
 * right. Shared ones (from .switchboard.json) show read-only, since they are edited in that file.
 * A successful save hands the action to `onSaved` (the caller closes the editor and confirms it); a
 * failed one keeps the editor open with the error above the form, so nothing typed is lost.
 */
export function ActionEditor({
  projectRoot,
  actions,
  sharedFile,
  errors,
  initial,
  initialAction,
  onChanged,
  onSaved,
  onClose,
}: {
  projectRoot: string;
  actions: ListedAction[];
  sharedFile: string | null;
  errors: string[];
  initial?: Partial<ActionDraft> | null;
  /** The action to start on (Edit… on a pill). */
  initialAction?: ListedAction | null;
  onChanged(): void;
  /** After a successful save: the action as saved, and the one it was edited from (null for a new one). */
  onSaved(saved: ListedAction, previous: { scope: ListedAction['scope']; id: string } | null): void;
  onClose(): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const openIn = useOpenIn();
  // Opened with a prefilled draft, it starts on a new action; otherwise on the first action, if any.
  const [first] = useState(() => initialAction ?? (initial ? undefined : (groupActions(actions).yours[0] ?? actions[0])));
  /** The listed action the form shows, or null for a new one. */
  const [selected, setSelected] = useState<ListedAction | null>(first ?? null);
  const [draft, setDraft] = useState<ActionDraft>(() => (first ? draftOf(first) : { ...EMPTY_DRAFT, ...initial }));
  const [suggestions, setSuggestions] = useState<ActionSuggestion[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<DraftErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  /** The action waiting for "Delete?" to be confirmed. */
  const [deleting, setDeleting] = useState<ListedAction | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLTextAreaElement>(null);
  const shortcutRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  const readOnly = selected?.scope === 'shared';
  const { yours, shared } = groupActions(actions);
  const { shown, hidden } = visibleSuggestions(suggestions, actions, showAll);

  useEffect(() => {
    if (client) void client.call('actions.suggest', { projectRoot }).then((r) => setSuggestions(r.suggestions));
  }, [client, projectRoot]);

  // A new action starts in its name field; picking an existing one leaves focus on the list.
  useEffect(() => {
    if (!selected) nameRef.current?.focus();
  }, [selected]);

  // A failed save shows its message at the top of the form, which may be scrolled out of view.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  const edit = (next: Partial<ActionDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    // A field that changes no longer needs its message.
    if ('name' in next) setFieldErrors((f) => ({ ...f, name: undefined }));
    if ('command' in next) setFieldErrors((f) => ({ ...f, command: undefined }));
    if ('shortcut' in next || 'scope' in next) setFieldErrors((f) => ({ ...f, shortcut: undefined }));
    setError(null);
  };

  const select = (a: ListedAction | null, values?: Partial<ActionDraft>) => {
    setSelected(a);
    setDraft(a ? draftOf(a) : { ...EMPTY_DRAFT, ...values });
    setFieldErrors({});
    setError(null);
  };

  const save = async () => {
    if (!client || readOnly || saving) return;
    const editing = selected && selected.scope !== 'shared' ? selected : null;
    const invalid = validateDraft(draft, actions, editing);
    setFieldErrors(invalid);
    if (invalid.name) return nameRef.current?.focus();
    if (invalid.command) return commandRef.current?.focus();
    if (invalid.shortcut) return shortcutRef.current?.focus();
    const { scope, ...action } = draft;
    if (scope === 'shared') return;
    const name = action.name.trim();
    // An edit within the same scope keeps its id (so its shortcut and menu hook stay); a move or a new action gets one from the name.
    const sameScope = editing?.scope === scope;
    const newId = editing && sameScope ? editing.id : slug(name);
    setSaving(true);
    setError(null);
    try {
      await client.call('actions.save', {
        projectRoot: scope === 'global' ? null : projectRoot,
        action: {
          ...action,
          name,
          id: newId,
          runOnWorktreeCreate: action.type === 'shell' && action.runOnWorktreeCreate,
        },
        ...(editing && sameScope && editing.id !== slug(name) ? { previousId: editing.id } : {}),
      });
      // A move to the other scope removes the old copy only once the new one is saved, so a failed
      // save loses nothing (ids are unique per scope, so both can exist for a moment).
      if (editing && !sameScope)
        await client.call('actions.delete', {
          projectRoot: editing.scope === 'global' ? null : projectRoot,
          id: editing.id,
        });
      const saved: ListedAction = {
        ...draft,
        name,
        id: newId,
        scope,
        trusted: true,
      };
      onChanged();
      onSaved(saved, editing && { scope: editing.scope, id: editing.id });
    } catch (e) {
      setError(friendlySaveError(e));
      setSaving(false);
    }
  };

  const remove = async (a: ListedAction) => {
    if (!client || a.scope === 'shared') return;
    await client.call('actions.delete', {
      projectRoot: a.scope === 'global' ? null : projectRoot,
      id: a.id,
    });
    select(null);
    onChanged();
  };

  const insert = (name: string) => {
    const el = commandRef.current;
    const end = draft.command.length;
    const { text, cursor } = insertVariable(draft.command, el?.selectionStart ?? end, el?.selectionEnd ?? end, name);
    edit({ command: text });
    // Put the cursor after the variable once React has written the new value.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  };

  const PreviewIcon = ACTION_ICON[draft.icon];

  const actionRow = (a: ListedAction) => {
    const Icon = ACTION_ICON[a.icon];
    return (
      <Row key={actionKey(a)} selected={selected !== null && actionKey(selected) === actionKey(a)} onClick={() => select(a)}>
        <Icon size={14} className="shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{a.name}</span>
        {a.scope === 'global' && <span className="shrink-0 rounded border border-edge px-1.5 text-meta font-normal text-muted">All projects</span>}
        {a.scope === 'shared' && <span className="shrink-0 rounded border border-edge px-1.5 text-meta font-normal text-muted">Shared</span>}
        {a.shortcut && <Kbd keys={a.shortcut} />}
      </Row>
    );
  };

  // A renamed project shows the name you gave it.
  const shownName = useProjects((s) => s.projects.get(projectRoot)?.name) ?? projectName(projectRoot);

  return (
    <>
      {/*
       * Escape closes, except while a shortcut is being recorded (it stops the recording), a dropdown
       * is open, or the delete confirmation is on top. ⌘↵ saves from any field; the recorder marks the
       * keys it takes as handled.
       */}
      <Dialog
        width="lg"
        flush
        title="Project actions"
        subtitle={<span data-tooltip={projectRoot}>{shownName}</span>}
        onClose={onClose}
        onSubmit={readOnly ? undefined : () => void save()}
        className="h-[650px]"
      >

        <div className="flex min-h-0 flex-1">
          <nav aria-label="Actions" className="w-[280px] shrink-0 overflow-y-auto border-r border-edge px-2.5 py-2">
            {yours.length > 0 && (
              <>
                <SectionTitle id={`${id}-yours`}>Yours</SectionTitle>
                <ul aria-labelledby={`${id}-yours`} className="grid gap-px">
                  {yours.map(actionRow)}
                </ul>
              </>
            )}
            <ul className="mt-2 grid">
              <Row selected={selected === null} onClick={() => select(null)} data={{ 'data-add-action': true }}>
                <Plus size={14} className="shrink-0 text-accent-ink" aria-hidden />
                <span className="font-medium text-accent-ink">New action</span>
              </Row>
            </ul>
            {shared.length > 0 && (
              <>
                <SectionTitle id={`${id}-shared`}>From .switchboard.json</SectionTitle>
                <ul aria-labelledby={`${id}-shared`} className="grid gap-px">
                  {shared.map(actionRow)}
                </ul>
              </>
            )}
            {shown.length > 0 && (
              <>
                <SectionTitle id={`${id}-suggest`}>Add from package.json</SectionTitle>
                <ul aria-labelledby={`${id}-suggest`} className="grid gap-px">
                  {shown.map((s) => (
                    <Row
                      key={s.command}
                      onClick={() =>
                        select(null, {
                          name: s.name,
                          command: s.command,
                          type: s.type,
                          icon: s.icon,
                        })
                      }
                      data={{ 'data-action-suggestion': s.command }}
                    >
                      <span className="shrink-0 truncate">{s.name}</span>
                      <span className="min-w-0 flex-1 truncate text-right font-mono text-meta text-faint">{s.command}</span>
                      <Plus size={14} className="shrink-0 text-muted" aria-hidden />
                    </Row>
                  ))}
                  {hidden > 0 && (
                    <Row onClick={() => setShowAll(true)}>
                      <span className="text-muted">{hidden} more scripts…</span>
                    </Row>
                  )}
                </ul>
              </>
            )}
          </nav>

          <form
            aria-label={selected ? selected.name : 'New action'}
            className="flex min-w-0 flex-1 flex-col"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {error && (
                <Notice ref={errorRef} tone="error" className="mb-3" data-action-save-error>
                  {error}
                </Notice>
              )}
              {errors.map((e) => (
                <Notice key={e} tone="error" className="mb-3">
                  {e}
                </Notice>
              ))}
              {readOnly && (
                <Notice
                  role="note"
                  className="mb-3"
                  actions={
                    sharedFile && (
                      <Button size="sm" onClick={() => void openIn(sharedFile)}>
                        Edit file
                      </Button>
                    )
                  }
                >
                  Shared from .switchboard.json in the repo. Edit the file to change it.
                </Notice>
              )}
              {/* A disabled fieldset makes every control read-only for a shared action in one place. */}
              <fieldset disabled={readOnly} className="grid min-w-0 gap-4">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
                  <label htmlFor={`${id}-name`} className={fieldLabel}>
                    Name
                  </label>
                  <span className={fieldLabel} aria-hidden>
                    Icon
                  </span>
                  <input
                    ref={nameRef}
                    id={`${id}-name`}
                    placeholder="e.g. Publish"
                    value={draft.name}
                    onChange={(e) => edit({ name: e.target.value })}
                    aria-invalid={!!fieldErrors.name}
                    aria-describedby={fieldErrors.name ? `${id}-name-error` : undefined}
                    className={`${field} ${fieldBorder(!!fieldErrors.name)}`}
                    data-action-name
                  />
                  <IconPicker value={draft.icon} onChange={(icon) => edit({ icon })} />
                  {fieldErrors.name ? (
                    <span id={`${id}-name-error`} className="text-meta text-error">
                      {fieldErrors.name}
                    </span>
                  ) : (
                    draft.name.length > NAME_MAX - 5 && <span className="text-meta text-muted">{`${draft.name.length}/${NAME_MAX}`}</span>
                  )}
                </div>

                <div className="grid gap-1">
                  <RadioGroup label="What it does" className="grid grid-cols-2 gap-3">
                    {(['shell', 'prompt'] as const).map((type) => {
                      const on = draft.type === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          tabIndex={on ? 0 : -1}
                          onClick={() => edit({ type })}
                          className={`rounded-lg border px-3.5 py-2.5 text-left disabled:opacity-70 ${on ? 'border-accent-ink bg-selected' : 'border-edge hover:bg-border/45'}`}
                          data-action-type={type}
                        >
                          <span className="block text-ui font-semibold">{type === 'shell' ? 'Run a command' : 'Ask Claude'}</span>
                          <span className="mt-0.5 block text-meta text-muted">{type === 'shell' ? 'Opens in a terminal tab of the session' : 'Sends a prompt to the session'}</span>
                        </button>
                      );
                    })}
                  </RadioGroup>
                </div>

                <div className="grid gap-1">
                  <label htmlFor={`${id}-command`} className={fieldLabel}>
                    {draft.type === 'shell' ? 'Command' : 'Prompt'}
                  </label>
                  <textarea
                    ref={commandRef}
                    id={`${id}-command`}
                    rows={draft.type === 'shell' ? 1 : 3}
                    value={draft.command}
                    onChange={(e) => edit({ command: e.target.value })}
                    placeholder={draft.type === 'shell' ? 'npm run build && npm publish' : 'Commit the staged changes with a clear message'}
                    aria-invalid={!!fieldErrors.command}
                    aria-describedby={fieldErrors.command ? `${id}-command-error` : undefined}
                    className={`${field} ${fieldBorder(!!fieldErrors.command)} h-auto resize-y py-1.5 ${draft.type === 'shell' ? 'font-mono' : ''}`}
                    data-action-command
                  />
                  {fieldErrors.command && (
                    <span id={`${id}-command-error`} className="text-meta text-error">
                      {fieldErrors.command}
                    </span>
                  )}
                  <div role="group" aria-label="Insert a variable" className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 text-ui text-muted" aria-hidden>
                      Insert
                    </span>
                    {ACTION_VARIABLES.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => insert(name)}
                        aria-label={`Insert \${${name}}`}
                        className="h-6 rounded-md border border-edge px-2 font-mono text-meta text-muted hover:bg-border/50 hover:text-text"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="grid content-start gap-1">
                    <span className={fieldLabel}>Saved for</span>
                    <Select
                      label="Saved for"
                      className={`${field} border-edge`}
                      value={draft.scope}
                      onChange={(scope) => edit({ scope })}
                      disabled={readOnly}
                      options={[
                        { value: 'project', label: 'This project' },
                        { value: 'global', label: 'All projects' },
                        ...(readOnly
                          ? [
                            {
                              value: 'shared' as const,
                              label: '.switchboard.json',
                            },
                          ]
                          : []),
                      ]}
                    />
                  </div>
                  {draft.type === 'shell' && (
                    <div className="grid content-start gap-1">
                      <span className={fieldLabel}>Runs in</span>
                      <Select
                        label="Runs in"
                        className={`${field} border-edge`}
                        value={draft.cwd}
                        onChange={(cwd) => edit({ cwd })}
                        disabled={readOnly}
                        menuWidth={200}
                        options={[
                          {
                            value: 'session',
                            label: 'Session folder',
                            hint: 'its worktree',
                          },
                          { value: 'project-root', label: 'Project root' },
                        ]}
                      />
                    </div>
                  )}
                  <div className="grid content-start gap-1">
                    <span id={`${id}-shortcut`} className={fieldLabel}>
                      Shortcut
                    </span>
                    <ShortcutInput
                      labelId={`${id}-shortcut`}
                      value={draft.shortcut}
                      onChange={(shortcut) => edit({ shortcut })}
                      check={(shortcut) => validateDraft({ ...draft, shortcut }, actions, selected && selected.scope !== 'shared' ? selected : null).shortcut ?? null}
                      invalid={fieldErrors.shortcut}
                      buttonRef={shortcutRef}
                    />
                  </div>
                </div>

                <div className="grid gap-3">
                  <label className="flex cursor-pointer items-center gap-3 text-ui">
                    <Switch checked={draft.confirm} onChange={(confirm) => edit({ confirm })} disabled={readOnly} dataAttrs={{ 'data-action-confirm': true }} />
                    <span>Ask before running</span>
                  </label>
                  {draft.type === 'shell' && (
                    <label className="flex cursor-pointer items-center gap-3 text-ui">
                      <Switch checked={draft.runOnWorktreeCreate} onChange={(runOnWorktreeCreate) => edit({ runOnWorktreeCreate })} disabled={readOnly} dataAttrs={{ 'data-action-worktree': true }} />
                      <span>
                        Run when a new worktree is created <span className="text-meta text-muted">· before Claude starts, for setup such as installing dependencies</span>
                      </span>
                    </label>
                  )}
                </div>

              </fieldset>
            </div>

            <footer className="flex shrink-0 items-center gap-2.5 border-t border-edge px-6 py-3">
              {selected && !readOnly && (
                <Button variant="danger" onClick={() => setDeleting(selected)} data-delete-action>
                  Delete
                </Button>
              )}
              <span className="flex-1" />
              <span className="flex min-w-0 items-center gap-2.5 text-ui text-muted">
                <span className="shrink-0">In the header as</span>
                {/* The pill as it shows above the message box; the edge colour keeps its border visible on the dialog. */}
                <Pill shrink icon={<PreviewIcon size={12} className="shrink-0" aria-hidden />} kbd={draft.shortcut ?? undefined} className="max-w-44 border-edge">
                  <span className="truncate">{draft.name.trim() || 'Action'}</span>
                </Pill>
              </span>
              <span className="mx-1 h-5 w-px shrink-0 bg-edge" aria-hidden />
              <Button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
              {!readOnly && (
                <Button type="submit" variant="primary" kbd="⌘↵" disabled={saving} data-save-action>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              )}
            </footer>
          </form>
        </div>

        <p className="flex shrink-0 items-center gap-2 border-t border-edge bg-bg/40 px-5 py-2.5 text-ui text-muted">
          <Share2 size={14} className="shrink-0" aria-hidden />
          <span>
            Share actions with your team: commit a <code className="font-mono text-text">.switchboard.json</code> in the repo · each shared command asks for approval once.
          </span>
        </p>
      </Dialog>
      {deleting && <DeleteActionDialog action={deleting} onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />}
    </>
  );
}
