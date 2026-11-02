import type { Answer } from '../types';

export const GRADING_CONFIG = { easyMs: 2000, hardMs: 6000 } as const;
export interface GradingConfig { easyMs: number; hardMs: number }

export function gradeAnswer(correct: boolean, elapsedMs: number, previouslyWrong: boolean, config: GradingConfig = GRADING_CONFIG): Answer['rating'] {
  if (!correct) return 'Again';
  if (elapsedMs > config.hardMs) return 'Hard';
  if (elapsedMs <= config.easyMs && !previouslyWrong) return 'Easy';
  return 'Good';
}
