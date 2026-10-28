import React from 'react';
import { AbsoluteFill, Freeze, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import MANIFEST from '../../public/clips.json';
import { SOURCE, STAGE, WIDTH } from '../theme';
import { fit, Framed, Rect } from './Framed';

/// Where the window's own traffic lights sit, in points. They aren't in a capture (macOS draws them over the page),
/// so a crop that includes the window's top-left corner draws them back where the app leaves room for them, as the
/// README's framed screenshots do. Seshboard puts them at (16, 18); VS Code centres them in its 35pt title bar.
export const LIGHTS = { switchboard: { x: 16, y: 18 }, code: { x: 13, y: 12 } } as const;

const Lights: React.FC<{ at: { x: number; y: number } }> = ({ at }) => (
  <>
    {['#ff5f57', '#febc2e', '#28c840'].map((colour, i) => (
      <div
        key={colour}
        style={{
          position: 'absolute',
          left: (at.x + i * 20) * 2,
          top: at.y * 2,
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: colour,
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.18)',
        }}
      />
    ))}
  </>
);

/// How far into its entrance a window is: 0 tilted away and small, 1 flat and settled.
export const useEntrance = (delay = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 22, mass: 0.9, stiffness: 90 } });
};

/// A window on the panel: rounded, with a hairline edge and a deep shadow, swinging in from a tilt and settling
/// flat. `box` is where it ends up in the frame; `rect` is the part of the capture it shows.
export const Window: React.FC<{
  box: { left: number; top: number; width: number; height: number };
  rect: Rect;
  lights?: { x: number; y: number } | null;
  /// Frame the entrance starts on; null for no entrance (it is already there).
  enter?: number | null;
  /// Which way it swings in from: 1 from the right, -1 from the left.
  from?: 1 | -1;
  /// A slow push, as a scale of the mounted card, 1 to about 1.02.
  scale?: number;
  dim?: number;
  children: React.ReactNode;
}> = ({ box, rect, lights = LIGHTS.switchboard, enter = 0, from = 1, scale = 1, dim = 0, children }) => {
  const p = useEntrance(enter ?? -100);
  const tilt = 1 - p;
  // The corner radius of a macOS window, at the scale the window is shown.
  const radius = Math.max(10, (12 * box.width) / (rect.w / 2));
  return (
    <div
      style={{
        position: 'absolute',
        ...box,
        transformOrigin: from === 1 ? '20% 50%' : '80% 50%',
        transform: `perspective(2600px) translateX(${tilt * 140 * from}px) translateY(${tilt * 40}px) rotateY(${tilt * -24 * from}deg) rotateX(${tilt * 10}deg) scale(${(0.9 + 0.1 * p) * scale})`,
        opacity: interpolate(p, [0, 0.35], [0, 1], { extrapolateRight: 'clamp' }),
      }}
    >
      <div style={{ position: 'absolute', inset: -1, borderRadius: radius + 1, background: 'linear-gradient(180deg, rgba(255,255,255,0.26), rgba(255,255,255,0.05))', boxShadow: '0 60px 140px rgba(0,0,0,0.75), 0 10px 30px rgba(0,0,0,0.55)' }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden', background: '#111' }}>
        <Framed rect={rect} width={box.width} height={box.height}>
          {children}
          {lights && rect.x < 200 && rect.y < 100 ? <Lights at={lights} /> : null}
        </Framed>
        {/* A sheen across the glass while it swings in, gone once it is flat. */}
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(115deg, transparent ${20 + p * 60}%, rgba(255,255,255,${0.1 * tilt}) ${30 + p * 60}%, transparent ${45 + p * 60}%)` }} />
        {dim ? <div style={{ position: 'absolute', inset: 0, background: `rgba(7,9,13,${dim})` }} /> : null}
      </div>
    </div>
  );
};

/// A still out of public/shots, at the size it was captured.
export const Still: React.FC<{ name: string }> = ({ name }) => (
  <Img src={staticFile(`shots/${name}.png`)} style={{ position: 'absolute', top: 0, left: 0, width: SOURCE.width, height: SOURCE.height }} />
);

const layer: React.CSSProperties = { position: 'absolute', top: 0, left: 0, width: SOURCE.width, height: SOURCE.height };

/// One frame of a recording, held: `Freeze` pins the clock, so the video sits on exactly the pixels the moving clip
/// shows there, and the hold and the play on either side hand over without a flicker.
const Held: React.FC<{ src: string; frame: number }> = ({ src, frame }) => (
  <Freeze frame={0}>
    <OffthreadVideo src={src} trimBefore={frame} muted style={layer} />
  </Freeze>
);

export type Beat = {
  /// How long to sit on the first frame while the caption is read.
  holdIn: number;
  /// Where in the recording the moving part starts.
  from?: number;
  /// How much of it to play; left out, the rest.
  play?: number;
  /// Below 1 slows it down. Never above 1: a performance played back faster than it was done is the one edit
  /// people can feel.
  rate: number;
  /// Length of the shot, dissolve included; whatever is left after the hold and the play rests on the last frame.
  total: number;
};

/// How long a recording is, from public/clips.json (written by the capture), so a beat re-recorded a second
/// slower can't cut before its own payoff.
export const lengthOf = (name: string): number => {
  const entry = (MANIFEST as Record<string, { frames: number } | undefined>)[name];
  if (!entry) throw new Error(`no clip "${name}" in public/clips.json: run npm run capture`);
  return entry.frames;
};

/// The composition frame (within the shot) on which recording frame `at` shows, for a beat cut this way. Caption
/// switches are written in recording frames and turned into shot frames with this, so they follow the hold and
/// the rate instead of being worked out by hand.
export const shotFrame = (beat: Beat, at: number) => beat.holdIn + Math.round((at - (beat.from ?? 0)) / beat.rate);

/// Hold, play, hold: the shape every recorded beat is cut to.
export const Clip: React.FC<{ name: string; beat: Beat }> = ({ name, beat }) => {
  const src = staticFile(`clips/${name}.mp4`);
  const from = beat.from ?? 0;
  const play = beat.play ?? lengthOf(name) - from;
  const restFrom = beat.holdIn + Math.round(play / beat.rate);
  return (
    <>
      <Sequence durationInFrames={beat.holdIn} layout="none">
        <Held src={src} frame={from} />
      </Sequence>
      <Sequence from={beat.holdIn} durationInFrames={restFrom - beat.holdIn} layout="none">
        <OffthreadVideo src={src} trimBefore={from} playbackRate={beat.rate} muted style={layer} />
      </Sequence>
      <Sequence from={restFrom} durationInFrames={Math.max(1, beat.total - restFrom)} layout="none">
        <Held src={src} frame={from + play - 1} />
      </Sequence>
    </>
  );
};

/// The box a crop of this shape gets on a stage.
export const stageBox = (stage: keyof typeof STAGE, rect: Rect) => {
  const g = STAGE[stage];
  const box = fit(rect.w / rect.h, g.maxW, g.maxH);
  const left = stage === 'wide' ? (WIDTH - box.w) / 2 : g.left + (g.maxW - box.w) / 2;
  return { left, top: g.top + (g.maxH - box.h) / 2, width: box.w, height: box.h };
};

/// A window on one of the two stages, with its caption. `rectAt` is the camera: the crop on each frame. Every rect
/// it returns must share the first one's aspect, or the picture stretches on the way.
export const Shot: React.FC<{
  stage: keyof typeof STAGE;
  rectAt: (frame: number) => Rect;
  aside?: React.ReactNode;
  push?: [number, number, number];
  lights?: { x: number; y: number } | null;
  children: React.ReactNode;
}> = ({ stage, rectAt, aside, push, lights, children }) => {
  const frame = useCurrentFrame();
  const box = stageBox(stage, rectAt(0));
  const scale = push ? interpolate(frame, [0, push[2]], [push[0], push[1]], { extrapolateRight: 'clamp' }) : 1;
  return (
    <AbsoluteFill>
      {aside}
      <Window box={box} rect={rectAt(frame)} lights={lights} scale={scale}>
        {children}
      </Window>
    </AbsoluteFill>
  );
};
