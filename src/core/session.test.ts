import { expect, it } from 'vitest';
import { practiceReducer } from './session';
import type { PracticeAction, PracticeState } from './session';
import { word } from './fixtures.test-helper';

const words = [word('apple', { translation: 'n. 苹果' }), word('table', { translation: 'n. 桌子' }), word('chair', { translation: 'n. 椅子' }), word('river', { translation: 'n. 河流' })];
const start = () => practiceReducer(null, { type: 'start', seed: 42 }, words)!;
const reduce = (state: PracticeState, action: PracticeAction) => practiceReducer(state, action, words)!;
const answer = (state: PracticeState, selectedId: string | null, elapsedMs = 1000) => reduce(state, { type: 'answer', selectedId, elapsedMs, timestamp: 123456 });

it('is deterministic and locks the first answer, time and rating', () => {
  const before = start();
  expect(start()).toEqual(before);
  const answered = answer(before, 'apple');
  expect(answered.answer).toEqual({ wordId: 'apple', selectedId: 'apple', correct: true, elapsedMs: 1000, answeredAt: 123456, rating: 'Easy' });
  expect(answer(answered, 'table')).toBe(answered);
  expect(before.logs).toEqual([]);
});
it('requires details for Again/Hard and permits fast correct skipping', () => {
  for (const state of [answer(start(), null), answer(start(), 'apple', 6001)]) {
    expect(reduce(state, { type: 'next' })).toBe(state);
    const detail = reduce(state, { type: 'details' });
    expect(detail.phase).toBe('details');
    expect(reduce(detail, { type: 'next' }).question?.word.id).toBe('table');
  }
  expect(reduce(answer(start(), 'apple', 5000), { type: 'next' }).question?.word.id).toBe('table');
  expect(reduce(start(), { type: 'next' })).toEqual(start());
});
it('retains prior mistakes across rounds for the Easy rule', () => {
  const mistaken = answer(start(), null);
  const restarted = reduce(mistaken, { type: 'start', seed: 99 });
  expect(answer(restarted, 'apple').answer?.rating).toBe('Good');
});
it('slashes without a review log and never reintroduces a slashed word on restart', () => {
  const slashed = reduce(start(), { type: 'slash', now: 0, token: 1 });
  expect(slashed.question?.word.id).toBe('table');
  expect(slashed.logs).toEqual([]);
  expect(slashed.slashedIds).toEqual(['apple']);
  expect(reduce(slashed, { type: 'start', seed: 1 }).remainingIds).not.toContain('apple');
});
it('undo restores the word without overwriting the current answer or options', () => {
  const slashed = reduce(start(), { type: 'slash', now: 100, token: 1 });
  const answered = answer(slashed, 'table');
  const restored = reduce(answered, { type: 'undo', now: 3099 });
  expect(restored.remainingIds).toEqual(['table', 'apple', 'chair', 'river']);
  expect(restored.question).toBe(answered.question);
  expect(restored.answer).toBe(answered.answer);
  expect(restored.slashedIds).toEqual([]);
  expect(reduce(restored, { type: 'undo', now: 200 }).remainingIds).toEqual(restored.remainingIds);
});
it('expires undo at three seconds and ignores obsolete timer tokens', () => {
  const first = reduce(start(), { type: 'slash', now: 0, token: 1 });
  expect(reduce(first, { type: 'undo', now: 3000 }).slashedIds).toEqual(['apple']);
  const second = reduce(first, { type: 'slash', now: 1000, token: 2 });
  expect(reduce(second, { type: 'expireUndo', token: 1 })).toBe(second);
  expect(reduce(second, { type: 'expireUndo', token: 2 }).undo).toBeNull();
  expect(reduce(second, { type: 'undo', now: 2000 }).slashedIds).toEqual(['apple']);
});
it('can undo the last word from the completion screen', () => {
  let state = start();
  for (let i = 0; i < words.length; i++) state = reduce(state, { type: 'slash', now: i, token: i });
  expect(state.question).toBeNull();
  const restored = reduce(state, { type: 'undo', now: 100 });
  expect(restored.question?.word.id).toBe('river');
  expect(restored.remainingIds).toEqual(['river']);
});
it('does not skip an impossible word, fabricate options, or accept a missing option', () => {
  const single = practiceReducer(null, { type: 'start', seed: 42 }, [words[0]!])!;
  expect(single.question?.word.id).toBe('apple');
  expect(single.question?.options).toEqual([]);
  expect(practiceReducer(single, { type: 'answer', selectedId: null, elapsedMs: 1, timestamp: 1 }, [words[0]!])).toBe(single);
  const state = start();
  expect(answer(state, 'nonexistent')).toBe(state);
});
