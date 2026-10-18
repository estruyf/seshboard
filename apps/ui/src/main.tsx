import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { PopoutApp } from './components/popout/PopoutApp.tsx';
import { popoutSession } from './state/popoutsStore.ts';
import { receiveSessionView } from './state/sessionView.ts';
import './styles.css';
// Applies the theme (a generated style element) before the first render.
import './state/themeStore.ts';

// Focus rings only while navigating with Tab; any pointer use hides them again (see styles.css).
// Checked after the event has been handled: a Tab a control keeps for itself (picking a slash command,
// Shift+Tab for the permission mode, the shell in the terminal) leaves focus where it was, so no ring.
const root = document.documentElement;
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  if (event.defaultPrevented && document.activeElement === event.target) return;
  root.setAttribute('data-keyboard-nav', '');
});
window.addEventListener('pointerdown', () => root.removeAttribute('data-keyboard-nav'), true);

// A pop-out opens with the panels its session had open in the main window, from its first paint.
if (popoutSession) receiveSessionView(popoutSession, window.switchboard?.popoutView);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* A pop-out window shows one session (`?popout=<id>`); the main window shows the whole app. */}
    {popoutSession ? <PopoutApp sessionId={popoutSession} /> : <App />}
  </StrictMode>,
);
