import { createRoot } from 'react-dom/client';
import './styles.css';
import './flash/flash.css';
import FlashApp from './flash/FlashApp';

// The Flash-style authoring tool. Mounted at /flash.html. No StrictMode: the paused-animation /
// frame-resolver model must mount once so the preview matches the renderer exactly.
createRoot(document.getElementById('root')!).render(<FlashApp />);
