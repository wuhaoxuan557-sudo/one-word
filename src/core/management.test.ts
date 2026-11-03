import { expect, it } from 'vitest';
import { mergeWordlists, selectedWords, wordlistLabel } from './catalog';
import { manageSnapshot, normaliseSettings, preferences, validatePreferences } from './preferences';
import { freshSnapshot, dueCard, studyWords as words, studyTime as now } from './study.test-helper';
import { reconcileSnapshot } from './session';
import { studyTransition as transitionStudy } from './study.test-helper';
import { readyQueue } from './queue';
import { prepareChoicePool } from './choices';

it('deduplicates multiple wordlists by spelling, preserving stable IDs and frequency order', () => {
  const duplicate = { ...words[0]!, id: 'alternate', word: 'APPLE' };
  expect(mergeWordlists([[words[1]!, words[0]!], [duplicate, words[4]!]]).map(word => word.id)).toEqual(['apple', 'table', 'star']);
  expect(selectedWords({ cet4: words.slice(0, 2), cet6: [duplicate] }, ['cet4', 'cet6'])).toHaveLength(2);
  expect(wordlistLabel(['cet4', 'cet6'])).toBe('CET4 等 2 个');
});

it('prioritises unlearned bookmarks even after today reservations were created', () => {
  const initial = reconcileSnapshot(freshSnapshot(), words, now);
  const marked = manageSnapshot(initial, { type: 'bookmark', wordId: 'star', value: true }, words, now);
  const state = reconcileSnapshot(marked, words, now);
  expect(state.settings.daily?.newIds).toEqual(['star', 'apple']);
  const removed = reconcileSnapshot(manageSnapshot(state, { type: 'bookmark', wordId: 'star', value: false }, words, now), words, now);
  expect(removed.settings.daily?.newIds).toEqual(['apple', 'table']);
});

it('does not reset learned bookmarks or replace an unanswered current card', () => {
  const initial = transitionStudy(freshSnapshot(), { type: 'start' }, words, prepareChoicePool(words), now);
  const changed = reconcileSnapshot(manageSnapshot(initial, { type: 'bookmark', wordId: 'star', value: true }, words, now), words, now);
  expect(changed.settings.daily?.current).toEqual(initial.settings.daily?.current);
  expect(changed.settings.daily?.newIds).toEqual(['apple', 'star']);
  const learned = freshSnapshot(); learned.cards = [dueCard('star', now + 86_400_000)];
  const saved = reconcileSnapshot(manageSnapshot(learned, { type: 'bookmark', wordId: 'star', value: true }, words, now), words, now);
  expect(saved.cards[0]?.fsrs).toEqual(learned.cards[0]?.fsrs);
  expect(saved.settings.daily?.newIds).not.toContain('star');
});

it('unslashes learned cards into the due queue and fresh cards into the new queue without logs', () => {
  for (const reps of [0, 3]) {
    const input = freshSnapshot(); const original = dueCard('star', now + 7 * 86_400_000); original.fsrs.reps = reps;
    input.cards = [{ ...original, slashed: true, slashedAt: now - 1000 }];
    const restored = reconcileSnapshot(manageSnapshot(input, { type: 'unslash', wordId: 'star' }, words, now), words, now);
    expect(readyQueue(restored, now)[0]?.wordId).toBe('star');
    expect(restored.cards[0]?.slashed).toBe(false); expect(restored.logs).toEqual([]);
  }
});

it('applies limits now, keeps completed quota when changing lists, and ignores inactive future cards', () => {
  const initial = reconcileSnapshot(freshSnapshot(), words, now);
  initial.cards = [dueCard('apple', now + 86_400_000)];
  const changed = manageSnapshot(initial, { type: 'preferences', value: { ...preferences(initial.settings), newLimit: 1, selectedWordlists: ['cet6'] } }, words, now);
  const reselected = reconcileSnapshot(changed, words.slice(1), now);
  expect(readyQueue(reselected, now)).toEqual([]);
  const raised = reconcileSnapshot(manageSnapshot(reselected, { type: 'preferences', value: { ...preferences(reselected.settings), newLimit: 3 } }, words, now), words.slice(1), now);
  expect(readyQueue(raised, now).map(item => item.wordId)).toEqual(['table', 'chair']);
});

it('releases an unstarted word when switching away, preserving history and rejecting stale answers', () => {
  const pool = prepareChoicePool(words);
  const initial = transitionStudy(freshSnapshot(), { type: 'start' }, words, pool, now);
  const old = initial.settings.daily!.current!;
  const switched = reconcileSnapshot(initial, words.slice(1), now);
  expect(switched.settings.daily?.newIds).toEqual(['table', 'chair']);
  expect(transitionStudy(switched, { type: 'answer', presentationId: old.id, selectedId: old.wordId, elapsedMs: 1 }, words.slice(1), pool, now).logs).toEqual([]);
});

it('validates settings and upgrades the legacy selection default', () => {
  const settings = freshSnapshot().settings;
  expect(() => validatePreferences({ ...settings, selectedWordlists: [] })).toThrow();
  expect(() => validatePreferences({ ...settings, newLimit: -1 })).toThrow();
  expect(() => validatePreferences({ ...settings, grading: { easyMs: 6000, hardMs: 2000 } })).toThrow();
  const legacy = { ...settings }; delete (legacy as Partial<typeof legacy>).selectedWordlists;
  expect(normaliseSettings(legacy).selectedWordlists).toEqual(['cet4']);
});

it('does not let a restored new word jump ahead of an already due review', () => {
  const input = freshSnapshot();
  input.cards = [dueCard('apple'), { ...dueCard('star'), fsrs: { ...dueCard('star').fsrs, reps: 0 }, slashed: true }];
  const restored = manageSnapshot(input, { type: 'unslash', wordId: 'star' }, words, now);
  const started = transitionStudy(restored, { type: 'start' }, words, prepareChoicePool(words), now);
  expect(started.settings.daily?.current?.wordId).toBe('apple');
});
