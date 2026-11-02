import { expect, it, vi } from 'vitest';
import { createWordlistLoader } from './wordlists';
import { WORDLISTS } from '../core/catalog';
import { freshSnapshot, studyWords as words, studyTime as now } from '../core/study.test-helper';
import { emptyCard } from '../core/scheduler';
import { snapshotWord } from '../core/wordSnapshot';
import { backupWordIds, parseBackup, serializeBackup } from '../core/backup';
import { reconcileSnapshot } from '../core/session';

function fixture() {
  const lists = { cet4: words.slice(0, 4), cet6: [words[0]!, words[4]!], gre: [words[5]!] };
  const index = { version: 1, counts: Object.fromEntries(WORDLISTS.map(list => [list.id, 0])),
    memberships: { apple: 12, table: 4, chair: 4, river: 4, star: 8, tree: 128 } };
  const data: Record<string, unknown> = { ...lists, index };
  const fetcher = vi.fn(async (url: string) => ({ ok: true, status: 200,
    json: async () => data[url.replace('/wordlists/', '').replace('.json', '')] }));
  return { loader: createWordlistLoader(fetcher, '/'), fetcher };
}

it.each([['cet4'], ['cet6'], ['cet4', 'cet6']])('startup requests only the saved selection %s', async (...ids) => {
  const { loader, fetcher } = fixture(); const snapshot = freshSnapshot();
  snapshot.settings.selectedWordlists = ids;
  await loader.prepareSnapshot(snapshot);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(ids.map(id => `/wordlists/${id}.json`));
});

it('does not load an unselected list to display complete saved wordbook snapshots', async () => {
  const { loader, fetcher } = fixture(); const snapshot = freshSnapshot();
  snapshot.cards = [{ ...emptyCard('tree', now), bookmarked: true, wordSnapshot: snapshotWord(words[5]!) }];
  await loader.prepareSnapshot(snapshot);
  expect(fetcher.mock.calls).toEqual([['/wordlists/cet4.json']]);
  expect(loader.catalog.gre).toBeUndefined();
});

it('loads only the source needed to migrate legacy cards and caches duplicate requests', async () => {
  const { loader, fetcher } = fixture(); const snapshot = freshSnapshot();
  snapshot.cards = [{ ...emptyCard('tree', now), slashed: true }];
  await loader.prepareSnapshot(snapshot);
  await loader.prepareSnapshot(snapshot);
  expect(fetcher.mock.calls).toEqual([['/wordlists/cet4.json'], ['/wordlists/index.json'], ['/wordlists/gre.json']]);
});

it('loads a newly selected list once and preserves previously cached resources', async () => {
  const { loader, fetcher } = fixture();
  await loader.ensureLists(['cet4']);
  await Promise.all([loader.ensureLists(['cet4', 'cet6']), loader.ensureLists(['cet6'])]);
  expect(fetcher.mock.calls).toEqual([['/wordlists/cet4.json'], ['/wordlists/cet6.json']]);
});

it('defers a saved distractor from an old selection until resuming the current card', async () => {
  const { loader, fetcher } = fixture(); const snapshot = reconcileSnapshot(freshSnapshot(), words, now);
  snapshot.settings.daily!.current = { id: 'saved', wordId: 'apple', optionIds: ['apple', 'table', 'chair', 'star'],
    kind: 'new', reviewNumber: 0, phase: 'recognise', answer: null };
  await loader.prepareSnapshot(snapshot);
  expect(fetcher.mock.calls).toEqual([['/wordlists/cet4.json']]);
  await loader.prepareSnapshot(snapshot, true);
  expect(fetcher.mock.calls).toEqual([['/wordlists/cet4.json'], ['/wordlists/index.json'], ['/wordlists/cet6.json']]);
});

it('loads import references outside the selection without fetching unrelated lists', async () => {
  const { loader, fetcher } = fixture(); const snapshot = freshSnapshot();
  snapshot.cards = [{ ...emptyCard('tree', now), bookmarked: true }];
  const parsed = parseBackup(serializeBackup(snapshot, now));
  await loader.ensureLists(parsed.settings.selectedWordlists);
  await loader.ensureWords(backupWordIds(parsed));
  expect(() => parseBackup(serializeBackup(parsed, now), new Set(loader.words().map(word => word.id)))).not.toThrow();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/wordlists/cet4.json', '/wordlists/index.json', '/wordlists/gre.json']);
});

it('rejects unknown import references and allows retry after a failed list fetch', async () => {
  const { loader, fetcher } = fixture();
  await expect(loader.ensureWords(['not-a-word'])).rejects.toThrow('找不到');
  expect(fetcher.mock.calls).toEqual([['/wordlists/index.json']]);
  fetcher.mockRejectedValueOnce(new Error('Offline'));
  await expect(loader.ensureLists(['cet4'])).rejects.toThrow('Offline');
  await loader.ensureLists(['cet4']);
  expect(loader.catalog.cet4).toHaveLength(4);
});
