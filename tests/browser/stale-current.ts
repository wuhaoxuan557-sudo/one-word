import { createStudyStore } from '../../src/storage/database';
import type { VocabularyDatabase } from '../../src/storage/database';
import { studyWords as words } from '../../src/core/study.test-helper';

export async function checkStaleCurrent(database: (name: string) => Promise<VocabularyDatabase>, now: number,
  check: (condition: unknown, label: string) => void) {
  const pair = async (name: string) => {
    const a = createStudyStore(words, await database(`stale-${name}-A`)), b = createStudyStore(words, await database(`stale-${name}-B`));
    const started = await a.transact({ type: 'start' }, now);
    return { a, b, current: started.settings.daily!.current! };
  };
  const answered = await pair('answer');
  const phone = await answered.b.transact({ type: 'start' }, now);
  await answered.b.transact({ type: 'answer', presentationId: phone.settings.daily!.current!.id, selectedId: 'apple', elapsedMs: 500 }, now + 1000);
  const merged = await answered.a.mergeShared(await answered.b.exportShared(now + 1000), now + 1000);
  check(merged.settings.daily?.current === null, 'remote answer discards the desktop unanswered question before Start');
  const restarted = await answered.a.transact({ type: 'start' }, now + 1100);
  check(restarted.settings.daily?.current?.wordId === 'table' && restarted.logs.length === 1, 'Start uses the rebuilt queue without adding another answer for the old word');
  const legacy = { ...answered.current }; delete legacy.factsVersion;
  await answered.a.db.settings.put({ ...merged.settings, daily: { ...merged.settings.daily!, current: legacy } });
  const resumed = await answered.a.transact({ type: 'start' }, now + 1200);
  check(resumed.settings.daily?.current?.wordId === 'table' && resumed.logs.length === 1, 'Start rechecks an already-saved legacy current question after its remote answer was merged');

  const feedback = await pair('feedback');
  await feedback.a.transact({ type: 'answer', presentationId: feedback.current.id, selectedId: 'apple', elapsedMs: 3000 }, now + 1000);
  await feedback.b.transact({ type: 'bookmark', wordId: 'apple', value: true }, now + 1500);
  const kept = await feedback.a.mergeShared(await feedback.b.exportShared(now + 1500), now + 1500);
  check(kept.settings.daily?.current?.id === feedback.current.id && kept.settings.daily.current.phase === 'feedback', 'an answered feedback question survives same-word remote facts');
  await feedback.a.transact({ type: 'details', presentationId: feedback.current.id }, now + 1600);
  await feedback.b.transact({ type: 'bookmark', wordId: 'apple', value: false }, now + 1700);
  const details = await feedback.a.mergeShared(await feedback.b.exportShared(now + 1700), now + 1700);
  check(details.settings.daily?.current?.id === feedback.current.id && details.settings.daily.current.phase === 'details', 'an answered details question survives same-word remote facts');

  const slashed = await pair('slash');
  const remote = await slashed.b.transact({ type: 'start' }, now);
  await slashed.b.transact({ type: 'slash', presentationId: remote.settings.daily!.current!.id }, now + 1000);
  const cut = await slashed.a.mergeShared(await slashed.b.exportShared(now + 1000), now + 1000);
  check(cut.settings.daily?.current === null && (await slashed.a.transact({ type: 'start' }, now + 1100)).settings.daily?.current?.wordId === 'table', 'remote slash discards the unanswered question and excludes the slashed word');

  const unrelated = await pair('unrelated');
  await unrelated.b.transact({ type: 'bookmark', wordId: 'table', value: true }, now + 1000);
  const same = await unrelated.a.mergeShared(await unrelated.b.exportShared(now + 1000), now + 1000);
  check(same.settings.daily?.current?.id === unrelated.current.id &&
    (await unrelated.a.transact({ type: 'start' }, now + 1100)).settings.daily?.current?.id === unrelated.current.id,
    'unrelated remote facts preserve the unanswered UUID and options through Start');

  const bookmark = await pair('bookmark');
  await bookmark.b.transact({ type: 'bookmark', wordId: 'apple', value: true }, now - 1000);
  const marked = await bookmark.a.mergeShared(await bookmark.b.exportShared(now + 1000), now + 1000);
  check(marked.settings.daily?.current === null, 'new same-word bookmark fact invalidates a question even when its timestamp predates issue');
}
