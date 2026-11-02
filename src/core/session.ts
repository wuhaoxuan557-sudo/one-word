import type { Answer, Question, Word } from '../types';
import { generateOptions } from './choices';
import type { ChoicePool } from './choices';
import { gradeAnswer } from './rating';

export interface PracticeState {
  question: Question | null;
  remainingIds: string[];
  total: number;
  seed: number;
  phase: 'recognise' | 'feedback' | 'details';
  answer: Answer | null;
  logs: Answer[];
  failedIds: string[];
  slashedIds: string[];
  undo: { wordId: string; expiresAt: number; token: number } | null;
}

export type PracticeAction =
  | { type: 'start'; seed: number }
  | { type: 'answer'; selectedId: string | null; elapsedMs: number; timestamp: number }
  | { type: 'details' }
  | { type: 'next' }
  | { type: 'slash'; now: number; token: number }
  | { type: 'undo'; now: number }
  | { type: 'expireUndo'; token: number };

function questionFor(id: string | undefined, words: readonly Word[], seed: number, pool: readonly Word[] | ChoicePool): Question | null {
  if (!id) return null;
  const word = words.find(item => item.id === id);
  if (!word) throw new Error('The current word is missing from the wordlist.');
  // Deterministic generation keeps React reducer replays free of random effects.
  let value = seed >>> 0;
  const random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
  // An impossible wordlist stays on this word with an explicit UI error.
  return { word, options: generateOptions(word, pool, random) ?? [] };
}

export function practiceReducer(state: PracticeState | null, action: PracticeAction, words: readonly Word[], pool: readonly Word[] | ChoicePool = words): PracticeState | null {
  if (action.type === 'start') {
    const slashedIds = state?.slashedIds ?? [];
    const remainingIds = words.filter(word => !slashedIds.includes(word.id)).map(word => word.id);
    return {
      remainingIds, total: remainingIds.length, seed: action.seed,
      question: questionFor(remainingIds[0], words, action.seed, pool), phase: 'recognise', answer: null,
      logs: [], failedIds: state?.failedIds ?? [], slashedIds, undo: null,
    };
  }
  if (!state) return state;
  if (action.type === 'expireUndo') return state.undo?.token === action.token ? { ...state, undo: null } : state;
  if (action.type === 'undo') {
    if (!state.undo) return state;
    if (action.now >= state.undo.expiresAt) return { ...state, undo: null };
    const restoredId = state.undo.wordId;
    const remainingIds = state.question
      ? [state.remainingIds[0]!, restoredId, ...state.remainingIds.slice(1)]
      : [restoredId];
    return {
      ...state, remainingIds, slashedIds: state.slashedIds.filter(id => id !== restoredId), undo: null,
      question: state.question ?? questionFor(restoredId, words, state.seed, pool),
    };
  }
  if (!state.question) return state;
  if (action.type === 'answer') {
    if (state.phase !== 'recognise' || state.question.options.length !== 4) return state;
    if (action.selectedId !== null && !state.question.options.some(option => option.id === action.selectedId)) return state;
    const wordId = state.question.word.id;
    const correct = action.selectedId === wordId;
    const elapsedMs = Math.max(0, action.elapsedMs);
    const answer: Answer = {
      wordId, correct, elapsedMs, selectedId: action.selectedId, answeredAt: action.timestamp,
      rating: gradeAnswer(correct, elapsedMs, state.failedIds.includes(wordId)),
    };
    return {
      ...state, phase: 'feedback', answer, logs: [...state.logs, answer],
      failedIds: correct || state.failedIds.includes(wordId) ? state.failedIds : [...state.failedIds, wordId],
    };
  }
  if (action.type === 'details') return state.phase === 'feedback' ? { ...state, phase: 'details' } : state;
  if (action.type === 'next' && state.phase !== 'details' &&
      !(state.phase === 'feedback' && (state.answer?.rating === 'Good' || state.answer?.rating === 'Easy'))) return state;
  const seed = (state.seed + 1) >>> 0;
  const remainingIds = state.remainingIds.slice(1);
  const next: PracticeState = {
    ...state, seed, remainingIds, question: questionFor(remainingIds[0], words, seed, pool),
    phase: 'recognise', answer: null,
  };
  if (action.type === 'slash') return {
    ...next, slashedIds: [...state.slashedIds, state.question.word.id],
    undo: { wordId: state.question.word.id, expiresAt: action.now + 3000, token: action.token },
  };
  return next;
}
