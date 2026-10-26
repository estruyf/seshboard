import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Cable, Jack } from '../components/Cable';
import { SANS, T } from '../theme';

const ease = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) } as const;

/// The four status colours, in the order the app sorts by them: needs you, working, in the background, unread.
export const STATUS = [T.needsYou, T.working, T.background, T.unread];

/// A row of jacks lighting up one after another, from `start`.
export const JackRow: React.FC<{ y: number; start: number; gap?: number }> = ({ y, start, gap = 96 }) => {
  const frame = useCurrentFrame();
  return (
    <>
      {STATUS.map((color, i) => (
        <Jack key={color} x={960 + (i - 1.5) * gap} y={y} color={color} on={interpolate(frame, [start + i * 5, start + i * 5 + 8], [0, 1], ease)} />
      ))}
    </>
  );
};

export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 14, fps, config: { damping: 14, mass: 0.8 } });
  const line = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 16], [0, 1], ease),
    transform: `translateY(${interpolate(frame, [delay, delay + 16], [24, 0], ease)}px)`,
  });

  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      {/* Two cables come in from the edges and plug into the outer jacks under the name. */}
      <Cable from={{ x: -40, y: 980 }} to={{ x: 960 - 1.5 * 96, y: 812 }} start={30} length={22} sag={60} />
      <Cable from={{ x: 1960, y: 980 }} to={{ x: 960 + 1.5 * 96, y: 812 }} start={36} length={22} sag={60} />
      <JackRow y={812} start={44} />

      <div style={{ position: 'absolute', left: 0, right: 0, top: 210, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ position: 'relative', transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`, opacity: Math.min(1, pop * 1.5) }}>
          <div style={{ position: 'absolute', inset: -80, borderRadius: '50%', background: `radial-gradient(closest-side, rgba(${T.glow},0.35), transparent 70%)` }} />
          <Img src={staticFile('icon.png')} style={{ position: 'relative', width: 176, height: 176, filter: 'drop-shadow(0 24px 50px rgba(0,0,0,0.7))' }} />
        </div>
        <div style={{ ...line(22), marginTop: 34, fontSize: 132, fontWeight: 800, letterSpacing: -4.5, color: T.bright }}>Seshboard</div>
        <div style={{ ...line(34), marginTop: 6, fontSize: 40, fontWeight: 500, letterSpacing: -0.6, color: T.text }}>
          All your Claude Code sessions, in one window.
        </div>
      </div>
    </AbsoluteFill>
  );
};
