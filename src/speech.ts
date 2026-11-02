export type SpeechResult = 'unavailable' | 'blocked' | 'started';

export function speak(word: string, onResult: (result: SpeechResult) => void = () => {}, accent: 'en-GB' | 'en-US' = 'en-GB'): void {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    onResult('unavailable');
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(item => item.lang.toLowerCase() === accent.toLowerCase())
    ?? voices.find(item => /^en[-_]/i.test(item.lang));
  if (voice) utterance.voice = voice;
  utterance.lang = accent;
  utterance.rate = 0.9;
  utterance.onstart = () => onResult('started');
  utterance.onerror = event => {
    if (event.error !== 'canceled' && event.error !== 'interrupted') onResult('blocked');
  };
  window.speechSynthesis.speak(utterance);
}
