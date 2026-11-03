import type { ReviewEntry, Snapshot } from '../../types';
import { preferences } from '../preferences';
import { calendarDay } from './calendar';
import { isUuid, stableJson, uuid5 } from './identity';
import { LEGACY_DEVICE, PROFILE_ID, preferenceKeys } from './model';
import type { ReviewFact, SharedState, SyncEvent } from './model';
import { materializeShared, parseShared } from './merge';

export function reviewIdentity(log: ReviewEntry): string {
  return isUuid(log.id) ? log.id.toLowerCase() : uuid5(stableJson(['review', log.id, log.wordId, log.answeredAt, log.selectedId, log.correct, log.elapsedMs, log.rating]));
}
export function reviewFact(log: ReviewEntry): ReviewFact {
  return { id: reviewIdentity(log), wordId: log.wordId, answeredAt: log.answeredAt, selectedId: log.selectedId,
    correct: log.correct, rating: log.rating, elapsedMs: log.elapsedMs,
    ...(log.studyMs === undefined ? {} : { studyMs: log.studyMs }), deviceId: log.deviceId ?? LEGACY_DEVICE,
    profileId: log.profileId ?? PROFILE_ID, clock: log.syncClock ?? [log.answeredAt, 0] };
}
export function snapshotShared(snapshot: Snapshot): SharedState {
  return parseShared({ version: 1, profileId: PROFILE_ID, reviews: snapshot.logs.map(reviewFact), events: snapshot.events ?? [] });
}
export function migrateSnapshot(input: Snapshot, nextPresentationId: string): Snapshot {
  const logs = input.logs.map(log => ({ ...log, id: reviewIdentity(log), deviceId: log.deviceId ?? LEGACY_DEVICE,
    profileId: log.profileId ?? PROFILE_ID, syncClock: log.syncClock ?? [log.answeredAt, 0] as const }));
  const plan = input.settings.daily; const current = plan?.current;
  const migratedCurrent = current ? { ...current, id: current.answer ? reviewIdentity(current.answer) : isUuid(current.id) ? current.id : nextPresentationId,
    answer: current.answer ? logs.find(log => log.id === reviewIdentity(current.answer!))! : null } : null;
  const settings = { ...input.settings, ...(plan ? { daily: { ...plan, current: migratedCurrent } } : {}) };
  const counts = new Map<string, number>();
  for (const log of logs) counts.set(log.wordId, (counts.get(log.wordId) ?? 0) + 1);
  for (const card of input.cards) {
    const count = counts.get(card.wordId) ?? 0;
    if (card.fsrs.reps !== count) throw new Error(`单词 ${card.wordId} 的作答历史不完整，无法安全重放；原数据未修改。`);
  }
  if (input.events !== undefined) return { ...input, logs, settings };
  const events: SyncEvent[] = [];
  const base = (key: unknown, at = 0, count = 0) => ({ id: uuid5(stableJson(['legacy', key])), deviceId: LEGACY_DEVICE, clock: [at, count] as const, at });
  const prefs = preferences(input.settings);
  for (const key of preferenceKeys) events.push({ ...base(['preference', key, prefs[key]]), type: 'preference', key, value: prefs[key] } as SyncEvent);
  for (const card of input.cards) {
    if (card.wordSnapshot) events.push({ ...base(['word', card.wordId, card.wordSnapshot]), id: uuid5(stableJson(['word-snapshot', card.wordId, card.wordSnapshot])), type: 'word', wordId: card.wordId, value: card.wordSnapshot });
    const slashTime = card.slashedAt ?? 0;
    const answeredSameDay = logs.some(log => log.wordId === card.wordId && calendarDay(log.answeredAt, settings.syncTimeZone) === calendarDay(slashTime, settings.syncTimeZone));
    const slash: SyncEvent = { ...base(['slash', card.wordId, card.slashed, slashTime], slashTime), type: 'slash', wordId: card.wordId,
      value: card.slashed, quotaKind: card.slashed && slashTime && !answeredSameDay ? card.fsrs.reps ? 'review' : 'new' : null, resume: false };
    events.push(slash);
    events.push({ ...base(['bookmark', card.wordId, card.bookmarked, card.bookmarkedAt ?? null], card.bookmarkedAt ?? 0), type: 'bookmark', wordId: card.wordId, value: card.bookmarked });
    if (settings.daily?.undo?.wordId === card.wordId && card.slashed) settings.daily.undo = { ...settings.daily.undo, eventId: slash.id };
  }
  const shared = snapshotShared({ ...input, logs, events });
  const replayed = new Map(materializeShared(shared, settings.syncTimeZone).cards.map(card => [card.wordId, card]));
  for (const card of input.cards) if (card.fsrs.reps && !card.slashed) {
    const rebuilt = replayed.get(card.wordId)!;
    if (card.fsrs.due.getTime() < rebuilt.fsrs.due.getTime() && card.fsrs.due.getTime() >= (card.fsrs.last_review?.getTime() ?? 0)) {
      const at = card.fsrs.due.getTime();
      events.push({ ...base(['resume', card.wordId, at], at, 1), type: 'slash', wordId: card.wordId, value: false, quotaKind: null, resume: true });
    }
  }
  return { ...input, logs, settings, events };
}
