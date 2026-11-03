import type { ReviewFact, SyncEvent } from './model';
import { calendarDay } from './calendar';

export function quotaUsage(reviews: readonly ReviewFact[], events: readonly SyncEvent[], now: number, timeZone?: string) {
  const day = calendarDay(now, timeZone);
  const first = new Map<string, number>();
  const known = [...new Map(reviews.map(log => [log.id, log])).values()].filter(log => log.answeredAt <= now);
  for (const log of known) first.set(log.wordId, Math.min(first.get(log.wordId) ?? Infinity, log.answeredAt));
  const newIds = new Set<string>(), reviewIds = new Set<string>();
  let completed = 0;
  for (const log of known) if (calendarDay(log.answeredAt, timeZone) === day) {
    completed++;
    (calendarDay(first.get(log.wordId)!, timeZone) === day ? newIds : reviewIds).add(log.wordId);
  }
  const canceled = new Set(events.filter(e => e.type === 'undo-slash' && e.at <= now).map(e => e.type === 'undo-slash' ? e.targetId : ''));
  for (const event of new Map(events.map(event => [event.id, event])).values()) if (event.type === 'slash' && event.value && event.quotaKind && event.at <= now &&
    calendarDay(event.at, timeZone) === day && !canceled.has(event.id)) {
    completed++;
    const learned = first.get(event.wordId);
    const kind = learned === undefined ? event.quotaKind : calendarDay(learned, timeZone) < day ? 'review' : 'new';
    (kind === 'new' ? newIds : reviewIds).add(event.wordId);
  }
  return { day, completed, newIds: [...newIds].sort(), reviewIds: [...reviewIds].sort() };
}
