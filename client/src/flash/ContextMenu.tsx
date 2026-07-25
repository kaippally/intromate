import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
  checked?: boolean;
  shortcut?: string;
}

// One reusable right-click menu, portalled to body so it escapes panel clipping. Right-click a Stage
// object, a Library symbol, a layer or a keyframe to assign settings — each caller supplies its own
// item list built for that target.
export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const close = () => setMenu(null);
  const node = menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={close} /> : null;
  return { open, close, node };
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    // Keep it on screen.
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 6),
      y: Math.min(y, window.innerHeight - r.height - 6),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as any)) onClose(); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="fixed z-[10000] min-w-[190px] py-1 rounded-md border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 text-xs"
      style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) => it.separator
        ? <div key={i} className="my-1 border-t border-slate-800" />
        : <MenuRow key={i} item={it} onClose={onClose} />)}
    </div>,
    document.body,
  );
}

function MenuRow({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [openSub, setOpenSub] = useState(false);
  return (
    <div className="relative"
      onMouseEnter={() => setOpenSub(true)} onMouseLeave={() => setOpenSub(false)}>
      <button
        className={`w-full flex items-center gap-2 px-3 py-1 text-left ${item.disabled ? 'text-slate-600' : 'text-slate-200 hover:bg-sky-700/40'}`}
        disabled={item.disabled}
        onClick={() => { if (!item.submenu) { item.onClick?.(); onClose(); } }}>
        <span className="w-3 text-sky-400">{item.checked ? '✓' : ''}</span>
        <span className="flex-1">{item.label}</span>
        {item.shortcut && <span className="text-[10px] text-slate-500">{item.shortcut}</span>}
        {item.submenu && <span className="text-slate-500">▸</span>}
      </button>
      {item.submenu && openSub && (
        <div className="absolute left-full top-0 min-w-[170px] py-1 rounded-md border border-slate-700 bg-slate-900 shadow-2xl">
          {item.submenu.map((s, j) => s.separator
            ? <div key={j} className="my-1 border-t border-slate-800" />
            : <MenuRow key={j} item={s} onClose={onClose} />)}
        </div>
      )}
    </div>
  );
}
