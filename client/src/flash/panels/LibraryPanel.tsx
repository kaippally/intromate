import { useState } from 'react';
import type { FlashDoc, Symbol as FSymbol } from '../model';
import { MediaPicker } from '../../components/MediaPicker';
import type { MediaItem } from '../../types';

const TYPE_ICON: Record<string, string> = { scene: '🎬', movieclip: '🎞', graphic: '▣', button: '🔘' };

// The Object Library — the canonical repository of symbols (each its own timeline) and imported
// media assets. Double-click a symbol to open its timeline in a tab; "Place" drops an instance into
// the timeline you're editing. Changing a symbol updates every instance of it.
export function LibraryPanel({ doc, editingSymbolId, onNewSymbol, onEditSymbol, onPlaceInstance, onDuplicate, onDeleteSymbol, onImport, onPlaceImage, onReplaceAsset }: {
  doc: FlashDoc;
  editingSymbolId: string;
  onNewSymbol: () => void;
  onEditSymbol: (id: string) => void;
  onPlaceInstance: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDeleteSymbol: (id: string) => void;
  onImport: () => void;
  onPlaceImage: (item: MediaItem) => void;
  onReplaceAsset: (assetId: string, item: MediaItem) => void;
}) {
  const [picking, setPicking] = useState<null | 'image' | 'video' | 'audio'>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const instanceCount = (symId: string) => {
    let n = 0;
    for (const s of doc.symbols) for (const l of s.layers) for (const k of l.keyframes) for (const nd of k.nodes)
      if (nd.kind === 'instance' && nd.symbolRef === symId) n++;
    return n;
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-xs">
      <div className="flex items-center gap-1 p-1.5 border-b border-slate-800">
        <span className="font-semibold text-sky-400 flex-1">Library</span>
        <button className="im-btn" onClick={onNewSymbol} title="New Symbol (Ctrl+F8)">+ Symbol</button>
        <button className="im-btn" onClick={() => setPicking('image')} title="Import media (Ctrl+R)">Import</button>
      </div>

      {/* Symbols — as a containment TREE: a symbol expands to the symbols instanced inside it. */}
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">Symbols</div>
      <div className="overflow-auto" style={{ maxHeight: '45%' }}>
        <SymbolTree doc={doc} editingSymbolId={editingSymbolId} sel={sel} setSel={setSel}
          instanceCount={instanceCount} onOpen={onEditSymbol} onPlace={onPlaceInstance} onDup={onDuplicate} onDelete={onDeleteSymbol} />
      </div>

      {/* Assets */}
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500 border-t border-slate-900">Media</div>
      <div className="flex-1 overflow-auto">
        {doc.assets.length === 0 && <div className="text-slate-600 p-3 text-center text-[11px]">No media yet — Import.</div>}
        {doc.assets.map(a => (
          <div key={a.id} className="group flex items-center gap-2 px-2 py-1 hover:bg-slate-900"
            title="Right-click to replace"
            onContextMenu={e => { e.preventDefault(); setReplacing(a.id); setPicking(a.kind === 'audio' ? 'audio' : a.kind === 'video' ? 'video' : 'image'); }}>
            {a.kind === 'image' ? <img src={a.url} alt="" className="w-8 h-6 object-cover rounded-sm bg-slate-800" />
              : <span className="w-8 text-center">{a.kind === 'video' ? '🎥' : a.kind === 'audio' ? '🎵' : '🖼'}</span>}
            <span className="flex-1 truncate text-slate-300">{a.name}</span>
            <button className="im-btn opacity-0 group-hover:opacity-100" onClick={() => { setReplacing(a.id); setPicking(a.kind === 'audio' ? 'audio' : a.kind === 'video' ? 'video' : 'image'); }} title="Replace media">Replace</button>
            <button className="im-btn opacity-0 group-hover:opacity-100" onClick={() => onPlaceImage({ id: a.id, url: a.url, label: a.name, store: 'lib' } as any)}>Place</button>
          </div>
        ))}
      </div>

      {picking && (
        <MediaPicker kind={picking} onClose={() => { setPicking(null); setReplacing(null); }}
          onPick={item => { if (replacing) onReplaceAsset(replacing, item); else onPlaceImage(item); setPicking(null); setReplacing(null); }} />
      )}
    </div>
  );
}

