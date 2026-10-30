import type { ComponentType, SVGProps } from 'react';
import { otherProviderOf, PROVIDER_NAMES, type OptionalProvider, type SessionProvider } from '@seshboard/protocol/client';
import { CopilotIcon } from './CopilotIcon.tsx';

type ProviderIcon = ComponentType<{ size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'fill'>>;

/** Each provider's mark. A new provider fails to compile until it has one. */
export const PROVIDER_ICONS: Record<OptionalProvider, ProviderIcon> = { copilot: CopilotIcon };

/**
 * Marks a session of another provider (GitHub Copilot) on its row and in its header. Claude Code's sessions have none:
 * they are what Seshboard is for. Neutral, since no state is meant.
 */
export function ProviderMark({ session, size = 11, className = '' }: { session: { provider?: SessionProvider | null | undefined } | null | undefined; size?: number; className?: string }) {
  const provider = session ? otherProviderOf(session) : null;
  if (!provider) return null;
  const Icon = PROVIDER_ICONS[provider];
  const name = `${PROVIDER_NAMES[provider]} session`;
  return <Icon size={size} className={`shrink-0 ${className}`} role="img" aria-label={name} data-tooltip={name} data-provider-mark={provider} />;
}
