// The look: a patch bay. Seshboard is named after the operator's board, so the ground is a dark panel with a
// faint grid of jack holes, the app's own yellow is the cable, and the four status colours the app uses (needs
// you, working, running in the background, unread) are the lit jacks. All of them are the app's dark-theme values
// (apps/ui/src/styles.css), so nothing on the ground disagrees with what is in the windows.
export const T = {
  ground: '#07090d',
  panel: '#11141b',
  line: '#232835',
  bright: '#ffffff',
  text: '#e6e8ee',
  muted: '#9aa2b1',
  faint: '#5d6575',
  /// The app's accent: cables, kickers, the progress line.
  accent: '#ffd43b',
  /// The accent as an `r,g,b` triple, for glows.
  glow: '255,212,59',
  /// The status colours, as the app uses them in dark mode.
  needsYou: '#ed217c',
  working: '#ffd43b',
  background: '#51cf66',
  unread: '#74c0fc',
} as const;

export const SANS = '"SF Pro Display", -apple-system, system-ui, "Helvetica Neue", sans-serif';
export const MONO = '"SF Mono", ui-monospace, Menlo, monospace';

export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 30;

/// Scenes overlap by this much and dissolve through it.
export const XFADE = 14;

/// What the capture is, in its own pixels: a 1280x800 window at 2x. Every crop in the composition is written in
/// these numbers, the ones you would read off a file in public/shots in Preview.
export const SOURCE = { width: 2560, height: 1600 } as const;

/// Where pictures go. `side` puts the caption in a column on the left and the picture beside it, for anything
/// about as tall as the window; `wide` puts the caption above, for crops wider than about 2:1. Scale is
/// `cardWidth / (cropWidth / 2)`: below about 1.0 the app's 13px text stops being comfortable at 1080p.
export const STAGE = {
  side: { left: 650, top: 60, maxW: 1200, maxH: 960 },
  wide: { left: 150, top: 300, maxW: 1620, maxH: 720 },
} as const;

/// The caption column of the `side` stage, and the band above the picture on the `wide` stage.
export const COLUMN = { left: 96, width: 500 };
export const CAPTION_BASELINE = 250;
