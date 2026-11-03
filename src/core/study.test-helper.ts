import { State } from 'ts-fsrs';
import type { Snapshot, Word } from '../types';
import { word } from './fixtures.test-helper';
import { defaultSettings, transitionStudy } from './session';
import type { StudyAction } from './session';
import type { ChoicePool } from './choices';
import { emptyCard } from './scheduler';

export const studyTransition = (input: Snapshot, action: StudyAction, words: readonly Word[], pool: ChoicePool, now: number) =>
  transitionStudy(input, action, words, pool, now, crypto.randomUUID());

export const studyWords = [
  word('apple', { translation: 'n. 苹果', frq: 10 }), word('table', { translation: 'n. 桌子', frq: 20 }),
  word('chair', { translation: 'n. 椅子', frq: 30 }), word('river', { translation: 'n. 河流', frq: 40 }),
  word('star', { translation: 'n. 星星', frq: 0 }), word('tree', { translation: 'n. 大树', frq: 50 }),
];
export const studyTime = new Date(2026, 10, 2, 10).getTime();
export function freshSnapshot(now = studyTime): Snapshot {
  return { cards: [], logs: [], settings: { ...defaultSettings(now), newLimit: 2, reviewLimit: 1 } };
}
export function dueCard(wordId: string, dueAt = studyTime - 1000) {
  const card = emptyCard(wordId, dueAt);
  return { ...card, introducedAt: dueAt - 86_400_000, fsrs: { ...card.fsrs, due: new Date(dueAt), reps: 3, stability: 2, difficulty: 5, state: State.Review } };
}
