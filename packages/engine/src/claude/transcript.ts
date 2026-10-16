import type { ImageRef, TranscriptBlock, TranscriptMessage } from '@switchboard/protocol';
import { usageCounts } from '../usage/transcriptUsage.ts';
import { imageSize } from './imageSize.ts';

/** Receives image data found while normalising, so it can be served on demand instead of inline. */
export type ImageSink = (imageId: string, mediaType: string, data: string) => void;

/** The subset of the SDK's SessionMessage we rely on (plus `timestamp`, present at runtime). */
export interface RawSessionMessage {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  message: unknown;
  parent_tool_use_id: string | null;
  timestamp?: string;
  /** The summary Claude Code starts a conversation with after a compaction. */
  isCompactSummary?: boolean;
}

export const LIMITS = {
  /** Assistant/user prose is kept almost whole. */
  text: 200_000,
  /** Tool output is the bulk of large transcripts; the viewer only needs a preview. */
  toolResult: 8_000,
  /** Per string inside a tool input (e.g. the content of a Write). */
  toolInputString: 4_000,
} as const;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function clip(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

/** Deep-copies a JSON value, shortening long strings. */
export function clipJson(value: unknown, maxString: number): { value: Json; truncated: boolean } {
  let truncated = false;
  const walk = (v: unknown, depth: number): Json => {
    if (typeof v === 'string') {
      if (v.length <= maxString) return v;
      truncated = true;
      return v.slice(0, maxString);
    }
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'boolean' || v === null) return v;
    if (depth > 20) {
      truncated = true;
      return null;
    }
    if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));
    if (typeof v === 'object') {
      const out: { [key: string]: Json } = {};
      for (const [key, item] of Object.entries(v as Record<string, unknown>)) {
        if (item !== undefined) out[key] = walk(item, depth + 1);
      }
      return out;
    }
    return null;
  };
  return { value: walk(value, 0), truncated };
}

type RawBlock = { type?: unknown; [key: string]: unknown };

/** Base64 image source → reference (the data goes to the sink). */
function imageRef(source: unknown, imageId: string, sink: ImageSink | undefined): ImageRef | null {
  const s = source as { type?: unknown; media_type?: unknown; data?: unknown } | undefined;
  if (s?.type !== 'base64' || typeof s.data !== 'string' || typeof s.media_type !== 'string') return null;
  sink?.(imageId, s.media_type, s.data);
  return { imageId, mediaType: s.media_type, bytes: Math.floor((s.data.length * 3) / 4), ...imageSize(s.data) };
}

function toolResultImages(content: unknown, idPrefix: string, sink: ImageSink | undefined): ImageRef[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: RawBlock, i) => {
    if (part?.type !== 'image') return [];
    const ref = imageRef(part.source, `${idPrefix}:${i}`, sink);
    return ref ? [ref] : [];
  });
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: RawBlock) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : part?.type === 'image' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function normaliseBlock(block: RawBlock, imageId: string, sink: ImageSink | undefined): TranscriptBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: clip(String(block.text ?? ''), LIMITS.text).text };
    case 'thinking':
      return { type: 'thinking', text: clip(String(block.thinking ?? ''), LIMITS.text).text };
    case 'redacted_thinking':
      return { type: 'thinking', text: '' };
    case 'tool_use':
    case 'server_tool_use':
    case 'mcp_tool_use': {
      const { value, truncated } = clipJson(block.input ?? {}, LIMITS.toolInputString);
      return { type: 'tool_use', id: String(block.id ?? ''), name: String(block.name ?? 'unknown'), input: value, truncated };
    }
    case 'tool_result':
    case 'mcp_tool_result': {
      const { text, truncated } = clip(toolResultText(block.content), LIMITS.toolResult);
      return {
        type: 'tool_result',
        toolUseId: String(block.tool_use_id ?? ''),
        isError: block.is_error === true,
        text,
        truncated,
        images: toolResultImages(block.content, imageId, sink),
      };
    }
    case 'image': {
      const source = block.source as { media_type?: unknown } | undefined;
      return { type: 'image', mediaType: typeof source?.media_type === 'string' ? source.media_type : null, ref: imageRef(block.source, `${imageId}:-1`, sink) };
    }
    default:
      return { type: 'unknown', kind: typeof block.type === 'string' ? block.type : 'unknown' };
  }
}

function contentBlocks(message: unknown, uuid: string, sink: ImageSink | undefined): TranscriptBlock[] {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return content ? [{ type: 'text', text: clip(content, LIMITS.text).text }] : [];
  if (Array.isArray(content)) {
    return content.flatMap((b, i) => (b && typeof b === 'object' ? [normaliseBlock(b as RawBlock, `${uuid}:${i}`, sink)] : []));
  }
  return [];
}

/**
 * Converts an SDK session message into the renderer-friendly, size-bounded
 * shape. Images become references; their data goes to `sink`.
 */
export function normaliseMessage(raw: RawSessionMessage, sink?: ImageSink): TranscriptMessage {
  const timestamp = raw.timestamp ? Date.parse(raw.timestamp) : NaN;
  const model = (raw.message as { model?: unknown } | null)?.model;
  let blocks = contentBlocks(raw.message, raw.uuid, sink);
  if (raw.type === 'system' && blocks.length === 0) {
    const subtype = (raw.message as { subtype?: unknown } | null)?.subtype;
    blocks = [{ type: 'unknown', kind: typeof subtype === 'string' ? subtype : 'system' }];
  }
  const counts = raw.type === 'assistant' ? usageCounts(raw.message as Parameters<typeof usageCounts>[0]) : null;
  const responseId = (raw.message as { id?: unknown } | null)?.id;
  return {
    uuid: raw.uuid,
    role: raw.type,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    parentToolUseId: raw.parent_tool_use_id ?? null,
    model: typeof model === 'string' ? model : null,
    blocks,
    usage: counts
      ? {
          input: counts.input,
          output: counts.output,
          cacheRead: counts.cacheRead,
          cacheCreation: counts.cacheWrite,
          ...(typeof responseId === 'string' && responseId ? { id: responseId } : {}),
        }
      : null,
  };
}
