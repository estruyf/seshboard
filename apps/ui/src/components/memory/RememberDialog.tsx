import { useEffect, useId, useMemo, useState } from 'react';
import { firstSentence, isSameOrInside, slugify } from '@switchboard/protocol/client';
import { basename } from '../../lib/format.ts';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { openMemoryFile } from '../../state/memoryStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { Select } from '../ui/Select.tsx';
import { memoryNameProblem, TYPE_CHOICES } from './memoryUi.ts';
import { addsLineNote, defaultType, rememberMetadata, suggestName, uniqueName, type RememberFrom } from './rememberView.ts';
import { useMemoryList, usePersonalMemory } from './useMemoryList.ts';

const field = 'h-7 w-full rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';

/**
 * Remember this: text from the conversation (a selection or a whole message) saved as a memory file, straight into
 * this project's memory folder, the personal one or another project's. No Claude call, no tokens. The file says which
 * session it came from.
 */
export function RememberDialog({ text, from, sessionId, root, onClose }: { text: string; from: RememberFrom; sessionId: string | null; root: string | null; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const id = useId();
  const projects = useProjects((s) => s.projects);
  const [target, setTarget] = useState<string>(root ?? 'personal');
  const { list } = useMemoryList(target === 'personal' ? null : target);
  const { personal } = usePersonalMemory();
  const [type, setType] = useState(defaultType(from));
  const [description, setDescription] = useState(() => firstSentence(text));
  const [body, setBody] = useState(text.trim());
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [secrets, setSecrets] = useState<string[]>([]);
  const [secretsChecked, setSecretsChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The names taken where it goes, and how full that MEMORY.md is.
  const folder = target === 'personal' ? (personal?.dir ?? null) : (list?.memoryDir ?? null);
  const taken = useMemo(() => {
    const memories = target === 'personal' ? (personal?.memories ?? []) : (list?.memories ?? []);
    return memories.filter((m) => folder && m.path !== folder && isSameOrInside(m.path, folder)).map((m) => basename(m.path).replace(/\.md$/, ''));
  }, [target, personal, list, folder]);
  const indexLines = target === 'personal' ? (personal?.indexLines ?? 0) : (list?.indexLines ?? 0);
  // A suggested name follows the text and the folder until you type your own.
  useEffect(() => {
    if (!nameTouched) setName(uniqueName(suggestName(body), taken));
  }, [body, taken, nameTouched]);
  useEffect(() => {
    if (!client) return;
    const timer = setTimeout(() => void client.call('memory.checkSecrets', { text: `${description}\n${body}` }).then((r) => setSecrets(r.found), () => {}), 250);
    return () => clearTimeout(timer);
  }, [client, description, body]);

  const problem = memoryNameProblem(name, taken);
  const note = addsLineNote(indexLines);
  const blocked = !!problem || !body.trim() || (secrets.length > 0 && !secretsChecked) || busy;
  const targets = [
    ...(root ? [{ value: root, label: `${projects.get(root)?.name ?? basename(root)} (this session)` }] : []),
    { value: 'personal', label: 'Personal (all projects)' },
    ...addedProjects(projects)
      .filter((p) => p.root !== root)
      .map((p) => ({ value: p.root, label: p.name })),
  ];

  const save = async () => {
    if (!client || blocked) return;
    setBusy(true);
    try {
      const { path } = await client.call('memory.create', {
        root: target === 'personal' ? null : target,
        name,
        type,
        description: description.trim(),
        body,
        metadata: rememberMetadata(sessionId),
      });
      onClose();
      const where = target === 'personal' ? null : target;
      toast('Saved to memory', { body: `${name}, ${target === 'personal' ? 'in Personal' : `in ${projects.get(target)?.name ?? 'the project'}`}.`, actions: [{ label: 'Open', primary: true, onSelect: () => openMemoryFile(where, path) }] });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Remember this"
      subtitle="Saved as a memory file directly. No Claude call, no tokens."
      width="md"
      placement="top"
      onClose={onClose}
      onSubmit={() => void save()}
      data-remember-dialog
      footerStart={<span className={`text-meta ${note.over ? 'text-caution' : 'text-muted'}`}>{note.text}</span>}
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" kbd="⌘↵" disabled={blocked} onClick={() => void save()} data-remember-save>
            Save memory
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-3 gap-y-3">
        <label htmlFor={`${id}-name`} className="pt-1.5 text-ui text-muted">
          Name
        </label>
        <div className="grid gap-1">
          <input
            id={`${id}-name`}
            value={name}
            onChange={(e) => (setNameTouched(true), setName(e.target.value.toLowerCase().replace(/\s+/g, '-')))}
            onBlur={() => name && setName(slugify(name))}
            className={`${field} font-mono`}
            data-remember-name
          />
          {problem && <p className="text-meta text-error">{problem}</p>}
        </div>
        <span className="pt-1 text-ui text-muted">Type</span>
        <SegmentedControl mode="radio" label="Type" value={type} onChange={setType} className="justify-self-start" segments={TYPE_CHOICES.map((t) => ({ value: t, label: t, data: { 'data-remember-type': t } }))} />
        <span className="pt-1.5 text-ui text-muted">Save in</span>
        <Select label="Save in" value={target} onChange={setTarget} options={targets} menuWidth={260} className={`${field} flex items-center justify-between`} dataAttrs={{ 'data-remember-target': true }} />
        <label htmlFor={`${id}-description`} className="pt-1.5 text-ui text-muted">
          Description
        </label>
        <input id={`${id}-description`} value={description} onChange={(e) => setDescription(e.target.value.replace(/[\r\n]+/g, ' '))} className={field} data-remember-description />
        <label htmlFor={`${id}-text`} className="pt-1.5 text-ui text-muted">
          Text
        </label>
        <textarea id={`${id}-text`} value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="w-full resize-y rounded-md border border-edge bg-bg p-2.5 text-ui text-text outline-none focus:border-accent-ink" data-remember-text />
      </div>
      {secrets.length > 0 && (
        <Notice tone="error" className="mt-3" data-remember-secrets>
          <p>{`This looks like it holds ${secrets.join(', ')}. Memory files are plain text${target === 'personal' ? ', and the personal folder may be synced' : ''}.`}</p>
          <Checkbox checked={secretsChecked} onChange={setSecretsChecked} className="mt-1.5 text-text">
            I checked, it’s fine to save
          </Checkbox>
        </Notice>
      )}
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
    </Dialog>
  );
}
