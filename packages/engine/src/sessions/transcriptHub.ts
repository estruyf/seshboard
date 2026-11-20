import type { LogLevel, TranscriptMessage, TranscriptUpdate } from '@seshboard/protocol';
import type { SessionSource } from '../claude/sessionSource.ts';
import { normaliseMessage, type RawSessionMessage } from '../claude/transcript.ts';
import { coalesce } from '../util/coalesce.ts';
import { ImageStore } from './imageStore.ts';

interface Watcher {
  /** UUIDs this watcher has already been sent, in order; null until the initial load is sent. */
  uuids: string[] | null;
  /** A file change arrived while the initial load was in flight. */
  dirty: boolean;
  /** Messages streamed live while the initial load was in flight: added after it, where the file doesn't have them yet. */
  early: TranscriptMessage[];
  /** Sent from the live stream but not yet seen in the file. */
  live: Set<string>;
  emit: (update: TranscriptUpdate) => void;
}

/**
 * Works out the smallest update that brings a watcher from `sent` to `next`
 * (the file's current content). When the file is merely behind what was
 * already streamed live, nothing is sent: it will catch up. When the two part
 * after a common start (a line only the file has, among messages that came
 * live), only what follows it is sent again (`splice`), with the messages that
 * came live and the file doesn't have yet (`liveMessage` finds them). Nothing
 * in common (a rewind to the start, a compaction, another file) is a `replace`.
 */
