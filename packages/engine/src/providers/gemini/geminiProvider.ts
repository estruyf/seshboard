import { basename, dirname, join } from 'node:path';
import type { LogLevel } from '@seshboard/protocol';
import type { ProviderAdapter } from '../provider.ts';
import { acpDriver } from '../acp/acpDriver.ts';
import { createAcpConnection, type AcpCommand, type AcpConnection, type AcpConnectionOptions } from '../acp/acpConnection.ts';
import { findGemini, type GeminiBinary } from './geminiBinary.ts';
import { GEMINI_DEFAULT_MODELS, GEMINI_MODES, GEMINI_SIGN_IN, geminiModeId, geminiStatus, geminiToolCard, geminiToolNameOf, isModeNote, promptIdIn } from './geminiDriver.ts';
import { geminiCliHome, geminiDataDir, geminiSessionSource, SESSION_ID } from './geminiSource.ts';

/** Continues a session in Gemini CLI (in the session's folder: Gemini keeps sessions per project). */
export const GEMINI_RESUME = 'gemini --resume {sessionId}';

/** Installs Gemini CLI (Google's own instructions; it needs Node). */
export const GEMINI_INSTALL = 'npm install -g @google/gemini-cli';

export interface GeminiProviderOptions {
  /** The Gemini profile this is (Settings › Profiles). */
  profileId: string;
  /** The profile's folder: `~/.gemini`, or a folder of its own that Gemini CLI uses as its home (`GEMINI_CLI_HOME`). */
  geminiHome: string;
  /** The user's home folder. */
  userHome: string;
  /** The login shell's environment, for finding and running `gemini`. Without it, the process's own. */
  shellEnv?: () => Promise<Record<string, string | undefined>>;
  /** Where `gemini` is (tests and the demo); found on PATH and in the usual places otherwise. */
  binary?: () => Promise<GeminiBinary | null>;
  /** A fake ACP agent (tests and the demo). */
  createConnection?: (options: AcpConnectionOptions) => AcpConnection;
  log?: (level: LogLevel, message: string) => void;
}

/**
 * One Google Gemini CLI profile: its sessions read from its files (`<.gemini>/tmp/<project>/chats/`), and run through
 * Gemini CLI's ACP agent (`gemini --acp`, one per profile) with the profile's own login. Seshboard never handles the
 * login: Gemini CLI signs in on its own, in a terminal.
 */
export function geminiProvider({ profileId, geminiHome, userHome, shellEnv = async () => process.env, binary, createConnection = createAcpConnection, log }: GeminiProviderOptions): ProviderAdapter {
  const dataDir = geminiDataDir(geminiHome);
  const cliHome = geminiCliHome(geminiHome, userHome);
  const homeEnv = cliHome ? { GEMINI_CLI_HOME: cliHome } : undefined;
  const env = async () => ({ ...(await shellEnv()), ...homeEnv });
  /** Found once, and again after a start that said it's gone (installing it works without restarting Seshboard). */
  let found: Promise<GeminiBinary | null> | null = null;
  const findBinary = () => (found ??= (binary ?? (async () => findGemini(await shellEnv(), userHome)))().then((b) => {
    if (!b) found = null;
    return b;
  }));
  const command = async (): Promise<AcpCommand | null> => {
    const gemini = await findBinary();
    return gemini ? { path: gemini.path, args: [...(gemini.args ?? []), '--acp'] } : null;
  };
  const connection = createConnection({ agentName: 'Gemini CLI', command, env });
  const source = geminiSessionSource(dataDir);
  const driver = acpDriver({
    agentName: 'Gemini CLI',
    connection,
    modes: GEMINI_MODES,
    modeId: geminiModeId,
    status: async () => geminiStatus(await findBinary().catch(() => null), dataDir, await env()),
    signInMessage: GEMINI_SIGN_IN,
    defaultModels: GEMINI_DEFAULT_MODELS,
    toolName: geminiToolNameOf,
    toolCard: geminiToolCard,
    isNoise: isModeNote,
    messageIdOf: async (sessionId, text, since) => promptIdIn(await source.conversation(sessionId), text, since),
    ...(log ? { log } : {}),
  });
  const { files } = source;
  return {
    id: 'gemini',
    profileId,
    home: geminiHome,
    ...(homeEnv ? { homeEnv } : {}),
    folder: join(dataDir, 'tmp'),
    files: { files: () => files.files(), sessionOf: (relativePath) => files.sessionOf(relativePath) },
    source,
    resumeCommand: GEMINI_RESUME,
    signInCommand: 'gemini',
    driver,
    subagent: (sessionId, toolUseId) => source.subagent(sessionId, toolUseId),
    // What Gemini CLI's own delete removes: the session's file, its subagents, its log, its tool outputs and its folder.
    trashPaths(sessionId) {
      if (!SESSION_ID.test(sessionId)) return [];
      const file = files.fileOf(sessionId);
      if (!file) return [];
      const chats = dirname(file);
      const project = dirname(chats);
      const older = file.endsWith('.jsonl') ? file.slice(0, -1) : null;
      return [file, ...(older && basename(older).startsWith('session-') ? [older] : []), join(chats, sessionId), join(project, 'logs', `session-${sessionId}.jsonl`), join(project, 'tool-outputs', `session-${sessionId}`), join(project, sessionId)];
    },
  };
}
