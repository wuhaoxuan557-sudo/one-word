import { expect, it } from 'vitest';
import { State } from 'ts-fsrs';
import { STUDY_CONFIG } from './config';
import { buildDailyPlan, dailyQueue, estimateMinutes, homeSummary, localDay, nextMidnight, nextWakeAt, readyQueue, waitingSummary } from './queue';
import { reconcileSnapshot, defaultSettings } from './session';
import { dueCard, freshSnapshot, studyTime as now, studyWords as words } from './study.test-helper';

it('defaults to 20 new and 200 review cards', () => {
  expect(defaultSettings(now)).toMatchObject({ newLimit: 20, reviewLimit: 200, grading: { easyMs: 2000, hardMs: 6000 } });
});

const learningCard = (id: string, due: number, state = State.Learning) => {
  const card = dueCard(id, due);
  return { ...card, fsrs: { ...card.fsrs, state } };
};

it.each([State.Learning, State.Relearning])('learns ahead state %s through the inclusive twenty-minute boundary', cardState => {
  const windowMs = STUDY_CONFIG.learnAheadMinutes * 60_000;
  expect(windowMs).toBe(20 * 60_000);
  for (const offset of [windowMs - 1, windowMs, windowMs + 1]) {
    const input = freshSnapshot(); input.settings.newLimit = 0;
    input.cards = [learningCard('apple', now + offset, cardState)];
    const state = reconcileSnapshot(input, words, now);
    expect(readyQueue(state, now).map(item => item.wordId)).toEqual(offset <= windowMs ? ['apple'] : []);
    expect(homeSummary(state, words, now).reviewCount).toBe(0);
  }
});

it('keeps due reviews and new words ahead of early steps, then sorts those steps by due time', () => {
  const input = freshSnapshot(); input.settings.reviewLimit = 10;
  input.cards = [learningCard('chair', now + 10 * 60_000), learningCard('river', now + 5 * 60_000), dueCard('star', now - 1)];
  expect(readyQueue(reconcileSnapshot(input, words, now), now).map(item => item.wordId)).toEqual(['star', 'apple', 'table']);
  input.cards = input.cards.filter(card => card.wordId !== 'star'); input.settings.newLimit = 0;
  expect(readyQueue(reconcileSnapshot(input, words, now), now).map(item => item.wordId)).toEqual(['river', 'chair']);
});

it('does not learn ahead regular reviews or slashed cards and respects the daily limit', () => {
  const input = freshSnapshot(); input.settings.newLimit = 0;
  input.cards = [dueCard('apple', now + 1), { ...learningCard('table', now + 1), slashed: true },
    learningCard('chair', now + 3000), learningCard('river', now + 2000)];
  const state = reconcileSnapshot(input, words, now);
  expect(readyQueue(state, now).map(item => item.wordId)).toEqual(['river']);
  expect(waitingSummary(state, now)).toMatchObject({ count: 1, dueAt: now + 2000 });
  input.settings.reviewLimit = 0;
  expect(readyQueue(reconcileSnapshot(input, words, now), now)).toEqual([]);
});

it('reports waiting cards and wakes exactly when the next learning step enters the window', () => {
  const input = freshSnapshot(); input.settings.newLimit = 0; input.settings.reviewLimit = 10;
  input.cards = [learningCard('chair', now + 40 * 60_000), learningCard('river', now + 25 * 60_000),
    { ...learningCard('table', now + 21 * 60_000), slashed: true }];
  const state = reconcileSnapshot(input, words, now);
  expect(readyQueue(state, now)).toEqual([]);
  expect(waitingSummary(state, now)).toEqual({ count: 2, dueAt: now + 25 * 60_000, minutes: 25 });
  expect(nextWakeAt(state, now)).toBe(now + 5 * 60_000);
  expect(readyQueue(reconcileSnapshot(state, words, now + 5 * 60_000), now + 5 * 60_000).map(item => item.wordId)).toEqual(['river']);
});

it('includes a learning step across midnight when it is inside the window', () => {
  const late = nextMidnight(now) - 5 * 60_000;
  const input = freshSnapshot(); input.settings.newLimit = 0;
  input.cards = [learningCard('apple', late + 10 * 60_000)];
  const state = reconcileSnapshot(input, words, late);
  expect(readyQueue(state, late).map(item => item.wordId)).toEqual(['apple']);
  expect(readyQueue(reconcileSnapshot(state, words, nextMidnight(now)), nextMidnight(now)).map(item => item.wordId)).toEqual(['apple']);
});
it('puts overdue reviews first, orders by due date and applies independent limits', () => {
  const input = freshSnapshot();
  input.cards = [dueCard('river', now - 100), dueCard('chair', now - 200), dueCard('tree', now + 100)];
  const state = reconcileSnapshot(input, words, now);
  expect(dailyQueue(state, now).map(item => item.wordId)).toEqual(['chair', 'apple', 'table']);
  expect(state.settings.daily?.reviewIds).toEqual(['chair']);
});
it('sorts new words by frequency, puts missing/zero last and deduplicates spellings', () => {
  const input = freshSnapshot(); input.settings.newLimit = 20;
  const plan = buildDailyPlan([...words.slice().reverse(), { ...words[0]!, id: 'copy', word: 'APPLE' }], [], input.settings, now);
  expect(plan.newIds).toEqual(['apple', 'table', 'chair', 'river', 'tree', 'star']);
});
it('never admits slashed words and honours zero limits', () => {
  const input = freshSnapshot(); input.cards = [{ ...dueCard('apple'), slashed: true }];
  expect(buildDailyPlan(words, input.cards, input.settings, now).newIds).toEqual(['table', 'chair']);
  expect(buildDailyPlan(words, input.cards, { ...input.settings, newLimit: 0, reviewLimit: 0 }, now)).toMatchObject({ newIds: [], reviewIds: [] });
});
it('retains daily reservations on reload and replenishes them only on a new day', () => {
  const today = reconcileSnapshot(freshSnapshot(), words, now);
  today.cards = [dueCard('apple', now + 2 * 86_400_000), { ...dueCard('table'), slashed: true }];
  const reload = reconcileSnapshot(structuredClone(today), words, now + 1000);
  expect(reload.settings.daily?.newIds).toEqual(['apple', 'table']);
  expect(dailyQueue(reload, now)).toEqual([]);
  expect(reconcileSnapshot(reload, words, nextMidnight(now)).settings.daily?.newIds).toEqual(['chair', 'river']);
});
it('uses the local calendar day and the next local midnight', () => {
  const late = new Date(2026, 10, 2, 23, 59, 59, 999).getTime();
  expect(localDay(late)).toBe('2026-11-02'); expect(localDay(late + 1)).toBe('2026-11-03');
  expect(nextMidnight(late)).toBe(late + 1);
});
it('waits for future due cards and uses real counts and fallback time estimates', () => {
  const input = freshSnapshot(); input.cards = [dueCard('river', now + 60_000)];
  const state = reconcileSnapshot(input, words, now);
  expect(nextWakeAt(state, now)).toBe(now + 60_000);
  expect(homeSummary(state, words, now)).toMatchObject({ newCount: 2, reviewCount: 0, learned: 1, slashed: 0, bookmarked: 0, minutes: 1 });
  expect(estimateMinutes(20, 0, [])).toBe(9); expect(estimateMinutes(0, 200, [])).toBe(27); expect(estimateMinutes(0, 0, [])).toBe(0);
});
