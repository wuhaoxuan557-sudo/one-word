import type { AppSettings, CardRecord, DailyPlan, Presentation, ReviewEntry, Snapshot, Word } from '../types';
import { generateOptions } from './choices';
import type { ChoicePool } from './choices';
import { buildDailyPlan, readyQueue } from './queue';
import { GRADING_CONFIG, gradeAnswer } from './rating';
import { emptyCard, scheduleCard } from './scheduler';
import { snapshotWord } from './wordSnapshot';

export function defaultSettings(now: number): AppSettings {
  return { id: 'app', newLimit: 20, reviewLimit: 200, grading: { ...GRADING_CONFIG }, autoSpeak: true,
    accent: 'en-GB', createdAt: now, lastExportAt: null, daily: null, selectedWordlists: ['cet4'] };
}
export function reconcileSnapshot(snapshot: Snapshot, words: readonly Word[], now: number): Snapshot {
  let settings = snapshot.settings;
  const plan = settings.daily;
  const current = plan?.current;
  if (plan && current && !current.answer && !words.some(word => word.id === current.wordId)) {
    const usedNew = snapshot.cards.some(card => card.wordId === current.wordId && card.fsrs.reps > 0);
    const usedReview = snapshot.logs.some(log => log.day === plan.day && log.wordId === current.wordId);
    settings = { ...settings, daily: { ...plan, current: null,
      newIds: plan.newIds.filter(id => id !== current.wordId || usedNew),
      reviewIds: plan.reviewIds.filter(id => id !== current.wordId || usedReview) } };
  }
  return { ...snapshot, activeWordIds: words.map(word => word.id), settings: { ...settings, daily: buildDailyPlan(words, snapshot.cards, settings, now) } };
}

export type StudyAction =
  | { type: 'start' }
  | { type: 'tick'; startIfReady?: boolean }
  | { type: 'answer'; presentationId: string; selectedId: string | null; elapsedMs: number }
  | { type: 'details' | 'next' | 'slash'; presentationId: string }
  | { type: 'undo'; expiresAt: number };

function chooseCurrent(snapshot: Snapshot, words: readonly Word[], pool: ChoicePool, now: number): Snapshot {
  const plan = snapshot.settings.daily!;
  if (plan.current) return snapshot;
  const ready = readyQueue(snapshot, now);
  const next = ready.find(item => item.wordId === plan.preferredNextId && item.kind === ready[0]?.kind) ?? ready[0];
  if (!next) return snapshot;
  const word = words.find(item => item.id === next.wordId);
  if (!word) throw new Error('The current word is missing from the selected wordlists.');
  const sequence = plan.sequence + 1;
  let seed = (now + sequence) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const current: Presentation = { id: `${plan.day}:${sequence}`, wordId: word.id,
    optionIds: (generateOptions(word, pool, random) ?? []).map(item => item.id), kind: next.kind,
    reviewNumber: snapshot.cards.find(card => card.wordId === word.id)?.fsrs.reps ?? 0,
    phase: 'recognise', answer: null, startedAt: now };
  return withPlan(snapshot, { ...plan, current, sequence, preferredNextId: null });
}
function withPlan(snapshot: Snapshot, plan: DailyPlan): Snapshot {
  return { ...snapshot, settings: { ...snapshot.settings, daily: plan } };
}
function putCard(snapshot: Snapshot, card: CardRecord): Snapshot {
  return { ...snapshot, cards: [...snapshot.cards.filter(item => item.wordId !== card.wordId), card] };
}

export function transitionStudy(input: Snapshot, action: StudyAction, words: readonly Word[], pool: ChoicePool, now: number): Snapshot {
  let snapshot = reconcileSnapshot(input, words, now);
  const plan = snapshot.settings.daily!;
  const current = plan.current;
  if (action.type === 'start' || (action.type === 'tick' && action.startIfReady)) return chooseCurrent(snapshot, words, pool, now);
  if (action.type === 'tick') return snapshot;
  if (action.type === 'undo') {
    const undo = plan.undo;
    if (!undo || undo.expiresAt !== action.expiresAt || now >= undo.expiresAt) return snapshot;
    snapshot = { ...snapshot, cards: snapshot.cards.filter(card => card.wordId !== undo.wordId) };
    if (undo.previous) snapshot = putCard(snapshot, undo.previous);
    return chooseCurrent(withPlan(snapshot, { ...plan, undo: null, preferredNextId: undo.wordId,
      completed: plan.completed - (undo.counted && undo.day === plan.day ? 1 : 0) }), words, pool, now);
  }
  // A stale tab or repeated click cannot answer a newer presentation.
  if (!current || current.id !== action.presentationId) return snapshot;
  const previous = snapshot.cards.find(card => card.wordId === current.wordId);
  if (action.type === 'answer') {
    if (current.phase !== 'recognise' || current.optionIds.length !== 4 ||
      (action.selectedId !== null && !current.optionIds.includes(action.selectedId)) || !Number.isFinite(action.elapsedMs)) return snapshot;
    const card = previous ?? emptyCard(current.wordId, now);
    if (card.slashed) return snapshot;
    const correct = action.selectedId === current.wordId;
    const elapsedMs = Math.max(0, action.elapsedMs);
    const rating = gradeAnswer(correct, elapsedMs, card.everWrong, snapshot.settings.grading);
    const result = scheduleCard(card, rating, now);
    const answer: ReviewEntry = { id: current.id, day: plan.day, wordId: current.wordId,
      kind: current.kind, selectedId: action.selectedId, correct, elapsedMs, answeredAt: now,
      rating, dueAt: result.card.due.getTime(), fsrsLog: result.log };
    snapshot = putCard(snapshot, { ...card, fsrs: result.card, everWrong: card.everWrong || !correct, introducedAt: card.introducedAt ?? now });
    return withPlan({ ...snapshot, logs: [...snapshot.logs, answer] }, { ...plan, completed: plan.completed + 1,
      current: { ...current, phase: 'feedback', answer } });
  }
  if (action.type === 'details') return current.phase === 'feedback'
    ? withPlan(snapshot, { ...plan, current: { ...current, phase: 'details' } }) : snapshot;
  if (action.type === 'slash') {
    const card = previous ?? emptyCard(current.wordId, now);
    const word = words.find(word => word.id === current.wordId);
    snapshot = putCard(snapshot, { ...card, slashed: true, slashedAt: now,
      wordSnapshot: word ? snapshotWord(word) : card.wordSnapshot });
    return chooseCurrent(withPlan(snapshot, { ...plan, current: null, completed: plan.completed + (current.answer ? 0 : 1),
      undo: { wordId: current.wordId, previous: previous ?? null, expiresAt: now + 3000, day: plan.day, counted: !current.answer } }), words, pool, now);
  }
  if (current.phase !== 'details' && !(current.phase === 'feedback' &&
    (current.answer?.rating === 'Good' || current.answer?.rating === 'Easy'))) return snapshot;
  if (current.answer) {
    const startedAt = current.startedAt ?? current.answer.answeredAt - current.answer.elapsedMs;
    const studyMs = Math.max(current.answer.elapsedMs, now - startedAt);
    snapshot = { ...snapshot, logs: snapshot.logs.map(log => log.id === current.id ? { ...log, studyMs } : log) };
  }
  return chooseCurrent(withPlan(snapshot, { ...plan, current: null }), words, pool, now);
}
