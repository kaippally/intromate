import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { SlideObject } from '@sm/components/SlideObject';
import { cropLayout } from '@sm/components/slideCrop';
import {
  bounceAnimation, bounceKeyframes, presentationOpacity, presentationPerspectivePx, presentationTransform,
  reflectionBlurCss, resolvePage, resolvePresentation, resolveSurface, surfaceLinePx, surfaceMirrorTransform,
} from '@sm/components/slideStyles';
import type { IntroClock } from '../lib/clock';
import { bezierCss, paused } from '../lib/motion';
import { elementWindow } from '../project';
import type { CardEl, IntroProject } from '../types';

// A slide-style card: the Studio Mate SlideObject (crop + 3D slab + border + shadow) or a video,
// posed IN → HOLD → OUT and mirrored in the deck-level stage surface. The poses, the surface
// maths and the slab are all Studio Mate's; the tween is a paused WAAPI animation so it scrubs.
export function CardElement({ el, project, vw, vh, z, clock, selected, onSelect, onDragStart }: {
  el: CardEl;
  project: IntroProject;
  vw: number;
  vh: number;
  z: number;
  clock: IntroClock;
  selected?: boolean;
  onSelect?: (id: number) => void;
  onDragStart?: (e: React.MouseEvent, id: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const poseRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [aspect, setAspect] = useState<number | undefined>(undefined);

  const w = elementWindow(el);
  const pres = resolvePresentation(el.pres);
  const surface = resolveSurface(project.stage);
  const page = resolvePage({ ...el.page, ...(el.reflection ? surface : { reflection: false }) });
  const total = Math.max(1, w.inMs + w.holdMs + w.outMs);

  useEffect(() => {
    if (!el.src) return;
    if (el.type === 'video') {
      const v = document.createElement('video');
      v.onloadedmetadata = () => setAspect(v.videoWidth / Math.max(1, v.videoHeight));
      v.src = el.src;
    } else {
      const img = new Image();
      img.onload = () => setAspect(img.naturalWidth / Math.max(1, img.naturalHeight));
      img.src = el.src;
    }
  }, [el.src, el.type]);

  const motionSig = JSON.stringify([el.pres, w.start, w.inMs, w.holdMs, w.outMs, vw, vh, el.reflection, project.stage]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const kfTransform: Keyframe[] = [
      { transform: presentationTransform(pres.in), offset: 0, easing: bezierCss(pres.showEasing) },
      { transform: presentationTransform(pres.hold), offset: w.inMs / total, easing: 'linear' },
      { transform: presentationTransform(pres.hold), offset: (w.inMs + w.holdMs) / total, easing: bezierCss(pres.hideEasing) },
      { transform: presentationTransform(pres.out), offset: 1 },
    ];
    const kfOpacity: Keyframe[] = [
      { opacity: presentationOpacity(pres.in), offset: 0, easing: bezierCss(pres.showEasing) },
      { opacity: presentationOpacity(pres.hold), offset: w.inMs / total, easing: 'linear' },
      { opacity: presentationOpacity(pres.hold), offset: (w.inMs + w.holdMs) / total, easing: bezierCss(pres.hideEasing) },
      { opacity: presentationOpacity(pres.out), offset: 1 },
    ];
    const timing: KeyframeAnimationOptions = { delay: w.start, duration: total, fill: 'both' };

    const anims: Animation[] = [paused(root, kfOpacity, timing, clock.timeMs)];
    for (const pose of poseRefs.current) if (pose) anims.push(paused(pose, kfTransform, timing, clock.timeMs));

    const off = clock.subscribe(t => { root.style.visibility = t >= w.start && t <= w.end ? 'visible' : 'hidden'; });
    clock.apply();
    return () => { off(); anims.forEach(a => a.cancel()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionSig, clock, aspect]);

  // Videos are registered with the clock so it owns their playhead too.
  useEffect(() => {
    if (el.type !== 'video') return;
    videoRefs.current.forEach((v, i) => clock.registerVideo(el.id * 100 + i, v, w.start, el.trimInMs ?? 0, el.trimOutMs ?? 0));
    return () => { videoRefs.current.forEach((_, i) => clock.registerVideo(el.id * 100 + i, null, 0, 0)); };
  }, [el.id, el.type, el.src, w.start, el.trimInMs, el.trimOutMs, clock]);

  const layout = cropLayout(el.crop, aspect, vw, vh);
  const persp = Math.max(
    presentationPerspectivePx(pres.in) ?? 0,
    presentationPerspectivePx(pres.hold) ?? 0,
    presentationPerspectivePx(pres.out) ?? 0,
  );
  const bounceCss = pres.bounceAmount ? bounceKeyframes(pres.bounceAmount, pres.bounceCount) : '';
  const bounce = pres.bounceAmount ? `${bounceAnimation(pres, w.start + w.inMs)} paused` : undefined;

  const posed = (idx: number, asReflection: boolean) => (
    <div style={{ position: 'absolute', inset: 0, perspective: persp ? `${persp}px` : undefined }}>
      <div
        ref={n => { poseRefs.current[idx] = n; }}
        style={{ position: 'absolute', inset: 0, transformOrigin: 'center', transformStyle: 'preserve-3d', transform: presentationTransform(pres.in) }}
      >
        <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', animation: bounce }}>
          {/* Only the card's own face is clickable. These wrappers span the whole stage, so
              leaving them hit-testable made every click on empty stage grab and drag this card. */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transformStyle: 'preserve-3d', pointerEvents: 'none',
          }}>
            <div
              style={{
                pointerEvents: asReflection ? 'none' : 'auto',
                cursor: onDragStart ? 'move' : undefined,
                transformStyle: 'preserve-3d',
                outline: selected && !asReflection ? '1px dashed #38bdf8' : undefined,
                outlineOffset: 6,
              }}
              onMouseDown={asReflection ? undefined : e => { onSelect?.(el.id); onDragStart?.(e, el.id); }}
            >
              {el.type === 'video'
                ? <VideoFace el={el} layout={layout} page={page} asReflection={asReflection} vref={n => { videoRefs.current[idx] = n; }} />
                : el.src
                  ? <SlideObject src={el.src} crop={el.crop} aspect={aspect} frameW={vw} frameH={vh} page={page} thickness={page.thickness ?? 0} asReflection={asReflection} />
                  : <Placeholder vw={vw} vh={vh} label={el.name ?? 'Card'} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const lineY = surfaceLinePx(surface.reflectionSurfaceY, surface.reflectionDistance, vh, 1);
  const mirror = el.reflection && surface.reflection
    ? surfaceMirrorTransform(surface.reflectionSurfaceY, surface.reflectionDistance, vh, 1)
    : null;

  return (
    <div
      ref={rootRef}
      style={{ position: 'absolute', inset: 0, zIndex: z, opacity: 0, pointerEvents: 'none' }}
    >
      {bounceCss && <style>{bounceCss}</style>}
      {mirror && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: lineY, bottom: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: -lineY, height: vh, transformOrigin: 'center', transform: mirror, filter: reflectionBlurCss(page, 1) }}>
            {posed(1, true)}
          </div>
        </div>
      )}
      {posed(0, false)}
    </div>
  );
}

function VideoFace({ el, layout, page, asReflection, vref }: {
  el: CardEl;
  layout: { box: CSSProperties; img: CSSProperties } | null;
  page: ReturnType<typeof resolvePage>;
  asReflection: boolean;
  vref: (n: HTMLVideoElement | null) => void;
}) {
  if (!el.src) return <Placeholder vw={640} vh={360} label={el.name ?? 'Video'} />;
  const mask: CSSProperties = asReflection
    ? { WebkitMaskImage: `linear-gradient(to bottom, transparent ${100 - (page.reflectionFeather ?? 67)}%, #000)`, maskImage: `linear-gradient(to bottom, transparent ${100 - (page.reflectionFeather ?? 67)}%, #000)`, opacity: (page.reflectionOpacity ?? 50) / 100 }
    : {};
  const box: CSSProperties = layout?.box ?? { position: 'relative', width: '60%', height: '60%', overflow: 'hidden' };
  return (
    <div style={{
      ...box,
      borderRadius: page.borderRadius || undefined,
      border: page.borderWidth ? `${page.borderWidth}px ${page.borderStyle} ${page.borderColor}` : undefined,
      boxShadow: asReflection || !page.shadowBlur ? undefined : `${page.shadowX}px ${page.shadowY}px ${page.shadowBlur}px ${page.shadowColor}`,
      ...mask,
    }}>
      <video
        ref={vref}
        src={el.src}
        muted={asReflection || el.muted !== false}
        playsInline
        preload="auto"
        style={layout?.img ?? { width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  );
}

function Placeholder({ vw, vh, label }: { vw: number; vh: number; label: string }) {
  return (
    <div style={{
      width: vw * 0.4, height: vh * 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '2px dashed #475569', borderRadius: 12, color: '#64748b', fontSize: vh * 0.03,
    }}>{label} — pick media</div>
  );
}
