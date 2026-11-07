import { Pencil, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { modKey } from '../../lib/shortcuts.ts';
import { Button } from '../ui/Button.tsx';
import { linesLabel, MAX_COMMENT_LENGTH, type DiffComment, type QuotedLine } from './diffComments.ts';

/**
 * Comments sit inside the diff, which is as wide as its longest line while lines don't wrap: pinned to the left at the
 * diff's visible width (`@container/diff`), they stay in view while it scrolls sideways.
 */
const BLOCK = 'sticky left-0 w-[100cqw] px-2 py-1.5 font-sans whitespace-normal';

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "Lines 12-15", deleted lines said so. */
const heading = (comment: Pick<DiffComment, 'side' | 'start' | 'end'>) => `${upper(linesLabel(comment))}${comment.side === 'old' ? ', deleted' : ''}`;

/** Writing a comment, or changing one: ⌘↵ keeps it, Esc lets it go. */
export function CommentEditor({ target, initial = '', onSave, onCancel }: { target: Pick<DiffComment, 'side' | 'start' | 'end'>; initial?: string; onSave(body: string): void; onCancel(): void }) {
  const [body, setBody] = useState(initial);
  const save = () => body.trim() && onSave(body.trim());
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && modKey(event)) {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      // Not on to the panel or the session: Escape here is only for this comment.
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <div className={BLOCK} data-diff-comment-editor>
      <div className="rounded-lg border border-border bg-card p-2">
        <label className="flex flex-col gap-1">
          <span className="text-meta text-muted">Comment on {heading(target).toLowerCase()}</span>
          <textarea
            autoFocus
            rows={3}
            value={body}
            maxLength={MAX_COMMENT_LENGTH}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="What should change here?"
            className="w-full resize-y rounded-md border border-edge bg-bg px-2 py-1.5 text-ui text-text outline-none placeholder:text-faint focus:border-accent-ink"
            data-diff-comment-input
          />
        </label>
        <div className="mt-1.5 flex justify-end gap-1.5">
          <Button size="sm" onClick={onCancel} kbd="Esc">
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={save} disabled={!body.trim()} kbd="⌘↵" data-diff-comment-save>
            {initial ? 'Save' : 'Comment'}
          </Button>
        </div>
      </div>
    </div>
  );
}

const SIGN: Record<QuotedLine['kind'], string> = { add: '+', del: '−', same: ' ' };

/**
 * A comment written: its lines and text, with Edit and Remove. A stale one (its lines are gone from the diff, after an
 * edit) says so and quotes the lines it was written on.
 */
export function CommentCard({ comment, stale, onEdit, onRemove }: { comment: DiffComment; stale: boolean; onEdit(): void; onRemove(): void }) {
  return (
    <div className={BLOCK} data-diff-comment={comment.id} data-diff-comment-stale={stale || undefined}>
      <div className="group rounded-lg bg-text/6 px-2.5 py-1.5">
        <div className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-meta text-muted">{stale ? `${heading(comment)}, changed since` : heading(comment)}</span>
          <Button variant="quiet" size="sm" iconOnly icon={<Pencil size={12} />} aria-label="Edit comment" onClick={onEdit} data-diff-comment-edit />
          <Button variant="quiet" size="sm" iconOnly icon={<Trash2 size={12} />} aria-label="Remove comment" onClick={onRemove} data-diff-comment-remove />
        </div>
        {stale && (
          <pre className="my-1 max-h-24 overflow-hidden rounded bg-bg px-2 py-1 font-mono text-meta whitespace-pre text-muted">
            {comment.lines.map((line) => `${SIGN[line.kind]} ${line.text}`).join('\n')}
          </pre>
        )}
        <p className="text-ui break-words whitespace-pre-wrap text-text">{comment.body}</p>
      </div>
    </div>
  );
}
