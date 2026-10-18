import { CircleX, ClipboardPaste, FileText, Folder, Link2, Pencil, ScrollText, SquareTerminal, TextQuote, TextSelect, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ContextItem, WorktreePullRequest } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { chipLabel, LINKED_SESSION_HINT, pastePreview, type ContextChip } from './contextItems.ts';
import { linkDetail } from './sessionLinks.ts';
import { PastedTextDialog } from './PastedTextDialog.tsx';

const TEXT_ICON: Record<Extract<ContextItem, { kind: 'text' }>['source'], LucideIcon> = {
  selection: TextQuote,
  problems: TriangleAlert,
  terminal: SquareTerminal,
  output: ScrollText,
  paste: ClipboardPaste,
  checks: CircleX,
};

const iconFor = (item: Exclude<ContextItem, { kind: 'session' }>): LucideIcon => (item.kind === 'text' ? TEXT_ICON[item.source] : item.directory ? Folder : item.range ? TextSelect : FileText);


/**
 * The context tray: files, lines and text added to the message, as removable chips above it. Nothing goes to Claude
 * until you send; files go as references (Claude reads them), text as it is. A long paste is a card that shows its
 * start; a click opens it to read or edit.
 */
export function ContextTray({ chips, cwd, onRemove, onEditText, className = '' }: { chips: readonly ContextChip[]; cwd: string | null; onRemove(id: string): void; onEditText(id: string, text: string): void; className?: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const open = chips.find((chip) => chip.id === editing);
  if (chips.length === 0) return null;
  return (
    <ul className={`flex flex-wrap items-end gap-1.5 ${className}`} aria-label="Context" data-context-tray>
      {open?.kind === 'text' && (
        <PastedTextDialog
          label={open.label}
          text={open.text}
          onSave={(text) => onEditText(open.id, text)}
          onRemove={() => {
            setEditing(null);
            onRemove(open.id);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {chips.map((chip) => {
        const { label, detail } = chipLabel(chip, cwd);
        if (chip.kind === 'text' && chip.source === 'paste') return <PastedCard key={chip.id} label={label} detail={detail} text={chip.text} onOpen={() => setEditing(chip.id)} onRemove={() => onRemove(chip.id)} />;
        if (chip.kind === 'session') return <LinkedSessionChip key={chip.id} sessionId={chip.sessionId} label={chip.label} onRemove={() => onRemove(chip.id)} />;
        const Icon = iconFor(chip);
        return (
          <li
            key={chip.id}
            className="flex h-6 max-w-72 min-w-0 items-center gap-1 rounded-md border border-border bg-border/30 pl-1.5 text-ui text-text"
            data-context-chip={chip.kind === 'file' ? (chip.directory ? 'folder' : 'file') : chip.source}
            data-tooltip={detail}
          >
            <Icon size={12} className="shrink-0 text-muted" aria-hidden />
            <span className={`min-w-0 truncate ${chip.kind === 'file' ? 'font-mono' : ''}`}>{label}</span>
            <button
              type="button"
              onClick={() => onRemove(chip.id)}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-border/50 hover:text-text"
              aria-label={`Remove ${label}`}
              data-tooltip="Remove"
              data-context-chip-remove
            >
              <X size={11} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A linked session (session linking): a link icon, its label, and its branch and pull request after it. A click opens
 * it beside this one. A session that is gone is dashed: the message then only says so instead of a brief.
 */
function LinkedSessionChip({ sessionId, label, onRemove }: { sessionId: string; label: string; onRemove(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [info, setInfo] = useState<{ gone: boolean; branch: string | null; pr: WorktreePullRequest | null } | null>(null);
  useEffect(() => {
    if (!client) return;
    let current = true;
    // Also readies the brief: the engine reads gh and git for it now, so sending doesn't wait for them.
    client.call('sessions.linkInfo', { sessionId }).then(
      (result) => current && setInfo(result),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [client, sessionId]);
  const detail = linkDetail(info);
  const gone = info?.gone ?? false;
  return (
    <li
      className={`flex h-6 max-w-96 min-w-0 items-center gap-1 rounded-md border bg-border/30 pl-1.5 text-ui ${gone ? 'border-dashed border-edge text-muted' : 'border-border text-text'}`}
      data-context-chip="session"
      data-linked-session={sessionId}
      data-tooltip={gone ? 'This session is gone. Claude only gets its name.' : LINKED_SESSION_HINT}
    >
      <button
        type="button"
        onClick={() => !gone && useSessions.getState().openBeside(sessionId)}
        className="flex min-w-0 items-center gap-1 rounded-sm disabled:cursor-default"
        disabled={gone}
        aria-label={`Open ${label} beside this one`}
      >
        <Link2 size={12} className={`shrink-0 ${gone ? 'text-faint' : 'text-accent-ink'}`} aria-hidden />
        <span className="min-w-0 truncate font-semibold">{label}</span>
        {detail && <span className="min-w-0 shrink truncate font-mono text-meta text-muted">{detail}</span>}
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-border/50 hover:text-text"
        aria-label={`Remove ${label}`}
        data-tooltip="Remove"
        data-context-chip-remove
      >
        <X size={11} aria-hidden />
      </button>
    </li>
  );
}

/** A pasted text: its first lines in small type, "Pasted" under them, and Edit and Remove on hover or focus. */
function PastedCard({ label, detail, text, onOpen, onRemove }: { label: string; detail: string; text: string; onOpen(): void; onRemove(): void }) {
  return (
    <li className="group relative h-20 w-36 shrink-0" data-context-chip="paste" data-tooltip={`${label} · ${detail}`}>
      <button
        type="button"
        onClick={onOpen}
        className="flex size-full flex-col justify-between overflow-hidden rounded-lg border border-border bg-border/30 p-2 text-left hover:bg-border/45"
        aria-label={`Edit ${label}, ${detail}`}
        data-context-chip-open
      >
        <span className="line-clamp-3 font-mono text-meta leading-snug break-all whitespace-pre-wrap text-muted" aria-hidden>
          {pastePreview(text)}
        </span>
        <span className="flex items-center justify-between gap-1">
          <span className="rounded border border-edge px-1 text-meta font-medium tracking-wide text-muted uppercase">Pasted</span>
          <Pencil size={11} className="text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" aria-hidden />
        </span>
      </button>
      {/* Hidden until hover, but still in the Tab order: it appears when it has keyboard focus. */}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-1 right-1 flex size-5 items-center justify-center rounded bg-card text-muted opacity-0 group-hover:opacity-100 hover:bg-border hover:text-text focus-visible:opacity-100"
        aria-label={`Remove ${label}`}
        data-tooltip="Remove"
        data-context-chip-remove
      >
        <X size={11} aria-hidden />
      </button>
    </li>
  );
}
