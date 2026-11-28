/**
 * A message another Claude Code session sent to this one (Claude Code's `SendMessage` between sessions). The saved
 * transcript puts a line before the tag and Claude Code's guidance after it; the live stream may send the tag alone.
 */
export interface PeerMessage {
  /** The sender's address, such as `uds:/tmp/cc-socks/28545.sock`. */
  from: string;
  /** The sender's session name, when it has one. */
  name: string | null;
  /** What the sender was doing when it sent it (`prompting`), when Claude Code says. */
  mode: string | null;
  /** What the other session wrote, without the line before it, the guidance after it and the relay notice. */
  text: string;
  /**
   * The sender had handled Artifact content written by other people, so the message may pass some of it on. Claude Code
   * marks this with `<artifact-content-authored-by-others/>` and a paragraph of guidance inside the tag.
   */
  relaysOthersContent: boolean;
}

const PEER_MESSAGE = /^(?:Another Claude session sent a message:\s*)?<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/;

/** Claude Code's marker and the paragraph of guidance after it, up to a blank line or the end. */
const RELAY_NOTICE = /\n*<artifact-content-authored-by-others\s*\/?>(?:\n?[^\n]+)*/g;

const attribute = (attributes: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] || null;

/** Reads a message from another session out of a user turn's text, or null when the turn is something else. */
export function parsePeerMessage(text: string): PeerMessage | null {
  const match = PEER_MESSAGE.exec(text.trimStart());
  if (!match) return null;
  const from = attribute(match[1]!, 'from');
  if (!from) return null;
  const body = match[2]!;
  const relaysOthersContent = body.includes('<artifact-content-authored-by-others');
  const message = (relaysOthersContent ? body.replace(RELAY_NOTICE, '') : body).trim();
  return { from, name: attribute(match[1]!, 'from-name'), mode: attribute(match[1]!, 'from-mode'), text: message, relaysOthersContent };
}

/** Who sent it, for a label: the session's name, or its address when it has none. */
export const peerName = (message: Pick<PeerMessage, 'from' | 'name'>) => message.name ?? message.from;
