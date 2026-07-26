# Architecture — SQL Schema

The Flash document is stored **normalised** in SQLite (`data/flash.db`, `better-sqlite3`). Schema and
migrations: [../../server/src/db.ts](../../server/src/db.ts). Read/write:
[../../server/src/documents.ts](../../server/src/documents.ts).

## Why normalised

The model is relational (a document owns symbols; symbols own layers; layers own keyframes; keyframes
own nodes). Normalising keeps it queryable (`sqlite3 data/flash.db "SELECT …"`) and makes an atomic
save cheap. The client edits an in-memory JSON tree (with undo); the server flattens it into the
tables.

## Tables

```
document(id PK, name, fps, width, height, bg, root_symbol, created_at, updated_at)

symbol(id PK, document_id FK→document, name, type, reg_x, reg_y, ord,
       loop_frame, loop_action)          -- playback boundary: loop back to 0 | stop
layer(id PK, symbol_id FK→symbol, name, ord, kind, parent_id FK→layer, locked, visible, outlined)
keyframe(id PK, layer_id FK→layer, frame, kind, tween, ease, label, script,
         sound_asset FK→asset, sound_sync)
node(id PK, keyframe_id FK→keyframe, token, ord, kind,
     symbol_ref FK→symbol, asset_id FK→asset, name,
     x, y, scale_x, scale_y, rotation, skew_x, skew_y, rot_x, rot_y, z,
     hold, alpha, blend, loop_mode, first_frame, props)

asset(id PK, document_id FK→document, name, kind, url, meta)
```

- All child FKs `ON DELETE CASCADE` (deleting a document removes its whole tree).
- `node.symbol_ref` → `symbol.id` is how an instance references its master.
- JSON columns: `keyframe.ease` (`[x1,y1,x2,y2]`), `node.hold` (`["x","rotY",…]`), `node.props`,
  `asset.meta`.
- Indexes: `symbol(document_id)`, `layer(symbol_id)`, `keyframe(layer_id, frame)`,
  `node(keyframe_id)`, `asset(document_id)`.

## The two invariants of the storage layer

1. **Atomic write with deferred FKs.** `PUT` runs one transaction that upserts the document, clears
   its symbols/assets (cascades), and re-inserts the tree. Because an `instance` node can reference a
   symbol inserted **later** in the same tree, the transaction sets `PRAGMA defer_foreign_keys = ON`
   so insertion order doesn't matter. *(This was BUG-class "FOREIGN KEY constraint failed" on save.)*
2. **Additive migrations.** New columns are added with guarded `ALTER TABLE … ADD COLUMN` wrapped in
   try/catch, so an existing `flash.db` upgrades in place. `rot_x`, `rot_y`, `z`, `hold` were added
   this way. **When you add a model field that must persist: add it to (a) the `CREATE TABLE`, (b) the
   `ALTER TABLE` migration list, (c) the read mapping, and (d) the insert statement + values.** Missing
   any of the four silently drops the field on save. *(This was a real bug: `hold`/`rotX`/`rotY`
   didn't persist until all four were updated.)*

## Read / write flow

- **Read** (`readDocument`) issues a few indexed queries and rebuilds the nested JSON tree the client
  expects (camelCase, `hold`/`ease`/`props`/`meta` JSON-parsed).
- **Write** (`writeDocument`) is the transaction above; returns the doc with a fresh `updatedAt`.
- **Create** (`createDocument`) seeds a `scene` symbol with one `normal` layer holding a single
  `blank` keyframe at frame 0.

## API

| Method | Route | Does |
|---|---|---|
| GET | `/api/doc` | list `{id,name,fps,width,height,updatedAt}` |
| POST | `/api/doc` | create; body `{name,fps?,width?,height?}` |
| GET | `/api/doc/:id` | load the nested tree |
| PUT | `/api/doc/:id` | save the whole tree (atomic) |
| DELETE | `/api/doc/:id` | delete (cascades) |

The client autosaves the whole tree ~0.8 s after the last edit
([../../client/src/flash/FlashApp.tsx](../../client/src/flash/FlashApp.tsx)).

## Inspecting

```
sqlite3 data/flash.db ".tables"
sqlite3 data/flash.db "SELECT id,name,fps FROM document;"
sqlite3 data/flash.db "SELECT kind,x,y,props FROM node LIMIT 5;"
```
