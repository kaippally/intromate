import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './paths.js';

// App settings persisted to data/settings.json: general defaults, API keys, and an extra media
// folder that gets scanned alongside the built-in libraries. Cached in memory; written on change.

const FILE = join(DATA, 'settings.json');

export interface Settings {
  mediaFolder?: string;                 // extra folder scanned for Import (absolute path)
  defaultFps?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  autosave?: boolean;
  keys?: Record<string, string>;        // named API/service keys
}

const DEFAULTS: Settings = { defaultFps: 24, defaultWidth: 1920, defaultHeight: 1080, autosave: true, keys: {} };

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  let loaded: Settings;
  try { loaded = { ...DEFAULTS, ...(existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}) }; }
  catch { loaded = { ...DEFAULTS }; }
  cache = loaded;
  return loaded;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings(), ...patch };
  if (patch.keys) next.keys = { ...getSettings().keys, ...patch.keys };
  cache = next;
  writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

// The configured extra media folder, only if it exists on disk.
export function getMediaFolder(): string | null {
  const f = getSettings().mediaFolder?.trim();
  return f && existsSync(f) ? f : null;
}
