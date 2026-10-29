import type { TriggerNotice } from '@seshboard/protocol/client';
import type { AttentionEvent } from './attention.ts';

/**
 * What event triggers (#180) tell you, as notifications: a session a CI failure started ("CI failed on main. Started
 * “Fix test on main”"), an issue picked up ("Issue #212 picked up", which may still wait for a slot), and a trigger
 * that paused itself, with why.
 */
export function triggerAlerts(notices: readonly TriggerNotice[]): AttentionEvent[] {
  return notices.map((notice): AttentionEvent => {
    switch (notice.kind) {
      case 'started':
        return {
          kind: 'trigger-started',
          sessionId: notice.sessionId ?? '',
          title: notice.eventKind === 'ci' ? `CI failed on ${notice.branch || 'the branch'}. Started “${notice.title ?? notice.triggerName}”` : `Started “${notice.title ?? notice.triggerName}”`,
          body: [notice.projectName, notice.ref].filter(Boolean).join(' · '),
        };
      case 'pickedUp':
        return {
          kind: 'trigger-started',
          sessionId: '',
          triggerRoot: notice.projectRoot,
          title: `Issue ${notice.ref ?? ''} picked up`.replace(/\s+/g, ' '),
          body: `${notice.projectName} · ${notice.triggerName}`,
        };
      case 'paused':
        return {
          kind: 'trigger-paused',
          sessionId: '',
          triggerRoot: notice.projectRoot,
          title: `${notice.triggerName} is paused`,
          body: sentence(notice.reason ?? notice.projectName),
        };
    }
  });
}

/** A reason as a sentence. Its first letter stays as it is: "gh is signed out" names a program. */
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
