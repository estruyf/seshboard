import { Bug, Check, FlaskConical, GitCommitHorizontal, GitPullRequest, Globe, Package, Play, Rocket, Sparkles, SquareTerminal, Upload, Wrench, type LucideIcon } from 'lucide-react';
import type { ActionIcon } from '@seshboard/protocol/client';

/** The icon of each action icon choice. Its own module, so pure code (the palette's commands) can use it. */
export const ACTION_ICON: Record<ActionIcon, LucideIcon> = {
  play: Play,
  rocket: Rocket,
  'git-commit': GitCommitHorizontal,
  'git-pull-request': GitPullRequest,
  upload: Upload,
  flask: FlaskConical,
  package: Package,
  terminal: SquareTerminal,
  sparkles: Sparkles,
  wrench: Wrench,
  globe: Globe,
  bug: Bug,
  check: Check,
};
