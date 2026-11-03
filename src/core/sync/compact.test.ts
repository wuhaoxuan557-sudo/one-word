import { expect, it } from 'vitest';
import { compactReview, decodeDeviceFile, DEVICE_FILE_LIMIT, encodeDeviceMonth, utf8Bytes } from './compact';
import { devices, fact, slash, state, time } from './fixtures.test-helper';
import { mergeShared, parseShared } from './merge';
import { emptyShared } from './model';
import { uuid5 } from './identity';

it('roundtrips tuple records, snapshots, preferences and imported provenance without local-only state', () => {
  const original = state([fact('a'), fact('b', devices[1], time, { studyMs: 9000 })], [slash('s'),
    { id: uuid5('settings'), deviceId: devices[0], clock: [time, 1], at: time, type: 'preference', key: 'grading', value: { easyMs: 1500, hardMs: 6500 } },
    { id: uuid5('word'), deviceId: devices[0], clock: [time, 2], at: time, type: 'word', wordId: 'apple', value: { word: 'apple', translation: 'n. 苹果', translationFull: 'n. 苹果；苹果树' } }]);
  const files = encodeDeviceMonth(original, devices[0], '2026-11', 'Asia/Tokyo');
  expect(files[0]!.name).toBe(`device-${devices[0]}-2026-11.json`);
  const restored = files.reduce((acc, file) => mergeShared(acc, decodeDeviceFile(file.content, devices[0], '2026-11').state), emptyShared());
  expect(restored).toEqual(parseShared(original));
  expect(Array.isArray(JSON.parse(files[0]!.content).r[0])).toBe(true);
  expect(files[0]!.content).not.toContain('fsrsLog');
});

it('splits at actual UTF-8 bytes including the envelope and refuses oversized or truncated records', () => {
  const reviews = Array.from({ length: 6000 }, (_, i) => fact(`bulk-${i}`, devices[0], time + i, { wordId: 'ecdict:representative', selectedId: 'ecdict:representative', studyMs: 25000 }));
  const original = state(reviews);
  const files = encodeDeviceMonth(original, devices[0], '2026-11', 'UTC');
  expect(files.length).toBeGreaterThan(1); expect(files[1]!.name).toContain('-2026-11-2.json');
  expect(files.every(file => file.bytes === utf8Bytes(file.content) && file.bytes <= DEVICE_FILE_LIMIT)).toBe(true);
  expect(files.map(file => decodeDeviceFile(file.content).state.reviews.length).reduce((a, b) => a + b, 0)).toBe(6000);
  expect(() => decodeDeviceFile(files[0]!.content, undefined, undefined, true)).toThrow('截断');
  expect(() => decodeDeviceFile(files[0]!.content, devices[1])).toThrow('不一致');
  expect(() => encodeDeviceMonth(state([], [{ id: uuid5('huge'), deviceId: devices[0], clock: [time, 0], at: time,
    type: 'word', wordId: 'apple', value: { word: 'apple', translation: '字'.repeat(DEVICE_FILE_LIMIT) } }]), devices[0], '2026-11', 'UTC')).toThrow('单条');
});

it('measures compact completed/correct/wrong/missing-duration records in bytes', () => {
  const samples = [fact('short'), fact('full', devices[0], time, { wordId: 'ecdict:representative', selectedId: 'ecdict:representative', studyMs: 25000 }),
    fact('wrong', devices[0], time, { selectedId: null, correct: false, rating: 'Again' })];
  const bytes = samples.map(log => utf8Bytes(JSON.stringify(compactReview(log, devices[0]))));
  expect(bytes.every(size => size < 200)).toBe(true);
  expect(utf8Bytes('字')).toBe(3);
});
