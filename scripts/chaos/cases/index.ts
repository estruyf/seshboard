/**
 * Every repro case, in the order one run goes through them: read-only ones first, then the ones that change the
 * sandbox, then the ones that restart the app. `--case a,b` picks some; `--fresh` gives each its own app.
 */
import { gitCases } from './git.ts';
import { linkCases } from './links.ts';
import { overlayCases } from './overlays.ts';
import { sessionCases } from './sessions.ts';
import type { Case } from './types.ts';
import { uiCases } from './ui.ts';

export type { Case, Verdict } from './types.ts';

const all: Record<string, Case> = { ...overlayCases, ...uiCases, ...gitCases, ...sessionCases, ...linkCases };
const restarts = new Set(['newSessionFails', 'linkPermissionMode', 'linksAtLaunch', 'projectChoicesKept', 'quitMidRevert']);
const rank = (name: string) => (restarts.has(name) ? 2 : all[name]!.mutates ? 1 : 0);

export const CASES: Record<string, Case> = Object.fromEntries(Object.keys(all).sort((a, b) => rank(a) - rank(b)).map((name) => [name, all[name]!]));
