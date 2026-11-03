import { expect, it } from 'vitest';
import { statistics } from './statistics';
import { scheduleCard, emptyCard } from './scheduler';
import { freshSnapshot, studyTime as now } from './study.test-helper';
import { localDay } from './queue';
import type { ReviewEntry } from '../types';

function log(id: string, wordId: string, date: number, correct: boolean): ReviewEntry {
  const rating = correct ? 'Good' : 'Again'; const result = scheduleCard(emptyCard(wordId, date), rating, date);
  return { id, wordId, day: localDay(date), kind: 'review', selectedId: correct ? wordId : null, correct,
    elapsedMs: 3000, answeredAt: date, rating, dueAt: result.card.due.getTime(), fsrsLog: result.log };
}
it('returns thirty local calendar days and null accuracy for days without answers', () => {
  const result = statistics(freshSnapshot(), now);
  expect(result.days).toHaveLength(30); expect(result.days[0]?.day).toBe('2026-10-04');
  expect(result.days[29]?.day).toBe('2026-11-02'); expect(result.accuracy).toBeNull(); expect(result.dailyAverage).toBe(0);
});
it('counts repetitions but uses only each word first answer per day for weighted accuracy', () => {
  const input = freshSnapshot();
  input.logs = [log('later', 'apple', now - 1000, true), log('first', 'apple', now - 2000, false),
    log('other', 'table', now - 500, true), log('yesterday', 'apple', now - 86_400_000, true),
    log('old', 'chair', now - 40 * 86_400_000, false), log('future', 'river', now + 1, true)];
  input.cards = [{ ...emptyCard('tree', now), slashed: true }, { ...emptyCard('star', now), bookmarked: true }];
  const result = statistics(input, now);
  expect(result.days[29]).toMatchObject({ reviews: 3, firstCount: 2, firstCorrect: 1, accuracy: 0.5 });
  expect(result.days[28]?.accuracy).toBe(1); expect(result.accuracy).toBe(2 / 3); expect(result.dailyAverage).toBe(4 / 30);
  expect(result).toMatchObject({ learned: 3, slashed: 1, bookmarked: 1 });
});
it('handles midnight and month boundaries with no dependence on stored timezone day labels', () => {
  const midnight = new Date(2026, 10, 1).getTime(); const input = freshSnapshot();
  input.logs = [log('before', 'apple', midnight - 1, true), log('after', 'apple', midnight, false)];
  const result = statistics(input, midnight + 1);
  expect(result.days[28]).toMatchObject({ day: '2026-10-31', reviews: 1, accuracy: 1 });
  expect(result.days[29]).toMatchObject({ day: '2026-11-01', reviews: 1, accuracy: 0 });
});
it('calculates days and first-answer accuracy using the dataset timezone', () => {
  const snapshot = freshSnapshot(); snapshot.settings.syncTimeZone = 'Asia/Tokyo';
  const at = Date.parse('2026-11-03T15:00:00Z');
  snapshot.logs = [log('a', 'apple', at - 1, true), log('b', 'apple', at, false)];
  const result = statistics(snapshot, at);
  expect(result.days.at(-1)).toMatchObject({ day: '2026-11-04', reviews: 1, firstCount: 1, accuracy: 0 });
});
