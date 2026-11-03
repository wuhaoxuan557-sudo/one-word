import { emptyShared, PROFILE_ID } from './model';
import type { ReviewFact, SharedState, SyncEvent } from './model';
import { uuid5 } from './identity';

export const devices = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'] as const;
export const time = Date.parse('2026-11-03T01:00:00Z');
export function fact(name: string, deviceId: string = devices[0], answeredAt = time, changes: Partial<ReviewFact> = {}): ReviewFact {
  return { id: uuid5(name), deviceId, profileId: PROFILE_ID, wordId: 'apple', answeredAt, selectedId: 'apple', correct: true,
    rating: 'Good', elapsedMs: 3000, clock: [answeredAt, 0], ...changes };
}
export function slash(name: string, deviceId: string = devices[0], at = time, value = true): SyncEvent {
  return { id: uuid5(name), deviceId, clock: [at, 0], at, type: 'slash', wordId: 'apple', value, quotaKind: value ? 'new' : null, resume: !value };
}
export function state(reviews: ReviewFact[] = [], events: SyncEvent[] = []): SharedState { return { ...emptyShared(), reviews, events }; }
