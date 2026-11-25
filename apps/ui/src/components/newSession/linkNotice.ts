/** From this length on, the notice says how long a prompt from a link is (it may not all be on screen). */
export const LONG_LINK_PROMPT = 280;

/** The line under the message box while it holds a prompt from a `seshboard://` link, or a site action in the browser (`from`). */
export function linkNoticeText(length: number, from?: 'browser'): string {
  const size = length >= LONG_LINK_PROMPT ? ` (${length.toLocaleString('en-US')} characters)` : '';
  return `Prompt from ${from === 'browser' ? 'a page in the browser' : 'an external link'}${size}. Read it before you start the session.`;
}