export function diffTranscript(
  sent: readonly string[],
  next: readonly TranscriptMessage[],
  live: ReadonlySet<string> = new Set(),
  liveMessage: (uuid: string) => TranscriptMessage | undefined = () => undefined,
): Pick<TranscriptUpdate, 'mode' | 'messages' | 'at'> | null {
  const sentIsPrefix = next.length >= sent.length && sent.every((uuid, i) => next[i]!.uuid === uuid);
  if (sentIsPrefix) return next.length === sent.length ? null : { mode: 'append', messages: next.slice(sent.length) };
  const fileIsBehind = next.every((m, i) => sent[i] === m.uuid) && sent.slice(next.length).every((uuid) => live.has(uuid));
  if (fileIsBehind) return null;
  let at = 0;
  while (at < sent.length && at < next.length && sent[at] === next[at]!.uuid) at++;
  if (at === 0) return { mode: 'replace', messages: [...next] };
  const inFile = new Set(next.map((m) => m.uuid));
  const stillLive = sent.slice(at).flatMap((uuid) => {
    const message = live.has(uuid) && !inFile.has(uuid) ? liveMessage(uuid) : undefined;
    return message ? [message] : [];
  });
  return { mode: 'splice', at, messages: [...next.slice(at), ...stillLive] };
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
 * How often the file is read during a turn this app runs, at most. The live messages show the turn; this brings in what
 * only the file has (a compaction, a system line) without waiting for the turn to end.
 */
const TURN_READ_MS = 30_000;

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
  /** Sessions whose next reload sends the whole list again (after a retraction). */
  private readonly rebuilds = new Set<string>();
  /**
   * Sessions whose turn this app runs now: their file changes are not read while the live messages show them, only once
   * the turn ends (or every `TURN_READ_MS`). `missed`: the file changed since it was last read. `next`: a window started
   * watching during the turn, so the next change is read (what streamed before it watched may be newer than its first read).
   */
  private readonly turns = new Map<string, { missed: boolean; next: boolean; timer: ReturnType<typeof setTimeout> | undefined }>();
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
    const watcher: Watcher = { uuids: null, dirty: false, early: [], live: new Set(), emit };
    let set = this.watchers.get(sessionId);
    if (!set) this.watchers.set(sessionId, (set = new Set()));
    set.add(watcher);
    const turn = this.turns.get(sessionId);
    if (turn) turn.next = true;
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
        watcher.early.push(...messages);
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
    // Through the session's reload, so several retractions in a row (a refusal sends two or three) are one rebuild, and
    // an older read can't finish after a newer one.
    if (!this.watchers.get(sessionId)?.size) return;
    this.rebuilds.add(sessionId);
    this.reload(sessionId).trigger();
  }

  /** The session stopped: what it held back will never reach the file. */
  dropHeld(sessionId: string): void {
    this.held.delete(sessionId);
    this.sent.delete(sessionId);
    this.liveTail.delete(sessionId);
  }

  /** The session's turn ended, so what you sent is in the file; only what Claude Code doesn't have yet stays held. */
  settled(sessionId: string): void {
    // The turn is over and the file has what it will have: nothing live is left for a rebuild to bring back.
    this.liveTail.delete(sessionId);
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
    const turn = this.turns.get(sessionId);
    if (!turn || turn.next) {
      if (turn) turn.next = false;
      return this.reload(sessionId).trigger();
    }
    turn.missed = true;
    turn.timer ??= setTimeout(() => {
      turn.timer = undefined;
      if (!turn.missed || this.turns.get(sessionId) !== turn) return;
      turn.missed = false;
      if (this.watchers.has(sessionId)) this.reload(sessionId).trigger();
    }, TURN_READ_MS);
    turn.timer.unref?.();
  }

  /**
   * Whether this app runs a turn of the session now (it streams the messages live). When the turn ends or stops for
   * you, the file is read once for what changed meanwhile.
   */
  running(sessionId: string, on: boolean): void {
    const turn = this.turns.get(sessionId);
    if (on) {
      if (!turn) this.turns.set(sessionId, { missed: false, next: false, timer: undefined });
      return;
    }
    if (!turn) return;
    clearTimeout(turn.timer);
    this.turns.delete(sessionId);
    if (turn.missed) this.changed(sessionId);
  }

  private isNotice(sessionId: string, uuid: string): boolean {
    return this.notices.get(sessionId)?.some((m) => m.uuid === uuid) ?? false;
  }

  /** The session's one coalesced reload: never two reads at once, and the last one wins. */
  private reload(sessionId: string): ReturnType<typeof coalesce> {
    let reload = this.reloads.get(sessionId);
    if (!reload) {
      reload = coalesce(() => this.push(sessionId, [...(this.watchers.get(sessionId) ?? [])], false, this.rebuilds.delete(sessionId)), 100);
      this.reloads.set(sessionId, reload);
    }
    return reload;
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
        this.sendEarly(sessionId, watcher);
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
    // Only what is newer than the file's last message: an older one the file never wrote under its uuid would come back
    // after newer messages.
    const fileEnd = file.reduce<number | null>((end, m) => (m.timestamp !== null && !this.isNotice(sessionId, m.uuid) && (end === null || m.timestamp > end) ? m.timestamp : end), null);
    const pending = rebuild && tail ? [...tail.values()].filter((m) => !inList.has(m.uuid) && (fileEnd === null || m.timestamp === null || m.timestamp > fileEnd)) : [];
    const whole = pending.length ? [...messages, ...pending] : messages;
    for (const watcher of targets) {
      if (!initial && watcher.uuids === null) {
        // Its initial load is still in flight; let that finish first, then catch up.
        watcher.dirty = true;
        continue;
      }
      const liveMessage = (uuid: string) => tail?.get(uuid) ?? kept?.get(uuid);
      const diff = initial ? { mode: 'replace' as const, messages } : rebuild ? { mode: 'replace' as const, messages: whole } : diffTranscript(watcher.uuids!, messages, watcher.live, liveMessage);
      for (const m of file) watcher.live.delete(m.uuid);
      if (diff) {
        watcher.uuids = diff.mode === 'splice' ? [...watcher.uuids!.slice(0, diff.at), ...diff.messages.map((m) => m.uuid)] : (rebuild ? whole : messages).map((m) => m.uuid);
        if (diff.mode === 'replace') watcher.live.clear();
        else if (diff.mode === 'splice') {
          const shown = new Set(watcher.uuids);
          for (const uuid of watcher.live) if (!shown.has(uuid)) watcher.live.delete(uuid);
        }
      }
      for (const m of held) watcher.live.add(m.uuid);
      for (const m of pending) watcher.live.add(m.uuid);
      if (!diff) continue;
      watcher.emit({ sessionId, ...diff });
      if (initial) this.sendEarly(sessionId, watcher);
      if (initial && watcher.dirty) {
        // What came live while the first load was read: from the file now, also during a turn.
        watcher.dirty = false;
        this.reload(sessionId).trigger();
      }
    }
  }

  /** After a watcher's first update: what came live meanwhile and the file didn't have, as an append. */
  private sendEarly(sessionId: string, watcher: Watcher): void {
    const early = watcher.early;
    watcher.early = [];
    const known = new Set(watcher.uuids);
    const fresh = early.filter((m) => !known.has(m.uuid) && known.add(m.uuid));
    if (fresh.length === 0) return;
    for (const m of fresh) {
      watcher.uuids!.push(m.uuid);
      watcher.live.add(m.uuid);
    }
    watcher.emit({ sessionId, mode: 'append', messages: fresh });
  }

  stop(): void {
    for (const turn of this.turns.values()) clearTimeout(turn.timer);
    this.turns.clear();
    for (const reload of this.reloads.values()) reload.stop();
    this.reloads.clear();
    this.watchers.clear();
    this.held.clear();
    this.liveTail.clear();
  }
}
