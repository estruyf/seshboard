import { describe, expect, it } from 'vitest';
import { awakeCommand, KeepAwake, type AwakeChild } from './keepAwake.ts';

class FakeChild implements AwakeChild {
  killed = false;
  readonly #listeners: Record<string, Array<() => void>> = {};
  on(event: 'exit' | 'error', listener: () => void) {
    (this.#listeners[event] ??= []).push(listener);
    return this;
  }
  kill() {
    this.killed = true;
    this.emit('exit');
  }
  emit(event: 'exit' | 'error') {
    for (const listener of this.#listeners[event] ?? []) listener();
  }
}

function setup(platform: string) {
  const spawned: Array<{ file: string; args: string[]; child: FakeChild }> = [];
  const blocks = { started: 0, stopped: [] as number[], next: 7 };
  const keepAwake = new KeepAwake({
    platform,
    pid: 4242,
    spawn: (file, args) => {
      const child = new FakeChild();
      spawned.push({ file, args, child });
      return child;
    },
    blocker: {
      start: () => (blocks.started++, blocks.next++),
      stop: (id) => void blocks.stopped.push(id),
    },
  });
  return { keepAwake, spawned, blocks };
}

describe('awakeCommand', () => {
  it('runs caffeinate on a Mac, held to Switchboard’s process', () => {
    expect(awakeCommand('darwin', 4242)).toEqual({ file: '/usr/bin/caffeinate', args: ['-s', '-w', '4242'] });
  });

  it('has no command on Windows and Linux', () => {
    expect(awakeCommand('win32', 4242)).toBeNull();
    expect(awakeCommand('linux', 4242)).toBeNull();
  });
});

describe('KeepAwake on macOS', () => {
  it('starts caffeinate once, and stops it once', () => {
    const { keepAwake, spawned } = setup('darwin');
    expect(keepAwake.active).toBe(false);
    keepAwake.apply(true);
    keepAwake.apply(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ file: '/usr/bin/caffeinate', args: ['-s', '-w', '4242'] });
    expect(keepAwake.active).toBe(true);
    keepAwake.apply(false);
    keepAwake.apply(false);
    expect(spawned[0]!.child.killed).toBe(true);
    expect(keepAwake.active).toBe(false);
    expect(spawned).toHaveLength(1);
  });

  it('notices caffeinate exiting by itself, and starts it again only on the next apply(true)', () => {
    const { keepAwake, spawned } = setup('darwin');
    keepAwake.apply(true);
    spawned[0]!.child.emit('exit');
    expect(keepAwake.active).toBe(false);
    expect(spawned).toHaveLength(1);
    keepAwake.apply(true);
    expect(spawned).toHaveLength(2);
    expect(keepAwake.active).toBe(true);
  });

  it('is not active when caffeinate fails to start', () => {
    const { keepAwake, spawned } = setup('darwin');
    keepAwake.apply(true);
    spawned[0]!.child.emit('error');
    expect(keepAwake.active).toBe(false);
  });

  it('ignores the exit of a caffeinate it already replaced', () => {
    const { keepAwake, spawned } = setup('darwin');
    keepAwake.apply(true);
    const first = spawned[0]!.child;
    keepAwake.apply(false);
    keepAwake.apply(true);
    first.emit('exit');
    expect(keepAwake.active).toBe(true);
  });

  it('stops caffeinate on dispose', () => {
    const { keepAwake, spawned } = setup('darwin');
    keepAwake.apply(true);
    keepAwake.dispose();
    expect(spawned[0]!.child.killed).toBe(true);
    expect(keepAwake.active).toBe(false);
  });
});

describe('KeepAwake on Windows and Linux', () => {
  for (const platform of ['win32', 'linux']) {
    it(`uses the sleep blocker on ${platform}, once`, () => {
      const { keepAwake, spawned, blocks } = setup(platform);
      keepAwake.apply(true);
      keepAwake.apply(true);
      expect(spawned).toHaveLength(0);
      expect(blocks.started).toBe(1);
      expect(keepAwake.active).toBe(true);
      keepAwake.apply(false);
      keepAwake.dispose();
      expect(blocks.stopped).toEqual([7]);
      expect(keepAwake.active).toBe(false);
    });
  }
});
