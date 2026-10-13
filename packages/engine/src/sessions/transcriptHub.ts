import type { LogLevel, TranscriptMessage, TranscriptUpdate } from '@switchboard/protocol';
import type { SessionSource } from '../claude/sessionSource.ts';
import { normaliseMessage, type RawSessionMessage } from '../claude/transcript.ts';
import { coalesce } from '../util/coalesce.ts';
import { ImageStore } from './imageStore.ts';

interface Watcher {
  /** UUIDs this watcher has already been sent, in order; null until the initial load is sent. */
  uuids: string[] | null;
  /** A change arrived while the initial load was in flight. */
  dirty: boolean;
  /** Sent from the live stream but not yet seen in the file. */
  live: Set<string>;
  emit: (update: TranscriptUpdate) => void;
}

/**
 * Works out the smallest update that brings a watcher from `sent` to `next`
 * (the file's current content). When the file is merely behind what was
 * already streamed live, nothing is sent: it will catch up.
 */
export function diffTranscript(
  sent: readonly string[],
  next: readonly TranscriptMessage[],
  live: ReadonlySet<string> = new Set(),
): Pick<TranscriptUpdate, 'mode' | 'messages'> | null {
  const sentIsPrefix = next.length >= sent.length && sent.every((uuid, i) => next[i]!.uuid === uuid);
  if (sentIsPrefix) return next.length === sent.length ? null : { mode: 'append', messages: next.slice(sent.length) };
  const fileIsBehind = next.every((m, i) => sent[i] === m.uuid) && sent.slice(next.length).every((uuid) => live.has(uuid));
  if (fileIsBehind) return null;
  return { mode: 'replace', messages: [...next] };
}

/**
 * Live transcripts for open windows. Each watcher gets the full transcript
 * once, then only appended messages (or a replace after a rewind/compaction).
 */
export class TranscriptHub {
  private readonly watchers = new Map<string, Set<Watcher>>();
  private readonly reloads = new Map<string, ReturnType<typeof coalesce>>();
  /**
   * Messages you sent that Claude Code hasn't written to the file yet (queued behind a running turn),
   * kept so a window that opens the session later still shows them.
   */
  private readonly unwritten = new Map<string, RawSessionMessage[]>();
  readonly images = new ImageStore();

  constructor(
    private readonly source: SessionSource,
    private readonly log: (level: LogLevel, message: string) => void,
  ) {}

  async read(sessionId: string): Promise<TranscriptMessage[]> {
    const sink = this.images.sink(sessionId);
    return (await this.source.messages(sessionId)).map((m) => normaliseMessage(m, sink));
  }

  /** An image from a session's transcript; re-reads the transcript once if it was evicted. */
  async image(sessionId: string, imageId: string): Promise<{ mediaType: string; data: string } | undefined> {
    const hit = this.images.get(sessionId, imageId);
    if (hit) return hit;
    await this.read(sessionId);
    return this.images.get(sessionId, imageId);
  }

  /** Starts sending `transcript.updated` for a session; the first update is a full `replace`. */
  watch(sessionId: string, emit: Watcher['emit']): () => void {
    const watcher: Watcher = { uuids: null, dirty: false, live: new Set(), emit };
    let set = this.watchers.get(sessionId);
    if (!set) this.watchers.set(sessionId, (set = new Set()));
    set.add(watcher);
    void this.push(sessionId, [watcher], true);
    return () => {
      set.delete(watcher);
      if (set.size === 0) {
        this.watchers.delete(sessionId);
        this.reloads.get(sessionId)?.stop();
        this.reloads.delete(sessionId);
      }
    };
  }

  /**
   * Messages straight from a session this app runs, ahead of the file. They
   * carry the same uuids Claude Code writes, so the later file read confirms
   * them instead of duplicating them.
   */
  pushLive(sessionId: string, raw: readonly RawSessionMessage[]): void {
    if (raw.length === 0) return;
    const sent = raw.filter((m) => m.type === 'user');
    if (sent.length > 0) this.unwritten.set(sessionId, [...(this.unwritten.get(sessionId) ?? []), ...sent]);
    const set = this.watchers.get(sessionId);
    if (!set) return;
    const sink = this.images.sink(sessionId);
    const messages = raw.map((m) => normaliseMessage(m, sink));
    for (const watcher of set) {
      if (watcher.uuids === null) {
        watcher.dirty = true;
        continue;
      }
      const known = new Set(watcher.uuids);
      const fresh = messages.filter((m) => !known.has(m.uuid));
      if (fresh.length === 0) continue;
      for (const m of fresh) {
        watcher.uuids.push(m.uuid);
        watcher.live.add(m.uuid);
      }
      watcher.emit({ sessionId, mode: 'append', messages: fresh });
    }
  }

  /** The session has no turn left, so everything sent is in the file. */
  settled(sessionId: string): void {
    this.unwritten.delete(sessionId);
  }

  /** Called when a transcript file changed on disk. Reloads are coalesced per session. */
  changed(sessionId: string): void {
    if (!this.watchers.has(sessionId)) return;
    let reload = this.reloads.get(sessionId);
    if (!reload) {
      reload = coalesce(() => this.push(sessionId, [...(this.watchers.get(sessionId) ?? [])], false), 100);
      this.reloads.set(sessionId, reload);
    }
    reload.trigger();
  }

  private async push(sessionId: string, targets: Watcher[], initial: boolean): Promise<void> {
    if (targets.length === 0) return;
    let messages: TranscriptMessage[];
    try {
      messages = await this.read(sessionId);
    } catch (error) {
      const message = (error as Error)?.message || String(error);
      this.log('warn', `Reading transcript ${sessionId} failed: ${message}`);
      if (!initial) return;
      // The window says so instead of waiting for a transcript that won't come. Later file changes
      // still deliver the whole transcript as an append, which clears the error there.
      for (const watcher of targets) {
        if (watcher.uuids !== null) continue;
        watcher.uuids = [];
        watcher.emit({ sessionId, mode: 'replace', messages: [], error: message });
      }
      return;
    }
    const inFile = new Set(messages.map((m) => m.uuid));
    const waiting = (this.unwritten.get(sessionId) ?? []).filter((m) => !inFile.has(m.uuid));
    if (waiting.length > 0) this.unwritten.set(sessionId, waiting);
    else this.unwritten.delete(sessionId);
    for (const watcher of targets) {
      if (!initial && watcher.uuids === null) {
        // Its initial load is still in flight; let that finish first, then catch up.
        watcher.dirty = true;
        continue;
      }
      const diff = initial ? { mode: 'replace' as const, messages } : diffTranscript(watcher.uuids!, messages, watcher.live);
      for (const m of messages) watcher.live.delete(m.uuid);
      if (!diff) continue;
      watcher.uuids = messages.map((m) => m.uuid);
      if (diff.mode === 'replace') watcher.live.clear();
      if (initial && waiting.length > 0) {
        // Still queued behind a running turn: show them after the file's messages, as they were sent.
        const sink = this.images.sink(sessionId);
        const queued = waiting.map((m) => normaliseMessage(m, sink));
        for (const m of queued) {
          watcher.uuids.push(m.uuid);
          watcher.live.add(m.uuid);
        }
        diff.messages = [...diff.messages, ...queued];
      }
      watcher.emit({ sessionId, ...diff });
      if (initial && watcher.dirty) {
        watcher.dirty = false;
        this.changed(sessionId);
      }
    }
  }

  stop(): void {
    for (const reload of this.reloads.values()) reload.stop();
    this.reloads.clear();
    this.watchers.clear();
  }
}
