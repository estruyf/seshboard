import { Activity, Archive, ArchiveRestore, Bell, Blocks, Bookmark, Brain, FolderGit2, Gauge, Info, ListTree, MessageSquare, Palette, PanelLeft, Puzzle, SlidersHorizontal, Smartphone, SquareCode, Target, type LucideIcon, Users } from 'lucide-react';
import type { SettingsSection } from '../state/sessionsStore.ts';

/** What a Settings page is about: Seshboard itself, how Claude behaves, the things you keep, what Seshboard talks to; `bottom` is the rarely used ones under a line. */
export type SettingsGroup = 'app' | 'claude' | 'work' | 'connect' | 'bottom';

export interface SettingsPage {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: SettingsGroup;
}

/** The headers over the groups; the bottom block has none on screen, only this name for screen readers. */
export const SETTINGS_GROUP_LABEL: Record<SettingsGroup, string> = {
  app: 'App',
  claude: 'Claude',
  work: 'Your work',
  connect: 'Connect',
  bottom: 'More',
};

const GROUP_ORDER: readonly SettingsGroup[] = ['app', 'claude', 'work', 'connect', 'bottom'];

/** Settings' pages, in the order its menu lists them; the command palette's Settings pages follow it too. */
export const SETTINGS_SECTIONS: readonly SettingsPage[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, group: 'app' },
  { id: 'theme', label: 'Theme', icon: Palette, group: 'app' },
  { id: 'sidebar', label: 'Sidebar', icon: PanelLeft, group: 'app' },
  { id: 'notifications', label: 'Notifications', icon: Bell, group: 'app' },
  { id: 'focus', label: 'Focus', icon: Target, group: 'app' },
  { id: 'conversation', label: 'Conversation', icon: MessageSquare, group: 'claude' },
  { id: 'profiles', label: 'Claude profiles', icon: Users, group: 'claude' },
  { id: 'usage', label: 'Usage', icon: Gauge, group: 'claude' },
  { id: 'memory', label: 'Memory', icon: Brain, group: 'claude' },
  { id: 'projects', label: 'Projects', icon: FolderGit2, group: 'work' },
  { id: 'sessions', label: 'Sessions', icon: Archive, group: 'work' },
  { id: 'prompts', label: 'Prompts', icon: Bookmark, group: 'work' },
  { id: 'pipelines', label: 'Pipelines', icon: ListTree, group: 'work' },
  { id: 'providers', label: 'Providers', icon: Blocks, group: 'connect' },
  { id: 'vscode', label: 'VS Code', icon: SquareCode, group: 'connect' },
  { id: 'remote', label: 'Remote', icon: Smartphone, group: 'connect' },
  { id: 'mods', label: 'Mods', icon: Puzzle, group: 'connect' },
  { id: 'backup', label: 'Backup', icon: ArchiveRestore, group: 'bottom' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity, group: 'bottom' },
  { id: 'about', label: 'About', icon: Info, group: 'bottom' },
];

/** The pages under each group, groups in the menu's order (the bottom block last), pages in the order of `sections`. */
export function navGroups<T extends { group: SettingsGroup }>(sections: readonly T[]): Array<{ group: SettingsGroup; pages: T[] }> {
  return GROUP_ORDER.map((group) => ({ group, pages: sections.filter((page) => page.group === group) })).filter((g) => g.pages.length > 0);
}

/** Each page's place in the menu, for sorting things by page (search's results). */
export const settingsPageOrder = (page: SettingsSection) => SETTINGS_SECTIONS.findIndex((s) => s.id === page);

/** A Settings page's name, as its menu lists it. */
export const settingsSectionLabel = (section: SettingsSection) => SETTINGS_SECTIONS.find((s) => s.id === section)?.label ?? 'Settings';
