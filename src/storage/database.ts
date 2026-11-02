import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { AppSettings, CardRecord, ReviewEntry, Snapshot, Word } from '../types';
import { prepareChoicePool } from '../core/choices';
import { defaultSettings, transitionStudy } from '../core/session';
import type { StudyAction } from '../core/session';

export class VocabularyDatabase extends Dexie {
  cards!: Table<CardRecord, string>;
  reviewLogs!: Table<ReviewEntry, string>;
  settings!: Table<AppSettings, string>;
  constructor(name = 'one-word') {
    super(name);
    this.version(1).stores({
      cards: '&wordId, fsrs.due',
      reviewLogs: '&id, wordId, answeredAt, day, [wordId+answeredAt]',
      settings: '&id',
    });
  }
}

export function createStudyStore(words: readonly Word[], db = new VocabularyDatabase()) {
  const pool = prepareChoicePool(words);
  const transact = (action: StudyAction, now = Date.now()): Promise<Snapshot> =>
    db.transaction('rw', db.cards, db.reviewLogs, db.settings, async () => {
      const settings = await db.settings.get('app') ?? defaultSettings(now);
      const cards = await db.cards.toArray();
      const logs = await db.reviewLogs.toArray();
      const before: Snapshot = { settings, cards, logs };
      const after = transitionStudy(before, action, words, pool, now);
      const oldCards = new Map(cards.map(card => [card.wordId, card]));
      const newIds = new Set(after.cards.map(card => card.wordId));
      const changed = after.cards.filter(card => oldCards.get(card.wordId) !== card);
      const removed = cards.filter(card => !newIds.has(card.wordId)).map(card => card.wordId);
      if (changed.length) await db.cards.bulkPut(changed);
      if (removed.length) await db.cards.bulkDelete(removed);
      const addedLogs = after.logs.slice(logs.length);
      if (addedLogs.length) await db.reviewLogs.bulkAdd(addedLogs);
      const oldLogs = new Map(logs.map(log => [log.id, log]));
      const updatedLogs = after.logs.filter(log => oldLogs.has(log.id) && oldLogs.get(log.id) !== log);
      if (updatedLogs.length) await db.reviewLogs.bulkPut(updatedLogs);
      // Commit card, log and resume state together before the UI acknowledges an answer.
      await db.settings.put(after.settings);
      return after;
    });
  return { db, transact, load: (now = Date.now()) => transact({ type: 'tick' }, now) };
}
export type StudyStore = ReturnType<typeof createStudyStore>;
