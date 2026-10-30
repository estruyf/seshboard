import type { OptionalProvider } from '@seshboard/protocol';
import type { RawSessionInfo, SessionSource } from '../claude/sessionSource.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';
import type { MultiProfileSource } from '../profiles/profileSources.ts';

export interface ProviderSource {
  provider: OptionalProvider;
  source: SessionSource;
}

/**
 * Claude Code's sessions (every profile) and those of the providers the user allowed, as one source. A session is read
 * through the provider it was listed by; one not seen yet is looked up in Claude Code first. Other providers' sessions
 * are read-only: forking, renaming and subagents stay Claude Code's.
 */
export class ProviderSources implements SessionSource {
  private readonly owners = new Map<string, OptionalProvider>();

  constructor(
    private readonly claude: MultiProfileSource,
    /** The allowed providers, read on every call (allowing one takes effect on the next scan). */
    private readonly others: () => ProviderSource[],
  ) {}

  /** The Claude profile a session was last found in. */
  ownerOf(sessionId: string): string | undefined {
    return this.claude.ownerOf(sessionId);
  }

  /** The provider of a session listed by another provider; undefined for Claude Code's (and unknown ones). */
  providerOf(sessionId: string): OptionalProvider | undefined {
    const provider = this.owners.get(sessionId);
    return provider && this.others().some((o) => o.provider === provider) ? provider : undefined;
  }

  async list(): Promise<RawSessionInfo[]> {
    const others = this.others();
    const [claude, ...rest] = await Promise.all([
      this.claude.list(),
      // One provider's folder that can't be read leaves its sessions out, not Claude Code's.
      ...others.map(({ source }) => source.list().catch(() => [] as RawSessionInfo[])),
    ]);
    const seen = new Set(claude!.map((i) => i.sessionId));
    const all = [...claude!];
    rest.forEach((infos, index) => {
      const { provider } = others[index]!;
      for (const info of infos) {
        if (seen.has(info.sessionId)) continue;
        seen.add(info.sessionId);
        this.owners.set(info.sessionId, provider);
        all.push({ ...info, provider });
      }
    });
    return all;
  }

  async info(sessionId: string): Promise<RawSessionInfo | undefined> {
    const other = this.sourceOf(sessionId);
    if (other) {
      const info = await other.source.info(sessionId);
      return info && { ...info, provider: other.provider };
    }
    const info = await this.claude.info(sessionId);
    if (info) return info;
    for (const { provider, source } of this.others()) {
      const found = await source.info(sessionId).catch(() => undefined);
      if (found) {
        this.owners.set(sessionId, provider);
        return { ...found, provider };
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
    const provider = this.owners.get(sessionId);
    return provider ? this.others().find((o) => o.provider === provider) : undefined;
  }
}
