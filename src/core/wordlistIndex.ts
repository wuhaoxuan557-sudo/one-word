import { WORDLISTS } from './catalog';

export interface WordlistIndex {
  version: 1;
  counts: Record<string, number>;
  memberships: Record<string, number>;
}

export function parseWordlistIndex(value: unknown): WordlistIndex {
  const fail = (): never => { throw new Error('词表索引格式不正确，请重新构建词表。'); };
  if (!value || typeof value !== 'object') return fail();
  const index = value as Partial<WordlistIndex>;
  const counts = index.counts;
  if (index.version !== 1 || !counts || !index.memberships || Array.isArray(index.memberships) ||
    WORDLISTS.some(list => !Number.isSafeInteger(counts[list.id]) || counts[list.id]! < 0) ||
    Object.entries(index.memberships).some(([id, mask]) => !id || !Number.isInteger(mask) || mask < 1 || mask > 255)) return fail();
  return index as WordlistIndex;
}

export function membershipLists(index: WordlistIndex, wordId: string): string[] {
  const mask = index.memberships[wordId] ?? 0;
  return WORDLISTS.filter((_, bit) => mask & (1 << bit)).map(list => list.id);
}

export function selectionCount(index: WordlistIndex, ids: readonly string[]): number {
  const mask = WORDLISTS.reduce((bits, list, bit) => ids.includes(list.id) ? bits | (1 << bit) : bits, 0);
  return Object.values(index.memberships).filter(bits => bits & mask).length;
}
