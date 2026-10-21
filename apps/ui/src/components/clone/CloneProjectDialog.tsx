import { useState } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useClone } from '../../state/cloneStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { ClonePanel } from './ClonePanel.tsx';
import { canClone } from './cloneModel.ts';
import { useCloneJob } from './useCloneJob.ts';

/**
 * The sidebar's Clone from GitHub…: clones a repository into the Clone into folder and adds it to your projects,
 * without starting a session. Closing it while it clones stops the clone.
 */
export function CloneProjectDialog() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const job = useCloneJob(client, url, name);
  const close = () => {
    if (job.stage === 'running') job.cancel();
    useClone.getState().showDialog(false);
  };
  const start = () => void job.wait().catch(() => {});
  const ready = job.stage !== 'running' && job.stage !== 'done' && canClone(job.plan) && !job.problem;
  return (
    <Dialog
      placement="top"
      width="md"
      title="Clone from GitHub"
      subtitle="Clones a repository into the folder set in Settings › Projects and adds it to your projects."
      onClose={close}
      onSubmit={ready ? start : undefined}
      data-clone-dialog
      footer={
        job.stage === 'done' ? (
          <Button variant="primary" onClick={close} data-clone-done>
            Done
          </Button>
        ) : (
          <>
            <Button variant={job.stage === 'running' ? 'danger' : 'secondary'} onClick={close}>{job.stage === 'running' ? 'Stop and close' : 'Cancel'}</Button>
            <Button variant="primary" kbd="↩" disabled={!ready} onClick={start} data-clone-start>
              {job.plan?.state === 'cloned' ? 'Add it' : 'Clone'}
            </Button>
          </>
        )
      }
    >
      <ClonePanel bare url={url} name={name} job={job} onUrl={setUrl} onName={setName} onStart={start} onClose={close} />
    </Dialog>
  );
}
