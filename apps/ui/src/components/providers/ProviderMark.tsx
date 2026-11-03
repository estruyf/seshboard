import type { ComponentType, SVGProps } from 'react';
import { PROVIDER_NAMES, providerOf, type SessionProvider } from '@seshboard/protocol/client';
import { ClaudeIcon } from './ClaudeIcon.tsx';
import { CopilotIcon } from './CopilotIcon.tsx';

type ProviderIcon = ComponentType<{ size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'fill'>>;

/** Each provider's mark. A new provider fails to compile until it has one. */
export const PROVIDER_ICONS: Record<SessionProvider, ProviderIcon> = { claude: ClaudeIcon, copilot: CopilotIcon };

/**
 * Says whose a session is (Claude Code's, GitHub Copilot's) on its row, and another provider's in its header. Neutral,
 * since no state is meant. Nothing without a session (a session on another computer).
 */
export function ProviderMark({ session, size = 11, className = '' }: { session: { provider?: SessionProvider | null | undefined } | null | undefined; size?: number; className?: string }) {
  if (!session) return null;
  const provider = providerOf(session);
  const Icon = PROVIDER_ICONS[provider];
  const name = `${PROVIDER_NAMES[provider]} session`;
  return <Icon size={size} className={`shrink-0 ${className}`} role="img" aria-label={name} data-tooltip={name} data-provider-mark={provider} />;
}
