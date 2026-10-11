import { Brain } from 'lucide-react';
import { openMemoryFile } from '../../state/memoryStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useProjectColor } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { Pill } from '../ui/Pill.tsx';
import type { MemoryWrite } from '../transcript/memoryWrites.ts';
import { typeTone } from './memoryUi.ts';

/**
 * A memory Claude saved, as one quiet line in the conversation instead of a file edit: "Saved memory <name>", its type
 * and Open, which shows it on the project's Memory tab. Tinted in the project's colour.
 */
export function SavedMemoryLine({ write, root }: { write: MemoryWrite; root: string | null }) {
  const project = useProjects((s) => (root ? s.projects.get(root) : undefined));
  const color = useProjectColor(project, root);
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-ui"
      style={color ? { borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)` } : undefined}
      data-memory-saved-line={write.path}
    >
      <Brain size={14} className="shrink-0 text-muted" aria-hidden />
      <span className="shrink-0 text-muted">Saved memory</span>
      <span className="min-w-0 truncate font-semibold">{write.name}</span>
      {write.type && <Pill tone={typeTone(write.type)}>{write.type}</Pill>}
      {write.personal && <Pill tone="muted">Personal</Pill>}
      <span className="flex-1" />
      {root && (
        <Button size="sm" variant="quiet" onClick={() => openMemoryFile(root, write.path)} data-memory-saved-open>
          Open
        </Button>
      )}
    </div>
  );
}
