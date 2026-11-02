import type { Word } from '../types';

const textFields = ['id', 'word', 'phonetic', 'translation', 'translationFull', 'definition', 'pos', 'exchange'] as const;
const numberFields = ['collins', 'oxford', 'frq'] as const;

export function parseWordlist(value: unknown): Word[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('词表为空或格式不正确，请重新构建词表。');
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('词表记录格式不正确。');
    const item = entry as Record<string, unknown>;
    if (textFields.some(key => typeof item[key] !== 'string') ||
        numberFields.some(key => typeof item[key] !== 'number' || !Number.isFinite(item[key]) || item[key] < 0) ||
        numberFields.some(key => !Number.isInteger(item[key])) || Number(item.collins) > 5 || Number(item.oxford) > 1 ||
        typeof item.word !== 'string' || !item.word.trim() ||
        typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)) {
      throw new Error('词表含有无效或重复的记录，请重新构建词表。');
    }
    seen.add(item.id);
    return item as unknown as Word;
  });
}

export function sortByFrequency(words: readonly Word[]): Word[] {
  return [...words].sort((a, b) => (a.frq || Infinity) - (b.frq || Infinity) || a.word.localeCompare(b.word, 'en'));
}
