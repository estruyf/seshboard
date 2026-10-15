import { lazy, Suspense, useRef, type ReactNode } from 'react';
import { activeComposer, useComposerTargets } from '../../state/composerTargets.ts';
import { useProjectPage } from '../../state/projectPageStore.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { useWidth } from '../ui/useWidth.ts';
import { APP_TERMINAL, appTerminalFolder, type TerminalView } from './appTerminal.ts';
import { effectiveDock, rightBlocked } from './terminalLayout.ts';

const TerminalPanel = lazy(() => import('./TerminalPanel.tsx').then((m) => ({ default: m.TerminalPanel })));

/**
 * The main area with the window's own terminal below or beside it, for the views outside a session (Home, a
 * project's page, Projects, Usage, New session, Settings). `view` is the one on screen. A session view brings
 * its own panel, so there this one steps aside, still open for later. Settings is a sheet over the view it
 * opened from: it covers the views (a session's panel too) but not this panel. Maximized, the view stays
 * mounted but hidden, as the conversation does behind a session's terminal.
 */
export function AppTerminalFrame({ view, children }: { view: TerminalView; children: ReactNode }) {
  const shown = useTerminals((s) => s.openFor.has(APP_TERMINAL)) && view !== 'session';
  const maximized = useTerminals((s) => s.maximizedFor.has(APP_TERMINAL)) && shown;
  const frameRef = useRef<HTMLDivElement>(null);
  const width = useWidth(frameRef);
  // Nothing else wants the right side here: only a narrow window keeps the terminal below.
  const blocked = rightBlocked(null, width);
  const dock = effectiveDock(useTerminals((s) => s.dock), blocked);
  const projectRoot = useProjectPage((s) => s.root);
  const newSessionCwd = useComposerTargets((s) => activeComposer(s.boxes, 'new', null)?.cwd ?? null);
  const home = useHomeFolder();
  const cwd = appTerminalFolder(view, { projectRoot, newSessionCwd });

  return (
    <div ref={frameRef} className={`flex min-h-0 min-w-0 flex-1 ${shown && dock === 'right' ? 'flex-row' : 'flex-col'}`} data-app-terminal-frame>
      {/* `relative`: the Settings sheet fills this, not the panel next to it. */}
      <div className={maximized ? 'hidden' : 'relative flex min-h-0 min-w-0 flex-1 flex-col'}>{children}</div>
      {shown && (
        <Suspense fallback={<div className={`theme-dark shrink-0 bg-terminal ${dock === 'right' ? 'w-90 border-l border-border' : 'h-40 border-t border-border'}`} />}>
          <TerminalPanel sessionId={null} cwd={cwd} projectRoot={null} home={home} dock={dock} rightBlocked={blocked} viewWidth={width} />
        </Suspense>
      )}
    </div>
  );
}
