import type { ApprovalCard } from '@seshboard/protocol/client';
import { Checkbox } from '../ui/Checkbox.tsx';

/**
 * What Seshboard's approval card shows (docs/seshboard-tools.md): a short preview as a tree, every prompt and command in
 * full, and the risky choices, unticked unless you tick them. The buttons are the permission card's (`PermissionCard`).
 */
export function ApprovalBody({ card, ticked, onTick }: { card: ApprovalCard; ticked: Record<string, boolean>; onTick(key: string, on: boolean): void }) {
  return (
    <>
      {card.lines.length > 0 && (
        <ul className="grid gap-0.5 rounded-lg bg-text/6 px-3 py-2" data-approval-lines>
          {card.lines.map((line, i) => (
            <li key={i} className="flex min-w-0 items-baseline gap-2 text-ui" style={{ paddingLeft: `${line.depth * 14}px` }}>
              {line.depth > 0 && (
                <span aria-hidden className="shrink-0 font-mono text-faint">
                  {(card.lines[i + 1]?.depth ?? 0) < line.depth ? '└' : '├'}
                </span>
              )}
              <span className="shrink-0 font-medium text-text">{line.text}</span>
              {line.detail && (
                <span className="min-w-0 truncate text-muted" data-tooltip={line.detail}>
                  {line.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {card.blocks.map((block, i) => (
        <div key={i} className="grid gap-1" data-approval-block={block.label}>
          <span className="text-meta text-muted">{block.label}</span>
          <pre className="max-h-48 overflow-auto rounded-lg bg-bg px-3 py-2 font-mono text-ui whitespace-pre-wrap select-text">{block.text}</pre>
        </div>
      ))}
      {card.options.length > 0 && (
        <div className="grid gap-1.5" data-approval-options>
          {card.options.map((option) => (
            <Checkbox key={option.key} checked={ticked[option.key] === true} onChange={(on) => onTick(option.key, on)} dataAttrs={{ 'data-approval-option': option.key }}>
              <span className="grid">
                <span className="text-ui text-text">{option.label}</span>
                {option.detail && <span className="text-meta text-muted">{option.detail}</span>}
              </span>
            </Checkbox>
          ))}
        </div>
      )}
    </>
  );
}
