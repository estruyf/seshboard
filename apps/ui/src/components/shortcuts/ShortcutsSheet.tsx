import { isAbsolutePath } from '@switchboard/protocol/client';
import { Search } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useOverlay } from '../../state/overlayStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { useProjectActionList } from '../actions/useActions.ts';
import { Highlight } from '../palette/PaletteRows.tsx';
import { usePaletteContext } from '../palette/usePaletteContext.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Kbd, KeyCombo } from '../ui/Kbd.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { sheetLayout, shortcutContext, typedCombo, type SheetMode, type SheetRow, type SheetSection } from './shortcutSheet.ts';

const MARK = 'rounded-sm bg-accent/20 text-accent-ink';

/** Where focus was when the sheet opened: the terminal and the message box change what works. */
function focusPlace(el: Element | null): 'terminal' | 'composer' | 'other' {
  if (el?.closest('.xterm')) return 'terminal';
  if (el?.closest('[data-composer]')) return 'composer';
  return 'other';
}

/**
 * The keyboard shortcuts sheet (⌘/, Help › Keyboard Shortcuts, or the palette): every shortcut from the
 * registry in `lib/shortcuts.ts`, plus the open project's action shortcuts. Rows that don't work where you
 * are stay visible but faded (All) or go away (Here). The filter matches words and keys, and a combo
 * pressed in it is typed instead of run.
 */
