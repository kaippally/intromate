import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { PerspectiveGrid } from '@sm/components/PerspectiveGrid';
import { resolveSurface } from '@sm/components/slideStyles';
import { pxToXPos, pxToYPos, xPosToPx, yPosToPx } from '@sm/titles/render/coords';
import type { IntroClock } from '../lib/clock';
import { stageSize } from '../project';
import { isCard, type CardEl, type IntroElement, type IntroProject, type TrackEl } from '../types';
import { TrackElement } from './TrackElement';
import { CardElement } from './CardElement';

// The 1920×1080 (or portrait) stage. Everything inside is authored in stage pixels and the whole
// thing is CSS-scaled to whatever box it is shown in — the editor canvas, or the render viewport
// at 1:1. The clock attaches here, so `root.getAnimations({subtree:true})` is the composition.
export function IntroStage({ project, clock, boxW, boxH, editable, selectedId, onSelect, onPatch, guides }: {
  project: IntroProject;
  clock: IntroClock;
  boxW: number;
  boxH: number;
  editable?: boolean;
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  onPatch?: (id: number, patch: Partial<IntroElement>) => void;
  guides?: boolean;
}) {
  const { vw, vh } = stageSize(project);
  const scale = Math.min(boxW / vw, boxH / vh);
  const stageRef = useRef<HTMLDivElement>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { clock.attach(stageRef.current); clock.apply(); }, [clock]);
  useEffect(() => { clock.durationMs = project.durationMs; }, [clock, project.durationMs]);
  useEffect(() => {
    clock.registerVideo(-1, project.background.kind === 'video' ? bgVideoRef.current : null, 0, 0);
    return () => clock.registerVideo(-1, null, 0, 0);
  }, [clock, project.background.kind, project.background.url]);

  // Drag on the stage moves the element: a track by its xPos/yPos, a card by its HOLD pose.
  function startDrag(e: React.MouseEvent, id: number) {
    if (!editable || !onPatch) return;
    e.preventDefault();
    const el = project.elements.find(x => x.id === id);
    if (!el) return;
    const x0 = e.clientX, y0 = e.clientY;
    const card = isCard(el);
    const startX = card ? ((el as CardEl).pres?.hold?.x ?? 0) : xPosToPx((el as TrackEl).xPos, vw);
    const startY = card ? ((el as CardEl).pres?.hold?.y ?? 0) : yPosToPx((el as TrackEl).yPos, vh);

    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - x0) / scale;
      const dy = (ev.clientY - y0) / scale;
      if (card) {
        const c = el as CardEl;
        onPatch(id, { pres: { ...c.pres, hold: { ...(c.pres?.hold ?? {}), x: Math.round(startX + dx), y: Math.round(startY + dy) } } } as Partial<IntroElement>);
      } else {
        onPatch(id, {
          xPos: Math.round(pxToXPos(startX + dx, vw) * 100) / 100,
          yPos: Math.round(pxToYPos(startY + dy, vh) * 100) / 100,
        } as Partial<IntroElement>);
      }
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  const surface = resolveSurface(project.stage);
  const bg = project.background;
  const bgStyle: CSSProperties =
    bg.kind === 'color' ? { background: bg.color ?? '#000' }
    : bg.kind === 'gradient' ? { background: `linear-gradient(${bg.angle ?? 160}deg, ${bg.color ?? '#020617'}, ${bg.color2 ?? '#0b2545'})` }
    : {};

  return (
    <div className="relative overflow-hidden" style={{ width: vw * scale, height: vh * scale }}>
      <div
        ref={stageRef}
        className="absolute top-0 left-0 origin-top-left overflow-hidden"
        style={{ width: vw, height: vh, transform: `scale(${scale})`, ...bgStyle }}
      >
        {bg.kind === 'image' && bg.url && (
          <img src={bg.url} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: bg.fit ?? 'cover' }} />
        )}
        {bg.kind === 'video' && bg.url && (
          <video ref={bgVideoRef} src={bg.url} muted playsInline preload="auto"
            className="absolute inset-0 w-full h-full" style={{ objectFit: bg.fit ?? 'cover' }} />
        )}

        {project.elements.filter(e => e.enabled).map((el, i) => {
          const z = 10 + i;
          return isCard(el)
            ? <CardElement key={el.id} el={el} project={project} vw={vw} vh={vh} z={z} clock={clock}
                selected={editable && selectedId === el.id} onSelect={onSelect}
                onDragStart={editable ? startDrag : undefined} />
            : <TrackElement key={el.id} el={el as TrackEl} vw={vw} vh={vh} z={z} clock={clock}
                selected={editable && selectedId === el.id} onSelect={onSelect}
                onDragStart={editable ? startDrag : undefined} />;
        })}

        {guides && project.stage.grid && (
          <PerspectiveGrid w={vw} h={vh} surfaceY={surface.reflectionSurfaceY} />
        )}
        {guides && surface.reflection && (
          <div className="absolute left-0 right-0 pointer-events-none"
            style={{ top: vh * surface.reflectionSurfaceY, borderTop: '2px dashed #ef4444', zIndex: 20, opacity: 0.7 }} />
        )}
      </div>
    </div>
  );
}
