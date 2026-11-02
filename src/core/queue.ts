import { State } from 'ts-fsrs';
import type { AppSettings, CardRecord, DailyPlan, ReviewEntry, Snapshot, Word } from '../types';
import { STUDY_CONFIG } from './config';
import { sortByFrequency } from './wordlist';

const learnAheadMs = STUDY_CONFIG.learnAheadMinutes * 60_000;
const isLearning = (card: CardRecord) => card.fsrs.state === State.Learning || card.fsrs.state === State.Relearning;

export function localDay(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function nextMidnight(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

export function buildDailyPlan(words: readonly Word[], cards: readonly CardRecord[], settings: AppSettings, now: number): DailyPlan {
  const previous = settings.daily;
  const day = localDay(now);
  const plan: DailyPlan = previous?.day === day ? { ...previous, newIds: [...previous.newIds], reviewIds: [...previous.reviewIds] } : {
    day, newIds: [], reviewIds: [], completed: 0, sequence: previous?.sequence ?? 0, current: null, preferredNextId: null,
    undo: previous?.undo ?? null,
  };
  if (plan.undo && now >= plan.undo.expiresAt) plan.undo = null;
  const records = new Map(cards.map(card => [card.wordId, card]));
  const allowed = new Set(words.map(word => word.id));
  if (plan.current && !allowed.has(plan.current.wordId)) plan.current = null;
  const admitted = new Set([...plan.newIds, ...plan.reviewIds]);
  // Admit distinct cards once per local day; learning repetitions reuse that slot.
  const due = cards.filter(card => allowed.has(card.wordId) && !card.slashed && card.fsrs.reps > 0 &&
    (card.fsrs.due.getTime() <= now || (isLearning(card) && card.fsrs.due.getTime() <= now + learnAheadMs)) && !admitted.has(card.wordId))
    .sort((a, b) => a.fsrs.due.getTime() - b.fsrs.due.getTime() || a.wordId.localeCompare(b.wordId));
  plan.reviewIds.push(...due.slice(0, Math.max(0, settings.reviewLimit - plan.reviewIds.length)).map(card => card.wordId));
  const seenWords = new Set<string>();
  const fresh = sortByFrequency(words).sort((a, b) =>
    Number(b.id === plan.preferredNextId) - Number(a.id === plan.preferredNextId) ||
    Number(Boolean(records.get(b.id)?.bookmarked)) - Number(Boolean(records.get(a.id)?.bookmarked))).filter(word => {
    const key = word.word.toLowerCase();
    const record = records.get(word.id);
    if (seenWords.has(key)) return false;
    seenWords.add(key);
    return !admitted.has(word.id) && !record?.slashed && (!record || record.fsrs.reps === 0);
  });
  plan.newIds.push(...fresh.slice(0, Math.max(0, settings.newLimit - plan.newIds.length)).map(word => word.id));
  return plan;
}

export interface QueueItem { wordId: string; kind: 'new' | 'review'; dueAt: number }
export function dailyQueue(snapshot: Snapshot, now: number): QueueItem[] {
  const plan = snapshot.settings.daily;
  if (!plan) return [];
  const records = new Map(snapshot.cards.map(card => [card.wordId, card]));
  const allowed = snapshot.activeWordIds ? new Set(snapshot.activeWordIds) : null;
  return [...plan.reviewIds, ...plan.newIds].flatMap<QueueItem>(wordId => {
    if (allowed && !allowed.has(wordId)) return [];
    if (plan.current?.wordId === wordId && !plan.current.answer) return [];
    const card = records.get(wordId);
    if (card?.slashed) return [];
    if (!card || !card.fsrs.reps) return [{ wordId, kind: 'new' as const, dueAt: 0 }];
    if (card.fsrs.due.getTime() >= nextMidnight(now) && !isLearning(card)) return [];
    return [{ wordId, kind: 'review' as const, dueAt: card.fsrs.due.getTime() }];
  }).sort((a, b) => (a.kind === 'review' ? 0 : 1) - (b.kind === 'review' ? 0 : 1) || a.dueAt - b.dueAt);
}

export function readyQueue(snapshot: Snapshot, now: number): QueueItem[] {
  const pending = dailyQueue(snapshot, now);
  const ready = pending.filter(item => item.dueAt <= now);
  if (ready.length) return ready;
  const learningIds = new Set(snapshot.cards.filter(isLearning).map(card => card.wordId));
  return pending.filter(item => learningIds.has(item.wordId) && item.dueAt <= now + learnAheadMs);
}

export function waitingSummary(snapshot: Snapshot, now: number) {
  const plan = snapshot.settings.daily;
  const admitted = new Set([...(plan?.newIds ?? []), ...(plan?.reviewIds ?? [])]);
  const pending = dailyQueue(snapshot, now).filter(item => item.dueAt > now);
  const availableSlots = Math.max(0, snapshot.settings.reviewLimit - (plan?.reviewIds.length ?? 0));
  const allowed = snapshot.activeWordIds ? new Set(snapshot.activeWordIds) : null;
  const upcoming = snapshot.cards.filter(card => (!allowed || allowed.has(card.wordId)) && !admitted.has(card.wordId) && !card.slashed &&
    isLearning(card) && card.fsrs.reps > 0 && card.fsrs.due.getTime() > now)
    .sort((a, b) => a.fsrs.due.getTime() - b.fsrs.due.getTime()).slice(0, availableSlots);
  const dueTimes = [...pending.map(item => item.dueAt), ...upcoming.map(card => card.fsrs.due.getTime())];
  const dueAt = Math.min(...dueTimes);
  return { count: dueTimes.length, dueAt, minutes: dueTimes.length ? Math.ceil((dueAt - now) / 60_000) : 0 };
}

export function queueProgress(snapshot: Snapshot, now: number) {
  const plan = snapshot.settings.daily;
  const active = plan?.current && !plan.current.answer ? 1 : 0;
  const completed = plan?.completed ?? 0;
  return { current: completed + active, total: completed + active + dailyQueue(snapshot, now).length };
}

export function estimateCardMs(kind: ReviewEntry['kind'], logs: readonly ReviewEntry[]): number {
  const samples = logs.filter(log => log.kind === kind).flatMap(log =>
    typeof log.studyMs === 'number' && Number.isFinite(log.studyMs) && log.studyMs >= 0 ? [log.studyMs] : []);
  const k = STUDY_CONFIG.estimatePriorCount;
  return (samples.reduce((sum, time) => sum + time, 0) + k * STUDY_CONFIG.defaultCardMs[kind]) / (samples.length + k);
}

export function estimateMinutes(newCount: number, reviewCount: number, logs: readonly ReviewEntry[]): number {
  return Math.ceil((newCount * estimateCardMs('new', logs) + reviewCount * estimateCardMs('review', logs)) / 60_000);
}

export function homeSummary(snapshot: Snapshot, words: readonly Word[], now: number) {
  const pending = dailyQueue(snapshot, now).filter(item => item.dueAt <= now);
  const current = snapshot.settings.daily?.current;
  if (current && !current.answer) pending.push({ wordId: current.wordId, kind: current.kind, dueAt: 0 });
  const newCount = pending.filter(item => item.kind === 'new').length;
  const reviewCount = pending.length - newCount;
  const allowed = new Set(words.map(word => word.id));
  const cards = snapshot.cards.filter(card => allowed.has(card.wordId));
  const earlyCount = readyQueue(snapshot, now).filter(item => item.dueAt > now).length;
  return { newCount, reviewCount, minutes: estimateMinutes(newCount, reviewCount + earlyCount, snapshot.logs),
    learned: cards.filter(card => card.fsrs.reps > 0 || card.slashed).length,
    slashed: snapshot.cards.filter(card => card.slashed).length, bookmarked: snapshot.cards.filter(card => card.bookmarked).length,
    backupDays: Math.floor((now - (snapshot.settings.lastExportAt ?? snapshot.settings.createdAt)) / 86_400_000) };
}

export function nextWakeAt(snapshot: Snapshot, now: number): number {
  const plan = snapshot.settings.daily;
  const admitted = new Set([...(plan?.newIds ?? []), ...(plan?.reviewIds ?? [])]);
  const canAdmit = (plan?.reviewIds.length ?? 0) < snapshot.settings.reviewLimit;
  const allowed = snapshot.activeWordIds ? new Set(snapshot.activeWordIds) : null;
  return Math.min(nextMidnight(now), plan?.undo?.expiresAt ?? Infinity,
    ...snapshot.cards.filter(card => (!allowed || allowed.has(card.wordId)) && !card.slashed && card.fsrs.reps > 0 && card.fsrs.due.getTime() > now &&
      (canAdmit || admitted.has(card.wordId))).map(card => {
        const due = card.fsrs.due.getTime();
        return isLearning(card) && due - learnAheadMs > now ? due - learnAheadMs : due;
      }));
}
