import { expect, it } from 'vitest';
import type { Snapshot } from '../types';
import { prepareChoicePool } from './choices';
import { dailyQueue, estimateMinutes, nextMidnight, queueProgress } from './queue';
import { transitionStudy } from './session';
import type { StudyAction } from './session';
import { dueCard, freshSnapshot, studyTime as now, studyWords as words } from './study.test-helper';

const pool = prepareChoicePool(words);
const apply = (state: Snapshot, action: StudyAction, time = now) => transitionStudy(state, action, words, pool, time);
const start = (state = freshSnapshot(), time = now) => apply(state, { type: 'start' }, time);
const current = (state: Snapshot) => state.settings.daily!.current!;
const answer = (state: Snapshot, selectedId: string | null, elapsedMs = 1000, time = now) => apply(state, { type: 'answer', presentationId: current(state).id, selectedId, elapsedMs }, time);
const slash = (state: Snapshot, time = now) => apply(state, { type: 'slash', presentationId: current(state).id }, time);
const next = (state: Snapshot, time = now) => apply(state, { type: 'next', presentationId: current(state).id }, time);

it('saves one answer with real FSRS due time and locks duplicate/stale submissions', () => {
  const original = start(); const copy = structuredClone(original);
  const saved = answer(original, 'apple');
  expect(saved.logs).toHaveLength(1); expect(current(saved).answer).toMatchObject({ rating: 'Easy', correct: true, kind: 'new' });
  expect(saved.cards[0]?.fsrs.due.getTime()).toBe(current(saved).answer?.dueAt);
  expect(answer(saved, null).logs).toEqual(saved.logs);
  expect(apply(next(saved), { type: 'answer', presentationId: current(original).id, selectedId: null, elapsedMs: 1 }).logs).toHaveLength(1);
  expect(original).toEqual(copy);
});
it('reads rating thresholds from persisted settings and preserves error history', () => {
  const custom = freshSnapshot(); custom.settings.grading = { easyMs: 500, hardMs: 900 };
  expect(current(answer(start(custom), 'apple', 901)).answer?.rating).toBe('Hard');
  const mistaken = answer(start(), null);
  const following = next(apply(mistaken, { type: 'details', presentationId: current(mistaken).id }));
  const afterSecond = next(answer(following, current(following).wordId));
  const repeated = apply(afterSecond, { type: 'tick', startIfReady: true }, now + 60_000);
  expect(current(repeated)).toMatchObject({ wordId: 'apple', kind: 'review', reviewNumber: 1 });
  expect(current(answer(repeated, 'apple', 100, now + 60_001)).answer?.rating).toBe('Good');
});
it('requires details for Again/Hard and permits Good/Easy to skip', () => {
  for (const state of [answer(start(), null), answer(start(), 'apple', 6001)]) {
    expect(current(next(state)).id).toBe(current(state).id);
    expect(current(next(apply(state, { type: 'details', presentationId: current(state).id }))).wordId).toBe('table');
  }
  expect(current(next(answer(start(), 'apple', 5000))).wordId).toBe('table');
  expect(current(next(start())).wordId).toBe('apple');
});
it('learns ahead within the configured window without consuming another daily slot', () => {
  const input = freshSnapshot(); input.settings.newLimit = 1;
  const saved = answer(start(input), null);
  expect(queueProgress(saved, now)).toEqual({ current: 1, total: 2 });
  const due = next(apply(saved, { type: 'details', presentationId: current(saved).id }));
  expect(current(due)).toMatchObject({ wordId: 'apple', kind: 'review' });
  expect(due.settings.daily?.newIds).toEqual(['apple']); expect(due.settings.daily?.reviewIds).toEqual([]);
  expect(queueProgress(due, now + 60_000)).toEqual({ current: 2, total: 2 });
});
it('persists slash without a new FSRS log and excludes it after reload and next day', () => {
  const saved = slash(start()); expect(saved.cards[0]?.slashed).toBe(true); expect(saved.logs).toEqual([]);
  const reload = apply(structuredClone(saved), { type: 'tick' }, now + 4000);
  expect(current(reload).wordId).toBe('table');
  const tomorrow = start(reload, nextMidnight(now));
  expect(tomorrow.settings.daily?.newIds).not.toContain('apple'); expect(tomorrow.settings.daily?.reviewIds).not.toContain('apple');
});
it('undo restores the card after the current one without overwriting its options or answer', () => {
  const saved = slash(start()); const answered = answer(saved, 'table');
  const restored = apply(answered, { type: 'undo', expiresAt: now + 3000 }, now + 2999);
  expect(current(restored)).toEqual(current(answered)); expect(restored.cards.some(card => card.wordId === 'apple')).toBe(false);
  expect(current(next(restored, now + 2999)).wordId).toBe('apple'); expect(restored.settings.daily?.completed).toBe(1);
});
it('expires undo at three seconds, ignores stale undo and restores existing card state', () => {
  const input = freshSnapshot(); input.cards = [dueCard('apple')];
  const saved = slash(start(input));
  const expired = apply(saved, { type: 'undo', expiresAt: now + 3000 }, now + 3000);
  expect(expired.cards.find(card => card.wordId === 'apple')?.slashed).toBe(true);
  const restored = apply(saved, { type: 'undo', expiresAt: now + 3000 }, now + 1);
  expect(restored.cards.find(card => card.wordId === 'apple')).toEqual(input.cards[0]);
  expect(apply(slash(saved, now + 1), { type: 'undo', expiresAt: now + 3000 }, now + 2).cards.filter(card => card.slashed)).toHaveLength(2);
});
it('restores the last slashed word and supports undo across midnight', () => {
  const input = freshSnapshot(); input.settings.newLimit = 1;
  const saved = slash(start(input)); expect(saved.settings.daily?.current).toBeNull();
  expect(current(apply(saved, { type: 'undo', expiresAt: now + 3000 }, now + 1)).wordId).toBe('apple');
  const late = nextMidnight(now) - 1000;
  const restored = apply(slash(start(input, late), late), { type: 'undo', expiresAt: late + 3000 }, late + 1001);
  expect(restored.cards.some(card => card.slashed)).toBe(false); expect(restored.settings.daily?.completed).toBe(0);
});
it('restores the same presentation, options, answer and due time from an IndexedDB-compatible clone', () => {
  const saved = answer(start(), 'apple', 4000);
  const reloaded = apply(structuredClone(saved), { type: 'tick' }, now + 2000);
  expect(current(reloaded)).toEqual(current(saved)); expect(reloaded.logs).toEqual(saved.logs);
  expect(queueProgress(reloaded, now + 2000)).toEqual(queueProgress(saved, now)); expect(estimateMinutes(20, 0, saved.logs)).toBe(9);
});
it('resets daily progress at midnight, keeps schedules, and rejects yesterday current card', () => {
  const saved = answer(start(), 'apple');
  const tomorrow = apply(saved, { type: 'answer', presentationId: current(saved).id, selectedId: null, elapsedMs: 1 }, nextMidnight(now));
  expect(tomorrow.settings.daily).toMatchObject({ day: '2026-11-03', completed: 0, current: null });
  expect(tomorrow.cards).toEqual(saved.cards); expect(tomorrow.logs).toEqual(saved.logs);
  expect(dailyQueue(tomorrow, nextMidnight(now)).some(item => item.wordId === 'apple' && item.kind === 'new')).toBe(false);
});
it('does not skip an impossible word or accept a nonexistent option', () => {
  const saved = transitionStudy(freshSnapshot(), { type: 'start' }, words.slice(0, 1), prepareChoicePool(words.slice(0, 1)), now);
  expect(current(saved)).toMatchObject({ wordId: 'apple', optionIds: [] }); expect(answer(saved, null).logs).toEqual([]);
  expect(answer(start(), 'missing').logs).toEqual([]);
});
it('keeps presentation IDs unique if the local calendar changes back to an earlier day', () => {
  const first = start();
  const tomorrow = start(first, nextMidnight(now));
  const back = start(tomorrow, now + 1);
  expect(current(back).id).not.toBe(current(first).id);
});

