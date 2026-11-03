import type { Snapshot, Word } from '../../types';
import { reconcileSnapshot } from '../session';
import { materializeShared } from './merge';
import type { ReplayCache } from './merge';
import type { SharedState } from './model';
import { quotaUsage } from './quota';
import { currentFactsVersion, staleUnansweredCurrent } from './current';

export function projectSnapshot(input: Snapshot, shared: SharedState, words: readonly Word[], now: number, timeZone: string, pinCurrent = false, cache?: ReplayCache): Snapshot {
  const materialized = materializeShared(shared, timeZone, cache);
  const usage = quotaUsage(shared.reviews, shared.events, now, timeZone);
  const old = input.settings.daily;
  const current = old?.day === usage.day && !staleUnansweredCurrent(input, shared, materialized.cards) ? old.current : null;
  const plan = { day: usage.day, completed: usage.completed, sequence: old?.sequence ?? 0,
    newIds: [...usage.newIds], reviewIds: [...usage.reviewIds],
    current: current ? { ...current, ...(!current.answer ? { factsVersion: currentFactsVersion(current.wordId, shared.reviews, shared.events) } : {}),
      ...(pinCurrent ? { pinned: true } : {}) } : null,
    preferredNextId: old?.day === usage.day ? old.preferredNextId : null, undo: old?.undo ?? null };
  if (current && !current.answer) {
    const ids = current.kind === 'new' ? plan.newIds : plan.reviewIds;
    if (!ids.includes(current.wordId)) ids.push(current.wordId);
  }
  return reconcileSnapshot({ ...input, cards: materialized.cards, logs: materialized.logs, events: shared.events,
    settings: { ...input.settings, ...materialized.preferences, syncTimeZone: timeZone, daily: plan } }, words, now);
}
