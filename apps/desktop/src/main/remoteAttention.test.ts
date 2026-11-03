import { describe, expect, it } from 'vitest';
import type { RemoteSessions } from '@seshboard/protocol/client';
import { RemoteAttention } from './remoteAttention.ts';

type Session = RemoteSessions['sessions'][number];
type Prompt = RemoteSessions['prompts'][number];

const studio = { id: 'c1', name: 'studio' };
const session = (id: string, status: Session['status'], parentId: string | null = null): Session => ({ id, title: `Session ${id}`, status, parentId }) as Session;
const prompt = (requestId: string, sessionId: string, toolName = 'Bash'): Prompt => ({ requestId, sessionId, toolName }) as Prompt;
const list = (sessions: Session[], prompts: Prompt[] = []) => ({ sessions, prompts });

describe('RemoteAttention', () => {
  it('sets what was already so from the first list, then tells what changed', () => {
    const attention = new RemoteAttention();
    expect(attention.onList(studio, list([session('a', 'working')], [prompt('p0', 'a')]))).toEqual([]);
    const events = attention.onList(studio, list([session('a', 'needs-you'), session('b', 'working')], [prompt('p0', 'a'), prompt('p1', 'b', 'AskUserQuestion')]));
    expect(events).toEqual([{ kind: 'needs-you', sessionId: 'remote:c1:b', title: 'Claude has a question', body: 'Session b · on studio' }]);
  });

  it('says a turn finished or failed, but not for a pipeline step', () => {
    const attention = new RemoteAttention();
    attention.onList(studio, list([session('a', 'working'), session('b', 'working'), session('s', 'working', 'a')]));
    const events = attention.onList(studio, list([session('a', 'unread'), session('b', 'error'), session('s', 'idle', 'a')]));
    expect(events.map((e) => [e.kind, e.sessionId, e.title])).toEqual([
      ['finished', 'remote:c1:a', 'Claude finished'],
      ['failed', 'remote:c1:b', 'Claude Code stopped with an error'],
    ]);
  });

  it('shows only needs you, or nothing, as the computer\'s notifications say, and keeps up while they are off', () => {
    const attention = new RemoteAttention();
    const needsYou = { ...studio, notify: 'needs-you' as const };
    attention.onList(needsYou, list([session('a', 'working'), session('b', 'working')]));
    const events = attention.onList(needsYou, list([session('a', 'unread'), session('b', 'error')], [prompt('p1', 'a')]));
    expect(events.map((e) => e.kind)).toEqual(['needs-you']);

    const off = { ...studio, notify: 'off' as const };
    expect(attention.onList(off, list([session('a', 'working')], [prompt('p1', 'a'), prompt('p2', 'a')]))).toEqual([]);
    // Back on: what happened while they were off is not news.
    expect(attention.onList(studio, list([session('a', 'working')], [prompt('p1', 'a'), prompt('p2', 'a')]))).toEqual([]);
    expect(attention.onList(studio, list([session('a', 'idle')])).map((e) => e.kind)).toEqual(['finished']);
  });

  it('keeps only the sessions that are mine there, and their sub-sessions, for Only mine', () => {
    const attention = new RemoteAttention();
    const onlyMine = { ...studio, notify: 'started-here' as const, mineHere: ['mine'] };
    const working = [session('mine', 'working'), session('step', 'working', 'mine'), session('theirs', 'working')];
    attention.onList(onlyMine, list(working));
    const events = attention.onList(onlyMine, list([session('mine', 'unread'), session('step', 'error', 'mine'), session('theirs', 'unread')], [prompt('p1', 'step'), prompt('p2', 'theirs')]));
    expect(events.map((e) => [e.kind, e.sessionId])).toEqual([
      ['needs-you', 'remote:c1:step'],
      ['finished', 'remote:c1:mine'],
      ['failed', 'remote:c1:step'],
    ]);
  });

  it('starts over, silently, after a computer was away', () => {
    const attention = new RemoteAttention();
    attention.onList(studio, list([session('a', 'working')]));
    attention.forget('c1');
    expect(attention.onList(studio, list([session('a', 'idle')], [prompt('p1', 'a')]))).toEqual([]);
  });
});
