import type { ReactNode } from 'react';
import { shortAge, basename } from '../../lib/format.ts';
import { waitedFor } from '../../state/focus.ts';
import type { FocusSummary } from '../../state/focusGate.ts';
import { openProject } from '../../state/projectPageStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { openRow } from '../../state/useRemoteRows.ts';
import { FOCUS_DOT } from '../focus/focusLabels.ts';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import type { ContextRow, ContextSection } from './sessionContext.ts';

const STATE_DOT: Record<ContextRow['tone'], string> = { 'needs-you': 'bg-warn', working: 'bg-accent-ink animate-pulse', unread: 'bg-unread', error: 'bg-error', idle: 'bg-faint/50' };
const STATE_TEXT: Record<ContextRow['tone'], string> = { 'needs-you': 'text-warn', working: 'text-accent-ink', unread: 'text-unread', error: 'text-error', idle: 'text-faint' };

/** A session as one quiet row: its dot, its title, a word about it and its age. A click opens it. */
function SessionLine({ dot, title, word, wordClass, age, onOpen, data }: { dot: string; title: string; word: string; wordClass: string; age: string; onOpen(): void; data: Record<`data-${string}`, string> }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-border/45" {...data}>
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1 truncate text-ui text-text" data-tooltip={title}>
          {title}
        </span>
        <span className={`max-w-24 shrink-0 truncate text-meta ${wordClass}`}>{word}</span>
        <span className="w-8 shrink-0 text-right text-meta text-faint tabular-nums">{age}</span>
      </button>
    </li>
  );
}

/**
 * What is around the session you are about to start, in the column on the right (under the box in two columns): the
 * project's sessions, what counts toward the focus limit, and the project's defaults. `children` goes after the
 * project's sessions (what is queued in it). The aside is empty, and hidden, when there is nothing to say.
 */
export function NewSessionContext({ projectName, root, sections, rows, focus, now, defaults, children }: { projectName: string | null; root: string | null; sections: readonly ContextSection[]; rows: readonly ContextRow[]; focus: FocusSummary; now: number; defaults: [string, string] | null; children?: ReactNode }) {
  const projects = useProjects((s) => s.projects);
  return (
    <aside
      aria-label="About this project"
      className="grid min-w-0 content-start gap-5 empty:hidden @min-[860px]/new-session:col-start-2 @min-[860px]/new-session:min-h-[120px] @min-[860px]/new-session:overflow-y-auto [@media(max-height:680px)]:@min-[860px]/new-session:min-h-0 @min-[1200px]/new-session:col-start-3 @min-[1200px]/new-session:row-start-1 @min-[1200px]/new-session:pt-[52px]"
      data-new-session-context
    >
      {sections.includes('in-project') && (
        <section aria-label={`In ${projectName}`} data-pick-up>
          <SectionHeader as="h2" className="px-2">
            In {projectName}
          </SectionHeader>
          {/* One column no wider than the view, so a long title truncates instead of widening the list. */}
          <ul className="mt-1 grid grid-cols-[minmax(0,1fr)]">
            {rows.map(({ row, label, tone }) => (
              <SessionLine
                key={row.id}
                dot={STATE_DOT[tone]}
                title={row.title || 'Untitled session'}
                word={label}
                wordClass={STATE_TEXT[tone]}
                age={shortAge(row.updatedAt, now)}
                onOpen={() => openRow(row.id)}
                data={{ 'data-pick-up-session': row.id }}
              />
            ))}
          </ul>
          <p className="mt-1 px-2 text-meta text-faint">Click one to pick it up instead.</p>
        </section>
      )}

      {children}

      {sections.includes('going') && (
        <section aria-label="Going now" data-going-now>
          <SectionHeader as="h2" className="px-2" action={<span className="ml-auto font-normal tracking-normal normal-case tabular-nums">{focus.count} of {focus.limit}</span>}>
            Going now
          </SectionHeader>
          <ul className="mt-1 grid grid-cols-[minmax(0,1fr)]">
            {focus.sessions.map((session) => (
              <SessionLine
                key={session.id}
                dot={FOCUS_DOT[session.state]}
                title={session.title}
                word={session.remote?.computerName ?? projects.get(session.projectRoot)?.name ?? basename(session.projectRoot)}
                wordClass="text-muted"
                age={waitedFor(session.since, now)}
                onOpen={() => openRow(session.id)}
                data={{ 'data-focus-session': session.id }}
              />
            ))}
          </ul>
        </section>
      )}

      {sections.includes('defaults') && defaults && root && (
        <section aria-label={`Defaults for ${projectName}`} data-project-defaults-summary>
          <SectionHeader as="h2" className="px-2">
            Defaults for {projectName}
          </SectionHeader>
          <div className="mt-1 grid gap-0.5 rounded-lg bg-text/6 px-2.5 py-2 text-ui text-muted">
            <span className="truncate" data-tooltip={defaults[0]}>
              {defaults[0]}
            </span>
            <span className="truncate" data-tooltip={defaults[1]}>
              {defaults[1]}
            </span>
            <button type="button" onClick={() => openProject(root, 'settings')} className="w-fit rounded text-link hover:underline" data-edit-project-defaults>
              Edit in project settings
            </button>
          </div>
        </section>
      )}
    </aside>
  );
}
