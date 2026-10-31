import type { OptionalProvider } from '@seshboard/protocol';
import type { RawSessionInfo, SessionSource } from '../claude/sessionSource.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';
import type { MultiProfileSource } from '../profiles/profileSources.ts';

export interface ProviderSource {
  provider: OptionalProvider;
  /** The provider profile whose folder it reads. */
  profileId: string;
  source: SessionSource;
}

/**
 * Claude Code's sessions (every Claude profile) and those of the provider profiles (GitHub Copilot), as one source. A
 * session is read through the profile it was listed by; one not seen yet is looked up in Claude Code first. Other
 * providers' sessions are read-only here: forking, renaming and subagents stay Claude Code's.
 */
export class ProviderSources implements SessionSource {
  /** Session id → the provider profile that listed it. */
  private readonly owners = new Map<string, string>();

  constructor(
    private readonly claude: MultiProfileSource,
    /** The provider profiles, read on every call (adding one takes effect on the next scan). */
    private readonly others: () => ProviderSource[],
  ) {}

  /** The Claude profile a session was last found in. */
  ownerOf(sessionId: string): string | undefined {
    return this.claude.ownerOf(sessionId);
  }

  /** The provider profile a session was listed by; undefined for Claude Code's (and unknown ones). */
  profileOf(sessionId: string): string | undefined {
    const profileId = this.owners.get(sessionId);
    return profileId && this.others().some((o) => o.profileId === profileId) ? profileId : undefined;
  }

  /** The provider of a session listed by a provider profile; undefined for Claude Code's. */
  providerOf(sessionId: string): OptionalProvider | undefined {
    return this.sourceOf(sessionId)?.provider;
  }

  async list(): Promise<RawSessionInfo[]> {
    const others = this.others();
    const [claude, ...rest] = await Promise.all([
      this.claude.list(),
      // One profile's folder that can't be read leaves its sessions out, not Claude Code's.
      ...others.map(({ source }) => source.list().catch(() => [] as RawSessionInfo[])),
    ]);
    const seen = new Set(claude!.map((i) => i.sessionId));
    const all = [...claude!];
    rest.forEach((infos, index) => {
      const { provider, profileId } = others[index]!;
      for (const info of infos) {
        if (seen.has(info.sessionId)) continue;
        seen.add(info.sessionId);
        this.owners.set(info.sessionId, profileId);
        all.push({ ...info, provider, profileId });
      }
    });
    return all;
  }

  async info(sessionId: string): Promise<RawSessionInfo | undefined> {
    const other = this.sourceOf(sessionId);
    if (other) {
      const info = await other.source.info(sessionId);
      return info && { ...info, provider: other.provider, profileId: other.profileId };
    }
    const info = await this.claude.info(sessionId);
    if (info) return info;
    for (const { provider, profileId, source } of this.others()) {
      const found = await source.info(sessionId).catch(() => undefined);
      if (found) {
        this.owners.set(sessionId, profileId);
        return { ...found, provider, profileId };
      }
    }
    return undefined;
  }

  messages(sessionId: string): Promise<RawSessionMessage[]> {
    const other = this.sourceOf(sessionId);
    return other ? other.source.messages(sessionId) : this.claude.messages(sessionId);
  }

  subagentMessages(sessionId: string, agentId: string): Promise<RawSessionMessage[]> {
    return this.sourceOf(sessionId) ? Promise.resolve([]) : this.claude.subagentMessages(sessionId, agentId);
  }

  fork(sessionId: string, upToMessageId: string): Promise<string> {
    if (this.sourceOf(sessionId)) return Promise.reject(new Error('Forking is only available for Claude Code sessions'));
    return this.claude.fork(sessionId, upToMessageId);
  }

  rename(sessionId: string, title: string): Promise<void> {
    if (this.sourceOf(sessionId)) return Promise.reject(new Error('Renaming is only available for Claude Code sessions'));
    return this.claude.rename(sessionId, title);
  }

  private sourceOf(sessionId: string): ProviderSource | undefined {
    const profileId = this.owners.get(sessionId);
    return profileId ? this.others().find((o) => o.profileId === profileId) : undefined;
  }
}
