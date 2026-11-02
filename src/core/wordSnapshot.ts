import type { CardRecord, Word, WordSnapshot } from '../types';
import { formatDetailTranslation, formatOptionTranslation } from './translation';

export function snapshotWord(word: Word): WordSnapshot {
  return { word: word.word, translation: formatOptionTranslation(word.translation),
    translationFull: formatDetailTranslation(word.translationFull) };
}

export function fillWordSnapshots(cards: readonly CardRecord[], words: readonly Word[]): CardRecord[] {
  const byId = new Map(words.map(word => [word.id, word]));
  return cards.map(card => {
    const word = byId.get(card.wordId);
    return card.wordSnapshot || !word ? card : { ...card, wordSnapshot: snapshotWord(word) };
  });
}
