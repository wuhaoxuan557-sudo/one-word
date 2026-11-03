import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VocabularyDatabase, createStudyStore } from '../../src/storage/database';
import { createSyncStorage, defaultSyncConfig } from '../../src/storage/sync';
import { createSyncController } from '../../src/core/sync/controller';
import type { SyncView } from '../../src/core/sync/controller';
import { mockGithub } from '../../src/core/sync/github.test-helper';
import { Settings } from '../../src/components/Settings';
import { SyncSettings } from '../../src/components/SyncSettings';
import { defaultSettings } from '../../src/core/session';
import { studyWords as words } from '../../src/core/study.test-helper';
import { materializeShared } from '../../src/core/sync/merge';
import { decodeDeviceFile } from '../../src/core/sync/compact';
import { devices, fact, state } from '../../src/core/sync/fixtures.test-helper';
import { STUDY_TIME_ZONE } from '../../src/core/sync/calendar';
import { serializeBackup } from '../../src/core/backup';
import { stableJson } from '../../src/core/sync/identity';
import '../../src/styles.css';
import { checkStaleCurrent } from './stale-current';

const now = Date.parse('2026-11-03T15:30:00Z');
const checks: string[] = []; const open: VocabularyDatabase[] = [];
let outside = 0;
const actualFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  if (new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).origin !== location.origin) { outside++; throw new Error('External requests are forbidden.'); }
  return actualFetch(input, init);
};
async function database(name: string) { let db = new VocabularyDatabase(`one-word-gist-test-${name}`); await db.delete(); db = new VocabularyDatabase(db.name); open.push(db); return db; }
async function runTests(report: (text: string) => void) {
  const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); checks.push(`PASS ${label}`); report(checks.join('\n')); };
  checks.length = 0;
  await checkStaleCurrent(database, now, check);
  const old = await database('old-timezone'); const shared = state([fact('timezone', devices[0], now)]);
  const oldMaterialized = materializeShared(shared, 'Asia/Tokyo');
  await old.cards.bulkPut(oldMaterialized.cards); await old.reviewLogs.bulkPut(oldMaterialized.logs);
  await old.settings.put({ ...defaultSettings(now), syncTimeZone: 'Asia/Tokyo', daily: { day: '2026-11-04', sequence: 1, completed: 1, newIds: ['apple'], reviewIds: [], undo: null, preferredNextId: null,
    current: { id: shared.reviews[0]!.id, startedAt: now - 1000, wordId: 'apple', kind: 'new', reviewNumber: 0, optionIds: ['apple', 'table', 'chair', 'river'], phase: 'feedback', answer: oldMaterialized.logs[0]! } } });
  await old.localSettings.put({ id: 'sync-local', version: 1, deviceId: devices[0], clock: [now, 0], timeZone: 'Asia/Tokyo', boundTimeZone: 'Asia/Tokyo' });
  const rebased = await createStudyStore(words, old).load(now);
  check(rebased.logs[0]!.day === '2026-11-03' && rebased.logs[0]!.answeredAt === now && rebased.logs[0]!.id === shared.reviews[0]!.id &&
    rebased.settings.daily?.day === '2026-11-03' && rebased.settings.daily.current?.id === shared.reviews[0]!.id, 'existing Tokyo database rebases day labels and keeps timestamps, UUIDs and local feedback');
  check((await old.localSettings.get('sync-local'))!.timeZone === STUDY_TIME_ZONE && (await old.localSettings.get('sync-local'))!.boundTimeZone === STUDY_TIME_ZONE, 'existing device timezone metadata becomes Asia/Shanghai');
  const api = mockGithub(); const aDb = await database('A'), bDb = await database('B');
  const a = createStudyStore(words, aDb), b = createStudyStore(words, bDb); let time = now;
  await a.load(time); await b.load(time);
  const aStorage = createSyncStorage(aDb), bStorage = createSyncStorage(bDb);
  const config = { enabled: true, token: 'LOCAL_MOCK_TOKEN_DO_NOT_EXPORT' };
  await aStorage.update(config); await bStorage.update(config);
  const start = await a.transact({ type: 'start' }, time); const current = start.settings.daily!.current!;
  time += 1000; await a.transact({ type: 'answer', presentationId: current.id, selectedId: current.wordId, elapsedMs: 1000 }, time);
  const make = (store: typeof a, storage: typeof aStorage) => createSyncController({ exportShared: () => store.exportShared(time), mergeShared: (s, t, z) => store.mergeShared(s, t, z) }, storage,
    { fetch: api.fetch, online: () => true, onChange: () => {}, onMerge: () => {}, now: () => time });
  const ca = make(a, aStorage), cb = make(b, bStorage);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  api.setHook(async (_url, init) => { if (init.method === 'PATCH') { entered(); await gate; } return undefined; });
  const syncing = ca.sync(); await ready;
  time += 1000; const next = await a.transact({ type: 'next', presentationId: current.id }, time);
  time += 1000; const second = next.settings.daily!.current!;
  await a.transact({ type: 'answer', presentationId: second.id, selectedId: second.wordId, elapsedMs: 1000 }, time);
  check((await aDb.reviewLogs.count()) === 2, 'local answers commit while a mocked GitHub PATCH is held open');
  release(); await syncing; api.setHook(undefined); await ca.sync();
  await cb.sync(); await ca.sync();
  const aa = await a.load(time), bb = await b.load(time);
  check(aa.logs.length === 2 && bb.logs.length === 2 && stableJson(await a.exportShared(time)) === stableJson(await b.exportShared(time)), 'two independent databases discover the same gist and converge through real storage transactions');
  check(api.calls.filter(call => call.method === 'POST').length === 1 && api.calls.filter(call => call.method === 'PATCH').every(call => call.files.every(name => name.startsWith('device-'))), 'one secret gist is created and meta is never patched');
  const files = Object.entries([...api.gists.values()][0]!.files).filter(([name]) => name.startsWith('device-'));
  check(files.some(([, file]) => decodeDeviceFile(file.content).state.reviews.some(log => log.id === second.id)), 'the answer created during upload reaches a device file on the next pass');
  check(!serializeBackup(aa, time).includes('LOCAL_MOCK_TOKEN') && !JSON.stringify(await a.exportShared(time)).includes('LOCAL_MOCK_TOKEN'), 'enabled sync credentials are excluded from real database backups and shared data');
  let unblock!: () => void, locked!: () => void;
  const lockGate = new Promise<void>(resolve => { unblock = resolve; }), lockReady = new Promise<void>(resolve => { locked = resolve; });
  const holding = aStorage.lock(async () => { locked(); await lockGate; }); await lockReady;
  const otherDb = new VocabularyDatabase(aDb.name); open.push(otherDb);
  let acquired = false; await createSyncStorage(otherDb).lock(async () => { acquired = true; });
  check(!acquired, 'independent database connections share a real origin-wide sync lock'); unblock(); await holding;
  const fallback = createSyncStorage(aDb, false), otherFallback = createSyncStorage(otherDb, false);
  await fallback.lock(async renew => { await renew(); let overlap = false; await otherFallback.lock(async () => { overlap = true; });
    check(!overlap, 'IndexedDB lease fallback excludes a second connection and can renew before requests'); });
  check(outside === 0 && (await aStorage.read()).lastSyncAt === time, 'no real GitHub request is attempted and successful sync time is persisted');
  ca.dispose(); cb.dispose(); open.forEach(db => db.close());
  report(checks.join('\n') + '\nALL MOCK GIST CHECKS PASSED');
}
function Harness() {
  const [report, setReport] = useState('尚未运行');
  const [view, setView] = useState<SyncView>({ ...defaultSyncConfig(), busy: false });
  const [ui, setUi] = useState<ReturnType<typeof createSyncController> | null>(null);
  useEffect(() => {
    let db = new VocabularyDatabase('one-word-gist-test-UI'); let controller: ReturnType<typeof createSyncController> | undefined, disposed = false;
    void (async () => { await db.delete(); db = new VocabularyDatabase(db.name); const store = createStudyStore(words, db); await store.load(now); const api = mockGithub();
      controller = createSyncController({ exportShared: () => store.exportShared(now), mergeShared: (s, t, z) => store.mergeShared(s, t, z) }, createSyncStorage(db),
        { fetch: api.fetch, online: () => true, onChange: setView, onMerge: () => {}, now: () => now });
      if (disposed) { controller.dispose(); db.close(); return; } setUi(controller); await controller.start(); })();
    return () => { disposed = true; controller?.dispose(); db.close(); };
  }, []);
  return <main className="app-shell home-shell"><div className="page-main"><p className="page-note">MOCK API · 本地验收，无真实 GitHub 请求</p>
    <button className="primary-button" onClick={() => void runTests(setReport).catch(error => setReport(value => `${value}\nFAIL ${String(error)}`))}>运行全部模拟测试</button><pre id="result" style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{report}</pre></div>
    <Settings settings={defaultSettings(now)} now={now} busy={false} onChange={() => {}} onImport={() => {}} onExport={() => {}}
      sync={<SyncSettings view={view} onEnabled={async enabled => { await ui?.configure({ enabled }); }} onToken={async token => { await ui?.configure({ token }); }} onTest={async () => { await ui?.test(); }} onSync={async () => { await ui?.sync(); }} />} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
