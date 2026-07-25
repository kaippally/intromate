import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { TrackView } from '@sm/titles/render/TrackView';
import { centerPx, fontPx, textBoxPx, imageSizePx, shapeSizePx } from '@sm/titles/render/coords';
import { reflectionInPlaneStylePct } from '@sm/clipboard/reflection';
import { isTextLike, type ImageTrack, type TextTrack, type ShapeTrack } from '@sm/titles/types';
import type { IntroClock } from '../lib/clock';
import { abKeyframes, bezierCss, fxAnimation, paused, setupCharEffect } from '../lib/motion';
import { elementWindow } from '../project';
import type { TrackEl } from '../types';

// One L3 track on the intro stage. Layout, reflection group and content are Studio Mate's
// (coords + TrackView + the reflection engine); only the timing is IntroMate's — every motion
// is a paused animation the clock positions.
export function TrackElement({ el, vw, vh, z, clock, selected, onSelect, onDragStart }: {
  el: TrackEl;
  vw: number;
  vh: number;
  z: number;
  clock: IntroClock;
  selected?: boolean;
  onSelect?: (id: number) => void;
  onDragStart?: (e: React.MouseEvent, id: number) => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const reflRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(1.6);

  const w = elementWindow(el);
  const { cx, cy } = centerPx(el, vw, vh);

  // Image tracks size from their natural aspect, same as the L3 display.
  const imageUrl = el.type === 'image' ? (el as ImageTrack).image : '';
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => setAspect(img.naturalWidth / Math.max(1, img.naturalHeight));
    img.src = imageUrl;
  }, [imageUrl]);

  let boxW: number | undefined, boxH: number | undefined, sizing: 'fill' | 'auto' = 'fill', fpx: number | undefined;
  if (isTextLike(el)) {
    const box = textBoxPx(el as TextTrack, vh);
    if (box) { boxW = box.w; boxH = box.h; } else sizing = 'auto';
    fpx = fontPx((el as TextTrack).size, vh);
  } else if (el.type === 'image') {
    const s = imageSizePx(el as ImageTrack, vh, aspect); boxW = s.w; boxH = s.h;
  } else {
    const s = shapeSizePx(el as ShapeTrack, vh); boxW = s.w; boxH = s.h;
  }

  const sig = JSON.stringify([
    (el as TextTrack).text, (el as TextTrack).spans, (el as TextTrack).font, el.animation, el.type,
  ]);
  const motionSig = JSON.stringify([
    el.animation, el.animationOut, el.holdAnim, w.start, w.inMs, w.holdMs, w.outMs,
    el.rotationX, el.rotationY, el.rotationZ, el.transitionEnabled, el.stateB, el.transitionDurationMs,
    el.transitionBezier, (el as TextTrack).typeWriterMode, (el as TextTrack).bounceSpeed, sig, vw, vh, aspect,
  ]);

  // Build the paused animation set, then hand time back to the clock.
  useLayoutEffect(() => {
    const outer = outerRef.current, fx = fxRef.current;
    if (!outer || !fx) return;

    fx.style.animation = fxAnimation(el, w);
    if (reflRef.current) reflRef.current.style.animation = fxAnimation(el, w, true);

    const charSeek = setupCharEffect(fx, el, w);

    const ab = abKeyframes(el, vw, vh, aspect);
    let abAnim: Animation | null = null;
    if (ab) {
      abAnim = paused(outer, [{ transform: ab.from }, { transform: ab.to }], {
        delay: w.start,
        duration: Math.max(1, el.transitionDurationMs ?? w.inMs),
        easing: bezierCss(el.transitionBezier),
        fill: 'both',
      }, clock.timeMs);
    }

    const off = clock.subscribe(t => {
      outer.style.opacity = t >= w.start && t <= w.end ? '1' : '0';
      charSeek?.(t);
    });
    clock.apply();

    return () => { off(); abAnim?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionSig, clock]);

  const reflEligible = el.type === 'text' || el.type === 'image' || el.type === 'gradientText';
  const dist = (el as TextTrack).reflectionDistance ?? 0;
  const reflStyle: CSSProperties | null = reflEligible && (el as TextTrack).reflection
    ? { ...reflectionInPlaneStylePct(el as TextTrack, dist), ['--l3rd']: `${dist}px` } as CSSProperties
    : null;
  const groupDim: CSSProperties = {
    position: 'relative',
    width: sizing === 'fill' ? '100%' : 'max-content',
    height: sizing === 'fill' ? '100%' : 'max-content',
    opacity: Math.max(0, Math.min(100, (el as TextTrack).reflectionOpacityMain ?? 100)) / 100,
  };

  return (
    <div
      ref={outerRef}
      className="absolute origin-center"
      style={{
        left: cx, top: cy, width: boxW, height: boxH, zIndex: z, opacity: 0,
        transform: `translate(-50%,-50%) translate(0px,0px) scale(1,1) perspective(1200px) rotateX(${el.rotationX ?? 0}deg) rotateY(${el.rotationY ?? 0}deg) rotateZ(${el.rotationZ ?? 0}deg)`,
        outline: selected ? '1px dashed #38bdf8' : undefined,
        outlineOffset: 4,
        cursor: onDragStart ? 'move' : undefined,
      }}
      onMouseDown={e => { onSelect?.(el.id); onDragStart?.(e, el.id); }}
    >
      <div
        ref={fxRef}
        style={{ position: 'relative', width: sizing === 'fill' ? '100%' : 'max-content', height: sizing === 'fill' ? '100%' : 'max-content' }}
      >
        {reflStyle ? (
          <div key={sig} style={groupDim}>
            <TrackView track={el} fontPx={fpx} sizing={sizing} />
            <div ref={reflRef} data-l3-reflection style={reflStyle}>
              <TrackView track={el} fontPx={fpx} sizing={sizing} />
            </div>
          </div>
        ) : (
          <div key={sig} style={groupDim}>
            <TrackView track={el} fontPx={fpx} sizing={sizing} />
          </div>
        )}
      </div>
    </div>
  );
}
