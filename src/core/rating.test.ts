import { expect, it } from 'vitest';
import { gradeAnswer } from './rating';

it.each([
  [false, 0, false, 'Again'], [false, 10000, true, 'Again'],
  [true, 1999, false, 'Easy'], [true, 2000, false, 'Easy'],
  [true, 2001, false, 'Good'], [true, 6000, false, 'Good'],
  [true, 6001, false, 'Hard'], [true, 1000, true, 'Good'],
] as const)('grades correct=%s, elapsed=%s, previousError=%s as %s', (correct, elapsed, previousError, expected) => {
  expect(gradeAnswer(correct, elapsed, previousError)).toBe(expected);
});
it('reads thresholds from the supplied config', () => {
  expect(gradeAnswer(true, 1000, false, { easyMs: 500, hardMs: 900 })).toBe('Hard');
});
