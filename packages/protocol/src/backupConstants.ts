/** The kinds of data a settings file can hold, in the order the export and import dialogs list them. */
export const BACKUP_SECTIONS = ['preferences', 'themes', 'profiles', 'projects', 'actions', 'schedules', 'choices', 'sessions'] as const;
export type BackupSection = (typeof BACKUP_SECTIONS)[number];

/** The newest settings file format this build reads and the one it writes (2 added themes). */
export const SETTINGS_FILE_FORMAT = 2;

/** `switchboard-settings-2026-10-06.json` for a date. */
export const settingsFileName = (date: Date) =>
  `switchboard-settings-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.json`;
