import { Cpu, WandSparkles } from 'lucide-react';
import { AUTO_MODEL } from '@seshboard/protocol/client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ClaudeProfile, Effort, PermissionMode } from '@seshboard/protocol/client';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import { MODE_CHOICES, MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import type { BoxChoiceUse } from '../../state/pipelines.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { CHOICE_PILL, ChoiceMenu, type Choice, type ChoiceAction } from '../newSession/ChoiceMenu.tsx';
import { EFFORT_LABEL, EFFORTS, MODE_DESCRIPTION } from '../newSession/route.ts';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { chipShape, effortBars, FOOTER_LEVELS, footerLevel, MODE_SHORT, modelFamily, shortModelName, type FooterLevel } from './chipFaces.ts';

/** Test hooks: each chip gets `data-<name>-select` and its menu `data-menu="<name>"`. */
export interface ChipNames {
  profile: string;
  model: string;
  effort: string;
  mode: string;
}

const NEW_SESSION_NAMES: ChipNames = { profile: 'profile', model: 'model', effort: 'effort', mode: 'mode' };

export interface ComposerChipRowProps {
  /** The Claude profile. Without `onChange` it can't change (a running session keeps its profile): the menu shows it and links to Settings. */
  profile: { value: string; onChange?(id: string): void; labelFor?(profile: ClaudeProfile): string };
  /**
   * `auto`: a session on the model Auto picked ("Sonnet", or "Default model" when picking failed); the chip reads
   * "Auto · Sonnet". `actions` go under the models (the session's "Why Auto picked Sonnet").
   */
  model: { value: string; label: string; choices: Array<Choice<string>>; onChange(model: string): void; auto?: string | null; actions?: ChoiceAction[] };
  /** Null when the model has no effort setting. */
  effort: { value: Effort | ''; onChange(effort: Effort | ''): void } | null;
  mode: { value: PermissionMode; onChange(mode: PermissionMode): void };
  disabled?: boolean;
  names?: ChipNames;
  /**
   * New session with a pipeline picked in Run as: the model, effort and mode apply only to the steps that don't set
   * their own. A chip no step uses is dimmed (still usable); each says why in its tooltip.
   */
  pipeline?: Record<'model' | 'effort' | 'permissionMode', BoxChoiceUse> | null;
}

/** Auto's wand, in the accent: always with the model chip's "Auto", since the permission mode can read "Auto" too. */
export const AutoWand = ({ size = 13 }: { size?: number }) => <WandSparkles size={size} className="shrink-0 text-accent-ink" aria-hidden />;

/** A chip's tooltip with what a picked pipeline does with it. */
const withNote = (title: string, use: BoxChoiceUse | undefined) => (use ? `${title}. ${use.note}` : title);

/** Three bars that fill with the effort level; above High they turn to the accent. */
function EffortBars({ effort }: { effort: Effort | '' }) {
  const { filled, strong } = effortBars(effort);
  return (
    <span aria-hidden className={`flex h-3 shrink-0 items-end gap-[1.5px] ${strong ? 'text-accent-ink' : ''}`}>
      {[5, 8, 11].map((height, i) => (
        <span key={height} className={`w-[2.5px] rounded-[1px] ${i < filled ? 'bg-current' : 'bg-current/25'}`} style={{ height }} />
      ))}
    </span>
  );
}

const Dot = ({ className }: { className: string }) => <span aria-hidden className={`size-2 shrink-0 rounded-full ${className}`} />;

/**
 * The message box's chip row, the same in a session, in New session and in the palette's prompt step:
 * profile · model · effort · permission mode as quiet buttons that show only the value ("Personal",
 * "Opus 4.5", "Medium", "Auto"), each opening its menu above it. The profile chip shows only with more
 * than one profile, like the profile badges elsewhere.
 *
 * When the row runs out of room it steps through fixed levels (`footerLevel`) rather than cutting words:
 * a hidden copy of the row at every level is measured against the room the footer leaves.
 */
