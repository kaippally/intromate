import { randomUUID } from 'node:crypto';
import { db } from './db.js';

// Read/write the Flash document as one nested tree. The client edits it in memory (with undo/redo)
// and autosaves the whole tree; the server flattens it into the normalised tables inside a single
// transaction, so a save is atomic and the SQL store stays queryable.

const uid = () => randomUUID().slice(0, 12);
const bool = (v: unknown) => (v ? 1 : 0);
const jparse = (s: unknown) => (s == null ? null : JSON.parse(String(s)));

export interface DocMeta { id: string; name: string; fps: number; width: number; height: number; updatedAt: number }

export function listDocuments(): DocMeta[] {
  return db.prepare(`SELECT id, name, fps, width, height, updated_at AS updatedAt FROM document ORDER BY updated_at DESC`).all() as DocMeta[];
}

export function readDocument(id: string): any | null {
  const doc = db.prepare(`SELECT * FROM document WHERE id = ?`).get(id) as any;
  if (!doc) return null;

  const symbols = db.prepare(`SELECT * FROM symbol WHERE document_id = ? ORDER BY ord`).all(id) as any[];
  const layers = db.prepare(`SELECT l.* FROM layer l JOIN symbol s ON s.id = l.symbol_id WHERE s.document_id = ? ORDER BY l.ord`).all(id) as any[];
  const keyframes = db.prepare(`SELECT k.* FROM keyframe k JOIN layer l ON l.id = k.layer_id JOIN symbol s ON s.id = l.symbol_id WHERE s.document_id = ? ORDER BY k.frame`).all(id) as any[];
  const nodes = db.prepare(`SELECT n.* FROM node n JOIN keyframe k ON k.id = n.keyframe_id JOIN layer l ON l.id = k.layer_id JOIN symbol s ON s.id = l.symbol_id WHERE s.document_id = ? ORDER BY n.ord`).all(id) as any[];
  const assets = db.prepare(`SELECT * FROM asset WHERE document_id = ? ORDER BY name`).all(id) as any[];

  const nodesByKf = new Map<string, any[]>();
  for (const n of nodes) {
    const arr = nodesByKf.get(n.keyframe_id) ?? [];
    arr.push({
      id: n.id, token: n.token, ord: n.ord, kind: n.kind,
      symbolRef: n.symbol_ref, assetId: n.asset_id, name: n.name,
      x: n.x, y: n.y, scaleX: n.scale_x, scaleY: n.scale_y, rotation: n.rotation, skewX: n.skew_x, skewY: n.skew_y,
      rotX: n.rot_x, rotY: n.rot_y, z: n.z, hold: jparse(n.hold),
      alpha: n.alpha, blend: n.blend, loopMode: n.loop_mode, firstFrame: n.first_frame, props: jparse(n.props),
    });
    nodesByKf.set(n.keyframe_id, arr);
  }
  const kfByLayer = new Map<string, any[]>();
  for (const k of keyframes) {
    const arr = kfByLayer.get(k.layer_id) ?? [];
    arr.push({
      id: k.id, frame: k.frame, kind: k.kind, tween: k.tween, ease: jparse(k.ease),
      label: k.label, script: k.script, soundAssetId: k.sound_asset, soundSync: k.sound_sync,
      nodes: nodesByKf.get(k.id) ?? [],
    });
    kfByLayer.set(k.layer_id, arr);
  }
  const layersBySymbol = new Map<string, any[]>();
  for (const l of layers) {
    const arr = layersBySymbol.get(l.symbol_id) ?? [];
    arr.push({
      id: l.id, name: l.name, ord: l.ord, kind: l.kind, parentId: l.parent_id,
      locked: !!l.locked, visible: !!l.visible, outlined: !!l.outlined,
      keyframes: kfByLayer.get(l.id) ?? [],
    });
    layersBySymbol.set(l.symbol_id, arr);
  }

  return {
    id: doc.id, name: doc.name, fps: doc.fps, width: doc.width, height: doc.height, bg: doc.bg,
    rootSymbol: doc.root_symbol, createdAt: doc.created_at, updatedAt: doc.updated_at,
    assets: assets.map(a => ({ id: a.id, name: a.name, kind: a.kind, url: a.url, meta: jparse(a.meta) })),
    symbols: symbols.map(s => ({
      id: s.id, name: s.name, type: s.type, regX: s.reg_x, regY: s.reg_y, ord: s.ord,
      layers: layersBySymbol.get(s.id) ?? [],
    })),
  };
}

const insDoc = () => db.prepare(`INSERT INTO document (id,name,fps,width,height,bg,root_symbol,created_at,updated_at) VALUES (@id,@name,@fps,@width,@height,@bg,@root_symbol,@created_at,@updated_at)
  ON CONFLICT(id) DO UPDATE SET name=@name,fps=@fps,width=@width,height=@height,bg=@bg,root_symbol=@root_symbol,updated_at=@updated_at`);

