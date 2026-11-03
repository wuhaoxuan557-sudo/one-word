import { VocabularyDatabase, createStudyStore } from '../../src/storage/database';
import { defaultSettings } from '../../src/core/session';
import { nextMidnight } from '../../src/core/queue';
import { studyWords as words, studyTime as now } from '../../src/core/study.test-helper';
import type { Snapshot } from '../../src/types';
import { stableJson } from '../../src/core/sync/identity';

const databaseName = 'one-word-m2-browser-tests';
const output = document.querySelector<HTMLPreElement>('#result')!;
const report: string[] = [];
const current = (snapshot: Snapshot) => snapshot.settings.daily!.current!;
function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
  report.push(`PASS ${label}`); output.textContent = report.join('\n');
}
const equal = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

async function runTests() {
  report.length = 0;
  let db = new VocabularyDatabase(databaseName);
  await db.delete();
  db = new VocabularyDatabase(databaseName);
  let store = createStudyStore(words, db);
  await db.settings.put({ ...defaultSettings(now), newLimit: 2, reviewLimit: 1, grading: { easyMs: 500, hardMs: 900 }, autoSpeak: false });
  await store.load(now);
  check(equal(db.tables.map(table => table.name).sort(), ['cards', 'reviewLogs', 'settings', 'syncEvents']), 'four IndexedDB tables including syncEvents');
  const initial = await store.transact({ type: 'start' }, now);
  const saved = await store.transact({ type: 'answer', presentationId: current(initial).id, selectedId: 'apple', elapsedMs: 600 }, now + 1000);
  check(current(saved).answer?.rating === 'Good', 'rating thresholds read from settings');
  const snapshotBeforeClose = structuredClone(saved);
  db.close();
  db = new VocabularyDatabase(databaseName); store = createStudyStore(words, db);
  const reopened = await store.load(now + 1001);
  check(equal(current(reopened), current(snapshotBeforeClose)), 'close/reopen retains phase, options, answer and due time');
  check(reopened.cards[0]?.fsrs.due instanceof Date && reopened.logs[0]?.fsrsLog.review instanceof Date, 'IndexedDB preserves FSRS dates');
  check(reopened.logs.length === 1 && reopened.settings.daily?.completed === 1, 'close/reopen retains log and daily progress');
  db.reviewLogs.hook('updating', () => { throw new Error('Intentional duration update failure'); });
  let nextRejected = false;
  try { await store.transact({ type: 'next', presentationId: current(reopened).id }, now + 1050); }
  catch { nextRejected = true; }
  check(nextRejected && (await db.reviewLogs.get(current(reopened).id))?.studyMs === undefined &&
    (await db.settings.get('app'))?.daily?.current?.id === current(reopened).id,
  'failed duration update rolls back Next and preserves the current question');
  db.close(); db = new VocabularyDatabase(databaseName); store = createStudyStore(words, db);
  const second = await store.transact({ type: 'next', presentationId: current(reopened).id }, now + 1100);
  db.close(); db = new VocabularyDatabase(databaseName); store = createStudyStore(words, db);
  const finishedLog = await db.reviewLogs.get(current(reopened).id);
  check(finishedLog?.studyMs === 1100 && finishedLog.elapsedMs === 600 && finishedLog.rating === 'Good',
    'Next persists complete card duration separately from grading time after reopen');
  const otherDb = new VocabularyDatabase(databaseName);
  const other = createStudyStore(words, otherDb);
  await Promise.all([
    store.transact({ type: 'answer', presentationId: current(second).id, selectedId: 'table', elapsedMs: 100 }, now + 1200),
    other.transact({ type: 'answer', presentationId: current(second).id, selectedId: null, elapsedMs: 100 }, now + 1200),
  ]);
  otherDb.close();
  const afterRace = await store.load(now + 1201);
  check(afterRace.logs.length === 2 && afterRace.cards.find(card => card.wordId === 'table')?.fsrs.reps === 1, 'concurrent duplicate submissions produce one review');
  const previousTable = afterRace.cards.find(card => card.wordId === 'table');
  const slashed = await store.transact({ type: 'slash', presentationId: current(afterRace).id }, now + 1300);
  check(slashed.logs.length === 2 && slashed.cards.find(card => card.wordId === 'table')?.slashed, 'slash persists without a new review log');
  db.close(); db = new VocabularyDatabase(databaseName); store = createStudyStore(words, db);
  const slashReload = await store.load(now + 1301);
  const restored = await store.transact({ type: 'undo', expiresAt: slashReload.settings.daily!.undo!.expiresAt }, now + 1302);
  check(equal(restored.cards.find(card => card.wordId === 'table'), previousTable), 'undo survives reload within its three-second window');
  const repeat = await store.transact({ type: 'start' }, now + 601_000);
  check(current(repeat).wordId === 'apple' && current(repeat).kind === 'review', 'FSRS learning step reappears when due');
  await store.transact({ type: 'slash', presentationId: current(repeat).id }, now + 602_000);
  db.close(); db = new VocabularyDatabase(databaseName); store = createStudyStore(words, db);
  const tomorrow = await store.load(nextMidnight(now));
  check(tomorrow.cards.find(card => card.wordId === 'apple')?.slashed &&
    !tomorrow.settings.daily!.newIds.includes('apple') && !tomorrow.settings.daily!.reviewIds.includes('apple'), 'slashed word stays excluded after reopen and midnight');
  check(tomorrow.settings.daily?.completed === 0 && tomorrow.logs.length === 2, 'midnight resets daily progress but preserves history');
  const pending = await store.transact({ type: 'start' }, nextMidnight(now));
  const failingId = current(pending).wordId;
  db.reviewLogs.hook('creating', () => { throw new Error('Intentional transaction failure'); });
  let rejected = false;
  try { await store.transact({ type: 'answer', presentationId: current(pending).id, selectedId: failingId, elapsedMs: 100 }, nextMidnight(now) + 1); }
  catch { rejected = true; }
  check(rejected && !(await db.cards.get(failingId)) && (await db.reviewLogs.count()) === 2 &&
    (await db.settings.get('app'))?.daily?.current?.phase === 'recognise', 'transaction failure rolls back card, log and resume state together');
  db.close();
  output.textContent += '\nALL DATABASE CHECKS PASSED\nClose this tab, open this URL again, then select the reopen check.';
}

async function verifyReopen() {
  const db = new VocabularyDatabase(databaseName);
  try {
    const snapshot = await createStudyStore(words, db).load(nextMidnight(now) + 2);
    check(snapshot.logs.length === 2 && snapshot.cards.find(card => card.wordId === 'apple')?.slashed &&
      current(snapshot).wordId === 'chair' && current(snapshot).phase === 'recognise' && current(snapshot).optionIds.length === 4,
    'NEW PAGE: persisted history, slash and current question recovered');
    output.textContent += `\n${JSON.stringify({ logs: snapshot.logs.length, current: current(snapshot).wordId, day: snapshot.settings.daily?.day, completed: snapshot.settings.daily?.completed })}`;
  } finally { db.close(); }
}

document.querySelector('#run')!.addEventListener('click', () => { void runTests().catch(error => { output.textContent += `\nFAIL ${String(error)}`; }); });
document.querySelector('#reopen')!.addEventListener('click', () => { void verifyReopen().catch(error => { output.textContent += `\nFAIL ${String(error)}`; }); });
