import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { Caption } from './components/Caption';
import { move, pts, WINDOW } from './components/Framed';
import { Ground, Progress } from './components/Ground';
import { Scene } from './components/Scene';
import { Beat, Clip, lengthOf, Shot, shotFrame, Still } from './components/Shot';
import { Companion, companionBeat } from './scenes/Companion';
import { Montage, MONTAGE, MONTAGE_STEP } from './scenes/Montage';
import { Outro } from './scenes/Outro';
import { Title } from './scenes/Title';
import { T, XFADE } from './theme';

// About fifty seconds: what Seshboard is, then the three things the user asked to lead with (several Claude
// accounts, projects, the VS Code companion), then the rest at a glance.
//
// Every recorded beat is sized from its recording (public/clips.json): hold on the first frame while the caption
// is read, play, rest on where it ends. Caption switches inside a beat are written as *recording* frames (the
// moment something happens on screen, found with `node scripts/activity.mjs <clip>`) and turned into shot frames
// with `shotFrame`, so they follow the hold and the rate. Those recording frames are the numbers to re-check after
// every capture.

/// A beat's length: the hold, the recording at its rate, and `rest` frames on the last one.
const sized = (name: string, beat: Omit<Beat, 'total'>, rest: number): Beat => {
  const play = beat.play ?? lengthOf(name) - (beat.from ?? 0);
  return { ...beat, total: beat.holdIn + Math.ceil(play / beat.rate) + rest };
};

// ---- the shots -------------------------------------------------------------------------------------------------

/// Home, down to the project tiles. The bottom edge runs through the empty part of the sidebar and the gap above
/// Profiles: the profile cards can only say "Usage unavailable" for the demo's logins, which have no credentials.
const HOME = pts(0, 0, 1280, 539);

/// Adding the Work login. It opens on the Claude profiles settings, close enough to read the form, and pulls out to
/// the whole window as the profile lands and its sessions join the sidebar.
const PROFILES = pts(540, 44, 740, 462.5);
const profileBeat = sized('profile', { holdIn: 18, from: 20, rate: 0.9 }, 66);
/// Recording frame on which the Work profile is added and the sidebar fills in.
const PROFILE_ADDED = 135;

/// The main column from the sidebar's edge: the Projects list, then payments-api's page and its Settings tab.
const MAIN = pts(322, 0, 958, 598.75);
/// At its own pace: it's three choices in a row, and slowed down they drag. It stops once the last one (New
/// worktree, at recording frame ~308) has settled.
const projectBeat = sized('project', { holdIn: 16, from: 24, play: 306, rate: 1 }, 40);

/// acme-store's worktrees: the whole height of the window, from the sidebar's edge to the window's.
const WORKTREES = pts(322, 0, 958, 800);

const COMPANION_TOTAL = (() => {
  const beat = companionBeat(0);
  return beat.holdIn + Math.ceil((lengthOf('companion') - (beat.from ?? 0)) / beat.rate) + 40;
})();

// ---- the timeline ----------------------------------------------------------------------------------------------

const LENGTHS = {
  title: 112,
  home: 150,
  profile: profileBeat.total,
  project: projectBeat.total,
  worktrees: 140,
  companion: COMPANION_TOTAL,
  montage: MONTAGE.length * MONTAGE_STEP + 40,
  outro: 170,
};
type Name = keyof typeof LENGTHS;
/// Scenes overlap by XFADE and dissolve through it.
const S = (() => {
  let at = 0;
  const out = {} as Record<Name, { from: number; duration: number }>;
  for (const [name, length] of Object.entries(LENGTHS) as Array<[Name, number]>) {
    out[name] = { from: at, duration: length + XFADE };
    at += length;
  }
  return out;
})();
export const DURATION = S.outro.from + S.outro.duration;

const Part: React.FC<{ name: Name; children: React.ReactNode }> = ({ name, children }) => (
  <Sequence from={S[name].from} durationInFrames={S[name].duration}>
    <Scene duration={S[name].duration}>{children}</Scene>
  </Sequence>
);

export const Promo: React.FC = () => (
  <AbsoluteFill>
    <Ground />

    <Part name="title">
      <Title />
    </Part>

    <Part name="home">
      <Shot
        stage="wide"
        rectAt={() => HOME}
        push={[1, 1.025, S.home.duration]}
        aside={<Caption where="wide" kicker="Home" headline="See what needs you, and what's working." note="Sessions you start here and the ones in your terminal, live, in one list." />}
      >
        <Still name="home" />
      </Shot>
    </Part>

    <Part name="profile">
      <Shot
        stage="side"
        rectAt={move(PROFILES, WINDOW, shotFrame(profileBeat, PROFILE_ADDED) - 4, shotFrame(profileBeat, PROFILE_ADDED) + 22)}
        aside={
          <>
            <Sequence durationInFrames={shotFrame(profileBeat, PROFILE_ADDED) + 2} layout="none">
              <Caption kicker="01 · Claude accounts" color={T.unread} headline="A personal plan and a work one?" note="Add each login as a profile. A profile is a Claude Code config folder with its own sign-in." outAt={shotFrame(profileBeat, PROFILE_ADDED) - 8} />
            </Sequence>
            <Sequence from={shotFrame(profileBeat, PROFILE_ADDED)} layout="none">
              <Caption kicker="01 · Claude accounts" color={T.unread} headline="Both, in one list." note="Work sessions join the list as soon as it's added, each one marked with its account's colour." />
            </Sequence>
          </>
        }
      >
        <Clip name="profile" beat={profileBeat} />
      </Shot>
    </Part>

    <Part name="project">
      <Shot
        stage="side"
        rectAt={() => MAIN}
        aside={<Caption kicker="02 · Projects" color={T.background} headline="Every project, its own page." note="Its sessions, worktrees, actions and defaults. payments-api runs on the Work account, at high effort, in a new worktree." />}
      >
        <Clip name="project" beat={projectBeat} />
      </Shot>
    </Part>

    <Part name="worktrees">
      <Shot
        stage="side"
        rectAt={() => WORKTREES}
        push={[1, 1.02, S.worktrees.duration]}
        aside={<Caption kicker="02 · Projects" color={T.background} headline="Know which worktrees can go." note="Changes, commits ahead, merged or pushed, and size on disk, grouped by what's safe to remove." />}
      >
        <Still name="worktrees" />
      </Shot>
    </Part>

    <Part name="companion">
      <Companion total={S.companion.duration} />
    </Part>

    <Part name="montage">
      <Montage />
    </Part>

    <Part name="outro">
      <Outro />
    </Part>

    <Progress />
  </AbsoluteFill>
);
