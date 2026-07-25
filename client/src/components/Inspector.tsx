import { useEffect, useState } from 'react';
import { ANIMATION_OUT_PRESETS, ANIMATION_PRESETS } from '@sm/titles/types';
import { DEFAULT_POSE, DEFAULT_PRESENTATION, resolvePose } from '@sm/components/slideStyles';
import type { PresPose } from '@sm/components/slideStyles';
import { ANIM_IN_MS, ANIM_OUT_MS } from '@sm/lib/animations';
import { mediaInfo } from '../api';
import { ASPECTS } from '../project';
import { isCard, type CardEl, type IntroAudio, type IntroElement, type IntroProject, type TrackEl } from '../types';
import { Check, Col, Num, Row, Section, Sel, Slide, Txt } from './controls';
import { MediaPicker } from './MediaPicker';

const HOLD_OPTIONS = [
  { id: 'none', label: 'None' },
  { id: 'spinContinuous', label: 'Spin Continuously' },
  { id: 'holdBounce', label: 'Bounce (hold)' },
];

export function Inspector({ project, element, audio, fonts, onPatch, onPatchAudio, onRemoveAudio, onPatchProject }: {
  project: IntroProject;
  element: IntroElement | null;
  audio: IntroAudio | null;
  fonts: { id: string; label: string }[];
  onPatch: (patch: Partial<IntroElement>) => void;
  onPatchAudio: (patch: Partial<IntroAudio>) => void;
  onRemoveAudio: () => void;
  onPatchProject: (patch: Partial<IntroProject>) => void;
}) {
  return (
    <div className="h-full overflow-auto text-xs">
      {audio ? <AudioPanel cue={audio} onPatch={onPatchAudio} onRemove={onRemoveAudio} /> : element ? <ElementPanel el={element} fonts={fonts} onPatch={onPatch} /> : null}
      <ProjectPanel project={project} onPatchProject={onPatchProject} />
    </div>
  );
}

