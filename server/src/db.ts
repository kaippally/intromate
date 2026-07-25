import Database from 'better-sqlite3';
import { join } from 'node:path';
import { DATA } from './paths.js';

// The Flash-model document store. Normalised because the model IS relational: a document owns
// library symbols; each symbol owns a timeline (layers); each layer owns keyframes; each keyframe
// owns display nodes. An "instance" is simply a node whose kind is 'instance' pointing at a symbol
// — exactly Flash's Library→Stage instantiation, no separate placement table.
//
// The root of a document is a symbol of type 'scene' (the Main Timeline). MovieClip / Graphic /
// Button symbols are the reusable ones. A Graphic's timeline is slaved to its parent; a MovieClip's
// runs independently (that distinction lives in the resolver, not the schema).

export const db = new Database(join(DATA, 'flash.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS document (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  fps         INTEGER NOT NULL DEFAULT 24,
  width       INTEGER NOT NULL DEFAULT 1920,
  height      INTEGER NOT NULL DEFAULT 1080,
  bg          TEXT NOT NULL DEFAULT '#000000',
  root_symbol TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Library symbols. 'scene' = a Main Timeline; the others are reusable.
CREATE TABLE IF NOT EXISTS symbol (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'movieclip',  -- scene | movieclip | graphic | button
  reg_x       REAL NOT NULL DEFAULT 0,            -- registration point (local origin)
  reg_y       REAL NOT NULL DEFAULT 0,
  ord         INTEGER NOT NULL DEFAULT 0          -- Library sort order
);
CREATE INDEX IF NOT EXISTS symbol_doc ON symbol(document_id);

-- A timeline layer. ord ascending = bottom→top of the z-order (Flash: index 0 is the bottom).
CREATE TABLE IF NOT EXISTS layer (
  id         TEXT PRIMARY KEY,
  symbol_id  TEXT NOT NULL REFERENCES symbol(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  ord        INTEGER NOT NULL DEFAULT 0,
  kind       TEXT NOT NULL DEFAULT 'normal',      -- normal | mask | masked | guide | folder
  parent_id  TEXT REFERENCES layer(id) ON DELETE CASCADE,  -- folder / mask grouping
  locked     INTEGER NOT NULL DEFAULT 0,
  visible    INTEGER NOT NULL DEFAULT 1,
  outlined   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS layer_symbol ON layer(symbol_id);

-- A keyframe holds the layer's state at 'frame'. Plain frames between keyframes hold the previous
-- keyframe's state (the resolver looks up the active keyframe as max(frame) <= target).
CREATE TABLE IF NOT EXISTS keyframe (
  id          TEXT PRIMARY KEY,
  layer_id    TEXT NOT NULL REFERENCES layer(id) ON DELETE CASCADE,
  frame       INTEGER NOT NULL,                   -- 0-based start frame of this keyframe
  kind        TEXT NOT NULL DEFAULT 'key',        -- key | blank
  tween       TEXT NOT NULL DEFAULT 'none',       -- none | motion | classic | shape
  ease        TEXT,                               -- JSON [x1,y1,x2,y2] or named ease
  label       TEXT,                               -- timeline label (also a gotoAndPlay target)
  script      TEXT,                               -- frame script (logic layer, later)
  sound_asset TEXT REFERENCES asset(id) ON DELETE SET NULL,
  sound_sync  TEXT NOT NULL DEFAULT 'event'       -- event | stream | start | stop
);
CREATE INDEX IF NOT EXISTS keyframe_layer ON keyframe(layer_id, frame);

-- A display node on a keyframe. token is a per-layer stable id so a tween pairs the same logical
-- object across its start and end keyframes. kind 'instance' + symbol_ref = a Library instance.
CREATE TABLE IF NOT EXISTS node (
  id          TEXT PRIMARY KEY,
  keyframe_id TEXT NOT NULL REFERENCES keyframe(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,                      -- tween pairing key (stable within a layer)
  ord         INTEGER NOT NULL DEFAULT 0,         -- z within the layer's keyframe
  kind        TEXT NOT NULL,                      -- instance | shape | text | image | video | group
  symbol_ref  TEXT REFERENCES symbol(id) ON DELETE SET NULL,
  asset_id    TEXT REFERENCES asset(id) ON DELETE SET NULL,
  name        TEXT,                               -- instance name (scriptable handle, later)
  x           REAL NOT NULL DEFAULT 0,
  y           REAL NOT NULL DEFAULT 0,
  scale_x     REAL NOT NULL DEFAULT 1,
  scale_y     REAL NOT NULL DEFAULT 1,
  rotation    REAL NOT NULL DEFAULT 0,            -- degrees
  skew_x      REAL NOT NULL DEFAULT 0,
  skew_y      REAL NOT NULL DEFAULT 0,
  alpha       REAL NOT NULL DEFAULT 1,            -- 0..1 color-transform alpha
  blend       TEXT NOT NULL DEFAULT 'normal',
  loop_mode   TEXT NOT NULL DEFAULT 'loop',       -- graphic only: loop | playonce | single
  first_frame INTEGER NOT NULL DEFAULT 0,         -- graphic only: local start frame
  rot_x       REAL NOT NULL DEFAULT 0,            -- 3D perspective tilt (pitch), degrees
  rot_y       REAL NOT NULL DEFAULT 0,            -- 3D perspective tilt (yaw), degrees
  hold        TEXT,                               -- JSON [param,…]: channels frozen across the tween
  props       TEXT                                -- JSON: text/font/fill/stroke/effect preset, etc.
);
CREATE INDEX IF NOT EXISTS node_keyframe ON node(keyframe_id);

-- Library media (non-symbol): images, video, audio, fonts. url points at the media server
-- (IntroMate's own store or a read-only Studio Mate library), never inline data.
CREATE TABLE IF NOT EXISTS asset (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,                      -- image | video | audio | font | bitmap
  url         TEXT NOT NULL,
  meta        TEXT                                -- JSON: natural size, duration, etc.
);
CREATE INDEX IF NOT EXISTS asset_doc ON asset(document_id);
`);

// Migrate an already-created node table to the newer columns (no-op on a fresh DB).
for (const col of ['rot_x REAL NOT NULL DEFAULT 0', 'rot_y REAL NOT NULL DEFAULT 0', 'hold TEXT', 'z REAL NOT NULL DEFAULT 0']) {
  try { db.exec(`ALTER TABLE node ADD COLUMN ${col}`); } catch { /* already present */ }
}
// Per-symbol playback boundary: at loop_frame the playhead loops back to 0 or stops.
for (const col of ['loop_frame INTEGER', 'loop_action TEXT']) {
  try { db.exec(`ALTER TABLE symbol ADD COLUMN ${col}`); } catch { /* already present */ }
}
