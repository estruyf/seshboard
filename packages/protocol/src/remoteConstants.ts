/**
 * Remote's limits that the remote app needs as values too, without zod (see `remoteClient.ts`).
 *
 * The most images one message from a phone takes, and the most base64 each may be. The phone resizes a photo to
 * 2,000px on its longest side (JPEG at 0.8) first, so a few fit in one line of the channel (4 MB, `remoteServer.ts`),
 * which splits it into frames itself.
 */
export const REMOTE_MAX_IMAGES = 4;
export const REMOTE_IMAGE_BYTES = 900_000;
