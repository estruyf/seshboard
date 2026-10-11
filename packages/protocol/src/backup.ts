import { z } from 'zod';
import { AbsolutePath, AnyAbsolutePath } from './absolutePath.ts';
import { BACKUP_SECTIONS, SETTINGS_FILE_FORMAT } from './backupConstants.ts';
import { PROJECT_NAME_MAX } from './projectConstants.ts';

export { BACKUP_SECTIONS, SETTINGS_FILE_FORMAT, settingsFileName, type BackupSection } from './backupConstants.ts';

export const BackupSectionSchema = z.enum(BACKUP_SECTIONS);

const SessionId = z.string().min(1).max(200);

/** Image types a project icon can have (the same ones Settings accepts). */
export const ICON_EXTENSIONS = ['.svg', '.png', '.ico', '.jpg', '.jpeg', '.webp', '.gif'] as const;

/** A custom project icon. Images travel inside the file (base64), since the copy Switchboard keeps is per Mac. */
export const ExportedIcon = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('emoji'), value: z.string().min(1).max(16) }),
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('image'), ext: z.enum(ICON_EXTENSIONS), data: z.string().max(300_000) }),
]);
export type ExportedIcon = z.infer<typeof ExportedIcon>;

/** One added project, in the user's order. `name: null` uses the folder's name, `icon: null` the detected icon. */
export const ExportedProject = z.object({
  path: AnyAbsolutePath,
  /** A name that doesn't fit is dropped, not the whole project. */
  name: z.string().min(1).max(PROJECT_NAME_MAX).nullable().default(null).catch(null),
  icon: ExportedIcon.nullable().default(null),
  /** Read field by field on import (see ProjectDefaults), so one outdated value doesn't drop the rest. */
  defaults: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type ExportedProject = z.infer<typeof ExportedProject>;

/**
 * A settings file. Every section is optional (the user picks what to export), unknown fields are
 * ignored, and projects and actions are lists of unknowns so one bad entry is skipped, not fatal.
 */
export const SettingsFile = z.object({
  kind: z.literal('switchboard-settings'),
  format: z.number().int().positive(),
  appVersion: z.string().max(100).default('unknown'),
  exportedAt: z.string().max(100).default(''),
  preferences: z.record(z.string(), z.unknown()).optional(),
  /** Imported themes, each a theme file as in the themes folder; checked one by one on import, like a theme import. */
  themes: z.array(z.unknown()).max(500).optional(),
  projects: z.array(z.unknown()).max(5000).optional(),
  actions: z
    .object({
      global: z.array(z.unknown()).max(1000).default([]),
      projects: z.array(z.object({ path: AnyAbsolutePath, actions: z.array(z.unknown()).max(1000) })).max(5000).default([]),
    })
    .optional(),
  /** App choices by key (default editor, New session defaults, …); only known keys are imported. */
  choices: z.record(z.string(), z.json()).optional(),
  /** Session ids are only meaningful where the same transcripts are (the same Mac, or a copied ~/.claude). */
  sessions: z
    .object({
      pinned: z.array(SessionId).max(100_000).default([]),
      /** Written by versions that had both Settled and Archived; imported as archived. */
      settled: z.array(z.object({ id: SessionId, at: z.number() })).max(100_000).optional(),
      archived: z.array(z.object({ id: SessionId, at: z.number() })).max(100_000).default([]),
      owned: z.array(SessionId).max(100_000).default([]),
      continued: z.array(SessionId).max(100_000).default([]),
    })
    .optional(),
});
export type SettingsFile = z.infer<typeof SettingsFile>;

/** Validates a parsed settings file, with a message meant for the person importing it. */
export function parseSettingsFile(raw: unknown): { file: SettingsFile } | { error: string } {
  const head = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (head.kind !== 'switchboard-settings') return { error: 'This is not a Switchboard settings file.' };
  if (typeof head.format === 'number' && head.format > SETTINGS_FILE_FORMAT) {
    return { error: `This file was exported by a newer version of Switchboard (format ${head.format}). Update Switchboard, then import it again.` };
  }
  const parsed = SettingsFile.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `The settings file is damaged${issue ? ` (${issue.path.join('.') || 'file'}: ${issue.message})` : ''}.` };
  }
  return { file: parsed.data };
}

/**
 * One line of the import preview. `keep`: both have it and they differ; Merge keeps yours.
 * `skip`: not imported (detail says why).
 */
export const ImportChange = z.object({
  section: BackupSectionSchema,
  label: z.string(),
  change: z.enum(['add', 'change', 'remove', 'keep', 'skip']),
  detail: z.string().nullable(),
});
export type ImportChange = z.infer<typeof ImportChange>;

export const ImportPreview = z.object({
  format: z.number(),
  appVersion: z.string(),
  exportedAt: z.string(),
  /** The sections the file has (the import dialog only offers these). */
  sections: z.array(BackupSectionSchema),
  changes: z.array(ImportChange),
  /** Items that are already the same here. */
  unchanged: z.number(),
  /** Project folders from the file that don't exist on this Mac (and weren't pointed elsewhere). */
  missingFolders: z.array(z.string()),
});
export type ImportPreview = z.infer<typeof ImportPreview>;

/** Merge adds what's missing and keeps your values on conflict; Replace makes Switchboard match the file. */
export const ImportMode = z.enum(['merge', 'replace']);
export type ImportMode = z.infer<typeof ImportMode>;

/** A project folder from the file (in any platform's form: it may come from a Mac or a PC) pointed at a folder here. */
export const FolderMapping = z.object({ from: AnyAbsolutePath, to: AbsolutePath });
export type FolderMapping = z.infer<typeof FolderMapping>;
