import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import type { GithubBlock } from '@switchboard/protocol/client';
import { clockTime } from '../../lib/usageLimit.ts';
import { typeWord } from '../github/githubText.ts';
import { GithubStateIcon } from '../github/GithubParts.tsx';

/**
 * Under your prompt, one row per issue or pull request it attached: its state, number and title, when it was read
 * ("as of 14:02", the time the message went), and **What Claude got**, the block exactly as Claude read it. The
 * message keeps that block, so it never changes later. A click on the number opens it on GitHub.
 */
export function GithubAttached({ blocks, at, divided = true }: { blocks: readonly GithubBlock[]; at: number | null; divided?: boolean }) {
  if (!blocks.length) return null;
  return (
    <ul className={`flex flex-col gap-1 ${divided ? 'mt-2 border-t border-border pt-2' : 'mt-1'}`} aria-label="Attached issues and pull requests">
      {blocks.map((block) => (
        <AttachedRow key={`${block.type}:${block.repo}#${block.number}`} block={block} at={at} />
      ))}
    </ul>
  );
}

function AttachedRow({ block, at }: { block: GithubBlock; at: number | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="min-w-0" data-github-attached={`${block.type}:${block.number}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta">
        <GithubStateIcon type={block.type} state={block.state} size={12} />
        <span className="text-muted">Attached:</span>
        <button
          type="button"
          className="shrink-0 font-mono text-ui font-semibold text-text hover:underline"
          onClick={() => void window.open(block.url, '_blank')}
          aria-label={`${typeWord(block.type)} ${block.number}, open on GitHub`}
          data-tooltip="Open on GitHub"
        >
          #{block.number}
        </button>
        <span className="min-w-0 flex-1 truncate text-muted">{block.title}</span>
        {block.unreachable ? <span className="shrink-0 text-caution">details not loaded</span> : at !== null && !block.stub && <span className="shrink-0 text-faint">as of {clockTime(at)}</span>}
        {!block.stub && (
          <button type="button" className="flex shrink-0 items-center gap-0.5 text-link hover:underline" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} data-what-claude-got>
            <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
            What Claude got
          </button>
        )}
      </div>
      {open && (
        <pre id={id} className="mt-1.5 max-h-72 overflow-auto rounded-md bg-code p-2.5 font-mono text-meta whitespace-pre-wrap text-text [overflow-wrap:anywhere]" data-github-got>
          {block.inner}
        </pre>
      )}
    </li>
  );
}
