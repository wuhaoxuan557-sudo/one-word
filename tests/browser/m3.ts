import { VocabularyDatabase, createStudyStore } from '../../src/storage/database';
import { serializeBackup, parseBackup } from '../../src/core/backup';
import { preferences } from '../../src/core/preferences';
import { readyQueue } from '../../src/core/queue';
import { studyWords as words, studyTime as now } from '../../src/core/study.test-helper';

const output = document.querySelector<HTMLPreElement>('#result')!;
const report: string[] = [];
function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
  report.push(`PASS ${label}`); output.textContent = report.join('\n');
}
async function runTests() {
  report.length = 0;
  const name = 'one-word-m3-browser-tests';
  let db = new VocabularyDatabase(name); await db.delete();
  db = new VocabularyDatabase(name); let store = createStudyStore(words, db);
  const initial = await store.transact({ type: 'start' }, now);
  const current = initial.settings.daily!.current!;
  const saved = await store.transact({ type: 'answer', presentationId: current.id, selectedId: current.wordId, elapsedMs: 3000 }, now + 3000);
  const backup = serializeBackup(saved, now + 4000);
  const before = JSON.stringify(await store.load(now + 4000));
  const wrongVersion = JSON.parse(backup) as Record<string, unknown>; wrongVersion.version = 99;
  for (const [label, text] of [['empty', ''], ['invalid JSON', '{broken'], ['wrong shape', '{}'], ['unsupported version', JSON.stringify(wrongVersion)]] as const) {
    let rejected = false; try { await store.importBackup(text, now + 4000); } catch { rejected = true; }
    check(rejected && JSON.stringify(await store.load(now + 4000)) === before, `${label} import leaves all four tables unchanged`);
  }
  const marked = await store.transact({ type: 'bookmark', wordId: 'star', value: true }, now + 4000);
  check(marked.settings.daily?.newIds[1] === 'star', 'bookmark moves an untouched word ahead of reserved new words');
  const changed = await store.transact({ type: 'preferences', value: { ...preferences(marked.settings), newLimit: 3, reviewLimit: 10, autoSpeak: false, accent: 'en-US', grading: { easyMs: 500, hardMs: 900 } } }, now + 4000);
  db.close(); db = new VocabularyDatabase(name); store = createStudyStore(words, db);
  check(JSON.stringify((await store.load(now + 4000)).settings) === JSON.stringify(changed.settings), 'all preferences survive database reopen');
  const beforeFailure = JSON.stringify(await store.load(now + 4000));
  let sourceDb = new VocabularyDatabase('one-word-m3-import-source'); await sourceDb.delete();
  sourceDb = new VocabularyDatabase('one-word-m3-import-source');
  const source = createStudyStore(words, sourceDb);
  const sourceMarked = await source.transact({ type: 'bookmark', wordId: 'chair', value: true }, now + 4000);
  const newBackup = serializeBackup(sourceMarked, now + 4000); sourceDb.close();
  db.cards.hook('creating', () => { throw new Error('Intentional import failure'); });
  let rejected = false; try { await store.importBackup(newBackup, now + 4000); } catch { rejected = true; }
  db.close(); db = new VocabularyDatabase(name); store = createStudyStore(words, db);
  check(rejected && JSON.stringify(await store.load(now + 4000)) === beforeFailure, 'failed merge transaction restores all original tables');
  const imported = await store.importBackup(backup, now + 4000);
  const parsed = parseBackup(backup);
  check(imported.logs.length === 1 && imported.cards.some(card => card.wordId === 'star' && card.bookmarked) &&
    imported.cards[0]?.fsrs.due instanceof Date && !imported.settings.autoSpeak && parsed.settings.autoSpeak,
    'valid import merges data, retains later local settings and revives FSRS dates');
  check(imported.settings.daily?.current?.id === current.id && imported.settings.daily.current.answer?.rating === 'Good', 'valid import retains the local feedback and current question');
  const next = await store.transact({ type: 'next', presentationId: current.id }, now + 5000);
  const slashed = await store.transact({ type: 'slash', presentationId: next.settings.daily!.current!.id }, now + 5000);
  const restored = await store.transact({ type: 'unslash', wordId: next.settings.daily!.current!.wordId }, now + 9000);
  check(slashed.cards.some(card => card.slashed) && !restored.cards.some(card => card.slashed) &&
    readyQueue(restored, now + 9000).some(item => item.wordId === next.settings.daily!.current!.wordId), 'wordbook unslash returns the word to the queue without adding a review');
  const exported = await store.transact({ type: 'exported', at: now + 10000 }, now + 10000);
  check(exported.settings.lastExportAt === now + 10000, 'successful export records backup reminder time');
  db.close(); output.textContent += '\nALL M3 DATABASE CHECKS PASSED';
}
document.querySelector('#run')!.addEventListener('click', () => { void runTests().catch(error => { output.textContent += `\nFAIL ${String(error)}`; }); });