export function ShortcutsSheet() {
  const close = useOverlay((s) => s.close);
  const mode = useOverlay((s) => s.shortcutsMode);
  const setMode = useOverlay((s) => s.setShortcutsMode);
  // Read before the dialog takes focus: where you were decides what works.
  const [focus] = useState(() => focusPlace(document.activeElement));
  const [selection] = useState(() => document.querySelectorAll('[data-picked]').length);
  const palette = usePaletteContext();
  const ctx = useMemo(() => shortcutContext(palette, { focus, selection }), [palette, focus, selection]);
  // A quick question has no project, so no project actions (`canEditActions` is false there).
  const projectRoot = palette.canEditActions ? (palette.session?.projectRoot ?? null) : null;
  const { actions } = useProjectActionList(ctx.session ? projectRoot : null);
  const projectName = ctx.session && projectRoot && isAbsolutePath(projectRoot) ? (palette.currentProject?.name ?? null) : null;

  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const layout = useMemo(
    () => sheetLayout({ ctx, mode, query, actions: actions.map((a) => ({ id: a.id, name: a.name, shortcut: a.shortcut ?? null, scope: a.scope })) }),
    [ctx, mode, query, actions],
  );

  const rows = () => [...(body.current?.querySelectorAll<HTMLElement>('[data-shortcut-row]') ?? [])];
  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    // ⌘J here types "⌘J" to look it up, rather than opening the terminal behind the sheet.
    const combo = typedCombo(event.nativeEvent);
    if (combo) {
      event.preventDefault();
      event.stopPropagation();
      setQuery(combo);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const list = rows();
      if (!list.length) return;
      event.preventDefault();
      (event.key === 'ArrowDown' ? list[0] : list.at(-1))!.focus();
    }
  };
  // ↑ and ↓ read through the rows (they do nothing when chosen); ↑ from the first goes back to the field.
  const onRowsKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = rows();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      const next = index + step;
      if (next < 0) input.current?.focus();
      else list[Math.min(next, list.length - 1)]!.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? list[0] : list.at(-1))!.focus();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Typing on a row goes on in the filter.
      event.preventDefault();
      setQuery((q) => q + event.key);
      input.current?.focus();
    }
  };

  const addAction = () => {
    close();
    usePaletteBus.getState().requestSession('new-action');
  };

  const empty = layout.count === 0 && query.trim() !== '';
  return (
    <Dialog
      title="Keyboard shortcuts"
      width="sheet"
      placement="top"
      flush
      onClose={close}
      initialFocus={input}
      data-shortcuts-sheet
      data-shortcut-mode={mode}
      headerActions={
        <>
          <label className="relative flex items-center">
            <Search size={13} aria-hidden className="pointer-events-none absolute left-2 text-faint" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onFieldKey}
              placeholder="Filter by action or key"
              aria-label="Filter by action or key"
              spellCheck={false}
              className="h-7 w-64 rounded-md border border-edge bg-bg pr-2 pl-7 text-ui text-text outline-none placeholder:text-faint focus:border-accent-ink/60"
              data-shortcut-filter
            />
          </label>
          <SegmentedControl<SheetMode>
            mode="radio"
            label="Which shortcuts"
            value={mode}
            onChange={setMode}
            segments={[
              { value: 'all', label: 'All', tooltip: 'Every shortcut; the ones that don’t work here are faded', data: { 'data-shortcut-mode-option': 'all' } },
              { value: 'here', label: 'Here', tooltip: 'Only what works where you are', data: { 'data-shortcut-mode-option': 'here' } },
            ]}
            className="mx-1"
            data-shortcut-mode-switch
          />
        </>
      }
      footerStart={<span className="text-meta text-muted">Faded rows don't work where you are right now.</span>}
      footer={
        <span className="flex items-center gap-1.5 text-meta text-muted">
          <Kbd keys="Esc" /> close
        </span>
      }
    >
      <div ref={body} className="px-5 py-4" onKeyDown={onRowsKey}>
        {empty ? (
          <div className="py-10 text-center text-ui" data-shortcut-empty>
            <p className="text-text">No shortcut for “{query.trim()}”</p>
            <p className="mt-1 text-muted">
              Try another word, or search the commands with <Kbd shortcut="palette.commands" />
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-8">
            {layout.columns.map((sections, column) => (
              <div key={column} className="flex min-w-0 flex-col gap-5">
                {sections.map((section) => (
                  <Section key={section.id} section={section} projectName={projectName} sessionOpen={ctx.session} onAddAction={addAction} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Section({ section, projectName, sessionOpen, onAddAction }: { section: SheetSection; projectName: string | null; sessionOpen: boolean; onAddAction(): void }) {
  const headingId = useId();
  const actions = section.id === 'actions';
  return (
    <section aria-labelledby={headingId} data-shortcut-section={section.id}>
      <div className="mb-1.5 flex items-center gap-2 px-2">
        <SectionHeader as="h3" headingId={headingId}>
          {section.title}
        </SectionHeader>
        {actions && projectName && (
          <Pill tone="muted" shrink className="max-w-48" data-shortcut-project>
            {projectName}
          </Pill>
        )}
      </div>
      {actions && section.rows.length === 0 ? (
        <div className="flex items-center gap-2 px-2 py-1.5 text-ui text-muted" data-shortcut-actions-empty>
          {sessionOpen ? (
            <>
              No actions in this project
              <Button variant="quiet" size="sm" onClick={onAddAction} className="ml-auto" data-shortcut-add-action>
                Add action…
              </Button>
            </>
          ) : (
            'Open a session to see its project’s actions'
          )}
        </div>
      ) : (
        <ul aria-labelledby={headingId}>
          {section.rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ row }: { row: SheetRow }) {
  return (
    <li
      tabIndex={-1}
      className={`flex items-center gap-3 rounded-md px-2 py-1.5 outline-none focus-visible:bg-border/45 ${row.available ? '' : 'opacity-40'}`}
      data-shortcut-row={row.id}
      data-available={row.available}
    >
      <span className="min-w-0 flex-1">
        <Highlight className="block text-ui text-text" text={row.action} indices={row.marks.action} mark={MARK} />
        {(row.context || row.note) && (
          <span className="block text-meta text-muted">
            {row.context && <Highlight text={row.context} indices={row.marks.context} mark={MARK} />}
            {row.context && row.note && ' · '}
            {row.note}
          </span>
        )}
        {!row.available && <span className="sr-only">, not available here</span>}
      </span>
      <KeyCombo combos={row.keys} marked={row.marks.keys} className="shrink-0" />
    </li>
  );
}
