import { expect, it } from 'vitest';
import { quotaUsage } from './quota';
import { calendarDay, calendarMidnight } from './calendar';
import { devices, fact, slash, time } from './fixtures.test-helper';
import { uuid5 } from './identity';
import type { SyncEvent } from './model';

it('counts global distinct introductions once while retaining every real attempt', () => {
  const a = fact('a'), b = fact('b', devices[1], time + 1000), c = fact('c', devices[2], time + 2000, { wordId: 'table', selectedId: 'table' });
  expect(quotaUsage([a, b, c], [], time + 3000, 'Asia/Tokyo')).toMatchObject({ completed: 3, newIds: ['apple', 'table'], reviewIds: [] });
  const tomorrow = time + 86_400_000;
  const repeat = fact('repeat', devices[0], tomorrow);
  expect(quotaUsage([a, b, c, repeat], [], tomorrow, 'Asia/Tokyo')).toMatchObject({ completed: 1, newIds: [], reviewIds: ['apple'] });
});

it('retains slash quota independently of the final flag and cancels it only through its undo event', () => {
  const s = slash('s'); const resume = slash('resume', devices[1], time + 1000, false);
  expect(quotaUsage([], [s, resume], time + 2000, 'UTC')).toMatchObject({ completed: 1, newIds: ['apple'] });
  const undo: SyncEvent = { id: uuid5('undo'), deviceId: devices[0], clock: [time + 2000, 0], at: time + 2000, type: 'undo-slash', targetId: s.id, wordId: 'apple', value: false };
  expect(quotaUsage([], [s, undo], time + 2000, 'UTC')).toMatchObject({ completed: 0, newIds: [] });
  expect(quotaUsage([fact('old', devices[1], time - 86_400_000)], [s], time + 2000, 'UTC').reviewIds).toEqual(['apple']);
});

it('uses a shared day at midnight and works across DST instead of assuming 24-hour days', () => {
  const t = Date.parse('2026-11-03T15:00:00Z');
  expect(calendarDay(t - 1, 'Asia/Tokyo')).toBe('2026-11-03');
  expect(calendarDay(t, 'Asia/Tokyo')).toBe('2026-11-04');
  expect(calendarDay(t, 'America/Los_Angeles')).toBe('2026-11-03');
  expect(quotaUsage([fact('x', devices[0], t - 1), fact('y', devices[1], t)], [], t, 'Asia/Tokyo')).toMatchObject({ completed: 1, newIds: [], reviewIds: ['apple'] });
  const spring = Date.parse('2026-03-08T05:00:00Z');
  expect(calendarMidnight(spring, 'America/New_York') - spring).toBe(23 * 3_600_000);
  const fall = Date.parse('2026-11-01T04:00:00Z');
  expect(calendarMidnight(fall, 'America/New_York') - fall).toBe(25 * 3_600_000);
  expect(() => calendarDay(t, 'Not/AZone')).toThrow('时区');
});
