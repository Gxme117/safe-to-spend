// expo-video is a native module: a build made before it was added hasn't got it, and importing it there throws. So it's
// loaded only when it's there; without it, Frank's openings are his pictures and recordings as before.
import type {VideoPlayer, VideoSource} from "expo-video";

let mod: typeof import("expo-video") | null = null;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only when it's there
try { mod = require("expo-video"); } catch { mod = null; }

/** The video player, or null where there's no video module (the same on every render, so it's still one hook). */
export const useVideoPlayer: (source: VideoSource) => VideoPlayer | null = mod?.useVideoPlayer ?? (() => null);

/** The view that draws it, or null where there's no video module. */
export const VideoView = mod?.VideoView ?? null;