// ── Audio cue ────────────────────────────────────────────────────────────────
function AudioPanel({ cue, onPatch, onRemove }: {
  cue: IntroAudio;
  onPatch: (patch: Partial<IntroAudio>) => void;
  onRemove: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const fileMs = useMediaDuration(cue.url);
  const trimIn = cue.trimInMs ?? 0;
  const trimOut = cue.trimOutMs && cue.trimOutMs > trimIn ? cue.trimOutMs : fileMs;
  const span = Math.max(0, trimOut - trimIn);

  return (
    <Section title={`Audio — ${cue.label ?? 'cue'}`}>
      <Row label="File">
        <button className="im-btn flex-1 truncate" onClick={() => setPicking(true)}>{cue.label ?? 'Pick…'}</button>
      </Row>
      <Row label="Start"><Num value={cue.startMs} step={50} min={0} onChange={v => onPatch({ startMs: v })} suffix="ms" /></Row>
      <Row label="Trim in"><Num value={trimIn} step={50} min={0} max={Math.max(0, trimOut - 50)} onChange={v => onPatch({ trimInMs: Math.max(0, v) })} suffix="ms" /></Row>
      <Row label="Trim out"><Num value={trimOut} step={50} min={trimIn + 50} max={fileMs || undefined} onChange={v => onPatch({ trimOutMs: v })} suffix="ms" /></Row>
      <div className="flex items-center gap-2 mb-2 text-[10px] text-slate-500">
        <span>clip {(span / 1000).toFixed(2)}s of {(fileMs / 1000).toFixed(2)}s</span>
        <button className="im-btn ml-auto" onClick={() => onPatch({ trimInMs: 0, trimOutMs: 0 })}>Full clip</button>
      </div>
      <Row label="Level"><Slide value={cue.volume ?? 1} min={0} max={2} step={0.01} onChange={v => onPatch({ volume: v })} /></Row>
      <Row label="Fade in"><Num value={cue.fadeInMs} step={100} min={0} onChange={v => onPatch({ fadeInMs: v })} suffix="ms" /></Row>
      <Row label="Fade out"><Num value={cue.fadeOutMs} step={100} min={0} onChange={v => onPatch({ fadeOutMs: v })} suffix="ms" /></Row>
      <Row label="Mute"><Check value={cue.muted} onChange={v => onPatch({ muted: v })} /></Row>
      <div className="flex justify-end mt-2">
        <button className="im-btn" onClick={onRemove}>Remove cue</button>
      </div>
      {picking && <MediaPicker kind="audio" onPick={i => onPatch({ url: i.url, label: i.label, trimInMs: 0, trimOutMs: 0 })} onClose={() => setPicking(false)} />}
    </Section>
  );
}

/** Source duration of a media url (ffmpeg-probed, cached per url for the session). */
const durationCache = new Map<string, number>();
function useMediaDuration(url: string | undefined): number {
  const [ms, setMs] = useState(url ? durationCache.get(url) ?? 0 : 0);
  useEffect(() => {
    if (!url) return setMs(0);
    const hit = durationCache.get(url);
    if (hit) return setMs(hit);
    let dead = false;
    mediaInfo(url).then(r => { durationCache.set(url, r.durationMs); if (!dead) setMs(r.durationMs); }).catch(() => {});
    return () => { dead = true; };
  }, [url]);
  return ms;
}

// ── Element ──────────────────────────────────────────────────────────────────
function ElementPanel({ el, fonts, onPatch }: {
  el: IntroElement;
  fonts: { id: string; label: string }[];
  onPatch: (patch: Partial<IntroElement>) => void;
}) {
  const card = isCard(el);
  const t = el as TrackEl;
  const c = el as CardEl;
  const p = (patch: any) => onPatch(patch);

  return (
    <>
      <Section title={`${el.name ?? el.type} — timing`}>
        <Row label="Name"><Txt value={el.name} onChange={v => p({ name: v })} /></Row>
        <Row label="Start"><Num value={el.delay} step={50} min={0} onChange={v => p({ delay: v })} suffix="ms" /></Row>
        <Row label="IN">
          <Num
            value={card ? (c.pres?.showDuration ?? DEFAULT_PRESENTATION.showDuration) : (t.animInMs ?? ANIM_IN_MS)}
            step={50} min={1}
            onChange={v => p(card ? { pres: { ...c.pres, showDuration: v } } : { animInMs: v })}
            suffix="ms" />
        </Row>
        <Row label="Hold"><Num value={el.duration} step={50} min={0} onChange={v => p({ duration: v })} suffix="ms" /></Row>
        <Row label="OUT">
          <Num
            value={card ? (c.pres?.hideDuration ?? DEFAULT_PRESENTATION.hideDuration) : (t.animOutMs ?? ANIM_OUT_MS)}
            step={50} min={1}
            onChange={v => p(card ? { pres: { ...c.pres, hideDuration: v } } : { animOutMs: v })}
            suffix="ms" />
        </Row>
      </Section>

      {!card && (
        <Section title="Motion">
          <Row label="IN effect">
            <Sel value={t.animation} options={ANIMATION_PRESETS.map(a => ({ id: a.id as string, label: a.label }))} onChange={v => p({ animation: v })} />
          </Row>
          <Row label="Hold loop">
            <Sel value={t.holdAnim ?? 'none'} options={HOLD_OPTIONS} onChange={v => p({ holdAnim: v })} />
          </Row>
          {t.holdAnim === 'holdBounce' && (
            <Row label="Bounce spd"><Slide value={t.bounceSpeed ?? 1} min={0.25} max={4} step={0.25} onChange={v => p({ bounceSpeed: v })} /></Row>
          )}
          <Row label="OUT effect">
            <Sel value={t.animationOut} options={ANIMATION_OUT_PRESETS.map(a => ({ id: a.id as string, label: a.label }))} onChange={v => p({ animationOut: v })} />
          </Row>
          {(t.animation === 'grow' || t.animationOut === 'shrink') && (
            <Row label="Grow from">
              <Sel value={t.growOrigin ?? 'center'} options={[{ id: 'left', label: 'Left' }, { id: 'center', label: 'Center' }, { id: 'right', label: 'Right' }]} onChange={v => p({ growOrigin: v })} />
            </Row>
          )}
          {t.animation === 'typeWriter' && (
            <Row label="Reveal by">
              <Sel value={(t as any).typeWriterMode ?? 'chars'} options={[{ id: 'chars', label: 'Characters' }, { id: 'words', label: 'Words' }]} onChange={v => p({ typeWriterMode: v })} />
            </Row>
          )}
        </Section>
      )}

      {!card && <TrackContent t={t} fonts={fonts} p={p} />}
      {card && <CardContent c={c} p={p} />}

      {!card && (
        <Section title="Transform">
          <Row label="X"><Slide value={t.xPos} min={-20} max={20} step={0.05} onChange={v => p({ xPos: v })} /></Row>
          <Row label="Y"><Slide value={t.yPos} min={-10} max={10} step={0.05} onChange={v => p({ yPos: v })} /></Row>
          <Row label="Rotate X"><Slide value={t.rotationX ?? 0} min={-180} max={180} onChange={v => p({ rotationX: v })} /></Row>
          <Row label="Rotate Y"><Slide value={t.rotationY ?? 0} min={-180} max={180} onChange={v => p({ rotationY: v })} /></Row>
          <Row label="Rotate Z"><Slide value={t.rotationZ ?? 0} min={-180} max={180} onChange={v => p({ rotationZ: v })} /></Row>
        </Section>
      )}

      {!card && (t.type === 'text' || t.type === 'gradientText' || t.type === 'image') && (
        <Section title="Surface reflection" defaultOpen={false}>
          <Row label="On"><Check value={(t as any).reflection} onChange={v => p({ reflection: v })} /></Row>
          <Row label="Object %"><Slide value={(t as any).reflectionOpacityMain ?? 100} min={0} max={100} onChange={v => p({ reflectionOpacityMain: v })} /></Row>
          <Row label="Reflect %"><Slide value={(t as any).reflectionOpacity ?? 50} min={0} max={100} onChange={v => p({ reflectionOpacity: v })} /></Row>
          <Row label="Distance"><Slide value={(t as any).reflectionDistance ?? 0} min={0} max={200} onChange={v => p({ reflectionDistance: v })} /></Row>
          <Row label="Feather"><Slide value={(t as any).reflectionFeather ?? 67} min={0} max={100} onChange={v => p({ reflectionFeather: v })} /></Row>
        </Section>
      )}
    </>
  );
}

function TrackContent({ t, fonts, p }: { t: TrackEl; fonts: { id: string; label: string }[]; p: (patch: any) => void }) {
  const [picking, setPicking] = useState(false);
  const fontOptions = [{ id: 'helvetiker', label: 'Helvetiker (default)' }, ...fonts];

  if (t.type === 'text' || t.type === 'gradientText') {
    return (
      <Section title="Content">
        <Row label="Text"><Txt area value={(t as any).text} onChange={v => p({ text: v, outputText: v })} /></Row>
        <Row label="Font"><Sel value={(t as any).font} options={fontOptions} onChange={v => p({ font: v })} /></Row>
        <Row label="Size"><Slide value={(t as any).size} min={0.1} max={6} step={0.05} onChange={v => p({ size: v })} /></Row>
        <Row label="Align">
          <Sel value={(t as any).align ?? 'center'} options={[{ id: 'left', label: 'Left' }, { id: 'center', label: 'Center' }, { id: 'right', label: 'Right' }]} onChange={v => p({ align: v })} />
        </Row>
        {t.type === 'text' ? (
          <>
            <Row label="Colour"><Col value={(t as any).color} onChange={v => p({ color: v })} /></Row>
            <Row label="Bevel"><Check value={(t as any).bevel} onChange={v => p({ bevel: v })} /></Row>
            <Row label="Depth"><Slide value={(t as any).depth ?? 0} min={0} max={1} step={0.01} onChange={v => p({ depth: v })} /></Row>
            <Row label="Shadow"><Check value={(t as any).shadowEnabled} onChange={v => p({ shadowEnabled: v })} /></Row>
            {(t as any).shadowEnabled && <Row label="Shadow col"><Col value={(t as any).shadowColor ?? '#000000'} onChange={v => p({ shadowColor: v })} /></Row>}
          </>
        ) : (
          <>
            <Row label="Colour 1"><Col value={(t as any).gradColor1} onChange={v => p({ gradColor1: v })} /></Row>
            <Row label="Colour 2"><Col value={(t as any).gradColor2} onChange={v => p({ gradColor2: v })} /></Row>
            <Row label="Angle"><Slide value={(t as any).gradAngle ?? 90} min={0} max={360} onChange={v => p({ gradAngle: v })} /></Row>
          </>
        )}
      </Section>
    );
  }

  if (t.type === 'image') {
    return (
      <Section title="Content">
        <Row label="Image">
          <button className="im-btn flex-1" onClick={() => setPicking(true)}>{(t as any).image ? 'Change…' : 'Pick image…'}</button>
        </Row>
        {(t as any).image && <img src={(t as any).image} alt="" className="w-full h-20 object-contain bg-slate-950 rounded border border-slate-800 mb-1" />}
        <Row label="Size"><Slide value={(t as any).size} min={0.1} max={9} step={0.05} onChange={v => p({ size: v })} /></Row>
        {picking && <MediaPicker kind="image" onPick={i => p({ image: i.url })} onClose={() => setPicking(false)} />}
      </Section>
    );
  }

  return (
    <Section title="Content">
      <Row label="Shape">
        <Sel value={(t as any).shapeType} options={[{ id: 'rect', label: 'Rectangle' }, { id: 'circle', label: 'Circle' }, { id: 'line', label: 'Line' }]} onChange={v => p({ shapeType: v })} />
      </Row>
      <Row label="Fill">
        <Sel value={(t as any).fill} options={[{ id: 'solid', label: 'Solid' }, { id: 'gradient-lr', label: 'Gradient →' }, { id: 'gradient-tb', label: 'Gradient ↓' }, { id: 'none', label: 'None' }]} onChange={v => p({ fill: v })} />
      </Row>
      <Row label="Colour"><Col value={(t as any).fillColor} onChange={v => p({ fillColor: v })} /></Row>
      {String((t as any).fill).startsWith('gradient') && <Row label="Colour 2"><Col value={(t as any).fillColor2} onChange={v => p({ fillColor2: v })} /></Row>}
      <Row label="Width"><Slide value={(t as any).width} min={0.1} max={20} step={0.1} onChange={v => p({ width: v })} /></Row>
      <Row label="Height"><Slide value={(t as any).height} min={0.05} max={10} step={0.05} onChange={v => p({ height: v })} /></Row>
      <Row label="Radius"><Num value={(t as any).radius ?? 0} onChange={v => p({ radius: v })} suffix="px" /></Row>
      <Row label="Opacity"><Slide value={(t as any).opacity ?? 1} min={0} max={1} step={0.05} onChange={v => p({ opacity: v })} /></Row>
    </Section>
  );
}

function CardContent({ c, p }: { c: CardEl; p: (patch: any) => void }) {
  const [picking, setPicking] = useState(false);
  const [pose, setPose] = useState<'in' | 'hold' | 'out'>('hold');
  const pres = { ...DEFAULT_PRESENTATION, ...c.pres };
  const current: PresPose = resolvePose((pres as any)[pose], DEFAULT_POSE);
  const setPoseField = (k: keyof PresPose, v: number) =>
    p({ pres: { ...c.pres, [pose]: { ...current, [k]: v } } });

  return (
    <>
      <Section title="Content">
        <Row label={c.type === 'video' ? 'Video' : 'Image'}>
          <button className="im-btn flex-1" onClick={() => setPicking(true)}>{c.src ? 'Change…' : 'Pick media…'}</button>
        </Row>
        {c.src && c.type === 'card' && <img src={c.src} alt="" className="w-full h-20 object-contain bg-slate-950 rounded border border-slate-800 mb-1" />}
        {c.type === 'video' && <VideoTrim c={c} p={p} />}
        <Row label="Thickness"><Slide value={c.page?.thickness ?? 0} min={0} max={80} onChange={v => p({ page: { ...c.page, thickness: v } })} /></Row>
        <Row label="Radius"><Slide value={c.page?.borderRadius ?? 0} min={0} max={80} onChange={v => p({ page: { ...c.page, borderRadius: v } })} /></Row>
        <Row label="Shadow"><Slide value={c.page?.shadowBlur ?? 0} min={0} max={120} onChange={v => p({ page: { ...c.page, shadowBlur: v } })} /></Row>
        <Row label="Reflect"><Check value={c.reflection} onChange={v => p({ reflection: v })} /></Row>
        {picking && <MediaPicker kind={c.type === 'video' ? 'video' : 'image'} onPick={i => p({ src: i.url })} onClose={() => setPicking(false)} />}
      </Section>

      <Section title="Poses">
        <div className="flex gap-1 mb-2">
          {(['in', 'hold', 'out'] as const).map(s => (
            <button key={s} className={`im-btn flex-1 ${pose === s ? 'border-sky-500 text-sky-300' : ''}`} onClick={() => setPose(s)}>{s.toUpperCase()}</button>
          ))}
        </div>
        <Row label="X"><Slide value={current.x} min={-2400} max={2400} step={10} onChange={v => setPoseField('x', v)} /></Row>
        <Row label="Y"><Slide value={current.y} min={-1400} max={1400} step={10} onChange={v => setPoseField('y', v)} /></Row>
        <Row label="Z"><Slide value={current.z} min={-3000} max={2000} step={10} onChange={v => setPoseField('z', v)} /></Row>
        <Row label="Scale"><Slide value={current.scale} min={0.05} max={3} step={0.01} onChange={v => setPoseField('scale', v)} /></Row>
        <Row label="Opacity"><Slide value={current.opacity} min={0} max={100} onChange={v => setPoseField('opacity', v)} /></Row>
        <Row label="Pitch"><Slide value={current.rotateX} min={-90} max={90} onChange={v => setPoseField('rotateX', v)} /></Row>
        <Row label="Yaw"><Slide value={current.rotateY} min={-90} max={90} onChange={v => setPoseField('rotateY', v)} /></Row>
        <Row label="Perspective"><Slide value={current.perspective} min={0} max={4000} step={50} onChange={v => setPoseField('perspective', v)} /></Row>
      </Section>

      <Section title="Waft (hold drift)" defaultOpen={false}>
        <Row label="Amount"><Slide value={pres.bounceAmount} min={0} max={80} onChange={v => p({ pres: { ...c.pres, bounceAmount: v } })} /></Row>
        <Row label="Wafts"><Slide value={pres.bounceCount} min={1} max={8} onChange={v => p({ pres: { ...c.pres, bounceCount: v } })} /></Row>
        <Row label="Per waft"><Num value={pres.bounceDuration} step={250} onChange={v => p({ pres: { ...c.pres, bounceDuration: v } })} suffix="ms" /></Row>
      </Section>
    </>
  );
}

// Video clips trim from both ends in SOURCE time. "Fit hold" then sizes the element's HOLD so the
// chip on the timeline is exactly as long as the trimmed clip (IN + HOLD + OUT = clip length).
function VideoTrim({ c, p }: { c: CardEl; p: (patch: any) => void }) {
  const fileMs = useMediaDuration(c.src);
  const trimIn = c.trimInMs ?? 0;
  const trimOut = c.trimOutMs && c.trimOutMs > trimIn ? c.trimOutMs : fileMs;
  const span = Math.max(0, trimOut - trimIn);
  const inMs = c.pres?.showDuration ?? DEFAULT_PRESENTATION.showDuration;
  const outMs = c.pres?.hideDuration ?? DEFAULT_PRESENTATION.hideDuration;

  return (
    <>
      <Row label="Muted"><Check value={c.muted} onChange={v => p({ muted: v })} /></Row>
      <Row label="Level"><Slide value={c.volume ?? 1} min={0} max={2} step={0.01} onChange={v => p({ volume: v })} /></Row>
      <Row label="Trim in"><Num value={trimIn} step={100} min={0} max={Math.max(0, trimOut - 100)} onChange={v => p({ trimInMs: Math.max(0, v) })} suffix="ms" /></Row>
      <Row label="Trim out"><Num value={trimOut} step={100} min={trimIn + 100} max={fileMs || undefined} onChange={v => p({ trimOutMs: v })} suffix="ms" /></Row>
      <div className="flex items-center gap-2 mb-2 text-[10px] text-slate-500">
        <span>clip {(span / 1000).toFixed(2)}s of {(fileMs / 1000).toFixed(2)}s</span>
        <button className="im-btn ml-auto" onClick={() => p({ trimInMs: 0, trimOutMs: 0 })}>Full clip</button>
        <button className="im-btn" title="Make the element last exactly as long as the trimmed clip"
          onClick={() => p({ duration: Math.max(0, span - inMs - outMs) })}>Fit hold</button>
      </div>
    </>
  );
}

// ── Project ──────────────────────────────────────────────────────────────────
function ProjectPanel({ project, onPatchProject }: { project: IntroProject; onPatchProject: (p: Partial<IntroProject>) => void }) {
  const [picking, setPicking] = useState<null | 'image' | 'video'>(null);
  const bg = project.background;
  const st = project.stage;
  return (
    <>
      <Section title="Project" defaultOpen={false}>
        <Row label="Name"><Txt value={project.name} onChange={v => onPatchProject({ name: v })} /></Row>
        <Row label="Aspect"><Sel value={project.aspectRatio} options={ASPECTS.map(a => ({ id: a, label: a }))} onChange={v => onPatchProject({ aspectRatio: v })} /></Row>
        <Row label="Duration"><Num value={project.durationMs} step={250} min={500} onChange={v => onPatchProject({ durationMs: v })} suffix="ms" /></Row>
        <Row label="FPS"><Sel value={String(project.fps)} options={[{ id: '24', label: '24' }, { id: '25', label: '25' }, { id: '30', label: '30' }, { id: '50', label: '50' }, { id: '60', label: '60' }]} onChange={v => onPatchProject({ fps: Number(v) })} /></Row>
        <Row label="Master vol"><Slide value={project.masterVolume ?? 1} min={0} max={2} step={0.01} onChange={v => onPatchProject({ masterVolume: v })} /></Row>
      </Section>

      <Section title="Background" defaultOpen={false}>
        <Row label="Kind">
          <Sel value={bg.kind} options={[
            { id: 'transparent', label: 'Transparent' }, { id: 'color', label: 'Solid' },
            { id: 'gradient', label: 'Gradient' }, { id: 'image', label: 'Image' }, { id: 'video', label: 'Video' },
          ]} onChange={v => onPatchProject({ background: { ...bg, kind: v as any } })} />
        </Row>
        {(bg.kind === 'color' || bg.kind === 'gradient') && <Row label="Colour"><Col value={bg.color} onChange={v => onPatchProject({ background: { ...bg, color: v } })} /></Row>}
        {bg.kind === 'gradient' && <>
          <Row label="Colour 2"><Col value={bg.color2} onChange={v => onPatchProject({ background: { ...bg, color2: v } })} /></Row>
          <Row label="Angle"><Slide value={bg.angle ?? 160} min={0} max={360} onChange={v => onPatchProject({ background: { ...bg, angle: v } })} /></Row>
        </>}
        {(bg.kind === 'image' || bg.kind === 'video') && <>
          <Row label="Source"><button className="im-btn flex-1" onClick={() => setPicking(bg.kind as 'image' | 'video')}>{bg.url ? 'Change…' : 'Pick…'}</button></Row>
          <Row label="Fit"><Sel value={bg.fit ?? 'cover'} options={[{ id: 'cover', label: 'Cover' }, { id: 'contain', label: 'Contain' }]} onChange={v => onPatchProject({ background: { ...bg, fit: v as any } })} /></Row>
        </>}
        {picking && <MediaPicker kind={picking} onPick={i => onPatchProject({ background: { ...bg, url: i.url } })} onClose={() => setPicking(null)} />}
      </Section>

      <Section title="Stage surface" defaultOpen={false}>
        <Row label="Mirror"><Check value={st.reflection} onChange={v => onPatchProject({ stage: { ...st, reflection: v } })} /></Row>
        <Row label="Surface Y"><Slide value={st.reflectionSurfaceY ?? 0.85} min={0.2} max={1} step={0.01} onChange={v => onPatchProject({ stage: { ...st, reflectionSurfaceY: v } })} /></Row>
        <Row label="Reflect %"><Slide value={st.reflectionOpacity ?? 50} min={0} max={100} onChange={v => onPatchProject({ stage: { ...st, reflectionOpacity: v } })} /></Row>
        <Row label="Feather"><Slide value={st.reflectionFeather ?? 67} min={0} max={100} onChange={v => onPatchProject({ stage: { ...st, reflectionFeather: v } })} /></Row>
        <Row label="Blur"><Slide value={st.reflectionBlur ?? 0} min={0} max={20} onChange={v => onPatchProject({ stage: { ...st, reflectionBlur: v } })} /></Row>
        <Row label="Distance"><Slide value={st.reflectionDistance ?? 0} min={0} max={300} onChange={v => onPatchProject({ stage: { ...st, reflectionDistance: v } })} /></Row>
        <Row label="Grid"><Check value={st.grid} onChange={v => onPatchProject({ stage: { ...st, grid: v } })} /></Row>
      </Section>
    </>
  );
}
