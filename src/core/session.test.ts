import { expect, it } from 'vitest';
import { recordAnswer } from './session';
import type { PracticeState } from './session';
import { word } from './fixtures.test-helper';

const state = (): PracticeState => ({
  question: { word: word('a'), options: [word('a'), word('b'), word('c'), word('d')] },
  cursor: 0, skipped: 0, phase: 'recognise', answer: null, logs: [], slashedIds: [],
});

it('locks the first answer and records measured response time, without persistence or FSRS', () => {
  const before = state();
  const answered = recordAnswer(before, 'a', 100, 1350, 123456);
  expect(answered.phase).toBe('feedback');
  expect(answered.answer).toEqual({ wordId: 'a', selectedId: 'a', correct: true, elapsedMs: 1250, answeredAt: 123456 });
  expect(answered.logs).toHaveLength(1);
  expect(recordAnswer(answered, 'b', 100, 2000, 456789)).toBe(answered);
  expect(before.logs).toHaveLength(0);
});

it('handles wrong and unknown answers, and refuses invalid option IDs', () => {
  expect(recordAnswer(state(), 'b', 10, 100, 1).answer?.correct).toBe(false);
  expect(recordAnswer(state(), null, 10, 100, 1).answer?.selectedId).toBeNull();
  expect(recordAnswer(state(), null, 10, 100, 1).answer?.correct).toBe(false);
  const initial = state();
  expect(recordAnswer(initial, 'nonexistent', 10, 100, 1)).toBe(initial);
  expect(recordAnswer({ ...initial, question: null }, null, 10, 100, 1).logs).toHaveLength(0);
  expect(recordAnswer(state(), 'a', 100, 90, 1).answer?.elapsedMs).toBe(0);
});
