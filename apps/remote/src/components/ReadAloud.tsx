import { useSyncExternalStore } from 'react';
import { Square, Volume2 } from 'lucide-react';
import { speakableParts } from '../lib/speech.ts';
import { toast } from './Toasts.tsx';

/**
 * Read aloud, with the phone's own voice (`speechSynthesis`): nothing goes to a server. One reply speaks at a time, so
 * the reply that speaks is shared state here. iOS only speaks after a tap, so every part is queued in the tap itself.
 */

let speaking: string | null = null;
const listeners = new Set<() => void>();
const set = (key: string | null) => {
  speaking = key;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The browser can speak (Firefox on Linux and some web views can't). */
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** Stops what is being said, if anything: leaving the session, or Stop. */
export function stopSpeaking() {
  if (!canSpeak() || speaking === null) return;
  set(null);
  window.speechSynthesis.cancel();
}

function speak(key: string, text: string) {
  const parts = speakableParts(text);
  if (!parts.length) {
    toast('Nothing to read aloud: this reply is only code.');
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  set(key);
  const lang = document.documentElement.lang || 'en';
  parts.forEach((part, index) => {
    const utterance = new SpeechSynthesisUtterance(part);
    utterance.lang = lang;
    // A part that ends or fails after Stop, or after another reply started, changes nothing.
    if (index === parts.length - 1) utterance.onend = () => speaking === key && set(null);
    utterance.onerror = (event) => {
      if (speaking !== key) return;
      set(null);
      if (event.error !== 'interrupted' && event.error !== 'canceled') toast("Couldn't read this reply aloud.", { tone: 'error' });
    };
    synth.speak(utterance);
  });
  // Safari can pause a queue it was given while the page was in the background.
  synth.resume();
}

/** Read aloud under a finished reply, and Stop while it speaks. Quiet, beside Copy. */
export function ReadAloudButton({ id, text }: { id: string; text: string }) {
  const current = useSyncExternalStore(subscribe, () => speaking);
  if (!canSpeak()) return null;
  const on = current === id;
  return (
    <button
      type="button"
      onClick={() => (on ? stopSpeaking() : speak(id, text))}
      aria-pressed={on}
      className={`flex min-h-8 w-fit items-center gap-1 rounded-md px-1.5 text-meta hover:bg-border/50 hover:text-text pointer-fine:min-h-6 ${on ? 'text-accent-ink' : 'text-faint'}`}
      data-remote-read-aloud={on ? 'speaking' : 'idle'}
    >
      {on ? <Square className="size-3.5" aria-hidden /> : <Volume2 className="size-3.5" aria-hidden />}
      {on ? 'Stop' : 'Listen'}
    </button>
  );
}
