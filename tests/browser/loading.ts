import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Wordbook } from '../../src/components/Wordbook';
import { createStudyStore, VocabularyDatabase } from '../../src/storage/database';
import { createWordlistLoader } from '../../src/storage/wordlists';
import { emptyCard } from '../../src/core/scheduler';
import { preferences } from '../../src/core/preferences';
import { serializeBackup } from '../../src/core/backup';

const output = document.querySelector<HTMLPreElement>('#result')!;
const root = createRoot(document.querySelector('#wordbook')!);
const report: string[] = [];
function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
  report.push(`PASS ${label}`); output.textContent = report.join('\n');
}
function source(failGre = false) {
  const requested: string[] = [];
  const loader = createWordlistLoader(url => {
    requested.push(url.split('/').pop()!);
    return failGre && url.endsWith('/gre.json') ? Promise.reject(new Error('Intentional load failure')) : fetch(url);
  }, import.meta.env.BASE_URL);
  return { loader, requested };
}
async function runTests() {
  report.length = 0;
  const name = 'one-word-m3-loading-tests';
  let db = new VocabularyDatabase(name); await db.delete(); db = new VocabularyDatabase(name);
  let resources = source(); let store = createStudyStore([], db, resources.loader.catalog, resources.loader);
  const now = Date.now(); await store.load(now);
  check(resources.requested.join(',') === 'cet4.json', 'cold startup fetches only the selected CET4 JSON, no index or other lists');
  const legacy = { ...emptyCard('ecdict:abnegation', now), bookmarked: true, slashed: true };
  await db.cards.put(legacy);
  const migrated = await store.load(now);
  const card = await db.cards.get(legacy.wordId);
  check(resources.requested.join(',') === 'cet4.json,index.json,gre.json', 'legacy migration loads only the required GRE source in addition to CET4');
  check(card?.wordSnapshot?.word === 'abnegation' && !!card.wordSnapshot.translation &&
    JSON.stringify(card.fsrs) === JSON.stringify(legacy.fsrs) && card.bookmarked && card.slashed, 'migration persists display snapshots without changing FSRS or saved flags');
  db.close(); db = new VocabularyDatabase(name); resources = source(); store = createStudyStore([], db, resources.loader.catalog, resources.loader);
  const reopened = await store.load(now);
  check(resources.requested.join(',') === 'cet4.json' && !resources.loader.catalog.gre && reopened.cards[0]?.wordSnapshot?.word === 'abnegation',
    'database reopen retains the GRE bookmark while fetching only CET4');
  root.render(createElement(Wordbook, { snapshot: reopened, tab: 'bookmarked', busy: false, onTab: () => {}, onRemove: () => {} }));
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  check(document.querySelector('#wordbook')!.textContent!.includes('abnegation') &&
    document.querySelector('#wordbook')!.textContent!.includes(card!.wordSnapshot!.translation), 'wordbook visibly renders an unselected GRE word and its short definition from the persisted snapshot');
  await store.transact({ type: 'bookmark', wordId: legacy.wordId, value: false }, now);
  const removed = await store.transact({ type: 'unslash', wordId: legacy.wordId }, now);
  check(!removed.cards[0]?.bookmarked && !removed.cards[0]?.slashed && resources.requested.join(',') === 'cet4.json',
    'removing a bookmark and unslashing an unloaded word need no source fetch');
  const switched = await store.transact({ type: 'preferences', value: { ...preferences(removed.settings), selectedWordlists: ['gre'] } }, now);
  check(resources.requested.join(',') === 'cet4.json,gre.json' && switched.settings.daily?.newIds.includes(legacy.wordId),
    'switching to GRE loads it once and brings the restored word into its queue');
  const oldBackup = structuredClone(migrated); delete oldBackup.cards[0]!.wordSnapshot;
  const text = serializeBackup(oldBackup, now);
  db.close(); db = new VocabularyDatabase(name); resources = source(true); store = createStudyStore([], db, resources.loader.catalog, resources.loader);
  const before = JSON.stringify([await db.cards.toArray(), await db.reviewLogs.toArray(), await db.settings.toArray()]);
  let rejected = false; try { await store.importBackup(text, now); } catch { rejected = true; }
  check(rejected && before === JSON.stringify([await db.cards.toArray(), await db.reviewLogs.toArray(), await db.settings.toArray()]),
    'failed import resource loading leaves all three existing tables unchanged');
  resources = source(); store = createStudyStore([], db, resources.loader.catalog, resources.loader);
  const prepared = await store.prepareImport(text);
  check(resources.requested.join(',') === 'cet4.json,index.json,gre.json' && !!prepared.cards[0]?.wordSnapshot &&
    before === JSON.stringify([await db.cards.toArray(), await db.reviewLogs.toArray(), await db.settings.toArray()]),
    'legacy import validation fetches only referenced sources and fills snapshots without writing before confirmation');
  await store.importBackup(text, now);
  check((await db.cards.get(legacy.wordId))?.wordSnapshot?.word === 'abnegation', 'confirmed legacy import atomically saves the completed snapshot');
  db.close(); output.textContent += '\nALL LAZY LOADING CHECKS PASSED';
}
document.querySelector('#run')!.addEventListener('click', () => { void runTests().catch(error => { output.textContent += `\nFAIL ${String(error)}`; }); });
