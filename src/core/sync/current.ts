import type { CardRecord, Snapshot } from '../../types';
import type { SharedState, SyncEvent } from './model';
import { stableJson, uuid5 } from './identity';

const changesWord = (event: SyncEvent, wordId: string) => event.type !== 'preference' && event.type !== 'word' && event.wordId === wordId;
export function currentFactsVersion(wordId: string, reviews: readonly { id: string; wordId: string }[], events: readonly SyncEvent[]): string {
  return uuid5(stableJson([
    [...new Set(reviews.filter(log => log.wordId === wordId).map(log => log.id))].sort(),
    [...new Set(events.filter(event => changesWord(event, wordId)).map(event => event.id))].sort(),
  ]));
}
export function staleUnansweredCurrent(input: Snapshot, shared: SharedState, cards: readonly CardRecord[]): boolean {
  const current = input.settings.daily?.current;
  if (!current || current.answer) return false;
  const known = current.factsVersion ?? currentFactsVersion(current.wordId, input.logs, input.events ?? []);
  if (known !== currentFactsVersion(current.wordId, shared.reviews, shared.events)) return true;
  if (current.factsVersion) return false;
  // Old presentations have no fact baseline. Recover evidence already merged by older app versions.
  const count = new Set(shared.reviews.filter(log => log.wordId === current.wordId).map(log => log.id)).size;
  return count !== current.reviewNumber || Boolean(cards.find(card => card.wordId === current.wordId)?.slashed) ||
    current.startedAt !== undefined && shared.events.some(event => changesWord(event, current.wordId) && event.at > current.startedAt!);
}
