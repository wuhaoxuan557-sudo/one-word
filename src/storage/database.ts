import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { AppSettings, CardRecord, ReviewEntry, Snapshot, Word } from '../types';
import { prepareChoicePool } from '../core/choices';
import { defaultSettings, transitionStudy, reconcileSnapshot } from '../core/session';
import type { StudyAction } from '../core/session';
import { manageSnapshot, normaliseSettings, validatePreferences } from '../core/preferences';
import type { ManagementAction } from '../core/preferences';
import { selectedWords } from '../core/catalog';
import type { Catalog } from '../core/catalog';
import { backupWordIds, parseBackup } from '../core/backup';
import { fillWordSnapshots } from '../core/wordSnapshot';
import type { WordlistLoader } from './wordlists';
import { migrateSnapshot, snapshotShared } from '../core/sync/migration';
import { materializeShared, mergeShared, parseShared } from '../core/sync/merge';
import type { ReplayCache } from '../core/sync/merge';
import { projectSnapshot } from '../core/sync/project';
import { recordMutation } from '../core/sync/mutations';
import { stableJson } from '../core/sync/identity';
import { STUDY_TIME_ZONE } from '../core/sync/calendar';
import type { Clock, LocalSyncState, SharedState, SyncEvent } from '../core/sync/model';

function freshLocal(): LocalSyncState {
  return { id: 'sync-local', version: 1, deviceId: crypto.randomUUID(), clock: [0, 0], timeZone: STUDY_TIME_ZONE };
}
function observedClock(local: Clock, shared: SharedState): Clock {
  return [...shared.events, ...shared.reviews].reduce<Clock>((clock, value) => value.clock[0] > clock[0] ||
    (value.clock[0] === clock[0] && value.clock[1] > clock[1]) ? value.clock : clock, local);
}
export class VocabularyDatabase extends Dexie {
  cards!: Table<CardRecord, string>;
  reviewLogs!: Table<ReviewEntry, string>;
  settings!: Table<AppSettings, string>;
  localSettings: Table<LocalSyncState, string>;
  syncEvents!: Table<SyncEvent, string>;
  constructor(name = 'one-word') {
    super(name);
    const stores = { cards: '&wordId, fsrs.due', reviewLogs: '&id, wordId, answeredAt, day, [wordId+answeredAt]', settings: '&id' };
    this.version(1).stores(stores);
    this.version(2).stores({ ...stores, syncEvents: '&id, type, wordId' }).upgrade(async tx => {
      const settingsTable = tx.table<AppSettings, string>('settings');
      const local = freshLocal();
      const input: Snapshot = { settings: { ...normaliseSettings(await settingsTable.get('app') ?? defaultSettings(Date.now())), syncTimeZone: local.timeZone },
        cards: await tx.table<CardRecord, string>('cards').toArray(), logs: await tx.table<ReviewEntry, string>('reviewLogs').toArray() };
      const migrated = migrateSnapshot(input, crypto.randomUUID());
      const shared = snapshotShared(migrated);
      await tx.table('reviewLogs').clear(); await tx.table('reviewLogs').bulkPut(migrated.logs);
      await tx.table('syncEvents').bulkPut(shared.events); await settingsTable.put(migrated.settings);
      await tx.table<LocalSyncState, string>('settings').put({ ...local, clock: observedClock(local.clock, shared) });
    });
    this.localSettings = this.table('settings');
  }
}

