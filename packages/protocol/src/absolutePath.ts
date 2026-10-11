import { z } from 'zod';
import { isAbsolutePath, isLocalAbsolutePath } from './paths.ts';

/**
 * The platform the schemas validate for. They only run in Node (the engine and main); the renderer imports their
 * types alone, without Node's, hence the guarded read.
 */
const platform = (globalThis as { process?: { platform?: string } }).process?.platform ?? '';

/**
 * An absolute path from any platform (`/…` or `C:\…`), for folders written on another machine: a settings file
 * exported on a Mac and imported on Windows names Mac folders, which are then mapped to local ones.
 */
export const AnyAbsolutePath = z.string().min(1).max(4096).refine(isAbsolutePath, 'Must be an absolute path');

/** An absolute path on the platform the engine runs on (see `isLocalAbsolutePath`). */
export const AbsolutePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => isLocalAbsolutePath(path, platform), 'Must be an absolute path');
