import type { CardRecord, Preferences, ReviewEntry, WordSnapshot } from '../../types';
import { GRADING_CONFIG } from '../rating';
import { emptyCard, scheduleCard } from '../scheduler';
import { validatePreferences } from '../preferences';
import { calendarDay } from './calendar';
import { compareEvents, compareText } from './clock';
import { isUuid, stableJson } from './identity';
import { PROFILE_ID, preferenceKeys } from './model';
import type { Clock, PreferenceEvent, ReviewFact, SharedState, SyncEvent } from './model';

export const defaultPreferences: Preferences = { newLimit: 20, reviewLimit: 200, grading: { ...GRADING_CONFIG }, autoSpeak: true, accent: 'en-GB', selectedWordlists: ['cet4'] };
const fail = (): never => { throw new Error('同步数据格式不正确，现有数据未修改。'); };
export const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
export const text = (value: unknown): string => typeof value === 'string' && value.length > 0 ? value : fail();
const flag = (value: unknown): boolean => typeof value === 'boolean' ? value : fail();
export const numeric = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fail();
export const integer = (value: unknown): number => Number.isSafeInteger(numeric(value)) ? value as number : fail();
export const timestamp = (value: unknown): number => { const n = integer(value); return n <= 8.64e15 ? n : fail(); };
export const uuid = (value: unknown): string => { const id = text(value); return isUuid(id) ? id.toLowerCase() : fail(); };
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : fail();
export const clockValue = (value: unknown): Clock => { const v = list(value); if (v.length !== 2) fail(); return [timestamp(v[0]), integer(v[1])]; };
function wordSnapshot(value: unknown): WordSnapshot {
  const v = record(value); if (typeof v.translation !== 'string' || (v.translationFull !== undefined && typeof v.translationFull !== 'string')) fail();
  return { word: text(v.word), translation: v.translation as string, ...(v.translationFull === undefined ? {} : { translationFull: v.translationFull as string }) };
}
export function parseReview(value: unknown): ReviewFact {
  const v = record(value); const rating = text(v.rating);
  if (!['Again', 'Hard', 'Good', 'Easy'].includes(rating) || v.profileId !== PROFILE_ID) fail();
  const result: ReviewFact = { id: uuid(v.id), deviceId: uuid(v.deviceId), profileId: PROFILE_ID, clock: clockValue(v.clock),
    wordId: text(v.wordId), answeredAt: timestamp(v.answeredAt), selectedId: v.selectedId === null ? null : text(v.selectedId),
    correct: flag(v.correct), rating: rating as ReviewFact['rating'], elapsedMs: numeric(v.elapsedMs),
    ...(v.studyMs === undefined ? {} : { studyMs: numeric(v.studyMs) }) };
  if (result.clock[0] < result.answeredAt || result.correct !== (result.selectedId === result.wordId) || (result.rating === 'Again') === result.correct ||
    (result.studyMs !== undefined && result.studyMs < result.elapsedMs)) fail();
  return result;
}
export function parseEvent(value: unknown): SyncEvent {
  const v = record(value); const base = { id: uuid(v.id), deviceId: uuid(v.deviceId), clock: clockValue(v.clock), at: timestamp(v.at) };
  if (base.clock[0] < base.at) fail();
  if (v.type === 'preference') {
    if (!preferenceKeys.includes(v.key as keyof Preferences)) fail();
    const key = v.key as keyof Preferences;
    const candidate = { ...defaultPreferences, [key]: v.value }; validatePreferences(candidate);
    const cleanValue = key === 'grading' ? { easyMs: candidate.grading.easyMs, hardMs: candidate.grading.hardMs }
      : key === 'selectedWordlists' ? [...candidate.selectedWordlists] : candidate[key];
    return { ...base, type: 'preference', key, value: cleanValue } as PreferenceEvent;
  }
  const wordId = text(v.wordId);
  if (v.type === 'word') return { ...base, type: 'word', wordId, value: wordSnapshot(v.value) };
  if (v.type === 'bookmark') return { ...base, type: 'bookmark', wordId, value: flag(v.value) };
  if (v.type === 'undo-slash') return { ...base, type: 'undo-slash', wordId, targetId: uuid(v.targetId), value: flag(v.value) };
  if (v.type === 'slash') {
    if (v.quotaKind !== null && v.quotaKind !== 'new' && v.quotaKind !== 'review') fail();
    const result: SyncEvent = { ...base, type: 'slash', wordId, value: flag(v.value), quotaKind: v.quotaKind as 'new' | 'review' | null, resume: flag(v.resume) };
    if ((!result.value && result.quotaKind !== null) || (result.value && result.resume)) fail();
    return result;
  }
  return fail();
}
function union<T extends { id: string }>(a: readonly T[], b: readonly T[], combine?: (a: T, b: T) => T): T[] {
  const result = new Map<string, T>();
  for (const value of [...a, ...b]) {
    const previous = result.get(value.id);
    if (!previous) result.set(value.id, value);
    else if (combine) result.set(value.id, combine(previous, value));
    else if (stableJson(previous) !== stableJson(value)) throw new Error('同一 UUID 对应不同记录，已停止合并。');
  }
  return [...result.values()].sort((a, b) => compareText(a.id, b.id));
}
function combineReview(a: ReviewFact, b: ReviewFact): ReviewFact {
  const { studyMs: am, ...ac } = a; const { studyMs: bm, ...bc } = b;
  if (stableJson(ac) !== stableJson(bc)) throw new Error('同一作答 UUID 对应不同内容，已停止合并。');
  const duration = Math.max(am ?? -1, bm ?? -1);
  return { ...ac, ...(duration < 0 ? {} : { studyMs: duration }) };
}
export function parseShared(value: unknown): SharedState {
  const v = record(value);
  if (v.version !== 1 || v.profileId !== PROFILE_ID) throw new Error('不支持此同步格式或调度版本，现有数据未修改。');
  const state: SharedState = { version: 1, profileId: PROFILE_ID,
    reviews: union([], list(v.reviews).map(parseReview), combineReview), events: union([], list(v.events).map(parseEvent)) };
  const byId = new Map(state.events.map(e => [e.id, e]));
  for (const event of state.events) if (event.type === 'undo-slash') {
    const target = byId.get(event.targetId);
    if (target && (target.type !== 'slash' || !target.value || target.wordId !== event.wordId)) fail();
  }
  return state;
}
export function mergeShared(a: SharedState, b: SharedState): SharedState {
  const left = parseShared(a), right = parseShared(b);
  return parseShared({ version: 1, profileId: PROFILE_ID, reviews: union(left.reviews, right.reviews, combineReview), events: union(left.events, right.events) });
}
export const chronological = (a: ReviewFact, b: ReviewFact) => a.answeredAt - b.answeredAt || compareText(a.id, b.id);
export type ReplayCache = Map<string, { key: string; card: CardRecord; logs: ReviewEntry[] }>;
export function materializeShared(input: SharedState, timeZone?: string, cache?: ReplayCache): { cards: CardRecord[]; logs: ReviewEntry[]; preferences: Preferences } {
  const state = parseShared(input);
  const preferences: Preferences = structuredClone(defaultPreferences);
  const cards = new Map<string, CardRecord>(); const latest = new Map<string, SyncEvent>();
  const firstEvent = new Map<string, number>();
  for (const event of state.events) {
    const key = event.type === 'preference' ? `preference:${event.key}` : `${event.type === 'slash' || event.type === 'undo-slash' ? 'slash' : event.type}:${event.wordId}`;
    const previous = latest.get(key); if (!previous || compareEvents(previous, event) < 0) latest.set(key, event);
    if (event.type !== 'preference') {
      if (!cards.has(event.wordId)) cards.set(event.wordId, emptyCard(event.wordId, event.at));
      firstEvent.set(event.wordId, Math.min(firstEvent.get(event.wordId) ?? Infinity, event.at));
    }
  }
  const logs: ReviewEntry[] = []; const lastReview = new Map<string, ReviewFact>();
  const grouped = new Map<string, ReviewFact[]>();
  for (const fact of [...state.reviews].sort(chronological)) { const group = grouped.get(fact.wordId) ?? []; group.push(fact); grouped.set(fact.wordId, group); }
  for (const [wordId, facts] of grouped) {
    const key = stableJson([PROFILE_ID, timeZone ?? null, facts]);
    let entry = cache?.get(wordId);
    if (!entry || entry.key !== key) {
      let card = emptyCard(wordId, facts[0]!.answeredAt); const wordLogs: ReviewEntry[] = [];
      const firstDay = calendarDay(facts[0]!.answeredAt, timeZone);
      for (const fact of facts) {
        const scheduled = scheduleCard(card, fact.rating, fact.answeredAt);
        const day = calendarDay(fact.answeredAt, timeZone); const { clock, ...fields } = fact;
        wordLogs.push({ ...fields, syncClock: clock, day, kind: firstDay === day ? 'new' : 'review', dueAt: scheduled.card.due.getTime(), fsrsLog: scheduled.log });
        card = { ...card, fsrs: scheduled.card, introducedAt: card.introducedAt ?? fact.answeredAt, everWrong: card.everWrong || !fact.correct };
      }
      entry = { key, card, logs: wordLogs }; cache?.set(wordId, structuredClone(entry));
    }
    const replayed = structuredClone(entry);
    cards.set(wordId, replayed.card); logs.push(...replayed.logs); lastReview.set(wordId, facts[facts.length - 1]!);
  }
  logs.sort((a, b) => a.answeredAt - b.answeredAt || compareText(a.id, b.id));
  for (const event of latest.values()) {
    if (event.type === 'preference') { Object.assign(preferences, { [event.key]: structuredClone(event.value) }); continue; }
    const card = cards.get(event.wordId)!;
    if (event.type === 'word') card.wordSnapshot = event.value;
    else if (event.type === 'bookmark') { card.bookmarked = event.value; card.bookmarkedAt = event.value ? event.at : null; }
    else {
      card.slashed = event.value; card.slashedAt = event.value ? event.at : null;
      const review = lastReview.get(event.wordId);
      if (event.type === 'slash' && event.resume && (!review || compareEvents(review, event) < 0)) card.fsrs = { ...card.fsrs, due: new Date(Math.min(card.fsrs.due.getTime(), event.at)) };
    }
  }
  validatePreferences(preferences);
  // Initial due dates for unlearned cards are derived from all their events, not input order.
  for (const [id, card] of cards) if (!card.fsrs.reps) card.fsrs.due = new Date(firstEvent.get(id)!);
  return { cards: [...cards.values()].sort((a, b) => compareText(a.wordId, b.wordId)), logs, preferences };
}
