import { Pause, Pencil, Play, RefreshCw, Trash2 } from 'lucide-react';
import type { Trigger } from '@seshboard/protocol/client';
import { checkTriggerNow, deleteTrigger, openTriggerEditor, setTriggerPaused, useTriggers } from '../../state/triggersStore.ts';
import { toast } from '../../state/toastStore.ts';
import type { MenuEntry } from '../Menu.tsx';

/** What failed, in a toast: the menu has closed by then. */
const quietly = (what: string, work: Promise<unknown>) => void work.catch((e: Error) => toast(`Couldn't ${what}: ${e.message}`));

/** A trigger's ⋯ menu: Edit…, Check now, Pause or Resume, Delete (with Undo). */
export function triggerEntries(trigger: Trigger): MenuEntry[] {
  return [
    { label: 'Edit…', icon: <Pencil size={14} />, data: { 'data-trigger-menu-edit': true }, onSelect: () => openTriggerEditor({ root: trigger.projectRoot, trigger }) },
    {
      label: 'Check now',
      icon: <RefreshCw size={14} />,
      disabledReason: trigger.paused ? 'Resume it first' : useTriggers.getState().checking.has(trigger.id) ? 'Checking…' : undefined,
      data: { 'data-trigger-menu-check': true },
      onSelect: () => void checkTriggerNow(trigger),
    },
    trigger.paused
      ? { label: 'Resume', icon: <Play size={14} />, data: { 'data-trigger-menu-pause': 'resume' }, onSelect: () => quietly('resume it', setTriggerPaused(trigger, false)) }
      : { label: 'Pause', icon: <Pause size={14} />, data: { 'data-trigger-menu-pause': 'pause' }, onSelect: () => quietly('pause it', setTriggerPaused(trigger, true)) },
    'separator',
    { label: 'Delete', icon: <Trash2 size={14} />, danger: true, data: { 'data-trigger-menu-delete': true }, onSelect: () => quietly('delete it', deleteTrigger(trigger)) },
  ];
}