// The containment tree. Roots are scenes plus any symbol not instanced anywhere (so nothing is
// hidden); each symbol expands to the symbols it instances. A visited set per path stops cycles.
function SymbolTree({ doc, editingSymbolId, sel, setSel, instanceCount, onOpen, onPlace, onDup, onDelete }: {
  doc: FlashDoc; editingSymbolId: string; sel: string | null; setSel: (id: string) => void;
  instanceCount: (id: string) => number; onOpen: (id: string) => void; onPlace: (id: string) => void; onDup: (id: string) => void; onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(doc.symbols.filter(s => s.type === 'scene').map(s => s.id)));
  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const childrenOf = (symId: string): string[] => {
    const sym = doc.symbols.find(s => s.id === symId);
    if (!sym) return [];
    const kids = new Set<string>();
    for (const l of sym.layers) for (const k of l.keyframes) for (const n of k.nodes)
      if (n.kind === 'instance' && n.symbolRef) kids.add(n.symbolRef);
    return [...kids];
  };
  const referenced = new Set(doc.symbols.flatMap(s => childrenOf(s.id)));
  const roots = doc.symbols.filter(s => s.type === 'scene' || !referenced.has(s.id));

  const render = (symId: string, depth: number, path: Set<string>): React.ReactNode => {
    const sym = doc.symbols.find(s => s.id === symId);
    if (!sym || path.has(symId)) return null;
    const kids = childrenOf(symId);
    const open = expanded.has(symId);
    return (
      <div key={`${[...path].join('>')}>${symId}`}>
        <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
          <button className="w-4 text-slate-500 hover:text-slate-200 text-[10px]" onClick={() => toggle(symId)}>
            {kids.length ? (open ? '▾' : '▸') : '·'}
          </button>
          <div className="flex-1 min-w-0">
            <SymbolRow sym={sym} count={instanceCount(sym.id)} selected={sel === sym.id} editing={editingSymbolId === sym.id}
              onClick={() => setSel(sym.id)} onOpen={() => onOpen(sym.id)} onPlace={() => onPlace(sym.id)} onDup={() => onDup(sym.id)} onDelete={() => onDelete(sym.id)} />
          </div>
        </div>
        {open && kids.map(cid => render(cid, depth + 1, new Set([...path, symId])))}
      </div>
    );
  };

  return <>{roots.map(r => render(r.id, 0, new Set()))}</>;
}

function SymbolRow({ sym, count, selected, editing, onClick, onOpen, onPlace, onDup, onDelete }: {
  sym: FSymbol; count: number; selected: boolean; editing: boolean;
  onClick: () => void; onOpen: () => void; onPlace: () => void; onDup: () => void; onDelete: () => void;
}) {
  return (
    <div className={`group flex items-center gap-2 px-2 py-1 cursor-pointer ${editing ? 'bg-sky-950/50' : selected ? 'bg-slate-800' : 'hover:bg-slate-900'}`}
      onClick={onClick} onDoubleClick={onOpen} title="Double-click to edit its timeline">
      <span>{TYPE_ICON[sym.type] ?? '▣'}</span>
      <span className={`flex-1 truncate ${editing ? 'text-sky-300' : 'text-slate-200'}`}>{sym.name}</span>
      {count > 0 && <span className="text-[9px] text-slate-600">{count}×</span>}
      {sym.type !== 'scene' && (
        <span className="hidden group-hover:flex gap-1">
          <button className="im-btn" onClick={e => { e.stopPropagation(); onPlace(); }} title="Place instance in current timeline">Place</button>
          <button className="im-btn" onClick={e => { e.stopPropagation(); onDup(); }} title="Duplicate">⧉</button>
          <button className="im-btn" onClick={e => { e.stopPropagation(); onDelete(); }} title="Delete">×</button>
        </span>
      )}
    </div>
  );
}
