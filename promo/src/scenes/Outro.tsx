import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { MONO, SANS, T } from '../theme';
import { JackRow } from './Title';

const ease = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) } as const;

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 16, mass: 0.8 } });
  const line = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 16], [0, 1], ease),
    transform: `translateY(${interpolate(frame, [delay, delay + 16], [18, 0], ease)}px)`,
  });

  return (
    <AbsoluteFill style={{ fontFamily: SANS, alignItems: 'center' }}>
      <div style={{ marginTop: 250, display: 'flex', alignItems: 'center', gap: 30, transform: `scale(${interpolate(pop, [0, 1], [0.85, 1])})`, opacity: Math.min(1, pop * 1.5) }}>
        <Img src={staticFile('icon.png')} style={{ width: 112, height: 112, filter: 'drop-shadow(0 18px 40px rgba(0,0,0,0.7))' }} />
        <span style={{ fontSize: 100, fontWeight: 800, letterSpacing: -3.4, color: T.bright }}>Seshboard</span>
      </div>
      <div style={{ ...line(8), marginTop: 30, fontSize: 38, fontWeight: 500, color: T.text, letterSpacing: -0.4 }}>
        Every session. Every account. One window.
      </div>

      {/* How to get it is the one thing to take away, so it is the one thing in a card. */}
      <div
        style={{
          ...line(16),
          marginTop: 56,
          padding: '24px 40px',
          borderRadius: 16,
          background: T.panel,
          border: `1px solid ${T.line}`,
          boxShadow: `0 30px 70px rgba(0,0,0,0.6), 0 0 0 1px rgba(${T.glow},0.12)`,
          fontFamily: MONO,
          fontSize: 32,
          color: T.bright,
        }}
      >
        <span style={{ color: T.faint }}>$ </span>brew install --cask <span style={{ color: T.accent }}>estruyf/tap/seshboard</span>
      </div>
      <div style={{ ...line(24), marginTop: 30, fontSize: 26, color: T.muted }}>
        github.com/estruyf/switchboard
        <span style={{ color: T.faint }}> &middot; </span>
        Free and open source, for macOS
      </div>
      <div style={{ ...line(30), marginTop: 12, fontSize: 22, color: T.faint }}>Seshboard Companion for VS Code on the Visual Studio Marketplace and Open VSX</div>
      <JackRow y={870} start={20} gap={72} />
    </AbsoluteFill>
  );
};
