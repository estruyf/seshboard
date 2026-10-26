import { CircleAlert, CircleCheck, Info, Stethoscope, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { TranscriptDiagnosis, TranscriptFileCheck, TranscriptFinding, TranscriptProfileCheck } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useMultipleProfiles, useProfile } from '../../state/profilesStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice, type NoticeTone } from '../ui/Notice.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { diagnosisReport, formatBytes } from './diagnosisReport.ts';

const FINDING: Record<TranscriptFinding['tone'], { tone: NoticeTone; icon: typeof Info }> = {
  error: { tone: 'error', icon: CircleAlert },
  warn: { tone: 'warn', icon: TriangleAlert },
  info: { tone: 'info', icon: Info },
  ok: { tone: 'success', icon: CircleCheck },
};

function FileRow({ file }: { file: TranscriptFileCheck }) {
  const facts = [
    formatBytes(file.size),
    `modified ${new Date(file.modifiedAt).toLocaleString()}`,
    `${file.lines.toLocaleString()} lines`,
    `${file.messages.toLocaleString()} messages`,
    file.compactions ? `compacted ${file.compactions === 1 ? 'once' : `${file.compactions} times`}` : null,
    file.badLines ? `${file.badLines.toLocaleString()} invalid lines` : null,
    file.complete ? null : 'last line incomplete',
  ].filter(Boolean);
  return (
    <li className="grid gap-0.5" data-diagnosis-file>
      <span className="font-mono text-meta break-all text-text select-text">{file.path}</span>
      <span className="text-meta text-muted">{facts.join(' · ')}</span>
    </li>
  );
}

function ProfileChecks({ check, named }: { check: TranscriptProfileCheck; named: boolean }) {
  const profile = useProfile(check.profileId);
  return (
    <section className="grid gap-2" data-diagnosis-profile={check.profileId}>
      <SectionHeader as="h3">{named ? `Profile: ${profile?.name ?? check.profileId}` : 'Transcript files'}</SectionHeader>
      {check.files.length === 0 ? (
        <p className="text-ui text-muted">
          None in <span className="font-mono text-meta">{check.configDir}</span>
        </p>
      ) : (
        <ul className="grid gap-2">
          {check.files.map((file) => (
            <FileRow key={file.path} file={file} />
          ))}
        </ul>
      )}
      <p className="text-ui text-muted" data-diagnosis-read={check.error === null ? check.read : 'error'}>
        {check.error === null
          ? `Claude Code's reader returned ${check.read?.toLocaleString()} ${check.read === 1 ? 'message' : 'messages'} in ${check.readMs} ms.`
          : `Claude Code's reader failed after ${check.readMs} ms.`}
      </p>
      {check.error !== null && (
        <pre className="max-h-48 overflow-auto rounded-md bg-code p-2.5 font-mono text-meta whitespace-pre-wrap text-text select-text">{check.stack ?? check.error}</pre>
      )}
    </section>
  );
}

/**
 * "Check transcript": why a session's conversation shows the way it does, or doesn't. The engine looks
 * at the transcript files in every profile's folder and runs Claude Code's reader on them; this shows
 * the conclusions first, then the details, and copies the lot for a bug report.
 */
export function TranscriptDiagnosisDialog({ sessionId, title, onClose }: { sessionId: string; title: string | null; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const multipleProfiles = useMultipleProfiles();
  const [diagnosis, setDiagnosis] = useState<TranscriptDiagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [flash, setFlash] = useFlash();

  const check = useCallback(() => {
    if (!client) return;
    setChecking(true);
    setError(null);
    client
      .call('transcript.diagnose', { sessionId })
      .then(setDiagnosis, (e: Error) => setError(e.message))
      .finally(() => setChecking(false));
  }, [client, sessionId]);
  useEffect(check, [check]);

  const copy = () => {
    if (!diagnosis) return;
    const report = diagnosisReport(diagnosis, { title, version: window.seshboard?.appInfo.version ?? null });
    navigator.clipboard.writeText(report).then(
      () => setFlash('Details copied'),
      () => setError('Could not copy the details'),
    );
  };

  return (
    <Dialog
      width="md"
      placement="top"
      icon={<Stethoscope size={15} className="text-accent-ink" aria-hidden />}
      title="Check transcript"
      subtitle={title ?? sessionId}
      onClose={onClose}
      onSubmit={copy}
      data-transcript-diagnosis={checking ? 'checking' : diagnosis ? 'done' : 'failed'}
      footerStart={
        flash ? (
          <Notice tone="success" inline>
            {flash}
          </Notice>
        ) : (
          <Button size="md" onClick={check} disabled={checking || !client} data-diagnosis-recheck>
            Check again
          </Button>
        )
      }
      footer={
        <>
          <Button size="md" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" size="md" kbd="⌘↵" onClick={copy} disabled={!diagnosis} data-diagnosis-copy>
            Copy details
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        {!diagnosis && checking && (
          <p className="text-ui text-muted" role="status">
            Checking the transcript…
          </p>
        )}
        {diagnosis && (
          <>
            <div className="grid gap-2" data-diagnosis-findings>
              {diagnosis.findings.map((finding) => {
                const { tone, icon: Icon } = FINDING[finding.tone];
                return (
                  <Notice key={finding.text} tone={tone} icon={<Icon size={14} aria-hidden />} data-diagnosis-finding={finding.tone}>
                    {finding.text}
                  </Notice>
                );
              })}
            </div>
            {diagnosis.profiles.map((profile) => (
              <ProfileChecks key={profile.profileId} check={profile} named={multipleProfiles} />
            ))}
            <p className="text-meta text-faint">
              Session id <span className="font-mono select-text">{diagnosis.sessionId}</span>
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
