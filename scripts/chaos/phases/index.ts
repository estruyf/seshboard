/**
 * Every phase, by the name `--phase` takes. The letters are the sections of tests/chaos-test-prompt.md.
 */
import { corrupt } from './corrupt.ts';
import { edges } from './edges.ts';
import { editors } from './editors.ts';
import { fuzz } from './fuzz.ts';
import { leak } from './leak.ts';
import { mix } from './mix.ts';
import { monkey } from './monkey.ts';
import { persist } from './persist.ts';
import { processChaos } from './process.ts';
import { repro } from './repro.ts';
import { scale } from './scale.ts';
import { speed } from './speed.ts';
import type { Phase } from './types.ts';
import { windowChaos } from './window.ts';
import { world } from './world.ts';

export type { Phase, PhaseOptions } from './types.ts';

export const PHASES: Record<string, { run: Phase; about: string }> = {
  monkey: { run: monkey, about: 'a. random walk over everything on screen (--actions, default 1000)' },
  speed: { run: speed, about: 'b. every shortcut 20× fast, dialogs 50×, races between clicks, double sends and starts' },
  fuzz: { run: fuzz, about: 'c. odd and very long text in every text field' },
  editors: { run: editors, about: 'c. odd text in the project action editor and new memories, then run the actions' },
  world: { run: world, about: 'd. odd git states, folders and transcripts changed while the app shows them' },
  process: { run: processChaos, about: 'e. engine SIGKILL and SIGSTOP, killed shells and actions, slow git, failing gh and claude' },
  window: { run: windowChaos, about: 'f. window sizes, maximise, full screen, zoom, blur and focus, themes and theme imports' },
  edges: { run: edges, about: 'g. deep links, the companion socket, imports and exports' },
  persist: { run: persist, about: 'user choices across a restart, a quit right after a rename, and a SIGKILL of the app' },
  corrupt: { run: corrupt, about: 'the app profile corrupted while the app is closed (preferences, themes, cache)' },
  leak: { run: leak, about: 'the heap after GC and the engine RSS over 200 cycles' },
  scale: { run: scale, about: '3,000 sessions written while the app runs' },
  mix: { run: mix, about: 'the monkey, with the world, the engine and the window changing under it (--actions)' },
  repro: { run: repro, about: 'the repro cases, each with a verdict (--case a,b for some)' },
};
