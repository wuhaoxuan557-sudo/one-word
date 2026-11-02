export interface VoiceInfo { lang: string; localService: boolean }

export function selectEnglishVoice<T extends VoiceInfo>(voices: readonly T[], accent: 'en-GB' | 'en-US'): T | undefined {
  const language = (voice: T) => voice.lang.toLowerCase().replaceAll('_', '-');
  const english = voices.filter(voice => /^en(?:-|$)/.test(language(voice)));
  const preference = (voice: T) => (voice.localService ? 0 : 10) +
    (language(voice) === accent.toLowerCase() ? 0 : /en-(gb|us)/.test(language(voice)) ? 1 : 2);
  return [...english].sort((a, b) => preference(a) - preference(b))[0];
}
