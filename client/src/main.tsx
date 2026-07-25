import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';

// No StrictMode: its double-mount would build every element's animation set twice, which the
// clock would then have to un-pick. The editor must show exactly what the renderer captures.
createRoot(document.getElementById('root')!).render(<App />);
