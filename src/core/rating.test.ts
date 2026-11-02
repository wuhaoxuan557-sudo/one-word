import { expect, it } from 'vitest';
import { gradeAnswer } from './rating';

it.each([
  [false, 0, false, 'Again'], [false, 10000, true, 'Again'],
  [true, 1999, false, 'Easy'], [true, 2000, false, 'Easy'],
  [true, 2001, false, 'Good'], [true, 6000, false, 'Good'],
  [true, 5999, false, 'Good'], [true, 0, false, 'Easy'],
  [true, 6001, false, 'Hard'], [true, 1000, true, 'Good'],
  [true, 1999, true, 'Good'], [true, 2000, true, 'Good'], [true, 2001, true, 'Good'],
  [true, 5999, true, 'Good'], [true, 6000, true, 'Good'], [true, 6001, true, 'Hard'],
  [false, 2000, false, 'Again'], [false, 6000, false, 'Again'], [false, 6001, false, 'Again'],
] as const)('grades correct=%s, elapsed=%s, previousError=%s as %s', (correct, elapsed, previousError, expected) => {
  expect(gradeAnswer(correct, elapsed, previousError)).toBe(expected);
});
it('reads thresholds from the supplied config', () => {
  expect(gradeAnswer(true, 1000, false, { easyMs: 500, hardMs: 900 })).toBe('Hard');
  for (const [time, expected] of [[499, 'Easy'], [500, 'Easy'], [501, 'Good'], [899, 'Good'], [900, 'Good'], [901, 'Hard']] as const) {
    expect(gradeAnswer(true, time, false, { easyMs: 500, hardMs: 900 })).toBe(expected);
  }
});
