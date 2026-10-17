import { CheckCircle2, FolderDown, GitBranch } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { parseGithubRepo, repoLabel } from '@switchboard/protocol/client';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { canClone, planLine, progressLine } from './cloneModel.ts';
import type { CloneJob } from './useCloneJob.ts';

const TONE = { muted: 'text-muted', warn: 'text-warn', ok: 'text-ok' } as const;

/**
 * Clone from GitHub's form: the repository's URL, where it goes (`<Clone into>/<name>`, the name can be changed), and
 * the clone's progress with Cancel. ↩ in a field (or Clone) starts it; Start in New session waits for it. `computer`
 * names another computer the clone runs on (Run on). `onSubmit` is ↩ once the clone is going: on to the prompt.
 */
export function ClonePanel({
  url,
  name,
  job,
  computer = null,
  onUrl,
  onName,
  onClose,
  onStart,
  closeLabel = 'Pick a project instead',
  autoFocus = true,
  bare = false,
}: {
  url: string;
  name: string;
  job: CloneJob;
  computer?: string | null;
  onUrl(url: string): void;
  onName(name: string): void;
  onClose(): void;
  /** Clone (or ↩): start it now. */
  onStart(): void;
  closeLabel?: string;
  autoFocus?: boolean;
  /** Without its header and frame: inside a dialog that has its own (the sidebar's Clone from GitHub…). */
  bare?: boolean;
}) {
  const urlRef = useRef<HTMLInputElement>(null);
  const parsed = parseGithubRepo(url);
  const repo = parsed?.ok ? parsed.repo : null;
  const { plan, stage } = job;
  const busy = stage === 'running';
  const locked = busy || stage === 'done';
  const line = job.problem ? { text: job.problem, tone: 'warn' as const } : plan ? planLine(plan, computer) : null;
  const ready = (stage === 'idle' || stage === 'failed') && canClone(plan) && !job.problem;

  useEffect(() => {
    if (autoFocus && !url) urlRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (ready) onStart();
  };
  // The folder's parent, as the plan shows it: everything before the name.
  const parent = plan && plan.where ? plan.where.slice(0, plan.where.length - plan.name.length) : null;

  return (
    <section className="grid gap-2" aria-label="Clone from GitHub" data-clone-repo data-clone-state={stage} data-clone-plan={plan?.state ?? ''}>
      {!bare && (
      <SectionHeader
        className="h-6"
        action={
          <Button size="sm" onClick={onClose} disabled={busy} className="ml-auto font-normal tracking-normal normal-case" data-clone-close>
            {closeLabel}
          </Button>
        }
      >
        Clone from GitHub{computer ? ` on ${computer}` : ''}
      </SectionHeader>
      )}
      <div className={`grid gap-2 ${bare ? '' : 'rounded-lg border border-border bg-card p-2.5'}`}>
        <label className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-edge bg-bg px-2.5 focus-within:border-accent-ink/60">
          <FolderDown size={14} className="shrink-0 text-faint" aria-hidden />
          <input
            ref={urlRef}
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            onKeyDown={onKeyDown}
            readOnly={locked}
            placeholder="https://github.com/owner/name"
            aria-label="GitHub repository URL"
            spellCheck={false}
            className="w-full min-w-0 bg-transparent font-mono text-ui text-text outline-none placeholder:text-faint read-only:text-muted"
            data-clone-url
          />
        </label>

        {repo && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-ui">
            <span className="flex min-w-0 items-center gap-1.5 font-semibold text-text" data-clone-name={repoLabel(repo)}>
              <span className="truncate">{repoLabel(repo)}</span>
              {repo.branch && (
                <span className="flex shrink-0 items-center gap-1 font-mono text-meta font-normal text-muted">
                  <GitBranch size={12} aria-hidden />
                  {repo.branch}
                </span>
              )}
            </span>
            {parent !== null && (
              <label className="flex h-6 min-w-0 flex-1 items-center rounded-md border border-edge bg-bg px-2 font-mono text-meta focus-within:border-accent-ink" data-tooltip="The folder it goes in">
                <span className="shrink-0 text-faint">{parent}</span>
                <input
                  value={name}
                  onChange={(e) => onName(e.target.value)}
                  onKeyDown={onKeyDown}
                  readOnly={locked}
                  placeholder={repo.name}
                  aria-label="Folder name"
                  spellCheck={false}
                  className="w-full min-w-0 bg-transparent text-text outline-none placeholder:text-text read-only:text-muted"
                  data-clone-folder
                />
              </label>
            )}
          </div>
        )}

        {busy || stage === 'done' ? (
          <div className="grid gap-1.5" data-clone-progress={stage}>
            <div className="h-1 overflow-hidden rounded-full bg-border" aria-hidden>
              <div className={`h-full rounded-full transition-[width] ${stage === 'done' ? 'bg-ok' : 'bg-accent-ink'}`} style={{ width: `${Math.max(3, job.progress?.percent ?? 0)}%` }} />
            </div>
            <div className="flex min-h-6 min-w-0 items-center gap-2 text-meta">
              {stage === 'done' ? (
                <span role="status" className="flex min-w-0 items-center gap-1.5 text-ok">
                  <CheckCircle2 size={13} className="shrink-0" aria-hidden />
                  <span className="truncate">{job.result?.reused ? 'Using the clone that is there.' : 'Cloned.'} Added to your projects{computer ? ` on ${computer}` : ''}.</span>
                </span>
              ) : (
                <>
                  <span role="status" className="min-w-0 flex-1 truncate text-muted">
                    {progressLine(job.progress ?? { phase: 'starting', percent: 0 })}
                  </span>
                  <Button size="sm" onClick={job.cancel} data-clone-cancel>
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-6 min-w-0 items-center gap-2 px-0.5 text-meta">
            {job.error ? (
              <span role="alert" className="min-w-0 flex-1 text-error" data-clone-error>
                {job.error}
              </span>
            ) : (
              <span className={`min-w-0 flex-1 truncate ${line ? TONE[line.tone] : 'text-faint'}`} data-clone-line>
                {line?.text ?? (url.trim() ? 'Checking…' : 'Paste a repository’s URL, or type owner/name.')}
              </span>
            )}
            {ready && !bare && (
              <Button size="sm" kbd="↩" onClick={onStart} data-clone-start>
                {plan?.state === 'cloned' ? 'Use it' : 'Clone'}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
