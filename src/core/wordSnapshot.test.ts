import { expect, it } from 'vitest';
import { fillWordSnapshots, snapshotWord } from './wordSnapshot';
import { freshSnapshot, studyWords as words, studyTime as now } from './study.test-helper';
import { emptyCard } from './scheduler';
import { manageSnapshot } from './preferences';
import { prepareChoicePool } from './choices';
import { transitionStudy } from './session';
import { parseBackup, serializeBackup } from './backup';

it('saves the displayed short definition and retains full text for search', () => {
  const word = { ...words[0]!, translation: 'n. 甲, 乙, 丙, 丁\nv. 戊', translationFull: 'n. 甲, 乙, 丙, 丁\nv. 戊' };
  expect(snapshotWord(word)).toEqual({ word: 'apple', translation: 'n. 甲；乙；丙', translationFull: 'n. 甲；乙；丙；丁\nv. 戊' });
});

it('backfills legacy cards idempotently without changing FSRS or flags', () => {
  const card = { ...emptyCard('apple', now), bookmarked: true, slashed: true };
  const filled = fillWordSnapshots([card], words);
  expect(filled[0]).toEqual({ ...card, wordSnapshot: snapshotWord(words[0]!) });
  expect(fillWordSnapshots(filled, words)[0]).toBe(filled[0]);
});

it('persists snapshots when bookmarking or slashing, and manages unloaded saved words', () => {
  const marked = manageSnapshot(freshSnapshot(), { type: 'bookmark', wordId: 'star', value: true }, words, now);
  expect(marked.cards[0]?.wordSnapshot).toEqual(snapshotWord(words[4]!));
  expect(manageSnapshot(marked, { type: 'bookmark', wordId: 'star', value: false }, [], now).cards[0]?.bookmarked).toBe(false);
  const pool = prepareChoicePool(words);
  const started = transitionStudy(freshSnapshot(), { type: 'start' }, words, pool, now);
  const slashed = transitionStudy(started, { type: 'slash', presentationId: started.settings.daily!.current!.id }, words, pool, now);
  expect(slashed.cards[0]?.wordSnapshot).toEqual(snapshotWord(words[0]!));
  expect(manageSnapshot(slashed, { type: 'unslash', wordId: 'apple' }, [], now).cards[0]?.slashed).toBe(false);
});

it('roundtrips snapshots in version 1 backups, accepts legacy cards and rejects malformed snapshots', () => {
  const state = freshSnapshot(); state.cards = fillWordSnapshots([emptyCard('apple', now)], words);
  expect(parseBackup(serializeBackup(state, now)).cards).toEqual(state.cards);
  const data = JSON.parse(serializeBackup(state, now)) as { cards: { wordSnapshot?: unknown }[] };
  data.cards[0]!.wordSnapshot = { word: 'apple', translation: 123 };
  expect(() => parseBackup(JSON.stringify(data))).toThrow('格式');
  delete data.cards[0]!.wordSnapshot;
  expect(parseBackup(JSON.stringify(data)).cards[0]?.wordSnapshot).toBeUndefined();
});
