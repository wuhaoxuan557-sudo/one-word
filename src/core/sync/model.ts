import type { Answer, Preferences, WordSnapshot } from '../../types';

export const SYNC_VERSION = 1;
export const PROFILE_ID = 'ts-fsrs-5.4.2/one-word-1';
export const LEGACY_DEVICE = '00000000-0000-4000-8000-000000000000';
export type Clock = readonly [number, number];
export interface LocalSyncState {
  id: 'sync-local'; version: 1; deviceId: string; clock: Clock; timeZone: string;
  boundTimeZone?: string;
}
export interface ReviewFact extends Answer {
  id: string; deviceId: string; profileId: string; clock: Clock; studyMs?: number;
}
interface EventBase { id: string; deviceId: string; clock: Clock; at: number }
export type PreferenceEvent = { [K in keyof Preferences]: EventBase & { type: 'preference'; key: K; value: Preferences[K] } }[keyof Preferences];
export type SyncEvent = PreferenceEvent
  | EventBase & { type: 'slash'; wordId: string; value: boolean; quotaKind: 'new' | 'review' | null; resume: boolean }
  | EventBase & { type: 'undo-slash'; wordId: string; targetId: string; value: boolean }
  | EventBase & { type: 'bookmark'; wordId: string; value: boolean }
  | EventBase & { type: 'word'; wordId: string; value: WordSnapshot };
export interface SharedState { version: 1; profileId: string; reviews: ReviewFact[]; events: SyncEvent[] }
export const emptyShared = (): SharedState => ({ version: SYNC_VERSION, profileId: PROFILE_ID, reviews: [], events: [] });
export const preferenceKeys = ['newLimit', 'reviewLimit', 'grading', 'autoSpeak', 'accent', 'selectedWordlists'] as const;
