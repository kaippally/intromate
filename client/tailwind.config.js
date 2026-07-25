const SM = process.env.SM_SRC ?? 'C:/KC_Assets/StudioMate/client/src';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './render.html',
    './src/**/*.{ts,tsx}',
    // The Studio Mate render components imported under @sm carry their own utility classes.
    `${SM}/titles/render/*.tsx`,
    `${SM}/components/Slide*.tsx`,
    `${SM}/components/PerspectiveGrid.tsx`,
  ],
  theme: { extend: {} },
  plugins: [],
};
