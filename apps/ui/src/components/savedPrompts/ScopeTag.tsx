import { Bookmark, CircleDot, Folder, GitBranch, GitPullRequest, Globe, List, Type, User, Users, type LucideIcon } from 'lucide-react';
import type { BlankType, PromptScope } from '@seshboard/protocol/client';

/** Each type's icon, on chips and in the Add blank menu. */
export const BLANK_ICONS: Record<BlankType, LucideIcon> = { issue: CircleDot, pr: GitPullRequest, branch: GitBranch, choice: List, text: Type, file: Folder };

/** The saved prompt mark, on chips, rows and the box's header. */
export const PromptIcon = Bookmark;

/**
 * Where a prompt is kept, as a tinted pill: "Global" with a globe (grey), the project with a person (`accent-ink`, just
 * for you), "<project> · shared" with people (`info`, the link blue).
 */
export function scopeTagParts(scope: PromptScope, projectName: string): { label: string; Icon: LucideIcon; tone: string; description: string } {
  if (scope.kind === 'global') return { label: 'Global', Icon: Globe, tone: 'bg-border/60 text-muted', description: 'Every project. Only you.' };
  if (scope.kind === 'personal') return { label: projectName, Icon: User, tone: 'bg-accent/15 text-accent-ink', description: `${projectName}, just for you.` };
  return { label: `${projectName} · shared`, Icon: Users, tone: 'bg-link/15 text-link', description: `${projectName}, shared with the project.` };
}

export function ScopeTag({ scope, projectName, className = '' }: { scope: PromptScope; projectName: string; className?: string }) {
  const { label, Icon, tone, description } = scopeTagParts(scope, projectName);
  return (
    <span className={`inline-flex min-w-0 max-w-48 shrink-0 items-center gap-1 rounded-md px-1.5 py-px text-meta ${tone} ${className}`} data-tooltip={description} data-prompt-scope={scope.kind}>
      <Icon size={11} aria-hidden className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}
