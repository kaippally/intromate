import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fileToDataUrl, listAudio, listImages, listVideos, thumbUrl, uploadMedia } from '../api';
import { Waveform } from './Waveform';
import type { MediaItem } from '../types';

// Picks from the IntroMate media folder AND (read-only) from the Studio Mate image/audio
// libraries, so an intro can use the logos and stingers the show already has.
export function MediaPicker({ kind, onPick, onClose }: {
  kind: 'image' | 'video' | 'audio';
  onPick: (item: MediaItem) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [auditionVol, setAuditionVol] = useState(0.8);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => { previewRef.current?.pause(); }, []);
  useEffect(() => { if (previewRef.current) previewRef.current.volume = auditionVol; }, [auditionVol]);

  function audition(item: MediaItem) {
    if (playing === item.url) { previewRef.current?.pause(); setPlaying(null); return; }
    previewRef.current?.pause();
    const el = new Audio(item.url);
    el.volume = auditionVol;
    el.onended = () => setPlaying(null);
    el.play().catch(() => setPlaying(null));
    previewRef.current = el;
    setPlaying(item.url);
  }

  const load = () => {
    const fn = kind === 'image' ? listImages : kind === 'video' ? listVideos : listAudio;
    fn().then(setItems).catch(() => setItems([]));
  };
  useEffect(load, [kind]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) await uploadMedia(f.name, await fileToDataUrl(f));
      load();
    } finally { setBusy(false); }
  }

  const shown = items.filter(i => !q || i.label.toLowerCase().includes(q.toLowerCase()));

  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center" style={{ zIndex: 9000 }}
      onClick={() => { previewRef.current?.pause(); onClose(); }}>
      <div className={`im-panel ${kind === 'image' ? 'w-[720px]' : 'w-[880px]'} max-h-[80vh] flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-2 border-b border-slate-800">
          <span className="text-sm font-semibold capitalize">{kind} library</span>
          <input className="im-input flex-1" placeholder="Filter…" value={q} onChange={e => setQ(e.target.value)} />
          {kind === 'audio' && (
            <label className="flex items-center gap-1 text-[10px] text-slate-500">
              Level
              <input type="range" min={0} max={1} step={0.05} value={auditionVol} className="w-20"
                onChange={e => setAuditionVol(Number(e.target.value))} />
              <span className="w-7 tabular-nums">{Math.round(auditionVol * 100)}%</span>
            </label>
          )}
          <button className="im-btn" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : 'Upload'}</button>
          <button className="im-btn" onClick={() => { previewRef.current?.pause(); onClose(); }}>Close</button>
          <input ref={fileRef} type="file" multiple hidden
            accept={kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : 'audio/*'}
            onChange={e => upload(e.target.files)} />
        </div>
        <div className="flex-1 overflow-auto p-2">
          {kind === 'image' && (
            <div className="grid grid-cols-5 gap-2">
              {shown.map(i => (
                <button key={i.url} className="border border-slate-800 rounded hover:border-sky-500 p-1" onClick={() => { onPick(i); onClose(); }}>
                  <img src={i.url} alt="" loading="lazy" className="w-full h-16 object-contain" />
                  <div className="text-[9px] truncate text-slate-500">{i.label}</div>
                </button>
              ))}
            </div>
          )}

          {kind === 'video' && (
            <div className="grid grid-cols-4 gap-2">
              {shown.map(i => (
                <button key={i.url} className="border border-slate-800 rounded hover:border-sky-500 p-1 text-left" onClick={() => { onPick(i); onClose(); }}>
                  <img src={thumbUrl(i.url)} alt="" loading="lazy" className="w-full h-20 object-cover bg-slate-950 rounded-sm" />
                  <div className="text-[9px] truncate text-slate-400">{i.label}</div>
                  <div className="text-[9px] text-slate-600">{i.store}</div>
                </button>
              ))}
            </div>
          )}

          {kind === 'audio' && (
            <div className="flex flex-col gap-0.5">
              {shown.map(i => (
                <div key={i.url} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-800 rounded">
                  <button className="im-btn w-7 shrink-0" title="Audition" onClick={() => audition(i)}>{playing === i.url ? '⏸' : '▶'}</button>
                  <div className="w-40 shrink-0 min-w-0">
                    <div className="text-[11px] truncate">{i.label}</div>
                    <div className="text-[9px] text-slate-600">{i.store}</div>
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => audition(i)}>
                    <Waveform url={i.url} width={280} height={26} buckets={280} color={playing === i.url ? '#38bdf8' : '#34d399'} />
                  </div>
                  <button className="im-btn shrink-0" onClick={() => { previewRef.current?.pause(); onPick(i); onClose(); }}>Use</button>
                </div>
              ))}
            </div>
          )}
          {!shown.length && <div className="text-xs text-slate-600 p-4 text-center">Nothing here yet — upload a file.</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
