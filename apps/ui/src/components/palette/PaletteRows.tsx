import { Check, ChevronRight, FolderOpen, GitBranch, PencilLine, type LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import type { ProjectInfo } from '@switchboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { rowStatus } from '../../state/sidebarRows.ts';
import { shortAge } from '../../lib/format.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { DraftIcon } from '../drafts/UnsentList.tsx';
import type { UnsentEntry } from '../drafts/useUnsent.ts';
import { Kbd } from '../ui/Kbd.tsx';
import type { TileTone } from '../newSession/projectTiles.ts';

/** The letters of `text` at `indices` in the readable accent, the rest as is. */
export function Highlight({ text, indices, className = '', mark = 'text-accent-ink' }: { text: string; indices: readonly number[]; className?: string; /** How a matched run looks. */ mark?: string }) {
  if (indices.length === 0) return <span className={className}>{text}</span>;
  const marked = new Set(indices);
  const parts: ReactNode[] = [];
  let run = '';
  let runMarked = false;
  const flush = (key: number) => {
    if (!run) return;
    parts.push(runMarked ? <span key={key} className={mark}>{run}</span> : run);
    run = '';
  };
  text.split('').forEach((char, i) => {
    if (marked.has(i) !== runMarked) {
      flush(i);
      runMarked = marked.has(i);
    }
    run += char;
  });
  flush(text.length);
  return <span className={className}>{parts}</span>;
}

interface RowShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> {
  id: string;
  active: boolean;
  /** 36px rows; `tall` (42px) for projects with their path and branch. */
  tall?: boolean;
  onHover(): void;
  onChoose(alt: boolean): void;
  children: ReactNode;
}

/** An option in the palette's list: the active one has the selected fill and a 2px accent rail. */
function RowShell({ id, active, tall = false, onHover, onChoose, children, className = '', ...rest }: RowShellProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-active={active}
      onMouseMove={onHover}
      onClick={(e) => onChoose(e.altKey)}
      className={`relative mx-1.5 flex cursor-default items-center gap-2.5 rounded-md px-2.5 ${tall ? 'h-10.5' : 'h-9'} ${active ? 'bg-selected text-text' : 'text-text/85'} ${className}`}
      {...rest}
    >
      {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-ink" />}
      {children}
    </div>
  );
}

type Common = Omit<RowShellProps, 'children' | 'tall'>;

const Slot = ({ children }: { children: ReactNode }) => (
  <span aria-hidden className="flex w-4 shrink-0 justify-center text-muted">
    {children}
  </span>
);

/** A command: icon, title, then its shortcut or a note, and a chevron when it asks for more. */
export function CommandRow({ icon: Icon, title, indices, shortcut, hint, hintTone, next, commandId, ...common }: Common & { icon: LucideIcon; title: string; indices: number[]; shortcut?: string; hint?: string; hintTone?: 'ok'; next: boolean; commandId: string }) {
  return (
    <RowShell {...common} data-palette-command={commandId}>
      <Slot>
        <Icon size={14} />
      </Slot>
      <Highlight className="min-w-0 flex-1 truncate text-body" text={title} indices={indices} />
      {hint && <span className={`max-w-[45%] shrink-0 truncate text-meta ${hintTone === 'ok' ? 'text-ok' : 'text-faint'}`}>{hint}</span>}
      {shortcut && <Kbd keys={shortcut} />}
      {next && <ChevronRight size={13} className="shrink-0 text-faint" aria-hidden />}
    </RowShell>
  );
}

const DOT: Partial<Record<NonNullable<ReturnType<typeof rowStatus>>, string>> = {
  'needs-you': 'bg-warn animate-pulse',
  running: 'bg-accent-ink',
  unread: 'bg-unread',
  background: 'bg-ok',
  error: 'bg-error',
};

/** A session to go to: its status dot, project icon, title and project, and what it needs or how old it is. */
export function SessionRow({ data, project, projectName, indices, draft = false, ...common }: Common & { data: SessionRowData; project: ProjectInfo | undefined; projectName: string; indices: number[]; /** It holds an unsent message. */ draft?: boolean }) {
  const status = rowStatus(data);
  return (
    <RowShell {...common} data-palette-session={data.id}>
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT[status ?? 'idle'] ?? 'bg-faint/50'}`} />
      <ProjectIcon project={project} root={data.projectRoot} size={16} name={data.remote?.projectName} remote={!!data.remote} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate text-body">
        <Highlight className="truncate" text={data.title || 'Untitled session'} indices={indices} />
        <span className="shrink-0 text-ui text-muted">· {projectName}</span>
      </span>
      {status === 'needs-you' && <span className="shrink-0 text-meta text-warn">Needs you</span>}
      {status === 'running' && <span className="shrink-0 text-meta text-accent-ink">Working</span>}
      {draft && <PencilLine size={11} className="shrink-0 text-faint" aria-label="unsent message" data-palette-pen />}
      <span className="shrink-0 text-meta text-faint tabular-nums">{shortAge(data.updatedAt)}</span>
    </RowShell>
  );
}

/** An unsent message in go-to: its icon, where it was written, the start of it in italics, and its age. */
export function DraftRow({ entry, ...common }: Common & { entry: UnsentEntry }) {
  return (
    <RowShell {...common} data-palette-draft={entry.item.key}>
      <span aria-hidden className="size-1.5 shrink-0" />
      <DraftIcon entry={entry} size={16} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2 truncate text-body">
        <span className="shrink-0 truncate">{entry.title}</span>
        <span className="min-w-0 truncate text-ui text-text/80 italic">{entry.item.preview}</span>
      </span>
      <span className="shrink-0 text-meta text-faint tabular-nums">{shortAge(entry.item.updatedAt)}</span>
    </RowShell>
  );
}

const TONE: Record<TileTone, { dot: string; text: string }> = {
  'needs-you': { dot: 'bg-warn', text: 'text-warn' },
  working: { dot: 'bg-accent-ink', text: 'text-text' },
  idle: { dot: 'bg-faint/60', text: 'text-muted' },
};

/**
 * A project: in the New session step with its branch, path and status (and ⌘1 to ⌘9); in go-to on one
 * line, offering a new session there.
 */
export function ProjectRow({
  root,
  project,
  name,
  indices,
  branch,
  path,
  status,
  number,
  compact = false,
  ...common
}: Common & { root: string; project: ProjectInfo | undefined; name: string; indices: number[]; branch: string | null; path: string; status: { tone: TileTone; label: string } | null; number: number | null; compact?: boolean }) {
  if (compact) {
    return (
      <RowShell {...common} data-palette-project={root}>
        <ProjectIcon project={project} root={root} size={16} />
        <Highlight className="min-w-0 flex-1 truncate text-body" text={name} indices={indices} />
        <span className="shrink-0 text-meta text-faint">new session</span>
        <ChevronRight size={13} className="shrink-0 text-faint" aria-hidden />
      </RowShell>
    );
  }
  return (
    <RowShell {...common} tall data-palette-project={root}>
      <ProjectIcon project={project} root={root} size={20} />
      <span className="grid min-w-0 flex-1 leading-tight">
        <span className="flex min-w-0 items-center gap-1.5 text-body">
          <Highlight className="truncate font-semibold" text={name} indices={indices} />
          {branch && (
            <span className="flex min-w-0 items-center gap-1 font-mono text-meta text-muted">
              <GitBranch size={11} className="shrink-0" aria-hidden />
              <span className="truncate">{branch}</span>
            </span>
          )}
        </span>
        <span className="truncate font-mono text-meta text-faint" data-palette-project-path>
          {path}
        </span>
      </span>
      {status && (
        <span className={`flex shrink-0 items-center gap-1.5 text-meta ${TONE[status.tone].text}`}>
          <span aria-hidden className={`size-1.5 rounded-full ${TONE[status.tone].dot}`} />
          {status.label}
        </span>
      )}
      {number !== null && <Kbd keys={`⌘${number}`} />}
    </RowShell>
  );
}

/** "Choose another folder…" at the end of the projects. */
export function FolderRow(common: Common) {
  return (
    <RowShell {...common} data-palette-choose-folder>
      <Slot>
        <FolderOpen size={14} />
      </Slot>
      <span className="min-w-0 flex-1 truncate text-body">Choose another folder…</span>
      <Kbd keys="⌘O" />
    </RowShell>
  );
}

/** One choice in a pick step (a model, a message to fork from): a check on the current one. */
export function OptionRow({
  value,
  title,
  indices,
  detail,
  dot,
  current,
  number,
  ...common
}: Common & { value: string; title: string; indices: number[]; detail?: string; dot?: string; current: boolean; number: number | null }) {
  return (
    <RowShell {...common} data-palette-option={value}>
      <Slot>{current ? <Check size={14} className="text-accent-ink" /> : dot ? <span className={`size-2 rounded-full ${dot}`} /> : null}</Slot>
      <span className="flex min-w-0 flex-1 items-baseline gap-2 truncate">
        <Highlight className="truncate text-body" text={title} indices={indices} />
        {detail && <span className="truncate text-ui text-muted">{detail}</span>}
      </span>
      {number !== null && <Kbd keys={`⌘${number}`} />}
    </RowShell>
  );
}

/** A prefix in the "?" help: the character, what it lists, and how to get there. */
export function HelpRow({ prefix, title, detail, hook, ...common }: Common & { prefix: string; title: string; detail: string; /** The `data-palette-help` value when it isn't the prefix (the shortcuts sheet). */ hook?: string }) {
  return (
    <RowShell {...common} data-palette-help={hook ?? (prefix || 'goto')}>
      <span aria-hidden className="flex w-4 shrink-0 justify-center font-mono text-body font-semibold text-accent-ink">
        {prefix}
      </span>
      <span className="min-w-0 flex-1 truncate text-body">{title}</span>
      <span className="shrink-0 text-meta text-faint">{detail}</span>
    </RowShell>
  );
}