export function ComposerChipRow({ profile, model, effort, mode, disabled, names = NEW_SESSION_NAMES, pipeline }: ComposerChipRowProps) {
  const profiles = useProfiles((s) => s.profiles);
  const current = profiles.find((p) => p.id === profile.value);
  const fixed = !profile.onChange;
  // A mode set elsewhere (bypass, say) is listed too, so the checked one is always there.
  const modes = [...new Set([...MODE_CHOICES, mode.value])];
  const [level, setLevel] = useState<FooterLevel>(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const copies = measureRef.current;
    if (!row || !copies) return;
    const measure = () => setLevel(footerLevel(row.getBoundingClientRect().width, [...copies.children].map((copy) => copy.getBoundingClientRect().width)));
    measure();
    // The row follows the window; each copy follows its own content (another model, a font that loaded).
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const copy of copies.children) observer.observe(copy);
    return () => observer.disconnect();
  }, []);

  const modelName = shortModelName(model.label);
  const effortLabel = effort ? (effort.value ? EFFORT_LABEL[effort.value] : 'Default effort') : '';
  const modeDot = MODE_DOT[mode.value] ?? 'bg-faint';

  /** Each chip's face at a level: what the real chip shows, and what the hidden copies measure. */
  const chips: Array<{ key: string; face(level: FooterLevel): ReactNode; menu(face: ReactNode): ReactNode }> = [];
  if (profiles.length > 1) {
    const profileName = current?.name ?? 'Profile';
    chips.push({
      key: 'profile',
      face: (l) => (
        <>
          <Dot className={current ? PROFILE_DOT[current.color] : 'bg-faint'} />
          {chipShape(l).profileName && <span>{profileName}</span>}
        </>
      ),
      menu: (face) => (
        <ChoiceMenu
          name={names.profile}
          value={profile.value}
          onChange={(id) => profile.onChange?.(id)}
          disabled={disabled && !fixed}
          label={`Claude profile: ${profileName}`}
          title={`Claude profile: ${profileName}${current?.account?.email ? ` · signed in as ${current.account.email}` : ''}${fixed ? '. A session keeps its profile; a new one can use another.' : ''}`}
          heading="Profile"
          placement="up"
          choices={profiles.map((p) => ({
            value: p.id,
            label: profile.labelFor?.(p) ?? p.name,
            description: p.account?.email ?? undefined,
            dot: PROFILE_DOT[p.color],
            disabled: fixed && p.id !== profile.value,
          }))}
          actions={fixed ? [{ label: 'Manage profiles…', onSelect: () => useSessions.getState().openSettings('profiles'), data: { 'data-manage-profiles': true } }] : undefined}
          width={260}
        >
          {face}
        </ChoiceMenu>
      ),
    });
  }
  const autoPicked = model.auto ?? null;
  const isAuto = autoPicked !== null || model.value === AUTO_MODEL;
  const modelTitle = autoPicked !== null ? `Model: Auto picked ${autoPicked}` : `Model: ${model.label}`;
  chips.push({
    key: 'model',
    face: (l) =>
      isAuto ? (
        <>
          <AutoWand />
          {chipShape(l).autoWord && <span>Auto</span>}
          {autoPicked !== null && (
            <>
              {chipShape(l).autoWord && (
                <span aria-hidden className="text-faint">
                  ·
                </span>
              )}
              <span className="font-semibold text-text">{chipShape(l).modelVersion ? shortModelName(autoPicked) : modelFamily(autoPicked)}</span>
            </>
          )}
        </>
      ) : (
        <>
          <Cpu size={13} className="shrink-0" aria-hidden />
          <span>{chipShape(l).modelVersion ? modelName : modelFamily(model.label)}</span>
        </>
      ),
    menu: (face) => (
      <ChoiceMenu
        name={names.model}
        value={model.value}
        onChange={model.onChange}
        disabled={disabled}
        label={modelTitle}
        title={withNote(modelTitle, pipeline?.model)}
        heading="Model"
        placement="up"
        choices={model.choices}
        actions={model.actions}
        width={isAuto || model.choices.some((c) => c.value === AUTO_MODEL) ? 300 : 260}
      >
        {face}
      </ChoiceMenu>
    ),
  });
  if (effort) {
    chips.push({
      key: 'effort',
      face: (l) => (
        <>
          <EffortBars effort={effort.value} />
          {chipShape(l).effortLabel && <span>{effortLabel}</span>}
        </>
      ),
      menu: (face) => (
        <ChoiceMenu
          name={names.effort}
          value={effort.value}
          onChange={effort.onChange}
          disabled={disabled}
          label={`Effort: ${effortLabel}`}
          title={withNote(`Effort: ${effortLabel}`, pipeline?.effort)}
          heading="Effort"
          placement="up"
          choices={[{ value: '' as const, label: 'Default', description: 'What Claude Code would pick' }, ...EFFORTS.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))]}
          width={200}
        >
          {face}
        </ChoiceMenu>
      ),
    });
  }
  chips.push({
    key: 'mode',
    face: (l) => (
      <>
        <Dot className={modeDot} />
        {chipShape(l).modeLabel && <span>{MODE_SHORT[mode.value]}</span>}
      </>
    ),
    menu: (face) => (
      <ChoiceMenu
        name={names.mode}
        value={mode.value}
        onChange={mode.onChange}
        disabled={disabled}
        label={`Permission mode: ${MODE_SHORT[mode.value]}`}
        title={withNote(`Permission mode: ${MODE_SHORT[mode.value]} (${formatKeys(keysFor('mode.cycle'))} in the message box)`, pipeline?.permissionMode)}
        heading="Permissions"
        placement="up"
        choices={modes.map((m) => ({ value: m, label: MODE_LABEL[m], description: MODE_DESCRIPTION[m], dot: MODE_DOT[m] ?? 'bg-faint' }))}
        width={280}
      >
        {face}
      </ChoiceMenu>
    ),
  });

  const dimmed = (key: string) => {
    const use = key === 'model' ? pipeline?.model : key === 'effort' ? pipeline?.effort : key === 'mode' ? pipeline?.permissionMode : undefined;
    return use?.dim ?? false;
  };

  return (
    <div ref={rowRef} className="relative flex min-w-0 flex-1 items-center gap-0.5" data-composer-chips data-chip-level={level}>
      {chips.map((chip) => (
        <div
          key={chip.key}
          className={`shrink-0 transition-opacity ${dimmed(chip.key) ? 'opacity-50 hover:opacity-100 focus-within:opacity-100' : ''}`}
          data-chip={chip.key}
          data-chip-dimmed={dimmed(chip.key) || undefined}
          {...(chip.key === 'model' ? { 'data-model-chip': isAuto ? 'auto' : model.value || 'default' } : {})}
        >
          {chip.menu(chip.face(level))}
        </div>
      ))}
      {/* The row at every level, out of sight and out of the way of clicks, screen readers and the layout around it. */}
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden">
        {FOOTER_LEVELS.map((l) => (
          <div key={l} className="flex w-max gap-0.5">
            {chips.map((chip) => (
              <span key={chip.key} className={CHOICE_PILL}>
                {chip.face(l)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
