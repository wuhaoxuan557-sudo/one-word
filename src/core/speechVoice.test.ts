import { expect, it } from 'vitest';
import { selectEnglishVoice } from './speechVoice';

const remote = { lang: 'en-GB', localService: false };
const local = { lang: 'en-US', localService: true };
it('prefers a local English voice even over a remote preferred accent', () => {
  expect(selectEnglishVoice([remote, local], 'en-GB')).toBe(local);
});
it('allows remote English when no local English exists', () => {
  expect(selectEnglishVoice([{ lang: 'zh-CN', localService: true }, remote], 'en-GB')).toBe(remote);
});
it('prefers the requested accent within the local group and normalises language tags', () => {
  const british = { lang: 'en_GB', localService: true };
  expect(selectEnglishVoice([local, british], 'en-GB')).toBe(british);
  expect(selectEnglishVoice([local, british], 'en-US')).toBe(local);
});
it('returns no explicit voice for an empty or non-English list', () => {
  expect(selectEnglishVoice([], 'en-GB')).toBeUndefined();
  expect(selectEnglishVoice([{ lang: 'zh-CN', localService: true }], 'en-GB')).toBeUndefined();
});
