import aluminium from './aluminium.json';
import catppuccin from './catppuccin.json';
import demoTime from './demo-time.json';
import forest from './forest.json';
import graphite from './graphite.json';
import midnight from './midnight.json';
import neon from './neon.json';
import nord from './nord.json';
import ocean from './ocean.json';
import paper from './paper.json';
import plum from './plum.json';
import signal from './signal.json';
import solarized from './solarized.json';

/**
 * The themes that ship with Switchboard, in picker order. They are theme files like any other and go
 * through the same validation as imports (main checks them at start, and the unit tests too), so the
 * format is used every day and can't drift. After the ported themes come the ones that match the app
 * icon's colourways (assets/app-icons), in the App icon picker's order.
 */
export const BUILT_IN_THEMES: ReadonlyArray<{ id: string; raw: unknown }> = [
  { id: 'demo-time', raw: demoTime },
  { id: 'catppuccin', raw: catppuccin },
  { id: 'nord', raw: nord },
  { id: 'solarized', raw: solarized },
  { id: 'graphite', raw: graphite },
  { id: 'midnight', raw: midnight },
  { id: 'paper', raw: paper },
  { id: 'signal', raw: signal },
  { id: 'forest', raw: forest },
  { id: 'plum', raw: plum },
  { id: 'aluminium', raw: aluminium },
  { id: 'ocean', raw: ocean },
  { id: 'neon', raw: neon },
];
