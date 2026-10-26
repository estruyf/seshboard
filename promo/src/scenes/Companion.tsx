import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Cable } from '../components/Cable';
import { Caption } from '../components/Caption';
import { fit, pts } from '../components/Framed';
import { Beat, Clip, LIGHTS, shotFrame, Window } from '../components/Shot';
import { T } from '../theme';

// VS Code and Seshboard, recorded together on one clock (capture.mjs, `companion`), so frame N of one is the same
// moment as frame N of the other. Side by side rather than overlapping: the cable that says "this went there" runs
// through the gap between them and plugs into the windows' edges, never over anything the apps drew.

/// VS Code: from the tab bar (just under the title bar) to the gap after line 19, the editor's lines being 24pt
/// apart from 99; its right edge is the window's, where the companion's button sits in the editor title.
const CODE = pts(352, 35, 928, 508);
/// Seshboard: the action pills and the message box the chip lands in, edge to edge of the box, down to the
/// window's own bottom edge.
const BOARD = pts(430, 604, 740, 196);

const codeBox = (() => {
  const b = fit(CODE.w / CODE.h, 960, 620);
  return { left: 64, top: 330, width: b.w, height: b.h };
})();
const boardBox = (() => {
  const b = fit(BOARD.w / BOARD.h, 820, 400);
  return { left: 1920 - 64 - b.w, top: 560, width: b.w, height: b.h };
})();

/// Where something at window point (x, y) of a crop lands in the frame.
const at = (box: typeof codeBox, crop: typeof CODE, x: number, y: number) => ({
  x: box.left + ((x * 2 - crop.x) * box.width) / crop.w,
  y: box.top + ((y * 2 - crop.y) * box.height) / crop.h,
});

/// The recording frame of the click on the companion's button; the chip shows up in Seshboard on the same frame.
/// Read off `node scripts/activity.mjs companion` (the chip) and `companion-code 0.05` (the click's ripple) after
/// every capture.
export const CLICK = 113;

export const companionBeat = (total: number): Beat => ({ holdIn: 20, from: 34, rate: 0.85, total });

export const Companion: React.FC<{ total: number }> = ({ total }) => {
  const beat = companionBeat(total);
  const button = at(codeBox, CODE, 1209, 49);
  const chip = at(boardBox, BOARD, 470, 672);
  return (
    <AbsoluteFill>
      <Caption
        where="wide"
        kicker="03 · VS Code companion"
        color={T.unread}
        headline="Select it in VS Code. Ask about it here."
        note="The lines arrive in the session as a chip. Nothing goes to Claude until you press Send."
      />
      <Window box={codeBox} rect={CODE} lights={LIGHTS.code} enter={0} from={-1}>
        <Clip name="companion-code" beat={beat} />
      </Window>
      <Window box={boardBox} rect={BOARD} lights={null} enter={6} from={1}>
        <Clip name="companion" beat={beat} />
      </Window>
      {/* Out of the right edge of VS Code by its button, into the left edge of Seshboard by the message box. */}
      <Cable
        from={{ x: codeBox.left + codeBox.width + 2, y: button.y }}
        to={{ x: boardBox.left - 2, y: chip.y }}
        start={shotFrame(beat, CLICK)}
        length={12}
        sag={40}
      />
    </AbsoluteFill>
  );
};
