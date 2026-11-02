import type { Word } from '../types';
import { sortByFrequency } from './wordlist';

export const WORDLISTS = [
  { id: 'zk', label: '中考' }, { id: 'gk', label: '高考' }, { id: 'cet4', label: 'CET4' },
  { id: 'cet6', label: 'CET6' }, { id: 'ky', label: '考研' }, { id: 'ielts', label: 'IELTS' },
  { id: 'toefl', label: 'TOEFL' }, { id: 'gre', label: 'GRE' },
] as const;
export type Catalog = Record<string, Word[]>;
export function mergeWordlists(lists: readonly (readonly Word[])[]): Word[] {
  const seen = new Set<string>();
  return sortByFrequency(lists.flatMap(list => [...list]).filter(word => {
    const key = word.word.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }));
}
export function selectedWords(catalog: Catalog, ids: readonly string[]): Word[] {
  return mergeWordlists(ids.map(id => catalog[id] ?? []));
}
export function wordlistLabel(ids: readonly string[]): string {
  const first = WORDLISTS.find(list => list.id === ids[0])?.label ?? 'CET4';
  return ids.length > 1 ? `${first} 等 ${ids.length} 个` : first;
}
