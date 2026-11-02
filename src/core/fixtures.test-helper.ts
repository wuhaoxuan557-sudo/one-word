import type { Word } from '../types';

export function word(id: string, changes: Partial<Word> = {}): Word {
  return {
    id, word: id, phonetic: '', translation: `n. ${id}`, translationFull: `n. ${id}`,
    definition: '', pos: 'n:100', collins: 0, oxford: 0, frq: 1000, exchange: '', ...changes,
  };
}
