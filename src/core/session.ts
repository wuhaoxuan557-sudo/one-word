import type { Answer, Question } from '../types';

export interface PracticeState {
  question: Question | null;
  cursor: number;
  skipped: number;
  phase: 'recognise' | 'feedback' | 'details';
  answer: Answer | null;
  logs: Answer[];
  slashedIds: string[];
}

export function recordAnswer(state: PracticeState, selectedId: string | null, startedAt: number, now: number, timestamp: number): PracticeState {
  if (state.phase !== 'recognise' || !state.question) return state;
  if (selectedId !== null && !state.question.options.some(option => option.id === selectedId)) return state;
  const answer: Answer = {
    wordId: state.question.word.id,
    selectedId,
    correct: selectedId === state.question.word.id,
    elapsedMs: Math.max(0, now - startedAt),
    answeredAt: timestamp,
  };
  return { ...state, phase: 'feedback', answer, logs: [...state.logs, answer] };
}
