import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { loadProject } from './api';
import { IntroClock } from './lib/clock';
import { IntroStage } from './components/IntroStage';
import { stageSize } from './project';
import type { IntroProject } from './types';

// The page the exporter screenshots — and a plain 1:1 preview when opened by hand.
// It exposes exactly two things to Playwright: `introReady` and `introSeek(ms)`.
declare global {
  interface Window {
    introReady?: boolean;
    introSeek?: (ms: number) => Promise<void>;
    introProject?: IntroProject;
  }
}

function RenderApp() {
  const params = new URLSearchParams(location.search);
  const id = params.get('project') ?? '';
  const [project, setProject] = useState<IntroProject | null>(null);
  const clock = useMemo(() => new IntroClock(), []);

  useEffect(() => { loadProject(id).then(setProject).catch(e => console.error('[IntroMate] load failed', e)); }, [id]);

  useEffect(() => {
    if (!project) return;
    window.introProject = project;
    window.introSeek = (ms: number) => clock.seekExact(ms);

    let cancelled = false;
    (async () => {
      await document.fonts.ready;
      // Every image/video in the stage must have real pixels before frame 0 is captured.
      const media = [...document.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video')];
      await Promise.all(media.map(m => new Promise<void>(res => {
        const done = () => res();
        if (m instanceof HTMLImageElement) { if (m.complete) return res(); m.addEventListener('load', done); m.addEventListener('error', done); }
        else { if (m.readyState >= 2) return res(); m.addEventListener('loadeddata', done); m.addEventListener('error', done); }
        setTimeout(done, 8000);
      })));
      await new Promise(r => setTimeout(r, 120));
      await clock.seekExact(0);
      if (!cancelled) window.introReady = true;
    })();
    return () => { cancelled = true; };
  }, [project, clock]);

  if (!project) return null;
  const { vw, vh } = stageSize(project);
  // The viewport is set to the stage size by the renderer, so scale is 1:1.
  return <IntroStage project={project} clock={clock} boxW={window.innerWidth || vw} boxH={window.innerHeight || vh} />;
}

// No StrictMode here: its double-mount would build the animation set twice, and a render must be
// bit-identical to what the editor previews.
createRoot(document.getElementById('root')!).render(<RenderApp />);
