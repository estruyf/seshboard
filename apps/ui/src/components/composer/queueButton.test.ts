import { describe, expect, it } from 'vitest';
import { submitKey } from '../newSession/startMenu.ts';
import { queueButtonState, sendKeyMode } from './queueButton.ts';

const ready = { blocked: null, sending: false, hasMessage: true, whileWorking: 'queue' as const };

describe('queueButtonState', () => {
  it('queues by default, and offers Steer and Send now in the menu', () => {
    const state = queueButtonState(ready);
    expect(state).toMatchObject({ label: 'Queue', disabled: false, reason: null });
    expect(state.items.map((item) => [item.action, item.label, item.shortcut, item.disabled])).toEqual([
      ['queue', 'Queue', 'composer.send', false],
      ['steer', 'Steer', 'composer.send-other', false],
      ['send-now', 'Send now', 'composer.send-now', false],
    ]);
  });

  it('puts Steer first when Enter steers', () => {
    const state = queueButtonState({ ...ready, whileWorking: 'steer' });
    expect(state.label).toBe('Steer');
    expect(state.items.map((item) => [item.action, item.shortcut])).toEqual([
      ['steer', 'composer.send'],
      ['queue', 'composer.send-other'],
      ['send-now', 'composer.send-now'],
    ]);
  });

  it('waits for a message', () => {
    const state = queueButtonState({ ...ready, hasMessage: false });
    expect(state).toMatchObject({ disabled: true, reason: 'Type a message first' });
    expect(state.items.every((item) => item.disabled)).toBe(true);
  });

  it('says why nothing can be sent before asking for a message', () => {
    expect(queueButtonState({ ...ready, hasMessage: false, blocked: 'Connecting to the engine…' })).toMatchObject({ disabled: true, reason: 'Connecting to the engine…' });
  });

  it('shows that it is sending, without a reason', () => {
    expect(queueButtonState({ ...ready, sending: true })).toMatchObject({ label: 'Sending…', disabled: true, reason: null });
  });
});

describe('the Send now key in the message box', () => {
  const press = (key: string, mods: { meta?: boolean; shift?: boolean } = {}) => ({ key, metaKey: !!mods.meta, shiftKey: !!mods.shift, ctrlKey: false, altKey: false });

  it('sends now on ⌘⇧↵, and queues on ↵ and ⌘↵', () => {
    expect(submitKey(press('Enter', { meta: true, shift: true }), 'composer.send-now')).toBe('secondary');
    expect(submitKey(press('Enter'), 'composer.send-now')).toBe('send');
    expect(submitKey(press('Enter', { meta: true }), 'composer.send-now')).toBe('send');
    expect(submitKey(press('Enter', { shift: true }), 'composer.send-now')).toBeNull();
  });
});

describe('sendKeyMode', () => {
  const press = (key: string, mods: { meta?: boolean; shift?: boolean; alt?: boolean } = {}) => ({ key, metaKey: !!mods.meta, shiftKey: !!mods.shift, ctrlKey: false, altKey: !!mods.alt });

  it('does what Enter does, the other way on ⌥↵, and sends now on ⌘⇧↵ while Claude works', () => {
    expect(sendKeyMode(press('Enter'), true, 'queue')).toBe('queue');
    expect(sendKeyMode(press('Enter', { alt: true }), true, 'queue')).toBe('steer');
    expect(sendKeyMode(press('Enter'), true, 'steer')).toBe('steer');
    expect(sendKeyMode(press('Enter', { alt: true }), true, 'steer')).toBe('queue');
    expect(sendKeyMode(press('Enter', { meta: true, shift: true }), true, 'queue')).toBe('now');
  });

  it('only sends on Enter while Claude is idle, and leaves ⇧↵ to type a new line', () => {
    expect(sendKeyMode(press('Enter'), false, 'queue')).toBe('queue');
    expect(sendKeyMode(press('Enter', { alt: true }), false, 'queue')).toBeNull();
    expect(sendKeyMode(press('Enter', { meta: true, shift: true }), false, 'queue')).toBeNull();
    expect(sendKeyMode(press('Enter', { shift: true }), true, 'queue')).toBeNull();
  });
});
