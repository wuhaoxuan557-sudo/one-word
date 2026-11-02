import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';
import type { Answer, CardRecord } from '../types';

export const SCHEDULER_CONFIG = {
  request_retention: 0.9, enable_fuzz: false, enable_short_term: true,
  learning_steps: ['1m', '10m'] as const, relearning_steps: ['10m'] as const,
};

export function emptyCard(wordId: string, now: number): CardRecord {
  return { wordId, fsrs: createEmptyCard(new Date(now)), slashed: false, bookmarked: false,
    everWrong: false, introducedAt: null, slashedAt: null };
}

export function scheduleCard(card: CardRecord, rating: Answer['rating'], now: number) {
  if (card.slashed) throw new Error('Slashed cards cannot be scheduled.');
  return fsrs(SCHEDULER_CONFIG).next(card.fsrs, new Date(now), Rating[rating]);
}

export function formatDue(dueAt: number, now: number): string {
  const difference = dueAt - now;
  if (difference <= 0) return '现在';
  if (difference < 3_600_000) return `${Math.max(1, Math.ceil(difference / 60_000))} 分钟后`;
  if (difference < 86_400_000) return `${Math.ceil(difference / 3_600_000)} 小时后`;
  return `${Math.max(1, Math.round(difference / 86_400_000))} 天后`;
}
