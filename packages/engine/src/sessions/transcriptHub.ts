import type { LogLevel, TranscriptMessage, TranscriptUpdate } from '@seshboard/protocol';
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
 * Puts notices into a transcript read from the file and leaves out the retracted messages. A notice goes before the
 * first message written after it (by time), or at the end. Pure, with tests.
 */
export function withNotices(
  messages: readonly TranscriptMessage[],
  notices: readonly TranscriptMessage[],
  retracted: ReadonlySet<string> = new Set(),
): TranscriptMessage[] {
  const kept = retracted.size ? messages.filter((m) => !retracted.has(m.uuid)) : [...messages];
  const have = new Set(kept.map((m) => m.uuid));
  for (const notice of notices) {
    if (have.has(notice.uuid)) continue;
    const at = notice.timestamp;
    const later = at === null ? -1 : kept.findIndex((m) => m.timestamp !== null && m.timestamp > at);
    kept.splice(later === -1 ? kept.length : later, 0, notice);
  }
  return kept;
}

/** How many live messages a session keeps for a retraction to rebuild the list from. */
const LIVE_TAIL = 200;

/**
 * Live transcripts for open windows. Each watcher gets the full transcript
 * once, then only appended messages (or a replace after a rewind/compaction).
 */
export class TranscriptHub {
  private readonly watchers = new Map<string, Set<Watcher>>();
  private readonly reloads = new Map<string, ReturnType<typeof coalesce>>();
  /**
   * Messages a session holds back from Claude Code (a new session's first message while Auto chooses), by uuid.
   * They are not in the file yet, and the window usually starts watching after they were sent, so each load adds
   * them until the file has them.
   */
  private readonly held = new Map<string, Map<string, TranscriptMessage>>();
  /**
   * Messages you sent that Claude Code has but hasn't written yet (steered into a running turn), by uuid. They are
   * kept with the held ones, so switching away and back still shows them, until the file has them or the turn ends.
   */
  private readonly sent = new Map<string, Set<string>>();
  /**
   * Lines Claude Code never writes to the file (a refusal moved the session to another model), by session. Every read
   * merges them back in by time, so a reload, a reopened session and a phone's `transcript.get` all keep them. They
   * live as long as the engine runs, not across an app restart.
   */
  private readonly notices = new Map<string, TranscriptMessage[]>();
  /** Messages Claude Code took back (a refused leg), by session: every read leaves them out, whatever the file says. */
  private readonly retracted = new Map<string, Set<string>>();
  /** The last live messages the file may not have yet, so a retraction can rebuild the list without losing them. */
  private readonly liveTail = new Map<string, Map<string, TranscriptMessage>>();
  readonly images = new ImageStore();

  constructor(
    private readonly source: SessionSource,
    private readonly log: (level: LogLevel, message: string) => void,
  ) {}

  async read(sessionId: string): Promise<TranscriptMessage[]> {
    const sink = this.images.sink(sessionId);
    const file = (await this.source.messages(sessionId)).map((m) => normaliseMessage(m, sink));
    const notices = this.notices.get(sessionId);
    const retracted = this.retracted.get(sessionId);
    return notices?.length || retracted?.size ? withNotices(file, notices ?? [], retracted) : file;
  }

