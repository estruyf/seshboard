import { MessageCircleQuestion } from 'lucide-react';
import type { ProjectInfo } from '@seshboard/protocol/client';
import { letterColor } from '../lib/projectColor.ts';
import { projectInitials } from './projectInitials.ts';

/**
 * A project's tile as drawn: its picture, its emoji, or its letters on a coloured square. `colored: false` (Settings ›
 * Theme › Project colours off) draws the picture and emoji in greyscale and the letters in the muted grey on a neutral
 * square. `question` is the quick questions folder's own icon. No stores, so it renders in tests.
 */
export function ProjectTileView({ project, name, size, letters, colored, question = false }: { project: Pick<ProjectInfo, 'icon'> | undefined; name: string; size: number; letters: 1 | 2; colored: boolean; question?: boolean }) {
  const grey = colored ? undefined : { filter: 'grayscale(1)' };
  // Corners scale with the icon, so large ones read as tiles rather than squares.
  const box = { width: size, height: size, borderRadius: Math.max(3, Math.round(size * 0.22)) };
  if (question) {
    return (
      <span style={box} className="flex shrink-0 items-center justify-center bg-border text-text" aria-hidden data-question-icon>
        <MessageCircleQuestion size={Math.round(size * 0.72)} strokeWidth={2.25} />
      </span>
    );
  }
  if (project?.icon?.kind === 'image') {
    return <img src={project.icon.dataUrl} alt="" style={{ ...box, ...grey }} className="shrink-0 object-contain" draggable={false} data-project-icon />;
  }
  if (project?.icon?.kind === 'emoji') {
    return (
      <span style={{ ...box, ...grey, fontSize: size * 0.85, lineHeight: `${size}px` }} className="shrink-0 text-center" aria-hidden data-project-icon>
        {project.icon.value}
      </span>
    );
  }
  const text = projectInitials(name, letters);
  return (
    <span
      style={{ ...box, ...(colored ? { background: letterColor(name) } : { color: letterColor(name, false) }), fontSize: size * (text.length > 1 ? 0.44 : 0.62) }}
      className={`flex shrink-0 items-center justify-center font-semibold ${colored ? 'text-white' : 'bg-text/10'}`}
      data-project-grey={colored ? undefined : true}
      aria-hidden
      data-project-icon
      data-project-initials={text}
    >
      {text}
    </span>
  );
}
