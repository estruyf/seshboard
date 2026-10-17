import { REMOTE_FEATURE_CLONE, type ClonePlan, type CloneProgress, type RepoBrings } from '@switchboard/protocol/client';

/**
 * Clone from GitHub's words and states, without React: what the plan, the progress and the trust question say. Shared
 * by New session (this computer and another one) and the sidebar's Clone from GitHub dialog.
 */

/** Where a clone stands in the form: nothing yet, running, done (with its project), failed or cancelled. */
export type CloneStage = 'idle' | 'running' | 'done' | 'failed';

/** The line under the repository: where it goes, or why it can't. `computer` names another computer. */
export function planLine(plan: ClonePlan, computer: string | null): { text: string; tone: 'muted' | 'warn' | 'ok' } {
  switch (plan.state) {
    case 'off':
      return { text: computer ? `Turn on Clone from GitHub in Settings on ${computer} to clone there.` : 'Turn on Clone from GitHub in Settings › Projects.', tone: 'warn' };
    case 'taken':
      return { text: `${plan.where} already exists. Choose another name.`, tone: 'warn' };
    case 'cloned':
      return { text: `Already cloned in ${plan.where}`, tone: 'ok' };
    case 'free':
      return { text: `Clones into ${plan.where}`, tone: 'muted' };
  }
}

/** Another computer that can't clone: it runs a Switchboard from before Clone from GitHub. Null when it can. */
export function remoteCloneProblem(computer: { name: string; features: string[] } | null): string | null {
  if (!computer || computer.features.includes(REMOTE_FEATURE_CLONE)) return null;
  return `Update Switchboard on ${computer.name} to clone there.`;
}

/** What the progress line says while a clone runs. */
export function progressLine(progress: Pick<CloneProgress, 'phase' | 'percent'>): string {
  const percent = progress.percent === null ? '' : ` ${progress.percent}%`;
  switch (progress.phase) {
    case 'receiving':
      return `Downloading${percent}`;
    case 'resolving':
      return `Unpacking${percent}`;
    case 'checkout':
      return `Checking out files${percent}`;
    default:
      return 'Connecting to GitHub…';
  }
}

/** Whether Start may go ahead with this plan: a clone that can start, or one already there. */
export const canClone = (plan: ClonePlan | null): plan is ClonePlan => plan !== null && (plan.state === 'free' || plan.state === 'cloned');

/** The trust question's groups, in the order they show, with a heading each; empty groups are left out. */
export function trustGroups(brings: RepoBrings): Array<{ title: string; items: string[] }> {
  return [
    { title: 'Hooks', items: brings.hooks.map((h) => `${h.event}: ${h.command}`) },
    { title: 'MCP servers', items: brings.mcpServers },
    { title: 'Allowed without asking', items: brings.allow },
    { title: 'Plugins', items: brings.plugins },
    { title: 'Settings', items: brings.settings },
  ].filter((group) => group.items.length > 0);
}

/** The trust question's sentence: names what the repository brings, plainly. */
export function trustText(brings: RepoBrings): string {
  const runs = [brings.hooks.length > 0 && 'hooks', brings.mcpServers.length > 0 && 'MCP servers'].filter(Boolean).join(' and ');
  const lines = [
    runs ? `This repository runs these ${runs} when the session starts.` : 'This repository changes what Claude may do in it.',
    'They come from its own Claude Code settings. Start only if you trust it.',
  ];
  return lines.join(' ');
}
