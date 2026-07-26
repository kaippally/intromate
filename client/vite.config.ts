import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// The Studio Mate client source IS the motion engine: effects, the L3 track renderer, the
// surface-reflection engine and the slide/slab styles are imported straight from it under `@sm`,
// never copied. Studio Mate is read-only from here — IntroMate adds the seekable clock on top.
const SM_SRC = process.env.SM_SRC ?? 'C:/KC_Assets/StudioMate/client/src';

// Build stamp shown in the UI. VERSION is the package version; BUILD is minted whenever this config
// is evaluated — i.e. when the Vite server starts or a production build runs. Together with the live
// HMR counter in BuildStamp they answer "is the code on my screen the code I just edited?".
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
const BUILD = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(BUILD),
  },
  resolve: {
    alias: {
      '@sm': SM_SRC,
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5200,
    strictPort: true,
    fs: { allow: [resolve(__dirname, '..'), SM_SRC, resolve(SM_SRC, '../..')] },
    proxy: {
      '/api': { target: 'http://localhost:4040', changeOrigin: true },
      '/exports': { target: 'http://localhost:4040', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        render: resolve(__dirname, 'render.html'),
        flash: resolve(__dirname, 'flash.html'),
      },
    },
  },
});