export type AppAction = StudyAction | ManagementAction;
export function createStudyStore(words: readonly Word[], db = new VocabularyDatabase(), catalog?: Catalog, loader?: WordlistLoader) {
  const replayCache: ReplayCache = new Map();
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
  const tables = [db.cards, db.reviewLogs, db.settings, db.syncEvents];
  const read = async (now: number) => {
    const savedLocal = await db.localSettings.get('sync-local');
    const local = { ...savedLocal ?? freshLocal(), timeZone: STUDY_TIME_ZONE, ...(savedLocal?.boundTimeZone ? { boundTimeZone: STUDY_TIME_ZONE } : {}) };
    const snapshot: Snapshot = fillSnapshots({ settings: { ...normaliseSettings(await db.settings.get('app') ?? defaultSettings(now)), syncTimeZone: local.timeZone },
      cards: await db.cards.toArray(), logs: await db.reviewLogs.toArray(), ...(savedLocal ? { events: await db.syncEvents.toArray() } : {}) });
    const migrated = migrateSnapshot(snapshot, crypto.randomUUID());
    return { snapshot: migrated, local: { ...local, clock: observedClock(local.clock, snapshotShared(migrated)) } };
  };
  const write = async (snapshot: Snapshot, local: LocalSyncState) => {
    const putChanges = async <T extends object>(table: Table<T, string>, values: T[], key: (value: T) => string) => {
      const old = new Map((await table.toArray()).map(value => [key(value), value]));
      const changed = values.filter(value => stableJson(old.get(key(value))) !== stableJson(value));
      if (changed.length) await table.bulkPut(changed);
      const ids = new Set(values.map(key)); const removed = [...old.keys()].filter(id => !ids.has(id));
      if (removed.length) await table.bulkDelete(removed);
    };
    await putChanges(db.cards, snapshot.cards, card => card.wordId);
    await putChanges(db.reviewLogs, snapshot.logs, log => log.id);
    await putChanges(db.syncEvents, snapshot.events ?? [], event => event.id);
    await db.settings.put(snapshot.settings); await db.localSettings.put(local);
  };
  const prepareResources = async (settings: AppSettings, cards: CardRecord[], includeCurrent: boolean) => {
    await loader?.prepareSnapshot({ settings, cards, logs: [] }, includeCurrent);
  };
  const transact = async (action: AppAction, now = Date.now()): Promise<Snapshot> => {
    if (action.type === 'preferences') validatePreferences(action.value);
    if (loader) {
      const settings = normaliseSettings(await db.settings.get('app') ?? defaultSettings(now));
      await prepareResources(action.type === 'preferences' ? { ...settings, ...action.value } : settings, await db.cards.toArray(), action.type !== 'tick' || Boolean(action.startIfReady));
    }
    return db.transaction('rw', tables, async () => {
      const { snapshot: saved, local } = await read(now);
      const before = action.type === 'start' ? projectSnapshot(saved, snapshotShared(saved), activeWords(saved.settings), now, local.timeZone, true, replayCache) : saved;
      const required = action.type === 'preferences' ? action.value.selectedWordlists : before.settings.selectedWordlists;
      if (catalog && required.some(id => !catalog[id])) throw new Error('词表选择已在其他页面更改，请重新加载。');
      const management = action.type === 'preferences' || action.type === 'bookmark' || action.type === 'unslash' || action.type === 'exported';
      const managed = management ? manageSnapshot(before, action, availableWords(), now) : before;
      const selected = activeWords(managed.settings);
      const key = managed.settings.selectedWordlists.join(',');
      if (catalog && key !== poolKey) { pool = prepareChoicePool(selected); poolKey = key; }
      const transitioned = fillSnapshots(management ? reconcileSnapshot(managed, selected, now)
        : transitionStudy(managed, action, selected, pool, now, crypto.randomUUID()));
      const recorded = recordMutation(before, transitioned, action, local, now, () => crypto.randomUUID());
      const shared = snapshotShared(recorded.snapshot);
      const after = projectSnapshot(recorded.snapshot, shared, selected, now, local.timeZone, false, replayCache);
      await write(after, recorded.local);
      return after;
    });
  };
  const prepareImport = async (text: string): Promise<Snapshot> => {
    const structured = parseBackup(text);
    if (loader) { await loader.ensureLists(structured.settings.selectedWordlists); await loader.ensureWords(backupWordIds(structured)); }
    return migrateSnapshot(fillSnapshots(parseBackup(text, new Set(availableWords().map(word => word.id)))), crypto.randomUUID());
  };
  const mergeIncoming = async (value: unknown, now = Date.now(), timeZone?: string): Promise<Snapshot> => {
    const incoming = parseShared(value);
    if (timeZone && timeZone !== STUDY_TIME_ZONE) throw new Error('同步库必须使用北京时间，现有数据未修改。');
    if (loader) {
      const { snapshot: local } = await db.transaction('r', tables, () => read(now));
      const combined = mergeShared(snapshotShared(local), incoming);
      const desired = materializeShared(combined, STUDY_TIME_ZONE, replayCache).preferences;
      await prepareResources({ ...local.settings, ...desired }, local.cards, true);
    }
    return db.transaction('rw', tables, async () => {
      const { snapshot: before, local } = await read(now);
      const shared = mergeShared(snapshotShared(before), incoming);
      const zone = STUDY_TIME_ZONE;
      const desired = materializeShared(shared, zone, replayCache).preferences;
      const settings = { ...before.settings, ...desired };
      if (catalog && settings.selectedWordlists.some(id => !catalog[id])) throw new Error('所选词表尚未准备好，现有数据未修改。');
      const after = projectSnapshot(before, shared, activeWords(settings), now, zone, true, replayCache);
      await write(after, { ...local, timeZone: zone, ...(timeZone ? { boundTimeZone: zone } : {}), clock: observedClock(local.clock, shared) });
      return after;
    });
  };
  const importBackup = async (text: string, now = Date.now()) => mergeIncoming(snapshotShared(await prepareImport(text)), now);
  return { db, transact, importBackup, prepareImport, mergeShared: mergeIncoming,
    exportShared: async (now = Date.now()) => snapshotShared(await transact({ type: 'tick' }, now)),
    load: (now = Date.now()) => transact({ type: 'tick' }, now) };
}
export type StudyStore = ReturnType<typeof createStudyStore>;
