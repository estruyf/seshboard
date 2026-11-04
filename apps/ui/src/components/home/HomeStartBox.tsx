import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { matches, shortcutGlyphs } from '../../lib/shortcuts.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import type { QuickProject } from '../quickStart/quickStartModel.ts';
import { Button } from '../ui/Button.tsx';
import { startTarget } from './homeModel.ts';

/** New session in `root` (none: New session's own pick), with `prompt` filled in for you to check and send. */
export function startInProject(root: string | null, prompt = '') {
  if (root) useProjects.getState().startIn(root, { prompt });
  useSessions.getState().openNewSession();
}

/**
 * Home's start box: what Claude should do, after a project's name ("seshboard fix the tests"). ↩ opens New session in
 * that project (the first one in the list without a name) with the rest as the prompt; ⌘1 to ⌘9 pick a project from
 * Start in a project, as in New session, and take the text along. The projects and their order are quick start's
 * (`useQuickProjects`), so the two agree. Quick start's token and options can take over here later.
 */
export function HomeStartBox({ projects }: { projects: readonly QuickProject[] }) {
  const [text, setText] = useState('');
  const hintId = useId();
  const field = useRef<HTMLInputElement>(null);
  const target = useMemo(() => startTarget(text, projects), [text, projects]);
  const picked = projects.find((p) => p.root === target.root) ?? null;
  const store = useProjects((s) => s.projects);

  // ⌘1 to ⌘9 wherever focus is on Home, as New session's list does; never from the terminal or under a dialog.
  const textRef = useRef(text);
  textRef.current = text;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matches(event, 'home.pick')) return;
      if (document.querySelector('[role=dialog], [role=alertdialog], [role=menu]')) return;
      if (event.target instanceof HTMLElement && event.target.closest('[data-terminal-panel]')) return;
      const project = projectsRef.current[Number(event.key) - 1];
      if (!project) return;
      event.preventDefault();
      // A name typed for another project goes; what follows it is still the prompt.
      startInProject(project.root, startTarget(textRef.current, projectsRef.current).prompt);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const start = () => startInProject(target.root ?? projects[0]?.root ?? null, target.prompt);
  const placeholder = `What should Claude do? Type a project name first, or ${shortcutGlyphs('⌘1')}–${shortcutGlyphs('⌘9')}…`;

  return (
    <form
      aria-label="Start a session"
      onSubmit={(event) => event.preventDefault()}
      // The field holds input, so it keeps its border, like the message box.
      className="flex h-[46px] min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card pr-2 pl-3.5 focus-within:border-faint"
      onClick={(event) => event.target === event.currentTarget && field.current?.focus()}
      data-home-start
    >
      <Search size={15} className="shrink-0 text-faint" aria-hidden />
      <input
        ref={field}
        value={text}
        onChange={(event) => setText(event.target.value)}
        // ↩ starts, on the key itself (not the form's implicit submit), and never while an input method composes.
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          start();
        }}
        placeholder={placeholder}
        aria-label="Start a session"
        aria-describedby={picked ? hintId : undefined}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-faint"
        data-home-start-input
      />
      {/* The project the text starts with: where ↩ starts. */}
      {picked && (
        <span id={hintId} className="flex max-w-56 min-w-0 shrink items-center gap-1.5 text-ui text-muted" data-home-start-project={picked.root}>
          <span className="sr-only">Starts in</span>
          <ProjectIcon project={store.get(picked.root)} root={picked.root} size={16} />
          <span className="truncate">{picked.name}</span>
        </span>
      )}
      <Button variant="primary" shortcut="session.new" type="button" onClick={() => (text.trim() ? start() : useSessions.getState().openNewSession())} className="shrink-0" data-empty-new-session>
        New session
      </Button>
    </form>
  );
}
