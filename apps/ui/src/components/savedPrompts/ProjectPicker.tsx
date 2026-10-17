import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Popover } from '../ui/Popover.tsx';

export interface PickerProject {
  root: string;
  name: string;
}

/** The button's text: the project, how many are picked, or what to do. */
export function pickerSummary(projects: PickerProject[], picked: string[]): string {
  if (picked.length === 0) return 'Choose projects';
  if (picked.length === 1) return projects.find((p) => p.root === picked[0])?.name ?? 'One project';
  return `${picked.length} projects`;
}

/**
 * A dropdown of projects where you tick several (a prompt just for you can go into more than one project at once).
 * It stays open while you tick; Escape or a click outside closes it.
 */
export function ProjectMultiSelect({ projects, picked, onChange, label }: { projects: PickerProject[]; picked: string[]; onChange(roots: string[]): void; label: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ x: number; y: number; width: number } | null>(null);
  const toggle = (root: string, on: boolean) => onChange(on ? [...picked, root] : picked.filter((r) => r !== root));
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open !== null}
        aria-label={label}
        onClick={() => {
          if (open) return setOpen(null);
          const rect = buttonRef.current!.getBoundingClientRect();
          setOpen({ x: rect.left, y: rect.bottom + 4, width: rect.width });
        }}
        className="no-drag flex w-full items-center gap-1.5 rounded-md border border-edge bg-bg px-2.5 py-1.5 text-left text-ui text-text outline-none focus-visible:border-accent-ink/60"
        data-prompt-projects
      >
        <span className="min-w-0 flex-1 truncate">{pickerSummary(projects, picked)}</span>
        <ChevronDown size={12} aria-hidden className="shrink-0 opacity-60" />
      </button>
      {open && (
        <Popover x={open.x} y={open.y} width={open.width} onClose={() => setOpen(null)} anchor={buttonRef}>
          <div role="group" aria-label={label} className="max-h-60 overflow-y-auto py-1">
            {projects.map((project) => (
              <Checkbox key={project.root} checked={picked.includes(project.root)} onChange={(on) => toggle(project.root, on)} className="w-full px-3 py-1 text-ui hover:bg-border/45" dataAttrs={{ 'data-prompt-project': project.root }}>
                <span className="block truncate">{project.name}</span>
              </Checkbox>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
