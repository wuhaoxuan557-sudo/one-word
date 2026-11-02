export interface Word {
  id: string;
  word: string;
  phonetic: string;
  translation: string;
  translationFull: string;
  definition: string;
  pos: string;
  collins: number;
  oxford: number;
  frq: number;
  exchange: string;
}

export interface Question {
  word: Word;
  options: Word[];
}

export interface Answer {
  wordId: string;
  selectedId: string | null;
  correct: boolean;
  elapsedMs: number;
  answeredAt: number;
  rating: 'Again' | 'Hard' | 'Good' | 'Easy';
}
import type { Card, ReviewLog as FSRSReviewLog } from 'ts-fsrs';
import type { GradingConfig } from './core/rating';


export interface CardRecord {
  wordId: string;
  fsrs: Card;
  slashed: boolean;
  bookmarked: boolean;
  everWrong: boolean;
  introducedAt: number | null;
  slashedAt: number | null;
}
export interface ReviewEntry extends Answer {
  id: string;
  day: string;
  kind: 'new' | 'review';
  dueAt: number;
  fsrsLog: FSRSReviewLog;
  // Absent until Next is pressed; older answer-only logs stay valid.
  studyMs?: number;
}
export interface Presentation {
  id: string;
  wordId: string;
  optionIds: string[];
  kind: 'new' | 'review';
  reviewNumber: number;
  phase: 'recognise' | 'feedback' | 'details';
  answer: ReviewEntry | null;
  startedAt?: number;
}
export interface DailyPlan {
  day: string;
  newIds: string[];
  reviewIds: string[];
  completed: number;
  sequence: number;
  current: Presentation | null;
  preferredNextId: string | null;
  undo: { wordId: string; previous: CardRecord | null; expiresAt: number; day: string; counted: boolean } | null;
}
export interface AppSettings {
  id: 'app';
  newLimit: number;
  reviewLimit: number;
  grading: GradingConfig;
  autoSpeak: boolean;
  accent: 'en-GB' | 'en-US';
  createdAt: number;
  lastExportAt: number | null;
  daily: DailyPlan | null;
}
export interface Snapshot {
  cards: CardRecord[];
  logs: ReviewEntry[];
  settings: AppSettings;
}
