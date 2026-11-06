import { statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ImageAttachment } from '@seshboard/protocol';
import type { UserInput } from './protocol.ts';

const MENTION = /^@(?:"([^"\n]+)"|([^\s"]\S*))$/;

/**
 * The files and folders a message mentions, as Codex's `mention` inputs. The message box writes them on one line of `@`
 * mentions (`promptWithContext`: relative to the session's folder, folders ending in `/`, a range as `#L12-40`, quoted
 * when the path has spaces), as Claude Code reads them; the line stays in the text too. Only a paragraph made of
 * mentions alone counts, so an `@` in what you typed is left as words. A path that isn't there is left out. The name is
 * the mention as typed, so the transcript (`codexEvents.ts`) sees it in the text and doesn't add it again.
 */
export function codexMentions(text: string, cwd: string): UserInput[] {
  const mentions: UserInput[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const words = paragraph.trim().match(/@"[^"\n]+"|\S+/g) ?? [];
    const matches = words.map((word) => MENTION.exec(word));
    if (!words.length || matches.some((m) => !m)) continue;
    for (const match of matches) {
      const target = match![1] ?? match![2]!;
      // A range of lines is for the reader: Codex gets the file, and reads the lines the text names.
      const bare = target.replace(/#L\d+(?:-\d+)?$/, '').replace(/[\\/]+$/, '');
      if (!bare) continue;
      const path = isAbsolute(bare) ? bare : join(cwd, bare);
      if (statSync(path, { throwIfNoEntry: false })) mentions.push({ type: 'mention', name: target, path });
    }
  }
  return mentions;
}

/** A message as `turn/start`'s input: its text, the files it mentions, and pasted images as data URLs. */
export function codexInput(text: string, attachments: readonly ImageAttachment[], cwd: string): UserInput[] {
  return [
    { type: 'text', text, text_elements: [] },
    ...codexMentions(text, cwd),
    ...attachments.map((a): UserInput => ({ type: 'image', url: `data:${a.mediaType};base64,${a.data}` })),
  ];
}
