import { useCallback, useEffect, useRef, useState } from 'react';
import { parseGithubRepo, type ClonePlan, type Computer, type Contract, type RepoBrings, type RpcClient } from '@switchboard/protocol/client';
import { callComputer, onComputerEvent } from '../computers/callComputer.ts';
import { remoteCloneProblem, type CloneStage } from './cloneModel.ts';

/** What a finished clone gave: the project here (`root`) or on the other computer (`projectId`), and what it brings. */
export interface CloneResult {
  root: string | null;
  projectId: string | null;
  reused: boolean;
  brings: RepoBrings | null;
}

/** Thrown by `wait` when the clone was cancelled: nothing went wrong, so nothing to say. */
export class CloneCancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

/** Progress as the form shows it, from this computer's event or another computer's. */
interface Progress {
  phase: 'starting' | 'receiving' | 'resolving' | 'checkout' | null;
  percent: number | null;
}

export interface CloneJob {
  plan: ClonePlan | null;
  /** Why there is no plan: the URL isn't a GitHub repository, the folder name won't do, the computer can't clone. */
  problem: string | null;
  stage: CloneStage;
  progress: Progress | null;
  error: string | null;
  result: CloneResult | null;
  /** Starts the clone (when it hasn't) and resolves once it is done; rejects with why, or `CloneCancelled`. */
  wait(): Promise<CloneResult>;
  cancel(): void;
}

const newJobId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * One clone, on this computer or on `computer` (Run on): the plan for `url` and `name` (read again a moment after
 * they change), then the clone and its progress. Changing the URL or name after a clone ended starts over.
 */
export function useCloneJob(client: RpcClient<Contract> | null, url: string, name: string, computer: Computer | null = null): CloneJob {
  const [plan, setPlan] = useState<ClonePlan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stage, setStage] = useState<CloneStage>('idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloneResult | null>(null);
  /** The clone running now: its id, and the promise `wait` hands out. */
  const running = useRef<{ jobId: string; done: Promise<CloneResult> } | null>(null);
  const computerId = computer?.id ?? null;
  const tooOld = remoteCloneProblem(computer);

  // A new URL, name or computer is another clone: the last one's outcome no longer applies.
  useEffect(() => {
    if (running.current) return;
    setStage('idle');
    setResult(null);
    setError(null);
    setProgress(null);
  }, [url, name, computerId]);

  useEffect(() => {
    setPlan(null);
    if (!url.trim()) return setProblem(null);
    const parsed = parseGithubRepo(url);
    if (!parsed?.ok) return setProblem(parsed?.error ?? null);
    if (tooOld) return setProblem(tooOld);
    if (!client) return setProblem(null);
    setProblem(null);
    let current = true;
    const params = { url, ...(name.trim() ? { name: name.trim() } : {}) };
    const timer = setTimeout(() => {
      const asked = computerId ? callComputer(client, computerId, 'projects.clonePlan', params) : client.call('projects.clonePlan', params);
      asked.then(
        (next) => current && setPlan(next),
        (e: Error) => current && setProblem(e.message),
      );
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, url, name, computerId, tooOld]);

  const start = useCallback((): Promise<CloneResult> => {
    if (!client) return Promise.reject(new Error('Connecting to the engine…'));
    const parsed = parseGithubRepo(url);
    if (!parsed?.ok) return Promise.reject(new Error(parsed?.error ?? 'Paste the URL of a GitHub repository.'));
    if (tooOld) return Promise.reject(new Error(tooOld));
    const jobId = newJobId();
    const folder = name.trim() || parsed.repo.name;
    setStage('running');
    setError(null);
    setResult(null);
    setProgress({ phase: 'starting', percent: 0 });
    const done = new Promise<CloneResult>((resolve, reject) => {
      type Event = { jobId: string; state: string; phase: Progress['phase']; percent: number | null; reused: boolean; brings: RepoBrings | null; error: string | null; root?: string | null; projectId?: string | null };
      const onEvent = (event: Event) => {
        if (event.jobId !== jobId) return;
        if (event.state === 'running') return setProgress({ phase: event.phase, percent: event.percent });
        stop();
        if (event.state === 'done') {
          const outcome = { root: event.root ?? null, projectId: event.projectId ?? null, reused: event.reused, brings: event.brings };
          setResult(outcome);
          setStage('done');
          setProgress({ phase: 'checkout', percent: 100 });
          resolve(outcome);
        } else if (event.state === 'cancelled') {
          setStage('idle');
          setProgress(null);
          reject(new CloneCancelled());
        } else {
          setStage('failed');
          setError(event.error ?? 'The clone failed.');
          reject(new Error(event.error ?? 'The clone failed.'));
        }
      };
      const stop = computerId ? onComputerEvent(client, computerId, 'projects.cloneProgress', onEvent) : client.on('projects.cloneProgress', onEvent);
      const params = { jobId, url, name: folder };
      (computerId ? callComputer(client, computerId, 'projects.clone', params) : client.call('projects.clone', params)).catch((e: Error) => {
        stop();
        setStage('failed');
        setError(e.message);
        reject(e);
      });
    }).finally(() => {
      if (running.current?.jobId === jobId) running.current = null;
    });
    running.current = { jobId, done };
    return done;
  }, [client, url, name, computerId, tooOld]);

  const wait = useCallback((): Promise<CloneResult> => {
    if (running.current) return running.current.done;
    if (result) return Promise.resolve(result);
    return start();
  }, [start, result]);

  const cancel = useCallback(() => {
    const job = running.current;
    if (!job || !client) return;
    const params = { jobId: job.jobId };
    void (computerId ? callComputer(client, computerId, 'projects.cancelClone', params) : client.call('projects.cancelClone', params)).catch(() => {});
  }, [client, computerId]);

  return { plan, problem, stage, progress, error, result, wait, cancel };
}
