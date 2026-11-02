import type { Snapshot } from '../types';
import { WORDLISTS, mergeWordlists } from '../core/catalog';
import type { Catalog } from '../core/catalog';
import { parseWordlist } from '../core/wordlist';
import { parseWordlistIndex, membershipLists } from '../core/wordlistIndex';
import type { WordlistIndex } from '../core/wordlistIndex';

type Fetcher = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export function createWordlistLoader(fetcher: Fetcher = fetch, base = import.meta.env.BASE_URL) {
  const catalog: Catalog = {};
  const pending = new Map<string, Promise<void>>();
  let index: Promise<WordlistIndex> | undefined;
  const read = async (file: string) => {
    const response = await fetcher(`${base}wordlists/${file}.json`);
    if (!response.ok) throw new Error(`词表加载失败：${file}（${response.status}）。`);
    return response.json() as Promise<unknown>;
  };
  const getIndex = () => index ??= read('index').then(parseWordlistIndex).catch(error => { index = undefined; throw error; });
  const ensureLists = async (ids: readonly string[]) => {
    if (ids.some(id => !WORDLISTS.some(list => list.id === id))) throw new Error('词表选择不正确。');
    await Promise.all(ids.map(id => {
      if (catalog[id]) return;
      let request = pending.get(id);
      if (!request) {
        request = read(id).then(value => { catalog[id] = parseWordlist(value); }).finally(() => pending.delete(id));
        pending.set(id, request);
      }
      return request;
    }));
  };
  const words = () => mergeWordlists(Object.values(catalog));
  const ensureWords = async (ids: readonly string[]) => {
    const loaded = new Set(words().map(word => word.id));
    let missing = [...new Set(ids)].filter(id => !loaded.has(id));
    if (!missing.length) return;
    const lookup = await getIndex();
    if (missing.some(id => !Object.hasOwn(lookup.memberships, id))) throw new Error('词库找不到所需单词，现有数据未修改。');
    while (missing.length) {
      // Prefer a list covering the most missing IDs; never load all memberships of a word.
      const next = WORDLISTS.filter(list => !catalog[list.id]).map(list => ({ id: list.id,
        count: missing.filter(id => membershipLists(lookup, id).includes(list.id)).length }))
        .sort((a, b) => b.count - a.count)[0];
      if (!next?.count) throw new Error('词表与索引不一致，请重新构建词表。');
      await ensureLists([next.id]);
      for (const word of catalog[next.id]!) loaded.add(word.id);
      missing = missing.filter(id => !loaded.has(id));
    }
  };
  const prepareSnapshot = async (snapshot: Snapshot, includeCurrent = false) => {
    await ensureLists(snapshot.settings.selectedWordlists);
    const current = snapshot.settings.daily?.current;
    const previous = snapshot.settings.daily?.undo?.previous;
    await ensureWords([
      ...snapshot.cards.filter(card => !card.wordSnapshot).map(card => card.wordId),
      ...(previous && !previous.wordSnapshot ? [previous.wordId] : []),
      ...(includeCurrent && current ? [current.wordId, ...current.optionIds] : []),
    ]);
  };
  return { catalog, words, getIndex, ensureLists, ensureWords, prepareSnapshot };
}
export type WordlistLoader = ReturnType<typeof createWordlistLoader>;
