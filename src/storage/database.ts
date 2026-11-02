import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { AppSettings, CardRecord, ReviewEntry, Snapshot, Word } from '../types';
import { prepareChoicePool } from '../core/choices';
import { defaultSettings, transitionStudy } from '../core/session';
import type { StudyAction } from '../core/session';
import { reconcileSnapshot } from '../core/session';
import { manageSnapshot, normaliseSettings, validatePreferences } from '../core/preferences';
import type { ManagementAction } from '../core/preferences';
import { selectedWords } from '../core/catalog';
import type { Catalog } from '../core/catalog';
import { backupWordIds, parseBackup } from '../core/backup';
import { fillWordSnapshots } from '../core/wordSnapshot';
import type { WordlistLoader } from './wordlists';

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

export type AppAction = StudyAction | ManagementAction;
export function createStudyStore(words: readonly Word[], db = new VocabularyDatabase(), catalog?: Catalog, loader?: WordlistLoader) {
  let pool = prepareChoicePool(catalog ? selectedWords(catalog, ['cet4']) : words);
  let poolKey = '';
  const availableWords = () => loader ? loader.words() : words;
  const activeWords = (settings: AppSettings) => catalog ? selectedWords(catalog, settings.selectedWordlists) : [...words];
  const fillSnapshots = (snapshot: Snapshot): Snapshot => {
    const undo = snapshot.settings.daily?.undo;
    return { ...snapshot, cards: fillWordSnapshots(snapshot.cards, availableWords()),
      settings: undo?.previous ? { ...snapshot.settings, daily: { ...snapshot.settings.daily!,
        undo: { ...undo, previous: fillWordSnapshots([undo.previous], availableWords())[0]! } } } : snapshot.settings };
  };
  const transact = async (action: AppAction, now = Date.now()): Promise<Snapshot> => {
    if (loader) {
      // Fetch before opening a write transaction; failed loads leave saved progress intact.
      const settings = normaliseSettings(await db.settings.get('app') ?? defaultSettings(now));
      if (action.type === 'preferences') {
        validatePreferences(action.value);
        settings.selectedWordlists = action.value.selectedWordlists;
      }
      await loader.prepareSnapshot({ settings, cards: await db.cards.toArray(), logs: [] }, action.type !== 'tick' || Boolean(action.startIfReady));
    }
    return db.transaction('rw', db.cards, db.reviewLogs, db.settings, async () => {
      const settings = normaliseSettings(await db.settings.get('app') ?? defaultSettings(now));
      const required = action.type === 'preferences' ? action.value.selectedWordlists : settings.selectedWordlists;
      if (catalog && required.some(id => !catalog[id])) throw new Error('词表选择已在其他页面更改，请重新加载。');
      const cards = await db.cards.toArray();
      const logs = await db.reviewLogs.toArray();
      const before = fillSnapshots({ settings, cards, logs });
      const management = action.type === 'preferences' || action.type === 'bookmark' || action.type === 'unslash' || action.type === 'exported';
      const managed = management ? manageSnapshot(before, action, availableWords(), now) : before;
      const selected = activeWords(managed.settings);
      const key = managed.settings.selectedWordlists.join(',');
      if (catalog && key !== poolKey) { pool = prepareChoicePool(selected); poolKey = key; }
      const after = management ? reconcileSnapshot(managed, selected, now) : transitionStudy(managed, action, selected, pool, now);
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
  };
  const prepareImport = async (text: string): Promise<Snapshot> => {
    const structured = parseBackup(text);
    if (loader) {
      await loader.ensureLists(structured.settings.selectedWordlists);
      await loader.ensureWords(backupWordIds(structured));
    }
    return fillSnapshots(parseBackup(text, new Set(availableWords().map(word => word.id))));
  };
  const importBackup = async (text: string, now = Date.now()): Promise<Snapshot> => {
    // Parse and reconcile before opening the write transaction. Invalid input cannot clear a table.
    const parsed = await prepareImport(text);
    const restored = reconcileSnapshot(parsed, activeWords(parsed.settings), now);
    await db.transaction('rw', db.cards, db.reviewLogs, db.settings, async () => {
      await db.cards.clear(); await db.reviewLogs.clear(); await db.settings.clear();
      await db.cards.bulkAdd(restored.cards); await db.reviewLogs.bulkAdd(restored.logs); await db.settings.put(restored.settings);
    });
    return restored;
  };
  return { db, transact, importBackup, prepareImport, load: (now = Date.now()) => transact({ type: 'tick' }, now) };
}
export type StudyStore = ReturnType<typeof createStudyStore>;
