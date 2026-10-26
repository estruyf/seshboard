import type { ProfileColor } from '@seshboard/protocol/client';
import { useMultipleProfiles, useProfile } from '../../state/profilesStore.ts';

/** Full class names, so Tailwind sees every one. */
export const PROFILE_DOT: Record<ProfileColor, string> = {
  yellow: 'bg-profile-yellow',
  blue: 'bg-profile-blue',
  green: 'bg-profile-green',
  purple: 'bg-profile-purple',
  red: 'bg-profile-red',
  orange: 'bg-profile-orange',
  gray: 'bg-profile-gray',
};

export const PROFILE_TEXT: Record<ProfileColor, string> = {
  yellow: 'text-profile-yellow',
  blue: 'text-profile-blue',
  green: 'text-profile-green',
  purple: 'text-profile-purple',
  red: 'text-profile-red',
  orange: 'text-profile-orange',
  gray: 'text-profile-gray',
};

export function ProfileDot({ color, size = 7 }: { color: ProfileColor; size?: number }) {
  return <span className={`inline-block shrink-0 rounded-full ${PROFILE_DOT[color]}`} style={{ width: size, height: size }} aria-hidden />;
}

/**
 * Which Claude profile (account) something uses: a coloured dot, with the name unless `dotOnly`.
 * Renders nothing while there is only one profile.
 */
export function ProfileBadge({ profileId, dotOnly = false, className = '' }: { profileId: string | null | undefined; dotOnly?: boolean; className?: string }) {
  const multiple = useMultipleProfiles();
  const profile = useProfile(profileId);
  if (!multiple || !profile) return null;
  const title = `Claude profile: ${profile.name}${profile.account?.email ? ` (${profile.account.email})` : ''}`;
  if (dotOnly) {
    return (
      <span role="img" data-tooltip={title} aria-label={title} className={`flex shrink-0 items-center ${className}`} data-profile-badge={profile.id}>
        <ProfileDot color={profile.color} />
      </span>
    );
  }
  return (
    <span data-tooltip={title} className={`flex min-w-0 shrink-0 items-center gap-1 ${PROFILE_TEXT[profile.color]} ${className}`} data-profile-badge={profile.id}>
      <ProfileDot color={profile.color} />
      <span className="truncate">{profile.name}</span>
    </span>
  );
}
