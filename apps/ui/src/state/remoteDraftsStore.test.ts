import { beforeEach, describe, expect, it } from 'vitest';
import type { RemoteAttachment } from '../components/computers/remoteAttachments.ts';
import { remoteDraft, remoteNewDraftKey, remoteSessionDraftKey, useRemoteDrafts } from './remoteDraftsStore.ts';

const image: RemoteAttachment = { id: 1, kind: 'image', image: { type: 'image', mediaType: 'image/jpeg', data: 'abc' } };

describe('remote drafts', () => {
  beforeEach(() => useRemoteDrafts.setState({ drafts: {} }));

  it('keeps the text and the attachments of a box apart from the others', () => {
    const { update } = useRemoteDrafts.getState();
    update(remoteNewDraftKey('c-1'), { text: 'fix the build' });
    update(remoteNewDraftKey('c-1'), { items: [image] });
    update(remoteSessionDraftKey('c-1', 's-1'), { text: 'and the tests' });
    expect(remoteDraft(remoteNewDraftKey('c-1'))).toEqual({ text: 'fix the build', items: [image] });
    expect(remoteDraft(remoteSessionDraftKey('c-1', 's-1'))).toEqual({ text: 'and the tests', items: [] });
    expect(remoteDraft(remoteNewDraftKey('c-2'))).toEqual({ text: '', items: [] });
  });

  it('forgets a box once it is empty', () => {
    const { update } = useRemoteDrafts.getState();
    const key = remoteNewDraftKey('c-1');
    update(key, { text: 'hi', items: [image] });
    update(key, { text: '' });
    expect(key in useRemoteDrafts.getState().drafts).toBe(true);
    update(key, { items: [] });
    expect(key in useRemoteDrafts.getState().drafts).toBe(false);
  });
});
