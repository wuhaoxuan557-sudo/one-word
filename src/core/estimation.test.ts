import { expect, it } from 'vitest';
import type { ReviewEntry } from '../types';
import { estimateCardMs, estimateMinutes } from './queue';
import { emptyCard, scheduleCard } from './scheduler';
import { studyTime as now } from './study.test-helper';

const result = scheduleCard(emptyCard('apple', now), 'Good', now);
const entry: ReviewEntry = { id: 'sample', day: '2026-11-02', wordId: 'apple', kind: 'new', selectedId: 'apple',
  correct: true, elapsedMs: 1000, answeredAt: now, rating: 'Good', dueAt: result.card.due.getTime(), fsrsLog: result.log };

it('uses the exact per-kind defaults at n=0', () => {
  expect(estimateCardMs('new', [])).toBe(25_000);
  expect(estimateCardMs('review', [])).toBe(8_000);
});

it('shrinks new and review histories independently with k=20', () => {
  const history = [
    ...Array.from({ length: 20 }, () => ({ ...entry, kind: 'new' as const, studyMs: 1000 })),
    ...Array.from({ length: 20 }, () => ({ ...entry, kind: 'review' as const, studyMs: 2000 })),
  ];
  expect(estimateCardMs('new', history)).toBe(13_000);
  expect(estimateCardMs('review', history)).toBe(5000);
  expect(estimateMinutes(20, 30, history)).toBe(7);
});

it.each(['new', 'review'] as const)('converges to the historical mean with many %s observations', kind => {
  const history = Array.from({ length: 100_000 }, (_, i) => ({ ...entry, kind, studyMs: i % 2 ? 35_000 : 45_000 }));
  expect(Math.abs(estimateCardMs(kind, history) - 40_000)).toBeLessThan(7);
});

it('uses complete card durations, excluding unfinished, legacy and invalid observations', () => {
  const history = [entry, ...[NaN, Infinity, -1].map(studyMs => ({ ...entry, studyMs }))];
  expect(estimateCardMs('new', history)).toBe(25_000);
  expect(estimateCardMs('new', [...history, { ...entry, studyMs: 40_000 }])).toBe((40_000 + 20 * 25_000) / 21);
});
