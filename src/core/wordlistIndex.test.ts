import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { WORDLISTS, mergeWordlists } from './catalog';
import { parseWordlist } from './wordlist';
import { membershipLists, parseWordlistIndex, selectionCount } from './wordlistIndex';

it('matches generated counts, memberships and deduplication to all eight local wordlists', () => {
  const load = (name: string): unknown => JSON.parse(readFileSync(`public/wordlists/${name}.json`, 'utf8'));
  const index = parseWordlistIndex(load('index'));
  const lists = WORDLISTS.map(list => parseWordlist(load(list.id)));
  WORDLISTS.forEach((list, bit) => {
    expect(index.counts[list.id]).toBe(lists[bit]!.length);
    expect(lists[bit]!.every(word => membershipLists(index, word.id).includes(list.id))).toBe(true);
  });
  expect(selectionCount(index, ['cet4', 'cet6'])).toBe(5805);
  expect(selectionCount(index, WORDLISTS.map(list => list.id))).toBe(mergeWordlists(lists).length);
  expect(selectionCount(index, [])).toBe(0);
});

it.each([null, {}, { version: 2 }, { version: 1, counts: {}, memberships: [] }])('rejects invalid indexes', value => {
  expect(() => parseWordlistIndex(value)).toThrow('索引');
});
