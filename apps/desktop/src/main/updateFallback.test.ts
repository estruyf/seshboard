import { describe, expect, it } from 'vitest';
import { fallbackTags, feedChannelOf, feedUrl, parseMissingFeed, releaseDownloadUrl, releaseTags } from './updateFallback.ts';

const message = 'Cannot find latest-mac.yml in the latest release artifacts (https://github.com/estruyf/seshboard/releases/download/v1.5.0-beta.10/latest-mac.yml): HttpError: 404';

const atom = (tags: string[]) =>
  `<?xml version="1.0"?><feed>${tags.map((t) => `<entry><link rel="alternate" type="text/html" href="https://github.com/estruyf/seshboard/releases/tag/${t}"/></entry>`).join('')}</feed>`;

describe('updateFallback', () => {
  it('reads the releases URL, the tag and the platform from the missing feed', () => {
    expect(parseMissingFeed(message)).toEqual({ releasesUrl: 'https://github.com/estruyf/seshboard/releases', tag: 'v1.5.0-beta.10', suffix: '-mac' });
    expect(parseMissingFeed('Cannot find beta.yml in the latest release artifacts (https://github.com/a/b/releases/download/v2.0.0/beta.yml)')?.suffix).toBe('');
    expect(parseMissingFeed('… (https://github.com/a/b/releases/download/v2.0.0/latest-linux-arm64.yml)')?.suffix).toBe('-linux-arm64');
    expect(parseMissingFeed('net::ERR_INTERNET_DISCONNECTED')).toBeNull();
  });

  it('lists the tags of the Atom feed in order, once each', () => {
    expect(releaseTags(atom(['v1.5.0-beta.10', 'vscode-v0.3.0', 'v1.5.0-beta.9', 'v1.4.0']))).toEqual(['v1.5.0-beta.10', 'vscode-v0.3.0', 'v1.5.0-beta.9', 'v1.4.0']);
  });

  it('picks the earlier releases the channel takes, down to the running version', () => {
    const tags = ['v1.5.0-beta.10', 'vscode-v0.3.0', 'v1.5.0-beta.9', 'v1.5.0-rc.1', 'v1.4.1', 'v1.5.0-beta.8', 'v1.4.0', 'v1.3.0'];
    expect(fallbackTags({ tags, missingTag: 'v1.5.0-beta.10', currentVersion: '1.5.0-beta.8', channel: 'beta' })).toEqual(['v1.5.0-beta.9', 'v1.4.1']);
    expect(fallbackTags({ tags, missingTag: 'v1.5.0-beta.10', currentVersion: '1.4.0', channel: 'stable' })).toEqual(['v1.4.1']);
    expect(fallbackTags({ tags, missingTag: 'v1.5.0-beta.10', currentVersion: '1.5.0-beta.9', channel: 'beta' })).toEqual([]);
    expect(fallbackTags({ tags, missingTag: 'v1.5.0-beta.10', currentVersion: '1.0.0', channel: 'beta', limit: 2 })).toEqual(['v1.5.0-beta.9', 'v1.4.1']);
  });

  it('names the feed and the download folder of a release', () => {
    const missing = parseMissingFeed(message)!;
    expect(feedChannelOf('v1.5.0-beta.9')).toBe('beta');
    expect(feedUrl(missing, 'v1.5.0-beta.9')).toBe('https://github.com/estruyf/seshboard/releases/download/v1.5.0-beta.9/beta-mac.yml');
    expect(feedUrl(missing, 'v1.4.1')).toBe('https://github.com/estruyf/seshboard/releases/download/v1.4.1/latest-mac.yml');
    expect(releaseDownloadUrl(missing, 'v1.4.1')).toBe('https://github.com/estruyf/seshboard/releases/download/v1.4.1');
  });
});
