import { FileText, Lock, ScrollText } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { defaultHeading, type SharePreview, type ShareTarget } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { openMemoryFile } from '../../state/memoryStore.ts';
import { showInChanges } from '../../state/showInChanges.ts';
import { toast } from '../../state/toastStore.ts';
import { useOpenIn } from '../OpenInButton.tsx';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { DiffRows } from './DiffRows.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { Select } from '../ui/Select.tsx';
import { canShare, parsePaths, relativeTo, removeByDefault, ruleLabel, shareButtonLabel, shareNotices, validRuleName, type TargetKind } from './memoryUi.ts';
import { useMemoryList } from './useMemoryList.ts';

const field = 'h-7 w-full rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';
const NEW_RULE = '__new__';
/** How long the preview waits after typing before asking the engine again. */
const PREVIEW_DELAY_MS = 200;

/**
 * Share “<name>” with the team: adds a memory to CLAUDE.md, a rule in .claude/rules/ or CLAUDE.local.md, with a live
 * preview of the change. Nothing is staged or committed; a toast offers Show in Changes and Undo afterwards.
 */
export function ShareDialog({ root, memoryPath, name, onClose }: { root: string; memoryPath: string; name: string; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const openIn = useOpenIn();
  const id = useId();
  const { list } = useMemoryList(root);
  const rules = useMemo(() => (list?.instructions ?? []).filter((i) => i.kind === 'rule'), [list]);
  const [kind, setKind] = useState<TargetKind>('claude-md');
  const [rule, setRule] = useState<string>(NEW_RULE);
  const [ruleName, setRuleName] = useState('');
  const [rulePaths, setRulePaths] = useState('');
  const [heading, setHeading] = useState(() => defaultHeading(name));
  const [placement, setPlacement] = useState<'add' | 'replace'>('add');
  const [removeMemory, setRemoveMemory] = useState(true);
  const [secretsChecked, setSecretsChecked] = useState(false);
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ignoreVersion, setIgnoreVersion] = useState(0);

  // An existing rule is the first choice once the list is read (only when the rules first arrive).
  const firstRule = rules[0]?.path ?? null;
  useEffect(() => {
    if (firstRule) setRule((current) => (current === NEW_RULE ? firstRule : current));
  }, [firstRule]);

  const rulesDir = `${root}/.claude/rules/`;
  const target: ShareTarget | null = useMemo(() => {
    if (kind !== 'rule') return { kind };
    if (rule !== NEW_RULE) return { kind: 'rule', file: rule.startsWith(rulesDir) ? rule.slice(rulesDir.length) : rule };
    if (!validRuleName(ruleName)) return null;
    const paths = parsePaths(rulePaths);
    return paths.length ? { kind: 'rule', file: ruleName.trim(), paths } : { kind: 'rule', file: ruleName.trim() };
  }, [kind, rule, ruleName, rulePaths, rulesDir]);
  const targetKey = JSON.stringify(target);

  // The preview follows every change, a moment after the last one.
  useEffect(() => {
    if (!client || !target || !heading.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      client.call('memory.sharePreview', { root, memoryPath, target, heading: heading.trim(), placement }).then(
        (result) => !cancelled && (setPreview(result), setPreviewError(null)),
        (e: Error) => !cancelled && (setPreview(null), setPreviewError(e.message)),
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `target` is compared by value (`targetKey`), so a new object with the same choice doesn't ask again.
  }, [client, root, memoryPath, targetKey, heading, placement, ignoreVersion]);

  const pickKind = (next: TargetKind) => {
    setKind(next);
    setRemoveMemory(removeByDefault(next));
    setPlacement('add');
  };

  const fileName = preview ? relativeTo(root, preview.targetPath) : kind === 'local' ? 'CLAUDE.local.md' : kind === 'rule' && target?.kind === 'rule' ? ruleLabel(target.file) : 'CLAUDE.md';
  const notices = preview ? shareNotices(preview.warnings, fileName) : [];
  const allowed = !!preview && !!target && !busy && canShare(notices, secretsChecked);
  const label = target ? shareButtonLabel(root, target, preview?.targetPath ?? null) : 'Add to rules';

  const ignoreLocal = async () => {
    if (!client) return;
    try {
      await client.call('memory.ignoreLocal', { root });
      setIgnoreVersion((v) => v + 1);
    } catch (e) {
      setError(`Couldn't add it to .gitignore: ${(e as Error).message}`);
    }
  };

  const share = async () => {
    if (!client || !target || !allowed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.call('memory.share', { root, memoryPath, target, heading: heading.trim(), placement, removeMemory, secretsChecked });
      onClose();
      const added = relativeTo(root, result.targetPath);
      toast(`Added to ${added}`, {
        body: result.removed ? 'And taken out of memory. Nothing is committed.' : 'Nothing is committed.',
        data: { 'data-share-toast': true },
        actions: [
          {
            label: 'Show in Changes',
            primary: true,
            onSelect: () => {
              if (!showInChanges(root, result.targetPath)) void openIn(result.targetPath).catch(() => {});
            },
            data: { 'data-share-show-changes': true },
          },
          {
            label: 'Undo',
            onSelect: () =>
              void client.call('memory.undoShare', { undoToken: result.undoToken }).then(
                () => result.removed && openMemoryFile(root, memoryPath),
                (e: Error) => toast(`Couldn't undo: ${e.message}`),
              ),
            data: { 'data-share-undo': true },
          },
        ],
      });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Share “${name}” with the team`}
      subtitle={kind === 'local' ? 'Stays on this Mac, next to the project’s instructions.' : 'Adds it to a file that’s committed with the project. Nothing is committed for you.'}
      width="lg"
      placement="top"
      onClose={onClose}
      onSubmit={() => void share()}
      data-share-dialog
      footerStart={
        <Checkbox checked={removeMemory} onChange={setRemoveMemory} className="text-ui" dataAttrs={{ 'data-share-remove': true }}>
          Remove it from memory after sharing
        </Checkbox>
      }
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" kbd="⌘↵" disabled={!allowed} onClick={() => void share()} data-share-confirm>
            {label}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
          <span className="text-ui text-muted">Add to</span>
          <SegmentedControl
            mode="radio"
            label="Where it goes"
            value={kind}
            onChange={pickKind}
            className="justify-self-start"
            data-share-target={kind}
            segments={[
              { value: 'claude-md', label: 'CLAUDE.md', icon: <FileText size={13} aria-hidden />, tooltip: 'The project’s instructions, for everyone', data: { 'data-share-target-option': 'claude-md' } },
              { value: 'rule', label: 'Rule file', icon: <ScrollText size={13} aria-hidden />, tooltip: 'A file in .claude/rules/, optionally only for some paths', data: { 'data-share-target-option': 'rule' } },
              { value: 'local', label: 'CLAUDE.local.md (only me)', icon: <Lock size={13} aria-hidden />, tooltip: 'Your own instructions for this project, not committed', data: { 'data-share-target-option': 'local' } },
            ]}
          />
          {kind === 'rule' && (
            <>
              <span className="text-ui text-muted">Rule</span>
              <Select
                label="Rule file"
                value={rule}
                onChange={setRule}
                className={`${field} flex items-center justify-between font-mono`}
                menuWidth={280}
                options={[...rules.map((r) => ({ value: r.path, label: relativeTo(root, r.path).replace(/^\.claude\//, ''), hint: r.paths?.join(', ') })), { value: NEW_RULE, label: 'New rule…' }]}
                dataAttrs={{ 'data-share-rule': true }}
              />
              {rule === NEW_RULE && (
                <>
                  <label htmlFor={`${id}-rule`} className="text-ui text-muted">
                    Name
                  </label>
                  <div className="grid gap-1">
                    <input id={`${id}-rule`} value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="e.g. ui" className={`${field} font-mono`} autoFocus data-share-rule-name />
                    {ruleName.trim() && !validRuleName(ruleName) && <p className="text-meta text-error">Letters, digits, “.”, “_” and “-” only (and “/” for a folder).</p>}
                  </div>
                  <label htmlFor={`${id}-paths`} className="text-ui text-muted">
                    Only for paths
                  </label>
                  <div className="grid gap-1">
                    <input id={`${id}-paths`} value={rulePaths} onChange={(e) => setRulePaths(e.target.value)} placeholder="e.g. apps/ui/** (optional)" className={`${field} font-mono`} data-share-rule-paths />
                    <p className="text-meta text-muted">Claude Code loads the rule only while it works on matching files. Separate patterns with commas.</p>
                  </div>
                </>
              )}
            </>
          )}
          <label htmlFor={`${id}-heading`} className="text-ui text-muted">
            Heading
          </label>
          <input id={`${id}-heading`} value={heading} onChange={(e) => setHeading(e.target.value.replace(/[\r\n]/g, ' '))} className={field} data-share-heading />
        </div>

        {notices.map((notice) =>
          notice.kind === 'secrets' ? (
            <Notice key={notice.kind} tone="error" data-share-warning="secrets">
              <p>{notice.text}</p>
              <Checkbox checked={secretsChecked} onChange={setSecretsChecked} className="mt-1.5 text-text" dataAttrs={{ 'data-share-secrets-checked': true }}>
                I checked, it’s safe to share
              </Checkbox>
            </Notice>
          ) : notice.kind === 'sameHeading' ? (
            <Notice
              key={notice.kind}
              tone="warn"
              data-share-warning="sameHeading"
              actions={
                <SegmentedControl<'add' | 'replace'>
                  mode="radio"
                  size="sm"
                  label="What to do with that section"
                  value={placement}
                  onChange={setPlacement}
                  segments={[
                    { value: 'replace', label: 'Replace that section', data: { 'data-share-placement': 'replace' } },
                    { value: 'add', label: 'Add as a new section', data: { 'data-share-placement': 'add' } },
                  ]}
                />
              }
            >
              {notice.text}
            </Notice>
          ) : notice.kind === 'localNotIgnored' ? (
            <Notice
              key={notice.kind}
              tone="warn"
              data-share-warning="localNotIgnored"
              actions={
                <Button size="sm" onClick={() => void ignoreLocal()} data-share-ignore-local>
                  Add CLAUDE.local.md to .gitignore
                </Button>
              }
            >
              {notice.text}
            </Notice>
          ) : (
            <Notice key={notice.kind} tone={notice.tone === 'error' ? 'error' : notice.tone === 'warn' ? 'warn' : 'info'} data-share-warning={notice.kind}>
              {notice.text}
            </Notice>
          ),
        )}

        <div className="grid gap-1.5">
          <p className="text-meta text-muted">
            {preview ? (
              <>
                {preview.exists ? 'Changes to' : 'Creates'} <span className="font-mono">{relativeTo(root, preview.targetPath)}</span>
              </>
            ) : (
              'Preview'
            )}
          </p>
          <div className="max-h-[42vh] min-h-24 overflow-auto rounded-lg border border-edge bg-code font-mono text-ui select-text" data-share-preview={preview ? relativeTo(root, preview.targetPath) : ''}>
            {previewError ? (
              <p role="alert" className="p-3 text-error">
                {previewError}
              </p>
            ) : !target ? (
              <p className="p-3 text-muted">Name the new rule to see what it adds.</p>
            ) : !preview ? (
              <p className="p-3 text-muted">Reading…</p>
            ) : (
              <DiffRows diff={preview.diff} />
            )}
          </div>
        </div>

        {error && (
          <Notice tone="error" onDismiss={() => setError(null)}>
            {`Couldn't share it: ${error}`}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
