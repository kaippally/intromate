import type { ReactNode } from 'react';

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 mb-1">
      <span className="w-24 shrink-0 text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <div className="flex-1 min-w-0 flex items-center gap-1">{children}</div>
    </label>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="border-b border-slate-800">
      <summary className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 cursor-pointer select-none hover:text-slate-200">{title}</summary>
      <div className="px-2 pb-2">{children}</div>
    </details>
  );
}

export function Num({ value, onChange, step = 1, min, max, suffix }: {
  value: number | undefined; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string;
}) {
  return (
    <>
      <input type="number" className="im-input" value={value ?? 0} step={step} min={min} max={max}
        onChange={e => onChange(Number(e.target.value))} />
      {suffix && <span className="text-[10px] text-slate-600">{suffix}</span>}
    </>
  );
}

export function Slide({ value, onChange, min, max, step = 1 }: {
  value: number | undefined; onChange: (v: number) => void; min: number; max: number; step?: number;
}) {
  return (
    <>
      <input type="range" className="flex-1" min={min} max={max} step={step} value={value ?? 0}
        onChange={e => onChange(Number(e.target.value))} />
      <span className="w-10 text-right text-[10px] text-slate-500 tabular-nums">{Math.round((value ?? 0) * 100) / 100}</span>
    </>
  );
}

export function Txt({ value, onChange, placeholder, area }: {
  value: string | undefined; onChange: (v: string) => void; placeholder?: string; area?: boolean;
}) {
  return area
    ? <textarea className="im-input h-16 resize-y" value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    : <input className="im-input" value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />;
}

export function Col({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  return (
    <>
      <input type="color" className="w-7 h-6 bg-transparent border border-slate-700 rounded" value={(value ?? '#ffffff').slice(0, 7)}
        onChange={e => onChange(e.target.value)} />
      <input className="im-input" value={value ?? ''} onChange={e => onChange(e.target.value)} />
    </>
  );
}

export function Sel<T extends string>({ value, onChange, options }: {
  value: T | undefined; onChange: (v: T) => void; options: { id: T; label: string }[];
}) {
  return (
    <select className="im-input" value={value ?? ''} onChange={e => onChange(e.target.value as T)}>
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

export function Check({ value, onChange, label }: { value: boolean | undefined; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-slate-400">
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
