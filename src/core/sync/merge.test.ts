import { expect, it } from 'vitest';
import { mergeShared, materializeShared, parseShared } from './merge';
import type { ReplayCache } from './merge';
import { emptyShared, PROFILE_ID } from './model';
import type { SyncEvent } from './model';
import { devices, fact, slash, state, time } from './fixtures.test-helper';
import { uuid5 } from './identity';
import { emptyCard, scheduleCard, SCHEDULER_CONFIG } from '../scheduler';

it('is idempotent, commutative and associative across three devices, six orders and repeated merges', () => {
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (let seed = 0; seed < 30; seed++) {
    const common = fact(`common-${seed}`);
    const copies = devices.map((device, i) => state([common, fact(`${seed}-${i}`, device, time + (seed + i) % 3 * 1000,
      i === 1 ? { selectedId: null, correct: false, rating: 'Again' } : {})], [slash(`s-${seed}-${i}`, device, time + seed, i !== 2)]));
    const [a, b, c] = copies;
    expect(mergeShared(a!, a!)).toEqual(parseShared(a));
    expect(mergeShared(a!, b!)).toEqual(mergeShared(b!, a!));
    const expected = mergeShared(mergeShared(a!, b!), c!);
    expect(expected).toEqual(mergeShared(a!, mergeShared(b!, c!)));
    const projected = materializeShared(expected, 'Asia/Tokyo');
    for (const order of orders) {
      const merged = order.reduce((acc, i) => mergeShared(acc, copies[i]!), emptyShared());
      expect(merged).toEqual(expected);
      expect(materializeShared(merged, 'Asia/Tokyo')).toEqual(projected);
      expect(mergeShared(merged, copies[order[0]!]!)).toEqual(expected);
    }
  }
});

it('replays saved ratings in timestamp and UUID order with the fixed FSRS profile', () => {
  expect(PROFILE_ID).toBe('ts-fsrs-5.4.2/one-word-1');
  expect(SCHEDULER_CONFIG).toEqual({ request_retention: 0.9, enable_fuzz: false, enable_short_term: true, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] });
  const a = fact('old', devices[0], time, { rating: 'Hard' });
  const b = fact('later', devices[1], time + 5000, { rating: 'Again', selectedId: null, correct: false });
  const combined = mergeShared(state([b]), state([a]));
  const actual = materializeShared(combined);
  let card = emptyCard('apple', time); card = { ...card, fsrs: scheduleCard(card, 'Hard', time).card };
  card = { ...card, fsrs: scheduleCard(card, 'Again', time + 5000).card };
  expect(actual.cards[0]!.fsrs).toEqual(card.fsrs);
  expect(actual.cards[0]!.everWrong).toBe(true);
  expect(actual.logs.map(log => log.rating)).toEqual(['Hard', 'Again']);
  expect(materializeShared(mergeShared(state([a]), emptyShared())).cards).toEqual(materializeShared(state([a])).cards);
});

it('preserves both concurrent reviews, merges completed duration monotonically and rejects UUID corruption', () => {
  const a = fact('a'); const b = fact('b', devices[1]);
  const complete = { ...a, studyMs: 5000 }; const later = { ...a, studyMs: 9000 };
  const combined = mergeShared(state([a, b]), state([complete]));
  expect(combined.reviews).toHaveLength(2);
  expect(mergeShared(combined, state([later])).reviews.find(r => r.id === a.id)?.studyMs).toBe(9000);
  const left = mergeShared(state([later]), mergeShared(state([complete]), state([a])));
  const right = mergeShared(mergeShared(state([later]), state([complete])), state([a]));
  expect(left.reviews).toEqual(right.reviews);
  expect(() => mergeShared(state([a]), state([{ ...a, elapsedMs: 4000 }]))).toThrow('UUID');
  expect(() => parseShared({ ...state(), profileId: 'different' })).toThrow('版本');
});

it('uses per-field clocks, deterministic equal-ms ties and a valid threshold group', () => {
  const preference = (name: string, deviceId: string, key: 'newLimit' | 'autoSpeak', value: number | boolean) => ({ id: uuid5(name), deviceId, clock: [time, 0], at: time, type: 'preference', key, value } as SyncEvent);
  const a = state([], [preference('limit-a', devices[0], 'newLimit', 10), preference('speak', devices[0], 'autoSpeak', false)]);
  const b = state([], [preference('limit-b', devices[1], 'newLimit', 30)]);
  const merged = materializeShared(mergeShared(a, b));
  expect(merged.preferences.newLimit).toBe(30); expect(merged.preferences.autoSpeak).toBe(false);
  expect(() => parseShared(state([], [{ id: uuid5('bad-threshold'), deviceId: devices[0], clock: [time, 0], at: time,
    type: 'preference', key: 'grading', value: { easyMs: 9000, hardMs: 1000 } }]))).toThrow();
});

it('merges slash/undo with new reviews without restoring an old FSRS snapshot', () => {
  const s = slash('slash', devices[0], time);
  const undo: SyncEvent = { id: uuid5('undo'), deviceId: devices[0], clock: [time + 2000, 0], at: time + 2000,
    type: 'undo-slash', wordId: 'apple', targetId: s.id, value: false };
  const answer = fact('concurrent-answer', devices[1], time + 1000);
  const merged = mergeShared(state([answer]), state([], [s, undo]));
  expect(materializeShared(merged).cards[0]!.slashed).toBe(false);
  expect(materializeShared(merged).cards[0]!.fsrs.reps).toBe(1);
  const bookmark: SyncEvent = { id: uuid5('concurrent-bookmark'), type: 'bookmark', deviceId: devices[1], clock: [time + 1500, 0], at: time + 1500, wordId: 'apple', value: true };
  expect(materializeShared(mergeShared(merged, state([], [bookmark]))).cards[0]!.bookmarked).toBe(true);
  const newer = slash('later-slash', devices[2], time + 3000);
  expect(materializeShared(mergeShared(merged, state([], [newer]))).cards[0]!.slashed).toBe(true);
  expect(mergeShared(state([], [undo]), state([], [s]))).toEqual(mergeShared(state([], [s]), state([], [undo])));
});

it('reapplies a resume due override only until the next real answer', () => {
  const a = fact('a'); const resume = slash('resume', devices[1], time + 1000, false);
  expect(materializeShared(state([a], [resume])).cards[0]!.fsrs.due.getTime()).toBe(time + 1000);
  const b = fact('b', devices[0], time + 2000);
  expect(materializeShared(state([a, b], [resume])).cards[0]!.fsrs.due.getTime()).toBeGreaterThan(time + 2000);
});

it('reuses unchanged per-word histories without allowing output mutation to corrupt cached FSRS', () => {
  const cache: ReplayCache = new Map(); const a = state([fact('a')]);
  const first = materializeShared(a, 'UTC', cache); const entry = cache.get('apple');
  first.cards[0]!.fsrs.reps = 999;
  const second = materializeShared(a, 'UTC', cache);
  expect(second.cards[0]!.fsrs.reps).toBe(1); expect(cache.get('apple')).toBe(entry);
  const extended = state([...a.reviews, fact('table', devices[1], time + 1000, { wordId: 'table', selectedId: 'table' })]);
  expect(materializeShared(extended, 'UTC', cache)).toEqual(materializeShared(extended, 'UTC'));
  expect(cache.get('apple')).toBe(entry);
});
