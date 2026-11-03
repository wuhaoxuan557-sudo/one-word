import type { AppSettings, Preferences, Snapshot, Word } from '../types';
import { WORDLISTS } from './catalog';
import { buildDailyPlan, localDay } from './queue';
import { emptyCard } from './scheduler';
import { snapshotWord } from './wordSnapshot';

export function validatePreferences(value: Preferences): void {
  if (![value.newLimit, value.reviewLimit].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 10_000)) throw new Error('每日上限须为 0 至 10000 的整数。');
  if (typeof value.autoSpeak !== 'boolean' || !['en-GB', 'en-US'].includes(value.accent)) throw new Error('发音设置不正确。');
  if (!value.grading || ![value.grading.easyMs, value.grading.hardMs].every(n => Number.isFinite(n) && n >= 0 && n <= 600_000) ||
    value.grading.easyMs >= value.grading.hardMs) throw new Error('快速阈值须小于慢速阈值，且不超过 600 秒。');
  if (!Array.isArray(value.selectedWordlists) || !value.selectedWordlists.length || new Set(value.selectedWordlists).size !== value.selectedWordlists.length ||
    value.selectedWordlists.some(id => !WORDLISTS.some(list => list.id === id))) throw new Error('请至少选择一个有效词表。');
}
export function normaliseSettings(settings: AppSettings): AppSettings {
  return { ...settings, selectedWordlists: settings.selectedWordlists ?? ['cet4'] };
}
export function preferences(settings: Preferences): Preferences {
  const { newLimit, reviewLimit, grading, autoSpeak, accent, selectedWordlists } = settings;
  return { newLimit, reviewLimit, grading, autoSpeak, accent, selectedWordlists };
}
export type ManagementAction =
  | { type: 'preferences'; value: Preferences }
  | { type: 'bookmark'; wordId: string; value: boolean }
  | { type: 'unslash'; wordId: string }
  | { type: 'exported'; at: number };

export function manageSnapshot(input: Snapshot, action: ManagementAction, words: readonly Word[], now: number): Snapshot {
  let snapshot = input;
  if (action.type === 'exported') return { ...input, settings: { ...input.settings, lastExportAt: action.at } };
  if (action.type === 'preferences') {
    validatePreferences(action.value);
    snapshot = { ...input, settings: { ...input.settings, ...preferences(action.value) } };
  } else {
    const word = words.find(word => word.id === action.wordId);
    const existing = input.cards.find(card => card.wordId === action.wordId);
    if (!word && !existing?.wordSnapshot) throw new Error('找不到这个单词。');
    const previous = input.cards.find(card => card.wordId === action.wordId) ?? emptyCard(action.wordId, now);
    const card = action.type === 'bookmark' ? { ...previous, bookmarked: action.value, bookmarkedAt: action.value ? now : null,
      wordSnapshot: word ? snapshotWord(word) : previous.wordSnapshot }
      : { ...previous, slashed: false, slashedAt: null, fsrs: { ...previous.fsrs, due: new Date(Math.min(now, previous.fsrs.due.getTime())) } };
    snapshot = { ...input, cards: [...input.cards.filter(item => item.wordId !== card.wordId), card] };
  }
  // Release only untouched reservations. Completed work still consumes today's quota.
  const plan = snapshot.settings.daily;
  if (!plan || plan.day !== localDay(now)) return action.type === 'unslash'
    ? { ...snapshot, settings: { ...snapshot.settings, daily: { ...buildDailyPlan([], snapshot.cards, snapshot.settings, now), preferredNextId: action.wordId } } }
    : snapshot;
  const cards = new Map(snapshot.cards.map(card => [card.wordId, card]));
  const reviewed = new Set(snapshot.logs.filter(log => log.day === plan.day).map(log => log.wordId));
  const current = plan.current;
  const keepCurrent = (id: string) => current?.wordId === id;
  return { ...snapshot, settings: { ...snapshot.settings, daily: { ...plan,
    newIds: plan.newIds.filter(id => cards.get(id)?.fsrs.reps || cards.get(id)?.slashed || keepCurrent(id)),
    reviewIds: plan.reviewIds.filter(id => reviewed.has(id) || cards.get(id)?.slashed || keepCurrent(id)),
    preferredNextId: action.type === 'unslash' ? action.wordId : plan.preferredNextId,
    undo: action.type === 'unslash' && plan.undo?.wordId === action.wordId ? null : plan.undo,
  } } };
}
