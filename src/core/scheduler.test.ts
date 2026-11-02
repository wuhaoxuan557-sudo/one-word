import { expect, it } from 'vitest';
import { Rating, State } from 'ts-fsrs';
import { emptyCard, formatDue, scheduleCard } from './scheduler';

const now = new Date(2026, 10, 2, 10).getTime();
it.each(['Again', 'Hard', 'Good', 'Easy'] as const)('uses actual FSRS scheduling for %s without mutating its input', rating => {
  const card = emptyCard('test', now);
  const copy = structuredClone(card);
  const result = scheduleCard(card, rating, now);
  expect(result.log.rating).toBe(Rating[rating]);
  expect(result.card.reps).toBe(1);
  expect(result.card.due.getTime()).toBeGreaterThan(now);
  expect(card).toEqual(copy);
  expect(result).toEqual(scheduleCard(card, rating, now));
});
it('uses minute-based learning steps and refuses slashed cards', () => {
  const card = emptyCard('test', now);
  expect(scheduleCard(card, 'Again', now).card.due.getTime()).toBe(now + 60_000);
  expect(scheduleCard(card, 'Good', now).card.due.getTime()).toBe(now + 600_000);
  expect(scheduleCard(card, 'Good', now).card.state).toBe(State.Learning);
  expect(scheduleCard(card, 'Easy', now).card.state).toBe(State.Review);
  expect(() => scheduleCard({ ...card, slashed: true }, 'Good', now)).toThrow();
});
it.each([[0, '现在'], [1, '1 分钟后'], [60_000, '1 分钟后'], [60_001, '2 分钟后'],
  [3_600_000, '1 小时后'], [86_400_000, '1 天后'], [3 * 86_400_000, '3 天后']] as const)('formats the actual due interval %s', (interval, label) => {
  expect(formatDue(now + interval, now)).toBe(label);
});
