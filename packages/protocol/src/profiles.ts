import { z } from 'zod';
import { PROFILE_COLORS } from './profileConstants.ts';
import { SESSION_PROVIDERS } from './providerConstants.ts';
import { ProfileDefaults } from './sessions.ts';

export { BUILTIN_PROFILE_ID, PROFILE_COLORS } from './profileConstants.ts';

export const ProfileColor = z.enum(PROFILE_COLORS);
export type ProfileColor = z.infer<typeof ProfileColor>;

/**
 * A Claude Code login. Claude Code keeps a separate login, settings, plugins and sessions per
 * config folder (CLAUDE_CONFIG_DIR), so each profile is its own account.
 */
export const ClaudeProfile = z.object({
  id: z.string(),
  /**
   * Who runs its sessions: Claude Code, or another provider (GitHub Copilot) with its own config folder and login
   * (`COPILOT_HOME`). Claude Code's own settings (plan usage, plugins, memory) only apply to Claude Code's.
   */
  provider: z.enum(SESSION_PROVIDERS),
  name: z.string(),
  color: ProfileColor,
  /** The config folder this profile reads and runs Claude Code with. */
  configDir: z.string(),
  /** The built-in profile uses Claude Code's own config folder and can't be removed or moved. */
  builtin: z.boolean(),
  /** Projects without a profile of their own use the default. */
  isDefault: z.boolean(),
  exists: z.boolean(),
  /** The claude.ai account Claude Code last signed in with here (null: not signed in yet, or an API key). */
  account: z.object({ email: z.string().nullable(), organization: z.string().nullable() }).nullable(),
  /** What new sessions with this profile start with, where their project sets nothing. */
  defaults: ProfileDefaults,
});
export type ClaudeProfile = z.infer<typeof ClaudeProfile>;

export const ProfilesSnapshot = z.object({ profiles: z.array(ClaudeProfile), defaultId: z.string() });
export type ProfilesSnapshot = z.infer<typeof ProfilesSnapshot>;