// Replace-in-transaction: documents are small, so we clear a document's children and re-insert the
// tree. Cascades handle the delete; the whole thing is one atomic transaction.
const writeTx = db.transaction((doc: any) => {
  const now = Date.now();
  // An instance node can reference a symbol defined later in the same tree (Scene 1 holding an
  // instance of Object 1). Defer FK enforcement to commit so insertion order doesn't matter.
  db.pragma('defer_foreign_keys = ON');
  insDoc().run({
    id: doc.id, name: doc.name, fps: doc.fps | 0, width: doc.width | 0, height: doc.height | 0,
    bg: doc.bg ?? '#000000', root_symbol: doc.rootSymbol ?? null,
    created_at: doc.createdAt ?? now, updated_at: now,
  });
  db.prepare(`DELETE FROM symbol WHERE document_id = ?`).run(doc.id);
  db.prepare(`DELETE FROM asset WHERE document_id = ?`).run(doc.id);

  const insSym = db.prepare(`INSERT INTO symbol (id,document_id,name,type,reg_x,reg_y,ord) VALUES (?,?,?,?,?,?,?)`);
  const insLayer = db.prepare(`INSERT INTO layer (id,symbol_id,name,ord,kind,parent_id,locked,visible,outlined) VALUES (?,?,?,?,?,?,?,?,?)`);
  const insKf = db.prepare(`INSERT INTO keyframe (id,layer_id,frame,kind,tween,ease,label,script,sound_asset,sound_sync) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insNode = db.prepare(`INSERT INTO node (id,keyframe_id,token,ord,kind,symbol_ref,asset_id,name,x,y,scale_x,scale_y,rotation,skew_x,skew_y,rot_x,rot_y,z,hold,alpha,blend,loop_mode,first_frame,props) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insAsset = db.prepare(`INSERT INTO asset (id,document_id,name,kind,url,meta) VALUES (?,?,?,?,?,?)`);

  for (const a of doc.assets ?? []) insAsset.run(a.id, doc.id, a.name, a.kind, a.url, a.meta ? JSON.stringify(a.meta) : null);

  for (const s of doc.symbols ?? []) {
    insSym.run(s.id, doc.id, s.name, s.type, s.regX ?? 0, s.regY ?? 0, s.ord ?? 0);
    for (const l of s.layers ?? []) {
      insLayer.run(l.id, s.id, l.name, l.ord ?? 0, l.kind ?? 'normal', l.parentId ?? null, bool(l.locked), bool(l.visible ?? true), bool(l.outlined));
      for (const k of l.keyframes ?? []) {
        insKf.run(k.id, l.id, k.frame | 0, k.kind ?? 'key', k.tween ?? 'none', k.ease ? JSON.stringify(k.ease) : null, k.label ?? null, k.script ?? null, k.soundAssetId ?? null, k.soundSync ?? 'event');
        for (const n of k.nodes ?? []) {
          insNode.run(n.id, k.id, n.token ?? n.id, n.ord ?? 0, n.kind, n.symbolRef ?? null, n.assetId ?? null, n.name ?? null,
            n.x ?? 0, n.y ?? 0, n.scaleX ?? 1, n.scaleY ?? 1, n.rotation ?? 0, n.skewX ?? 0, n.skewY ?? 0,
            n.rotX ?? 0, n.rotY ?? 0, n.z ?? 0, n.hold ? JSON.stringify(n.hold) : null,
            n.alpha ?? 1, n.blend ?? 'normal', n.loopMode ?? 'loop', n.firstFrame ?? 0, n.props ? JSON.stringify(n.props) : null);
        }
      }
    }
  }
  return now;
});

export function writeDocument(doc: any): any {
  const updatedAt = writeTx(doc);
  return { ...doc, updatedAt };
}

export function deleteDocument(id: string): boolean {
  return db.prepare(`DELETE FROM document WHERE id = ?`).run(id).changes > 0;
}

// A fresh document: a Main Timeline scene with one layer holding a single keyframe at frame 0.
export function createDocument(name: string, opts?: { fps?: number; width?: number; height?: number }): any {
  const id = uid();
  const rootId = uid();
  const doc = {
    id, name, fps: opts?.fps ?? 24, width: opts?.width ?? 1920, height: opts?.height ?? 1080,
    bg: '#101018', rootSymbol: rootId,
    assets: [],
    symbols: [{
      id: rootId, name: 'Scene 1', type: 'scene', regX: 0, regY: 0, ord: 0,
      layers: [{
        id: uid(), name: 'Layer 1', ord: 0, kind: 'normal', parentId: null,
        locked: false, visible: true, outlined: false,
        keyframes: [{ id: uid(), frame: 0, kind: 'blank', tween: 'none', ease: null, label: null, script: null, soundAssetId: null, soundSync: 'event', nodes: [] }],
      }],
    }],
  };
  return writeDocument(doc);
}
