import { selectEnglishVoice } from './core/speechVoice';

export type SpeechResult = 'unsupported' | 'failed' | 'started';
let requestId = 0;
let disposePending: (() => void) | undefined;

export function cancelSpeech(): void {
  requestId++;
  disposePending?.();
  disposePending = undefined;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

export function speak(word: string, onResult: (result: SpeechResult) => void = () => {}, accent: 'en-GB' | 'en-US' = 'en-GB'): void {
  cancelSpeech();
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { onResult('unsupported'); return; }
  const id = requestId;
  const synth = window.speechSynthesis;
  const play = () => {
    if (id !== requestId) return;
    disposePending?.();
    disposePending = undefined;
    const voice = selectEnglishVoice(synth.getVoices(), accent);
    const utterance = new SpeechSynthesisUtterance(word);
    if (voice) utterance.voice = voice;
    // An empty voice list may still support the browser's language-based default.
    utterance.lang = voice?.lang ?? accent;
    utterance.rate = 0.9;
    utterance.onstart = () => { if (id === requestId) onResult('started'); };
    utterance.onerror = event => {
      if (id === requestId && event.error !== 'canceled' && event.error !== 'interrupted') onResult('failed');
    };
    synth.speak(utterance);
  };
  if (synth.getVoices().length) play();
  else {
    const timer = window.setTimeout(play, 750);
    synth.addEventListener('voiceschanged', play, { once: true });
    disposePending = () => { window.clearTimeout(timer); synth.removeEventListener('voiceschanged', play); };
  }
}
