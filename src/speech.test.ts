import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cancelSpeech, speak } from './speech';
import type { VoiceInfo } from './core/speechVoice';

class TestUtterance {
  constructor(public text: string) {}
  lang = '';
  rate = 1;
  voice: VoiceInfo | undefined;
  onstart: (() => void) | undefined;
  onerror: ((event: { error: string }) => void) | undefined;
}
let voices: VoiceInfo[];
let events: EventTarget;
const spoken = vi.fn<(utterance: TestUtterance) => void>();
beforeEach(() => {
  vi.useFakeTimers(); voices = []; events = new EventTarget(); spoken.mockClear();
  vi.stubGlobal('SpeechSynthesisUtterance', TestUtterance);
  vi.stubGlobal('window', {
    setTimeout, clearTimeout, SpeechSynthesisUtterance: TestUtterance,
    speechSynthesis: {
      getVoices: () => voices, cancel: vi.fn(), speak: spoken,
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    },
  });
});
afterEach(() => { cancelSpeech(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('waits for late voice loading and speaks exactly once', () => {
  speak('apple');
  expect(spoken).not.toHaveBeenCalled();
  voices = [{ lang: 'en-GB', localService: true }];
  events.dispatchEvent(new Event('voiceschanged'));
  vi.advanceTimersByTime(1000);
  expect(spoken).toHaveBeenCalledTimes(1);
  expect(spoken.mock.calls[0]?.[0].voice).toBe(voices[0]);
});
it('allows a remote English voice without reporting unavailable', () => {
  voices = [{ lang: 'en-US', localService: false }];
  const result = vi.fn(); speak('apple', result);
  expect(spoken.mock.calls[0]?.[0].voice).toBe(voices[0]);
  expect(result).not.toHaveBeenCalled();
});
it('cancels pending speech when changing cards or leaving the session', () => {
  speak('old'); speak('new');
  vi.advanceTimersByTime(750);
  expect(spoken).toHaveBeenCalledTimes(1);
  expect(spoken.mock.calls[0]?.[0].text).toBe('new');
  spoken.mockClear(); speak('cancelled'); cancelSpeech();
  vi.advanceTimersByTime(1000);
  expect(spoken).not.toHaveBeenCalled();
});
