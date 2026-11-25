import type { UpdateChannel } from '@seshboard/protocol/bridge';

/**
 * Pure helpers for checking an earlier release while the newest one has no update feed yet. The release workflow
 * publishes the GitHub release first and attaches the feeds once every build is done, so for a while the newest
 * release has none. An app on an older version can still update to the release before it.
 */

/** Where the missing feed was: the releases URL, the newest release's tag and the platform's file suffix. */
export interface MissingFeed {
  /** For example https://github.com/estruyf/seshboard/releases */
  releasesUrl: string;
  tag: string;
  /** `-mac`, `` (Windows), `-linux` or `-linux-arm64`, as electron-updater names the feed files. */
  suffix: string;
}

/** Reads electron-updater's "Cannot find latest-mac.yml in the latest release artifacts (<url>)" message. */
export function parseMissingFeed(message: string): MissingFeed | null {
  const match = /(https:\/\/[^\s()]+\/releases)\/download\/([^/\s]+)\/(?:latest|beta)([^/\s]*)\.yml/.exec(message);
  if (!match) return null;
  return { releasesUrl: match[1]!, tag: decodeURIComponent(match[2]!), suffix: match[3]! };
}

/** The release tags in GitHub's releases Atom feed, newest first. Drafts are never in it. */
export function releaseTags(atom: string): string[] {
  const tags: string[] = [];
  for (const match of atom.matchAll(/\/releases\/tag\/([^"'<>\s]+)/g)) {
    const tag = decodeURIComponent(match[1]!);
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** Only a release (vX.Y.Z) or a beta (vX.Y.Z-beta.N) has a feed; other tags (vscode-v…, -rc.N) have none. */
const RELEASE_TAG = /^v?\d+\.\d+\.\d+(?:-beta\.\d+)?$/;
const isBetaTag = (tag: string) => tag.includes('-beta.');

/**
 * The releases older than the one without a feed that this channel takes, newest first, down to (not including)
 * the version this app runs. Stable takes releases only, Beta also betas.
 */
export function fallbackTags(options: { tags: string[]; missingTag: string; currentVersion: string; channel: UpdateChannel; limit?: number }): string[] {
  const start = options.tags.indexOf(options.missingTag);
  const result: string[] = [];
  for (const tag of options.tags.slice(start + 1)) {
    if (tag.replace(/^v/, '') === options.currentVersion) break;
    if (!RELEASE_TAG.test(tag)) continue;
    if (options.channel === 'stable' && isBetaTag(tag)) continue;
    result.push(tag);
    if (result.length >= (options.limit ?? 5)) break;
  }
  return result;
}

/** The feed a release carries: beta for a beta, latest for a release. */
export function feedChannelOf(tag: string): 'beta' | 'latest' {
  return isBetaTag(tag) ? 'beta' : 'latest';
}

/** The URL of the feed file of `tag` for this platform. */
export function feedUrl(missing: MissingFeed, tag: string): string {
  return `${releaseDownloadUrl(missing, tag)}/${feedChannelOf(tag)}${missing.suffix}.yml`;
}

/** The folder a release's files download from, for electron-updater's generic provider. */
export function releaseDownloadUrl(missing: MissingFeed, tag: string): string {
  return `${missing.releasesUrl}/download/${encodeURIComponent(tag)}`;
}
