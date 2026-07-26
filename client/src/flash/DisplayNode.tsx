import { cloneElement, createContext, useContext, useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { reflectionInPlaneStylePct } from '@sm/clipboard/reflection';
import { cssTransform, type RenderNode } from './resolve';

// Merge extra style onto an element without retyping it.
const inject = (el: ReactElement, style: CSSProperties) =>
  cloneElement(el, { style: { ...(el.props as any).style, ...style } });

// Recursive renderer for one resolved display node. Each node is an absolutely-positioned div
// carrying its own CSS transform + opacity + blend; children (a symbol instance's display list)
// nest inside, so CSS composes the transforms exactly as Flash's display list composes matrices.
export function DisplayNode({ node }: { node: RenderNode }) {
  const wrap: CSSProperties = {
    position: 'absolute', left: 0, top: 0, transformOrigin: '0 0',
    transform: cssTransform(node.transform),
    opacity: node.alpha,
    mixBlendMode: node.blend && node.blend !== 'normal' ? (node.blend as CSSProperties['mixBlendMode']) : undefined,
  };
  const p = (node.leaf?.props ?? {}) as any;

  const leaf = node.leaf ? <Leaf node={node} /> : null;

  // Surface reflection — the Studio Mate Clipboard engine: a coplanar flipped clone directly below
  // the object, feathered and dimmed. On when the node carries reflection props.
  const content: ReactNode = node.leaf && p.reflection
    ? (() => {
        const dist = p.reflectionDistance ?? 0;
        const reflStyle = { ...reflectionInPlaneStylePct(p, dist), ['--l3rd']: `${dist}px` } as CSSProperties;
        return (
          <div style={{ position: 'relative', width: 'max-content', height: 'max-content', opacity: Math.max(0, Math.min(100, p.reflectionOpacityMain ?? 100)) / 100 }}>
            {leaf}
            <div data-l3-reflection style={reflStyle}><Leaf node={node} silent /></div>
          </div>
        );
      })()
    : leaf;

  return (
    <div style={wrap} data-name={node.name ?? undefined} data-node-id={node.srcId ?? undefined}>
      {content}
      {node.children?.map(c => <DisplayNode key={c.key} node={c} />)}
    </div>
  );
}

// Is the timeline transport running? A video element must free-run while the playhead sweeps but be
// seeked exactly when the playhead is parked, and only the app knows which. This is transport state,
// never document state, so it rides a context instead of the resolver — resolve() stays pure.
export const StagePlaying = createContext(false);

// A video slaved to the timeline. `time` is the media position the resolver computed for this frame
// (pure: trim-in + elapsed/fps). props.autoplay — Stage right-click → Start Play — opts the node in.
//
//   parked (scrub, step, export)  → seek exactly to `time`, so the stage shows the true frame
//   playing                       → let the element run at its own rate, nudged only on real drift
//
// Seeking every frame during playback would stutter and chop the audio; never seeking would drift
// out of sync. The dead band gives smooth playback that still tracks the playhead.
function VideoLeaf({ src, p, time, silent, style }: {
  src: string; p: any; time: number; silent?: boolean; style?: CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const playing = useContext(StagePlaying);
  const on = p.autoplay !== false;   // plays with the timeline unless explicitly switched off
  const start = (p.trimInMs ?? 0) / 1000;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = silent || p.muted !== false;
    v.volume = Math.max(0, Math.min(1, p.volume ?? 1));
  }, [silent, p.muted, p.volume]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (on && playing) v.play().catch(() => {});  // an unmuted play() can be refused by the autoplay policy
    else v.pause();
  }, [on, playing]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const target = on ? time : start;
    const drift = Math.abs(v.currentTime - target);
    if (!(on && playing)) { if (drift > 0.02) v.currentTime = target; }
    else if (drift > 0.25) v.currentTime = target;
  }, [time, on, playing, start]);

  return <video ref={ref} src={src} playsInline preload="auto" style={style} />;
}

// Border style shared by image/video/shape: radius, thickness, colour.
function borderStyle(p: any): CSSProperties {
  return {
    borderRadius: p.borderRadius || p.radius || undefined,
    border: (p.borderWidth ?? 0) > 0 ? `${p.borderWidth}px ${p.borderStyle ?? 'solid'} ${p.borderColor ?? '#ffffff'}` : undefined,
    boxSizing: 'border-box',
  };
}

function Leaf({ node, silent }: { node: RenderNode; silent?: boolean }) {
  const leaf = node.leaf!;
  const p = (leaf.props ?? {}) as any;

  if (leaf.kind === 'image' || leaf.kind === 'video') {
    if (!leaf.assetUrl) return null;
    const w = p.w ?? 320, h = p.h ?? 180;
    const media = leaf.kind === 'video'
      ? <VideoLeaf src={leaf.assetUrl} p={p} time={leaf.mediaTime ?? 0} silent={silent} />
      : <img src={leaf.assetUrl} alt="" draggable={false} />;
    const c = p.crop;
    const cropped = c && (c.x > 0 || c.y > 0 || c.w < 1 || c.h < 1);
    const inner = cropped
      ? (() => { const iw = w / (c.w || 1), ih = h / (c.h || 1);
          return inject(media, { position: 'absolute', left: -c.x * iw, top: -c.y * ih, width: iw, height: ih, objectFit: 'fill', display: 'block' }); })()
      : inject(media, { display: 'block', width: w, height: h, objectFit: 'fill' });
    return <div style={{ width: w, height: h, overflow: 'hidden', position: 'relative', ...borderStyle(p) }}>{inner}</div>;
  }

  if (leaf.kind === 'text') {
    const grad = p.gradient
      ? { backgroundImage: `linear-gradient(${p.gradient.angle ?? 90}deg, ${p.gradient.c1}, ${p.gradient.c2})`,
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }
      : { color: p.color ?? '#ffffff' };
    return (
      <div style={{
        whiteSpace: p.w ? 'pre-wrap' : 'pre',
        width: p.w || 'max-content', height: p.h || 'auto',
        fontFamily: p.font ? `'${p.font}', sans-serif` : 'sans-serif',
        fontSize: p.size ?? 48, fontWeight: p.bold ? 700 : 400, fontStyle: p.italic ? 'italic' : 'normal',
        textAlign: p.align ?? 'left', lineHeight: 1.15,
        padding: (p.borderWidth ?? 0) > 0 ? 6 : 0, ...borderStyle(p), ...grad,
      }}>{p.text ?? ''}</div>
    );
  }

  // shape
  if (p.shape === 'line') {
    return <div style={{ width: p.w ?? 100, borderTop: `${p.strokeWidth ?? 2}px ${p.strokeStyle ?? 'solid'} ${p.stroke ?? '#fff'}` }} />;
  }
  const fill = p.fill2 && p.fill
    ? `linear-gradient(${p.gradientAngle ?? 90}deg, ${p.fill}, ${p.fill2})`
    : (p.fill ?? '#3a3a3a');
  return (
    <div style={{
      width: p.w ?? 100, height: p.h ?? 100,
      background: fill,
      border: (p.strokeWidth ?? p.borderWidth ?? 0) > 0 ? `${p.strokeWidth ?? p.borderWidth}px ${p.strokeStyle ?? 'solid'} ${p.stroke ?? p.borderColor ?? '#fff'}` : undefined,
      borderRadius: p.shape === 'ellipse' ? '50%' : (p.radius ?? p.borderRadius ?? 0),
      boxSizing: 'border-box',
    }} />
  );
}
