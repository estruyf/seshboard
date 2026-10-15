import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { RemoteProject } from '@switchboard/protocol/remote-client';
import type { Client } from './Connected.tsx';
import { Button } from './ui.tsx';

/** New session in a project Switchboard knows, with that project's defaults for model, effort and mode. */
export function NewSession({ client, banner, onBack, onStarted }: { client: Client; banner: ReactNode; onBack: () => void; onStarted: (sessionId: string) => void }) {
  const [projects, setProjects] = useState<RemoteProject[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    void client.call('projects.list', {}).then(
      ({ projects }) => setProjects(projects),
      (e: Error) => setError(e.message),
    );
  }, [client]);

  const start = async () => {
    if (!client || !projectId || !prompt.trim()) return;
    setBusy(true);
    try {
      const { sessionId } = await client.call('session.create', { projectId, prompt: prompt.trim() });
      onStarted(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The session didn't start.");
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top flex items-center gap-2 border-b border-border px-2 pb-2">
        <Button variant="quiet" onClick={onBack} aria-label="Back" className="min-h-11 px-2">
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
        <h1 className="text-title font-semibold">New session</h1>
      </header>
      {banner}
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <section aria-labelledby="pick-project" className="flex flex-col gap-2">
          <h2 id="pick-project" className="text-meta font-semibold tracking-wide text-faint uppercase">
            Project
          </h2>
          {projects === null && !error && <p className="text-ui text-muted">Loading projects…</p>}
          {projects?.length === 0 && <p className="text-ui text-muted">Add a project in Switchboard on your computer first.</p>}
          <div role="radiogroup" aria-labelledby="pick-project" className="flex flex-col gap-2">
            {projects?.map((project) => (
              <button
                key={project.id}
                type="button"
                role="radio"
                aria-checked={projectId === project.id}
                onClick={() => setProjectId(project.id)}
                className={`min-h-11 rounded-lg border px-3 text-left text-body ${projectId === project.id ? 'border-accent-ink bg-accent/15' : 'border-edge'}`}
              >
                {project.name}
              </button>
            ))}
          </div>
        </section>
        <label className="flex flex-col gap-2">
          <span className="text-meta font-semibold tracking-wide text-faint uppercase">What should Claude do?</span>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} className="rounded-xl border border-edge bg-card px-3 py-2 text-body" />
        </label>
        {error && (
          <p role="alert" className="text-ui text-error">
            {error}
          </p>
        )}
      </main>
      <footer className="safe-bottom border-t border-border px-4 pt-3">
        <Button variant="primary" className="w-full" disabled={busy || !client || !projectId || !prompt.trim()} onClick={() => void start()}>
          Start session
        </Button>
      </footer>
    </div>
  );
}