it('finalises the complete card time on Next without changing answer time or FSRS scheduling', () => {
  const initial = start();
  const saved = answer(initial, 'apple', 4000, now + 4000);
  const details = apply(saved, { type: 'details', presentationId: current(saved).id }, now + 10_000);
  expect(details.logs[0]?.studyMs).toBeUndefined();
  const reloaded = apply(structuredClone(details), { type: 'tick' }, now + 15_000);
  const finished = next(reloaded, now + 30_000);
  expect(finished.logs[0]).toEqual({ ...saved.logs[0], studyMs: 30_000 });
  expect(finished.cards).toEqual(saved.cards);
  expect(apply(finished, { type: 'next', presentationId: current(saved).id }, now + 90_000).logs).toEqual(finished.logs);
  expect(saved.logs[0]?.studyMs).toBeUndefined();
});

it('records complete time when skipping details and excludes abandoned or slashed cards', () => {
  const saved = answer(start(), 'apple', 1000, now + 1000);
  expect(next(saved, now + 5000).logs[0]).toMatchObject({ elapsedMs: 1000, studyMs: 5000, rating: 'Easy' });
  expect(slash(saved, now + 5000).logs[0]?.studyMs).toBeUndefined();
});

it('can finish a saved legacy presentation without a start timestamp', () => {
  const saved = answer(start(), 'apple', 4000, now + 4000);
  delete current(saved).startedAt;
  expect(next(saved, now + 9000).logs[0]?.studyMs).toBe(9000);
});

it('schedules an early learning answer at its actual answer time', () => {
  const input = freshSnapshot(); input.settings.newLimit = 1;
  const saved = answer(start(input), null, 1000, now + 1000);
  const early = next(apply(saved, { type: 'details', presentationId: current(saved).id }, now + 5000), now + 10_000);
  expect(current(early)).toMatchObject({ wordId: 'apple', kind: 'review', startedAt: now + 10_000 });
  expect(saved.cards[0]!.fsrs.due.getTime()).toBeGreaterThan(now + 11_000);
  const repeated = answer(early, 'apple', 1000, now + 11_000);
  expect(repeated.logs[1]?.fsrsLog.review.getTime()).toBe(now + 11_000);
  expect(repeated.logs[1]?.rating).toBe('Good');
});
