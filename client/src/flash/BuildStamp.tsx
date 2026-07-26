import { useEffect, useState } from 'react';

// The build stamp: proof of what is actually running on screen.
//
//   v0.1.0 · 2026-07-26 01:52 · hmr 3
//
// VERSION/BUILD are injected by vite.config.ts — BUILD changes when the dev server restarts or a
// production build runs. The hmr counter ticks every time Vite hot-applies an edit, so a change
// landing in the browser is visible immediately without reading the console or reloading. If the
// counter does not move after an edit, HMR did not reach this page and it needs a reload.
export function BuildStamp() {
  const [hmr, setHmr] = useState(0);

  useEffect(() => {
    if (!import.meta.hot) return;
    const bump = () => setHmr(n => n + 1);
    import.meta.hot.on('vite:afterUpdate', bump);
    return () => import.meta.hot?.off('vite:afterUpdate', bump);
  }, []);

  return (
    <span className="text-[10px] leading-none text-slate-500 tabular-nums" title="version · build · hot updates applied since load">
      v{__APP_VERSION__} · {__APP_BUILD__}{hmr > 0 && <span className="text-emerald-400"> · hmr {hmr}</span>}
    </span>
  );
}
