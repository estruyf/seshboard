import { Globe, Pencil, Plus, RotateCcw, SquarePen, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  defaultSiteAction,
  GITHUB_PR_ACTION,
  GITHUB_PROMPT_FIELDS,
  isBuiltInSiteAction,
  newSiteActionId,
  SITE_ACTION_NAME_MAX,
  SITE_ACTION_PAGES_MAX,
  SITE_ACTION_PROMPT_MAX,
  SITE_ACTIONS_MAX,
  SITE_PROMPT_FIELDS,
  sitePagesProblem,
  type SiteAction,
} from '@seshboard/protocol/client';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { basename } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { FIELD } from '../ui/fieldStyles.ts';
import { Select, type SelectOption } from '../ui/Select.tsx';
import { Switch } from '../ui/Toggle.tsx';

/*
 * Settings › Browser › Site actions (docs/browser.md): Start session in the browser's address bar and page menu, on the
 * pages each action names. The two GitHub ones come built in: they can be turned off, renamed and given a prompt, never
 * removed. Yours name their pages, a project (or ask) and a prompt.
 */

/** The project picker's value for "ask": a project's value is its folder, which is never this. */
const ASK = '*';

/** The words a prompt can use, as the form lists them. */
const fieldsLine = (builtIn: boolean) => (builtIn ? GITHUB_PROMPT_FIELDS : SITE_PROMPT_FIELDS).map((name) => `{${name}}`).join(' ');

/** What a row says under the name: which pages, and where New session opens. */
function whereLine(action: SiteAction, projectName: (root: string) => string): string {
  if (isBuiltInSiteAction(action.id)) return `${action.id === GITHUB_PR_ACTION ? 'GitHub pull requests' : 'GitHub issues'}, in your checkout of the repository`;
  return `${action.pages}, ${action.folder ? `in ${projectName(action.folder)}` : 'pick a folder'}`;
}

