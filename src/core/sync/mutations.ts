import type { Snapshot } from '../../types';
import type { StudyAction } from '../session';
import type { ManagementAction } from '../preferences';
import { advanceClock } from './clock';
import { stableJson } from './identity';
import { PROFILE_ID, preferenceKeys } from './model';
import type { LocalSyncState, SyncEvent } from './model';
import { currentFactsVersion } from './current';

export function recordMutation(before: Snapshot, after: Snapshot, action: StudyAction | ManagementAction, local: LocalSyncState, now: number, newId: () => string): { snapshot: Snapshot; local: LocalSyncState } {
  let clock = local.clock;
  const base = () => { clock = advanceClock(clock, now); return { id: newId(), deviceId: local.deviceId, clock, at: now }; };
  const events = [...before.events ?? []];
  const current = before.settings.daily?.current;
  if (action.type === 'preferences') {
    for (const key of preferenceKeys) if (stableJson(before.settings[key]) !== stableJson(after.settings[key])) {
      events.push({ ...base(), type: 'preference', key, value: after.settings[key] } as SyncEvent);
    }
  } else if (action.type === 'bookmark') events.push({ ...base(), type: 'bookmark', wordId: action.wordId, value: action.value });
  else if (action.type === 'unslash') events.push({ ...base(), type: 'slash', wordId: action.wordId, value: false, quotaKind: null, resume: true });
  else if (action.type === 'slash' && current?.id === action.presentationId) {
    const event: SyncEvent = { ...base(), type: 'slash', wordId: current.wordId, value: true, quotaKind: current.answer ? null : current.kind, resume: false };
    events.push(event);
    const plan = after.settings.daily;
    if (plan?.undo) after = { ...after, settings: { ...after.settings, daily: { ...plan, undo: { ...plan.undo, eventId: event.id } } } };
  } else if (action.type === 'undo') {
    const undo = before.settings.daily?.undo;
    if (undo?.eventId && undo.expiresAt === action.expiresAt && now < undo.expiresAt) events.push({ ...base(), type: 'undo-slash',
      wordId: undo.wordId, targetId: undo.eventId, value: undo.previous?.slashed ?? false });
  }
  const existing = new Set(before.logs.map(log => log.id));
  const logs = after.logs.map(log => {
    if (existing.has(log.id)) return log;
    const provenance = base();
    return { ...log, deviceId: local.deviceId, syncClock: provenance.clock, profileId: PROFILE_ID };
  });
  for (const card of after.cards) if (card.wordSnapshot) {
    if (!events.some(e => e.type === 'word' && e.wordId === card.wordId && stableJson(e.value) === stableJson(card.wordSnapshot)))
      events.push({ ...base(), type: 'word', wordId: card.wordId, value: card.wordSnapshot });
  }
  const answer = after.settings.daily?.current?.answer;
  const plan = after.settings.daily;
  let snapshot = { ...after, logs, events, settings: answer && plan ? { ...after.settings,
    daily: { ...plan, current: { ...plan.current!, answer: logs.find(log => log.id === answer.id)! } } } : after.settings };
  const issued = snapshot.settings.daily?.current;
  if (issued && !issued.answer && issued.id !== current?.id) snapshot = { ...snapshot, settings: { ...snapshot.settings,
    daily: { ...snapshot.settings.daily!, current: { ...issued, factsVersion: currentFactsVersion(issued.wordId, logs, events) } } } };
  return { snapshot, local: { ...local, clock } };
}
