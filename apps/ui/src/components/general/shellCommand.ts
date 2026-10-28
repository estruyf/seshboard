import type { ShellCommandState } from '@seshboard/protocol/bridge';
import { currentPlatform } from '../../lib/platform.ts';

/** `a`, `a and b`, `a, b and c`. */
export function listNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
}

/** What the line under Shell command says (Settings shows it, and its search finds it). */
export function shellCommandDetail(platform = currentPlatform()): string {
  const path = platform === 'linux' ? ' ~/.local/bin has to be on your PATH.' : '';
  return `Type seshboard . in a terminal to open New session in that folder. sesh . and switchboard . do the same.${path}`;
}

/** How the commands stand, in a sentence under the setting, with the names another program has. */
export function shellCommandStatus(state: ShellCommandState, platform = currentPlatform()): string {
  const taken = state.taken.length ? ` ${listNames(state.taken)} ${state.taken.length > 1 ? 'belong' : 'belongs'} to another program, so Seshboard leaves ${state.taken.length > 1 ? 'them' : 'it'} alone.` : '';
  switch (state.status) {
    case 'installed':
      return `${listNames(state.names)} installed in ${state.dir}.${platform === 'win32' ? ' Terminals you open from now on find them.' : ''}${taken}`;
    case 'missing':
      return `Installs ${listNames(state.names)} in ${state.dir}${platform === 'darwin' ? ', with your password if that folder needs it' : ''}.${taken}`;
    case 'outdated':
      return `Installed for another copy of Seshboard, or only in part. Update points them at this one.${taken}`;
    case 'taken':
      return taken.trim();
    case 'unavailable':
      return 'Only in the installed app, not in a development build.';
  }
}

/** The button next to the setting: what it does, and the label while it runs. Null when there is nothing to do. */
export function shellCommandAction(state: ShellCommandState): { action: 'install' | 'remove'; label: string; busy: string } | null {
  if (state.status === 'installed') return { action: 'remove', label: 'Remove', busy: 'Removing…' };
  if (state.status === 'missing') return { action: 'install', label: 'Install', busy: 'Installing…' };
  if (state.status === 'outdated') return { action: 'install', label: 'Update', busy: 'Updating…' };
  return null;
}
