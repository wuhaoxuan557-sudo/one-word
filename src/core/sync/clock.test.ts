import { expect, it } from 'vitest';
import { advanceClock, compareEvents } from './clock';
import { devices, slash, time } from './fixtures.test-helper';

it('advances within the same millisecond, after receiving remote time and after clock rollback', () => {
  expect(advanceClock([time, 0], time)).toEqual([time, 1]);
  expect(advanceClock([time, 4], time - 1000)).toEqual([time, 5]);
  expect(advanceClock([time, 4], time, [time + 1000, 8])).toEqual([time + 1000, 9]);
  expect(advanceClock([time, 4], time, [time, 8])).toEqual([time, 9]);
  expect(advanceClock([0, 0], time)).toEqual([time, 0]);
  expect(() => advanceClock([time, Number.MAX_SAFE_INTEGER], time)).toThrow('安全范围');
  expect(() => advanceClock([0, 0], NaN)).toThrow('不正确');
});

it('resolves equal timestamps by logical counter, device UUID and event UUID', () => {
  const a = slash('a', devices[0]), b = slash('b', devices[1]);
  expect(compareEvents(a, b)).toBeLessThan(0);
  expect(compareEvents({ ...a, clock: [time, 1] }, b)).toBeGreaterThan(0);
  expect(compareEvents(a, a)).toBe(0);
  expect(Math.sign(compareEvents(a, b))).toBe(-Math.sign(compareEvents(b, a)));
});
