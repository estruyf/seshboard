import { useMemo } from 'react';
import type { BackgroundTask } from '@seshboard/protocol/client';
import type { DisplayItem } from './displayItems.ts';
import { commandRuns, type CommandRun } from './commandRuns.ts';

/** Commands Claude ran in the background in this session, newest first, and how many are still running. */
export function useCommandRuns(items: readonly DisplayItem[], sessionOpen: boolean, live: readonly BackgroundTask[] | null): { commands: CommandRun[]; running: number } {
  const commands = useMemo(() => commandRuns(items, sessionOpen, live).reverse(), [items, sessionOpen, live]);
  return { commands, running: commands.filter((c) => c.state === 'running').length };
}
