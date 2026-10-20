import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { registerWorker } from './lib/push.ts';
import './styles.css';

// Only for notifications (public/sw.js): it caches nothing.
registerWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