/** The site actions, in their order, with Add site action under them. */
export function SiteActionsSettings() {
  const actions = usePreferences((s) => s.prefs.siteActions);
  const update = usePreferences((s) => s.update);
  const projects = useProjects((s) => s.projects);
  const [editing, setEditing] = useState<string | null>(null);
  const projectName = (root: string) => projects.get(root)?.name ?? basename(root);
  const save = (next: SiteAction[]) => update({ siteActions: next });
  const replace = (action: SiteAction) => save(actions.map((candidate) => (candidate.id === action.id ? action : candidate)));
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-site-actions>
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        {actions.map((action) =>
          editing === action.id ? (
            <li key={action.id}>
              <SiteActionForm
                action={action}
                onCancel={() => setEditing(null)}
                onSave={(changed) => {
                  replace(changed);
                  setEditing(null);
                }}
              />
            </li>
          ) : (
            <li key={action.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5" data-site-action={action.id}>
              <Switch checked={action.enabled} onChange={(enabled) => replace({ ...action, enabled })} label={`${action.name}: on`} dataAttrs={{ 'data-site-action-enabled': action.id }} />
              {isBuiltInSiteAction(action.id) ? <SquarePen size={14} aria-hidden className="shrink-0 text-muted" /> : <Globe size={14} aria-hidden className="shrink-0 text-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-medium text-text">{action.name}</span>
                <span className="block truncate text-meta text-muted">{whereLine(action, projectName)}</span>
              </span>
              <Button size="sm" icon={<Pencil size={12} aria-hidden />} onClick={() => setEditing(action.id)} data-site-action-edit={action.id}>
                Edit
              </Button>
              {isBuiltInSiteAction(action.id) ? (
                <ResetButton action={action} onReset={replace} />
              ) : (
                <Button
                  variant="quiet"
                  size="sm"
                  iconOnly
                  icon={<X size={14} aria-hidden />}
                  onClick={() => save(actions.filter((candidate) => candidate.id !== action.id))}
                  data-tooltip="Remove site action"
                  aria-label={`Remove ${action.name}`}
                  className="hover:text-error!"
                  data-site-action-remove={action.id}
                />
              )}
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <SiteActionForm
          action={null}
          onCancel={() => setEditing(null)}
          onSave={(added) => {
            save([...actions, added]);
            setEditing(null);
          }}
        />
      ) : (
        <Button className="w-fit" icon={<Plus size={13} aria-hidden />} disabled={actions.length >= SITE_ACTIONS_MAX} onClick={() => setEditing('new')} data-add-site-action>
          Add site action
        </Button>
      )}
    </div>
  );
}

/** Reset on a built-in action, while its name or prompt differs from how it came. */
function ResetButton({ action, onReset }: { action: SiteAction; onReset(action: SiteAction): void }) {
  const original = defaultSiteAction(action.id);
  if (!original || (original.name === action.name && original.prompt === action.prompt)) return null;
  return (
    <Button variant="quiet" size="sm" iconOnly icon={<RotateCcw size={12} aria-hidden />} onClick={() => onReset({ ...action, name: original.name, prompt: original.prompt })} data-tooltip="Reset name and prompt" aria-label={`Reset ${action.name}`} data-site-action-reset={action.id} />
  );
}

/** The projects a site action can open in: ask, or one of your added projects (and the one it has, if no longer added). */
function useFolderOptions(current: string | null): Array<SelectOption<string>> {
  const projects = useProjects((s) => s.projects);
  return useMemo(() => {
    const added = [...projects.values()].filter((p) => p.added || p.root === current).sort((a, b) => a.name.localeCompare(b.name));
    const missing = current && !projects.has(current) ? [{ value: current, label: basename(current) }] : [];
    return [{ value: ASK, label: 'Pick a folder each time' }, ...added.map((p) => ({ value: p.root, label: p.name })), ...missing];
  }, [projects, current]);
}

/** Add site action, or Edit on a row: a built-in action takes a name and a prompt, yours its pages and project too. */
function SiteActionForm({ action, onCancel, onSave }: { action: SiteAction | null; onCancel(): void; onSave(action: SiteAction): void }) {
  const builtIn = action ? isBuiltInSiteAction(action.id) : false;
  const [name, setName] = useState(action?.name ?? '');
  const [pages, setPages] = useState(action?.pages ?? '');
  const [folder, setFolder] = useState<string | null>(action?.folder ?? null);
  const [prompt, setPrompt] = useState(action?.prompt ?? '');
  const [error, setError] = useState<string | null>(null);
  const folders = useFolderOptions(folder);
  const submit = () => {
    if (!name.trim()) return setError('Give the action a name.');
    const problem = builtIn ? null : sitePagesProblem(pages);
    if (problem) return setError(problem);
    onSave({ id: action?.id ?? newSiteActionId(), name: name.trim(), pages: builtIn ? '' : pages.trim(), folder: builtIn ? null : folder, prompt, enabled: action?.enabled ?? true });
  };
  const label = 'block text-ui font-medium text-text';
  return (
    <form
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border border-dashed border-border px-3 py-3"
      aria-label={action ? `Edit ${action.name}` : 'New site action'}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
      data-site-action-form={action?.id ?? 'new'}
    >
      <label className="grid gap-1">
        <span className={label}>Name</span>
        <input
          className={`${FIELD} h-7 px-2.5 text-ui`}
          value={name}
          maxLength={SITE_ACTION_NAME_MAX}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="Investigate this error"
          autoFocus
          data-site-action-name
        />
        <span className="text-meta text-muted">The entry in the address bar's menu and the page's right-click menu.</span>
      </label>
      {builtIn ? (
        <p className="text-ui text-muted">{action && whereLine(action, basename)}. New session fills in the worktree and the {action?.id === GITHUB_PR_ACTION ? 'pull request' : 'issue'}.</p>
      ) : (
        <>
          <label className="grid gap-1">
            <span className={label}>Pages</span>
            <input
              className={`${FIELD} h-7 px-2.5 font-mono text-ui`}
              value={pages}
              maxLength={SITE_ACTION_PAGES_MAX}
              onChange={(e) => {
                setPages(e.target.value);
                setError(null);
              }}
              placeholder="https://*.sentry.io/issues/*"
              spellCheck={false}
              data-site-action-pages
            />
            <span className="text-meta text-muted">An address, with * for any text. The part after ? or # is ignored unless you add a ?.</span>
          </label>
          <div className="grid gap-1">
            <span className={label}>Project</span>
            <Select<string>
              label="Project"
              value={folder ?? ASK}
              options={folders}
              onChange={(next) => setFolder(next === ASK ? null : next)}
              menuWidth={260}
              className={`${FIELD} h-7 w-fit max-w-full px-2.5 text-ui`}
              dataAttrs={{ 'data-site-action-folder': true }}
            />
          </div>
        </>
      )}
      <label className="grid gap-1">
        <span className={label}>Prompt</span>
        <textarea
          className={`${FIELD} min-h-18 resize-y px-2.5 py-1.5 text-ui`}
          value={prompt}
          maxLength={SITE_ACTION_PROMPT_MAX}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={builtIn ? 'Leave empty for "Work on #151: …"' : 'Find the cause of {title}: {url}'}
          rows={3}
          data-site-action-prompt
        />
        <span className="text-meta text-muted">Fills in the message box. You can use {fieldsLine(builtIn)}.</span>
      </label>
      {error && (
        <p role="alert" className="text-ui text-error">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" data-site-action-save>
          {action ? 'Save' : 'Add action'}
        </Button>
      </div>
    </form>
  );
}