  /**
   * The transcript as a watcher's first update has it: the file, then what the session holds back until the file has
   * it (a new session's first message). A phone that reads a page before it watches sees your message too.
   */
  async readWithHeld(sessionId: string): Promise<TranscriptMessage[]> {
    const file = await this.read(sessionId);
    const inFile = new Set(file.map((m) => m.uuid));
    const held = [...(this.held.get(sessionId)?.values() ?? [])].filter((m) => !inFile.has(m.uuid));
    return held.length ? [...file, ...held] : file;
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
  pushLive(sessionId: string, raw: readonly RawSessionMessage[], held = false): void {
    if (raw.length === 0) return;
    const set = this.watchers.get(sessionId);
    const yours = raw.some((m) => m.type === 'user');
    if (!set && !held && !yours) return;
    const sink = this.images.sink(sessionId);
    const messages = raw.map((m) => normaliseMessage(m, sink));
    if (held || yours) {
      let kept = this.held.get(sessionId);
      if (!kept) this.held.set(sessionId, (kept = new Map()));
      let sent = this.sent.get(sessionId);
      raw.forEach((r, i) => {
        if (!held && r.type !== 'user') return;
        kept.set(messages[i]!.uuid, messages[i]!);
        if (!held) {
          if (!sent) this.sent.set(sessionId, (sent = new Set()));
          sent.add(messages[i]!.uuid);
        }
      });
    }
    if (!set) return;
    this.remember(sessionId, messages);
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

  private remember(sessionId: string, messages: readonly TranscriptMessage[]): void {
    let tail = this.liveTail.get(sessionId);
    if (!tail) this.liveTail.set(sessionId, (tail = new Map()));
    for (const m of messages) tail.set(m.uuid, m);
    for (const uuid of tail.keys()) {
      if (tail.size <= LIVE_TAIL) break;
      tail.delete(uuid);
    }
  }

  /**
   * A line that stays in the conversation (see `notices`): shown now, and merged into every later read.
   * Kept even with no window watching, for the next one that opens.
   */
  notice(sessionId: string, raw: RawSessionMessage): void {
    const message = normaliseMessage(raw);
    const list = this.notices.get(sessionId) ?? [];
    if (!list.some((m) => m.uuid === message.uuid)) list.push(message);
    this.notices.set(sessionId, list.slice(-20));
    this.pushLive(sessionId, [raw]);
  }

  /**
   * Claude Code took these messages back (a refusal's refused leg): they leave the list now and in every later read.
   * The watchers get the list again, without them.
   */
  retract(sessionId: string, uuids: readonly string[]): void {
    if (uuids.length === 0) return;
    const gone = this.retracted.get(sessionId) ?? new Set<string>();
    for (const uuid of uuids) gone.add(uuid);
    this.retracted.set(sessionId, gone);
    for (const uuid of uuids) this.liveTail.get(sessionId)?.delete(uuid);
    const watchers = this.watchers.get(sessionId);
    if (watchers?.size) void this.push(sessionId, [...watchers], false, true);
  }

  /** The session stopped: what it held back will never reach the file. */
  dropHeld(sessionId: string): void {
    this.held.delete(sessionId);
    this.sent.delete(sessionId);
    this.liveTail.delete(sessionId);
  }

  /** The session's turn ended, so what you sent is in the file; only what Claude Code doesn't have yet stays held. */
  settled(sessionId: string): void {
    const sent = this.sent.get(sessionId);
    if (!sent) return;
    this.sent.delete(sessionId);
    const kept = this.held.get(sessionId);
    for (const uuid of sent) kept?.delete(uuid);
    if (kept?.size === 0) this.held.delete(sessionId);
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

  /** `rebuild`: send the whole list again even where the file is merely behind (after a retraction). */
  private async push(sessionId: string, targets: Watcher[], initial: boolean, rebuild = false): Promise<void> {
    if (targets.length === 0) return;
    let file: TranscriptMessage[];
    try {
      file = await this.read(sessionId);
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
    // Held messages follow the file until it has them.
    const kept = this.held.get(sessionId);
    for (const m of file) kept?.delete(m.uuid);
    if (kept?.size === 0) this.held.delete(sessionId);
    const held = kept ? [...kept.values()] : [];
    const messages = held.length ? [...file, ...held] : file;
    // What was sent live and the file doesn't have yet; a rebuild keeps it.
    const tail = this.liveTail.get(sessionId);
    for (const m of file) tail?.delete(m.uuid);
    const inList = new Set(messages.map((m) => m.uuid));
    const pending = rebuild && tail ? [...tail.values()].filter((m) => !inList.has(m.uuid)) : [];
    const whole = pending.length ? [...messages, ...pending] : messages;
    for (const watcher of targets) {
      if (!initial && watcher.uuids === null) {
        // Its initial load is still in flight; let that finish first, then catch up.
        watcher.dirty = true;
        continue;
      }
      const diff = initial ? { mode: 'replace' as const, messages } : rebuild ? { mode: 'replace' as const, messages: whole } : diffTranscript(watcher.uuids!, messages, watcher.live);
      for (const m of file) watcher.live.delete(m.uuid);
      if (diff) {
        watcher.uuids = (rebuild ? whole : messages).map((m) => m.uuid);
        if (diff.mode === 'replace') watcher.live.clear();
      }
      for (const m of held) watcher.live.add(m.uuid);
      for (const m of pending) watcher.live.add(m.uuid);
      if (!diff) continue;
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
    this.held.clear();
    this.liveTail.clear();
  }
}
