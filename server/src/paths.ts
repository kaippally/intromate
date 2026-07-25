import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(__dirname, '../..');
export const DATA = resolve(ROOT, 'data');
export const PROJECTS_DIR = resolve(DATA, 'projects');
export const MEDIA_DIR = resolve(DATA, 'media');
export const EXPORTS_DIR = resolve(DATA, 'exports');
export const CLIENT_DIST = resolve(ROOT, 'client/dist');

// Studio Mate is the canonical store for fonts, images and audio. IntroMate reads them
// read-only so an intro uses the same assets as the L3/Slides look — nothing is written there.
export const SM_ROOT = process.env.SM_ROOT ?? 'C:/KC_Assets/StudioMate';
export const SM_FONTS = resolve(SM_ROOT, 'data/fonts');
export const SM_IMAGES = resolve(SM_ROOT, 'data/media/images');
export const SM_AUDIO = resolve(SM_ROOT, 'data/media/audio');
export const SM_MUSIC = resolve(SM_ROOT, 'data/Music');
export const SM_VIDEOS = resolve(SM_ROOT, 'data/media/videos');
export const SM_CLIPS = resolve(SM_ROOT, 'data/StreamCapture');

for (const d of [PROJECTS_DIR, MEDIA_DIR, EXPORTS_DIR]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}
