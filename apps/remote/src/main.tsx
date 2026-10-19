import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { storedAppIcon } from './lib/appIcon.ts';
import { showAppIcon } from './lib/favicon.ts';
import { registerWorker } from './lib/push.ts';
import './styles.css';

// Only for notifications (public/sw.js): it caches nothing.
registerWorker();
// The computer's app icon from last time, so Add to Home Screen takes it even before the computer answers.
showAppIcon(storedAppIcon(() => localStorage));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
