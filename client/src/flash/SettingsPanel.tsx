import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { checkFolder, getSettings, saveSettings, type AppSettings } from './api';

// Settings dialog (gear icon, top-right): general new-document defaults, an extra media folder
// scanned in ADDITION to the Studio Mate libraries, and named API/service keys. Persisted server-side
// (data/settings.json). A button jumps to the Keyboard Shortcuts manager.
export function SettingsPanel({ onClose, onOpenShortcuts }: { onClose: () => void; onOpenShortcuts: () => void }) {
  const [s, setS] = useState<AppSettings | null>(null);
  const [tab, setTab] = useState<'general' | 'media' | 'keys'>('general');
  const [folderOk, setFolderOk] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { getSettings().then(setS).catch(() => setS({})); }, []);
  const patch = (p: Partial<AppSettings>) => setS(v => ({ ...(v ?? {}), ...p }));

  useEffect(() => {
    const f = s?.mediaFolder?.trim();
    if (!f) { setFolderOk(null); return; }
    const t = setTimeout(() => checkFolder(f).then(r => setFolderOk(r.exists)).catch(() => setFolderOk(false)), 300);
    return () => clearTimeout(t);
  }, [s?.mediaFolder]);

  async function save() {
    if (!s) return;
    await saveSettings(s);
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }

  if (!s) return null;
  const keys = s.keys ?? {};

  return createPortal(
    <div className="fixed inset-0 z-[9500] bg-black/70 flex items-center justify-center" onClick={onClose}>
      <div className="w-[560px] max-h-[82vh] flex flex-col rounded-lg border border-slate-700 bg-slate-950 text-xs" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-3 border-b border-slate-800">
          <span className="text-sm font-semibold flex-1">⚙ Settings</span>
          {saved && <span className="text-emerald-400">saved</span>}
          <button className="im-btn-primary" onClick={save}>Save</button>
          <button className="im-btn" onClick={onClose}>Close</button>
        </div>

        <div className="flex gap-1 px-3 pt-2">
          {(['general', 'media', 'keys'] as const).map(t => (
            <button key={t} className={`im-btn capitalize ${tab === t ? 'border-sky-500 text-sky-300' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          {tab === 'general' && (
            <>
              <Row label="Default FPS"><Num v={s.defaultFps ?? 24} on={v => patch({ defaultFps: v })} /></Row>
              <Row label="Default width"><Num v={s.defaultWidth ?? 1920} on={v => patch({ defaultWidth: v })} /></Row>
              <Row label="Default height"><Num v={s.defaultHeight ?? 1080} on={v => patch({ defaultHeight: v })} /></Row>
              <Row label="Autosave"><input type="checkbox" checked={s.autosave !== false} onChange={e => patch({ autosave: e.target.checked })} /></Row>
              <div className="pt-2 border-t border-slate-800 mt-2">
                <button className="im-btn" onClick={onOpenShortcuts}>Keyboard Shortcuts…</button>
              </div>
            </>
          )}

          {tab === 'media' && (
            <>
              <div className="text-[11px] text-slate-500 mb-1">
                By default IntroMate scans the <b>Studio Mate</b> media libraries (images, audio, music,
                videos, clips). Add one more folder to include your own media in Import.
              </div>
              <Row label="Media folder">
                <input className="im-input" placeholder="C:\path\to\media" value={s.mediaFolder ?? ''} onChange={e => patch({ mediaFolder: e.target.value })} />
              </Row>
              <div className="text-[10px] pl-24">
                {folderOk === true && <span className="text-emerald-400">✓ folder found</span>}
                {folderOk === false && <span className="text-rose-400">✗ path not found on the server</span>}
                {folderOk === null && <span className="text-slate-600">absolute path on the server machine</span>}
              </div>
            </>
          )}

          {tab === 'keys' && (
            <>
              <div className="text-[11px] text-slate-500 mb-1">Named API / service keys, stored server-side.</div>
              {Object.entries(keys).map(([k, v], i) => (
                <div key={i} className="flex items-center gap-1">
                  <input className="im-input w-32" value={k} onChange={e => {
                    const next: Record<string, string> = {}; Object.entries(keys).forEach(([kk, vv], j) => { next[j === i ? e.target.value : kk] = vv; }); patch({ keys: next });
                  }} placeholder="name" />
                  <input className="im-input flex-1" value={v} onChange={e => patch({ keys: { ...keys, [k]: e.target.value } })} placeholder="value" type="password" />
                  <button className="im-btn" onClick={() => { const next = { ...keys }; delete next[k]; patch({ keys: next }); }}>×</button>
                </div>
              ))}
              <button className="im-btn" onClick={() => patch({ keys: { ...keys, [`key${Object.keys(keys).length + 1}`]: '' } })}>+ Add key</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-[10px] uppercase text-slate-500">{label}</span>
      <div className="flex-1 flex items-center gap-1">{children}</div>
    </label>
  );
}
function Num({ v, on }: { v: number; on: (n: number) => void }) {
  return <input type="number" className="im-input w-24" value={v} onChange={e => on(Number(e.target.value))} />;
}
