import Dexie from 'dexie';
import { createStudyStore, VocabularyDatabase } from '../../src/storage/database';
import type { StudyStore } from '../../src/storage/database';
import type { Snapshot, Word } from '../../src/types';
import { defaultSettings } from '../../src/core/session';
import { studyTransition as transitionStudy } from '../../src/core/study.test-helper';
import { preferences } from '../../src/core/preferences';
import { prepareChoicePool } from '../../src/core/choices';
import { studyWords as words, studyTime as now, freshSnapshot } from '../../src/core/study.test-helper';
import { serializeBackup, parseBackup } from '../../src/core/backup';
import { decodeDeviceFile, encodeDeviceMonth, compactReview, compactEvent, utf8Bytes } from '../../src/core/sync/compact';
import { calendarDay } from '../../src/core/sync/calendar';
import { isUuid, stableJson, uuid5 } from '../../src/core/sync/identity';
import { mergeShared } from '../../src/core/sync/merge';
import { emptyShared } from '../../src/core/sync/model';

const output = document.querySelector<HTMLPreElement>('#result')!;
const sizes = document.querySelector<HTMLPreElement>('#sizes')!;
const report: string[] = [];
const openDatabases: VocabularyDatabase[] = [];
const current = (s: Snapshot) => s.settings.daily!.current!;
let outsideRequests = 0;
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== location.origin) { outsideRequests++; return Promise.reject(new Error('External requests are forbidden in this test.')); }
  return originalFetch(input, init);
};
function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
  report.push(`PASS ${label}`); output.textContent = report.join('\n');
}
async function device(suffix: string, newLimit = 2) {
  const name = `one-word-sync-test-${suffix}`;
  let db = new VocabularyDatabase(name); await db.delete(); db = new VocabularyDatabase(name); openDatabases.push(db);
  await db.settings.put({ ...defaultSettings(now), newLimit, reviewLimit: 20, autoSpeak: false });
  const store = createStudyStore(words, db); await store.load(now); await store.mergeShared(emptyShared(), now, 'Asia/Shanghai');
  return store;
}
async function send(from: StudyStore, to: StudyStore, at: number) {
  const shared = await from.exportShared(at); const owner = (await from.db.localSettings.get('sync-local'))!.deviceId;
  const files = encodeDeviceMonth(shared, owner, calendarDay(at).slice(0, 7), 'Asia/Shanghai');
  const received = files.reduce((state, file) => mergeShared(state, decodeDeviceFile(file.content).state), emptyShared());
  return to.mergeShared(received, at, 'Asia/Shanghai');
}
async function dump(store: StudyStore) {
  return stableJson([await store.db.cards.toArray(), await store.db.reviewLogs.toArray(), await store.db.settings.toArray(), await store.db.syncEvents.toArray()]);
}
async function run() {
  report.length = 0; sizes.textContent = '';
  const a = await device('A'), b = await device('B');
  const aStart = await a.transact({ type: 'start' }, now), bStart = await b.transact({ type: 'start' }, now);
  check(isUuid(current(aStart).id) && current(aStart).id !== current(bStart).id, 'independent databases issue globally distinct UUID questions');
  await a.transact({ type: 'answer', presentationId: current(aStart).id, selectedId: 'apple', elapsedMs: 3000 }, now + 1000);
  await b.transact({ type: 'answer', presentationId: current(bStart).id, selectedId: null, elapsedMs: 4000 }, now + 2000);
  const bMerged = await send(a, b, now + 2500); const aMerged = await send(b, a, now + 2500);
  check(aMerged.logs.length === 2 && bMerged.logs.length === 2 && aMerged.cards.find(c => c.wordId === 'apple')?.fsrs.reps === 2 &&
    aMerged.cards.find(c => c.wordId === 'apple')?.everWrong, 'concurrent correct/wrong answers survive tuple transfer and rebuild one FSRS card');
  check(stableJson(await a.exportShared(now + 2500)) === stableJson(await b.exportShared(now + 2500)), 'bidirectional exchange converges to the same canonical shared state');
  check(current(aMerged).id === current(aStart).id && current(bMerged).id === current(bStart).id && current(aMerged).id !== current(bMerged).id,
    'each database retains its own current feedback instead of importing the other question');
  const beforeRepeat = stableJson(await a.exportShared(now + 2500));
  await send(b, a, now + 2500);
  check(stableJson(await a.exportShared(now + 2500)) === beforeRepeat, 'repeated merge does not duplicate records or produce artificial field versions');
  await a.transact({ type: 'details', presentationId: current(aStart).id }, now + 3000);
  const next = await a.transact({ type: 'next', presentationId: current(aStart).id }, now + 5000);
  check(next.logs.find(log => log.id === current(aStart).id)?.studyMs === 5000 && current(next).id !== current(aStart).id,
    'Next after merged feedback preserves the completed duration and issues a fresh local UUID');

  const a2 = await device('quota-A', 1), b2 = await device('quota-B', 1);
  await b2.transact({ type: 'bookmark', wordId: 'table', value: true }, now);
  const qa = await a2.transact({ type: 'start' }, now), qb = await b2.transact({ type: 'start' }, now);
  await a2.transact({ type: 'answer', presentationId: current(qa).id, selectedId: current(qa).wordId, elapsedMs: 1000 }, now + 1000);
  await b2.transact({ type: 'answer', presentationId: current(qb).id, selectedId: current(qb).wordId, elapsedMs: 1000 }, now + 1000);
  const quotaMerged = await send(b2, a2, now + 1500);
  check(quotaMerged.settings.daily?.completed === 2 && quotaMerged.settings.daily.newIds.length === 2 &&
    quotaMerged.settings.daily.newIds.every(id => quotaMerged.cards.find(c => c.wordId === id)?.fsrs.reps),
    'two offline introductions consume the shared quota; merged reservations do not grant another new allowance');

  const sa = await device('slash-A'), sb = await device('slash-B');
  const saStart = await sa.transact({ type: 'start' }, now), sbStart = await sb.transact({ type: 'start' }, now);
  const slashed = await sa.transact({ type: 'slash', presentationId: current(saStart).id }, now + 1000);
  await send(sa, sb, now + 1200);
  await sb.transact({ type: 'answer', presentationId: current(sbStart).id, selectedId: 'apple', elapsedMs: 1000 }, now + 1500);
  await send(sb, sa, now + 2000);
  const undone = await sa.transact({ type: 'undo', expiresAt: slashed.settings.daily!.undo!.expiresAt }, now + 2200);
  await send(sa, sb, now + 2300);
  check(undone.cards.find(c => c.wordId === 'apple')?.fsrs.reps === 1 && !undone.cards.find(c => c.wordId === 'apple')?.slashed && undone.logs.length === 1,
    'three-second slash undo preserves a review merged after the original card snapshot');
  check(undone.settings.daily?.completed === 1, 'undo cancels only its own slash quota event, retaining concurrent completed answers');

  const pa = await a.transact({ type: 'preferences', value: { ...preferences(aMerged.settings), newLimit: 7 } }, now + 5000);
  await b.transact({ type: 'preferences', value: { ...preferences(bMerged.settings), newLimit: 9 } }, now + 5000);
  await send(a, b, now + 5000); const resolved = await send(b, a, now + 5000);
  check(resolved.settings.newLimit === (await b.load(now + 5000)).settings.newLimit && [7, 9].includes(resolved.settings.newLimit),
    'equal-millisecond preference edits converge by HLC and device UUID');
  check(pa.settings.newLimit === 7, 'local preferences take effect before any exchange');
  const privateLocal = (await a.db.localSettings.get('sync-local'))!;
  await a.db.localSettings.put(Object.assign(privateLocal, { token: 'LOCAL_ONLY_SENTINEL_DO_NOT_EXPORT' }));
  const backup = serializeBackup(await a.load(now + 6000), now + 6000);
  check(!backup.includes('LOCAL_ONLY_SENTINEL') && !JSON.stringify(await a.exportShared(now + 6000)).includes('LOCAL_ONLY_SENTINEL'),
    'backups and shared tuples exclude device-local credentials');
  const beforeImport = await b.load(now + 6000); const localId = (await b.db.localSettings.get('sync-local'))!.deviceId;
  const imported = await b.importBackup(backup, now + 6000); const importedTwice = await b.importBackup(backup, now + 6000);
  check(imported.logs.length === 2 && importedTwice.logs.length === 2 && current(importedTwice).id === current(beforeImport).id &&
    (await b.db.localSettings.get('sync-local'))!.deviceId === localId, 'repeated backup imports merge history while retaining the receiver current question and device identity');
  const unchanged = await dump(a);
  let invalidRejected = false; try { await a.importBackup('{}', now + 6000); } catch { invalidRejected = true; }
  check(invalidRejected && await dump(a) === unchanged, 'invalid import leaves all four stores and local metadata unchanged');
  let zoneRejected = false; try { await a.mergeShared(emptyShared(), now + 6000, 'UTC'); } catch { zoneRejected = true; }
  check(zoneRejected && await dump(a) === unchanged, 'a bound dataset timezone cannot be silently changed by a later merge');
  a.db.syncEvents.hook('creating', () => { throw new Error('Intentional sync event failure'); });
  let failed = false; try { await a.transact({ type: 'bookmark', wordId: 'star', value: true }, now + 6000); } catch { failed = true; }
  check(failed && await dump(a) === unchanged, 'an event write failure rolls back cards, logs, settings, HLC and event data together');
  a.db.close();
  const reopenedDb = new VocabularyDatabase('one-word-sync-test-A'); openDatabases.push(reopenedDb);
  const reopened = createStudyStore(words, reopenedDb); const restored = await reopened.load(now + 7000);
  check(restored.logs.length === 2 && (await reopenedDb.localSettings.get('sync-local'))!.deviceId === privateLocal.deviceId,
    'database close/reopen retains merged progress, HLC metadata and device UUID');
  check(stableJson(parseBackup(serializeBackup(restored, now + 7000)).events) === stableJson(restored.events), 'version 2 backups preserve validated merge events');

  const legacyName = 'one-word-sync-test-legacy';
  const old = new Dexie(legacyName); old.version(1).stores({ cards: '&wordId, fsrs.due', reviewLogs: '&id, wordId, answeredAt, day, [wordId+answeredAt]', settings: '&id' });
  await old.delete(); await old.open();
  const pool = prepareChoicePool(words);
  const legacyStart = transitionStudy(freshSnapshot(), { type: 'start' }, words, pool, now);
  legacyStart.settings.daily!.current!.id = '2026-11-02:1';
  const legacy = transitionStudy(legacyStart, { type: 'answer', presentationId: current(legacyStart).id, selectedId: 'apple', elapsedMs: 3000 }, words, pool, now + 1000);
  await old.table('cards').bulkPut(legacy.cards); await old.table('reviewLogs').bulkPut(legacy.logs); await old.table('settings').put(legacy.settings); old.close();
  const upgradedDb = new VocabularyDatabase(legacyName); openDatabases.push(upgradedDb);
  const upgraded = await createStudyStore(words, upgradedDb).load(now + 7000);
  check(upgradedDb.verno === 2 && upgradedDb.tables.length === 4 && isUuid(upgraded.logs[0]!.id) && current(upgraded).answer?.id === upgraded.logs[0]!.id,
    'real IndexedDB version 1 upgrade adds syncEvents and atomically migrates log/current IDs');
  const copy = await device('legacy-copy'); await copy.importBackup(serializeBackup(legacy, now), now + 7000);
  check((await copy.load(now + 7000)).logs[0]!.id === upgraded.logs[0]!.id, 'legacy database migration and the same legacy backup import produce the identical UUID');
  check(upgraded.logs[0]!.answeredAt === legacy.logs[0]!.answeredAt && upgraded.cards[0]!.fsrs.reps === 1, 'migration retains answer time and FSRS review count');

  const midnight = Date.parse('2026-11-03T16:00:00Z');
  const dayA = await device('day-A'), dayB = await device('day-B');
  const issued = await dayA.transact({ type: 'start' }, midnight - 2000);
  await dayA.transact({ type: 'answer', presentationId: current(issued).id, selectedId: current(issued).wordId, elapsedMs: 1000 }, midnight - 1000);
  await send(dayA, dayB, midnight - 500);
  const todayB = await dayB.load(midnight);
  check(todayB.settings.daily?.day === '2026-11-04' && todayB.settings.daily.completed === 0 && todayB.logs.length === 1,
    'shared-timezone midnight resets only the day quota while retaining merged history');

  const measured = await reopened.exportShared(now + 7000); const owner = (await reopenedDb.localSettings.get('sync-local'))!.deviceId;
  const samples = measured.reviews.map(log => ({ rating: log.rating, completed: log.studyMs !== undefined,
    bytes: utf8Bytes(JSON.stringify(compactReview(log, log.deviceId))) }));
  const complete = { ...measured.reviews[0]!, studyMs: 25000 };
  samples.push({ rating: complete.rating, completed: true, bytes: utf8Bytes(JSON.stringify(compactReview(complete, complete.deviceId))) });
  const serialized = encodeDeviceMonth(measured, owner, '2026-11', 'Asia/Shanghai');
  const summary = (values: number[]) => ({ count: values.length, min: Math.min(...values), max: Math.max(...values), mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) });
  const cet4Response = await fetch(`${import.meta.env.BASE_URL}wordlists/cet4.json`);
  if (!cet4Response.ok) throw new Error('The local CET4 measurement fixture could not be loaded.');
  const cet4 = await cet4Response.json() as Word[];
  const realSamples = cet4.map(word => ({ ...complete, wordId: word.id, selectedId: word.id, correct: true, rating: 'Good' as const, elapsedMs: 2387.125 }));
  sizes.textContent = JSON.stringify({ reviews: samples, eventBytes: measured.events.map(event => ({ type: event.type, bytes: utf8Bytes(JSON.stringify(compactEvent(event, event.deviceId))) })),
    fileBytes: serialized.map(file => file.bytes),
    cet4CompletedCorrect: summary(realSamples.map(log => utf8Bytes(JSON.stringify(compactReview(log, log.deviceId))))),
    cet4Unknown: summary(realSamples.map(log => utf8Bytes(JSON.stringify(compactReview({ ...log, selectedId: null, correct: false, rating: 'Again' }, log.deviceId))))),
    cet4WithImportedOrigin: summary(realSamples.map(log => utf8Bytes(JSON.stringify(compactReview(log, owner === log.deviceId ? uuid5('other-writer') : owner))))) }, null, 2);
  check(outsideRequests === 0, 'zero external network requests attempted');
  output.textContent += '\nALL LOCAL SYNC CHECKS PASSED';
  for (const db of openDatabases) db.close();
}
document.querySelector('#run')!.addEventListener('click', () => { void run().catch(error => { output.textContent += `\nFAIL ${String(error)}`; for (const db of openDatabases) db.close(); }); });
