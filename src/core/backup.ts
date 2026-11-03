import type { Card, ReviewLog } from 'ts-fsrs';
import type { AppSettings, CardRecord, DailyPlan, Presentation, ReviewEntry, Snapshot } from '../types';
import { validatePreferences } from './preferences';
import { clockValue, parseEvent, parseShared, uuid } from './sync/merge';
import { reviewFact } from './sync/migration';
import { stableJson } from './sync/identity';
import { validateTimeZone } from './sync/calendar';

export const BACKUP_VERSION = 2;
const fail = (): never => { throw new Error('备份格式不正确，现有数据未修改。'); };
const object = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const str = (value: unknown): string => typeof value === 'string' && value.length > 0 ? value : fail();
const textField = (value: unknown): string => typeof value === 'string' ? value : fail();
const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fail();
const integer = (value: unknown): number => Number.isSafeInteger(num(value)) ? value as number : fail();
const bool = (value: unknown): boolean => typeof value === 'boolean' ? value : fail();
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : fail();
const choice = <T extends string | number>(value: unknown, values: readonly T[]): T => values.includes(value as T) ? value as T : fail();
const date = (value: unknown): Date => {
  const text = str(value); const parsed = new Date(text);
  if (!/^\d{4}-\d\d-\d\dT/.test(text) || !Number.isFinite(parsed.getTime())) fail();
  return parsed;
};
const timestamp = (value: unknown): number => { const n = integer(value); if (n > 8.64e15) fail(); return n; };
const nullableTime = (value: unknown) => value === null ? null : timestamp(value);
const day = (value: unknown): string => {
  const text = str(value);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d\d-\d\d$/.test(text) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) fail();
  return text;
};
function unique(values: string[]): string[] { if (new Set(values).size !== values.length) fail(); return values; }
function fsrsFields(item: Record<string, unknown>) {
  const difficulty = num(item.difficulty); if (difficulty > 10) fail();
  return { state: choice(item.state, [0, 1, 2, 3] as const), due: date(item.due), stability: num(item.stability), difficulty,
    elapsed_days: num(item.elapsed_days), scheduled_days: num(item.scheduled_days), learning_steps: integer(item.learning_steps) };
}
function fsrsCard(value: unknown): Card {
  const item = object(value);
  return { ...fsrsFields(item), reps: integer(item.reps), lapses: integer(item.lapses),
    ...(item.last_review === undefined ? {} : { last_review: date(item.last_review) }) };
}
function fsrsLog(value: unknown): ReviewLog {
  const item = object(value);
  return { ...fsrsFields(item), rating: choice(item.rating, [1, 2, 3, 4] as const),
    last_elapsed_days: num(item.last_elapsed_days), review: date(item.review) };
}

export function serializeBackup(snapshot: Snapshot, now: number): string {
  const version = snapshot.events === undefined ? 1 : BACKUP_VERSION;
  const parsed = parseBackup(JSON.stringify({ format: 'one-word-backup', version, exportedAt: now,
    cards: snapshot.cards, reviewLogs: snapshot.logs, settings: { ...snapshot.settings, lastExportAt: now }, syncEvents: snapshot.events }));
  return JSON.stringify({ format: 'one-word-backup', version, exportedAt: now,
    cards: parsed.cards, reviewLogs: parsed.logs, settings: parsed.settings, ...(parsed.events === undefined ? {} : { syncEvents: parsed.events }) }, null, 2);
}

export function parseBackup(text: string, knownIds?: ReadonlySet<string>): Snapshot {
  if (!text.trim()) throw new Error('备份文件为空，现有数据未修改。');
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('文件不是有效的 JSON，现有数据未修改。'); }
  const root = object(value);
  if (root.format !== 'one-word-backup') fail();
  if (root.version !== 1 && root.version !== BACKUP_VERSION) throw new Error('不支持此备份版本，现有数据未修改。');
  timestamp(root.exportedAt);
  const wordId = (value: unknown) => {
    const id = str(value);
    if (knownIds && !knownIds.has(id)) throw new Error('备份包含当前词库找不到的单词，现有数据未修改。');
    return id;
  };
  const ids = (value: unknown) => unique(array(value).map(wordId));
  const card = (value: unknown): CardRecord => {
    const item = object(value);
    return { wordId: wordId(item.wordId), fsrs: fsrsCard(item.fsrs), slashed: bool(item.slashed), bookmarked: bool(item.bookmarked),
      everWrong: bool(item.everWrong), introducedAt: nullableTime(item.introducedAt), slashedAt: nullableTime(item.slashedAt),
      ...(item.bookmarkedAt === undefined ? {} : { bookmarkedAt: nullableTime(item.bookmarkedAt) }),
      ...(item.wordSnapshot === undefined ? {} : { wordSnapshot: (() => {
        const saved = object(item.wordSnapshot);
        return { word: str(saved.word), translation: textField(saved.translation),
          ...(saved.translationFull === undefined ? {} : { translationFull: textField(saved.translationFull) }) };
      })() }) };
  };
  const review = (value: unknown): ReviewEntry => {
    const item = object(value);
    const entry: ReviewEntry = { id: str(item.id), wordId: wordId(item.wordId), day: day(item.day), kind: choice(item.kind, ['new', 'review']),
      selectedId: item.selectedId === null ? null : wordId(item.selectedId), correct: bool(item.correct), elapsedMs: num(item.elapsedMs),
      answeredAt: timestamp(item.answeredAt), rating: choice(item.rating, ['Again', 'Hard', 'Good', 'Easy']),
      dueAt: timestamp(item.dueAt), fsrsLog: fsrsLog(item.fsrsLog),
      ...(item.deviceId === undefined ? {} : { deviceId: uuid(item.deviceId) }),
      ...(item.profileId === undefined ? {} : { profileId: str(item.profileId) }),
      ...(item.syncClock === undefined ? {} : { syncClock: clockValue(item.syncClock) }),
      ...(item.studyMs === undefined ? {} : { studyMs: num(item.studyMs) }) };
    if (entry.correct !== (entry.selectedId === entry.wordId) || (entry.rating === 'Again') === entry.correct ||
      entry.fsrsLog.rating !== ['Again', 'Hard', 'Good', 'Easy'].indexOf(entry.rating) + 1 ||
      entry.fsrsLog.review.getTime() !== entry.answeredAt) fail();
    return entry;
  };
  const cards = array(root.cards).map(card); unique(cards.map(item => item.wordId));
  const logs = array(root.reviewLogs).map(review); unique(logs.map(item => item.id));
  const cardIds = new Set(cards.map(item => item.wordId));
  if (logs.some(log => !cardIds.has(log.wordId))) fail();
  const current = (value: unknown): Presentation | null => {
    if (value === null) return null;
    const item = object(value);
    const result: Presentation = { id: str(item.id), wordId: wordId(item.wordId), optionIds: ids(item.optionIds),
      kind: choice(item.kind, ['new', 'review']), reviewNumber: integer(item.reviewNumber),
      phase: choice(item.phase, ['recognise', 'feedback', 'details']), answer: item.answer === null ? null : review(item.answer),
      ...(item.pinned === undefined ? {} : { pinned: bool(item.pinned) }),
      ...(item.startedAt === undefined ? {} : { startedAt: timestamp(item.startedAt) }) };
    if (![0, 4].includes(result.optionIds.length) || (result.optionIds.length === 4 && !result.optionIds.includes(result.wordId)) ||
      (result.phase === 'recognise') !== (result.answer === null)) fail();
    if (result.answer && (result.answer.id !== result.id || result.answer.wordId !== result.wordId ||
      !logs.some(log => log.id === result.id && stableJson(reviewFact(log)) === stableJson(reviewFact(result.answer!))))) fail();
    return result;
  };
  const daily = (value: unknown): DailyPlan | null => {
    if (value === null) return null;
    const item = object(value);
    let undo: DailyPlan['undo'] = null;
    if (item.undo !== null) {
      const raw = object(item.undo);
      undo = { wordId: wordId(raw.wordId), previous: raw.previous === null ? null : card(raw.previous),
        expiresAt: timestamp(raw.expiresAt), day: day(raw.day), counted: bool(raw.counted), ...(raw.eventId === undefined ? {} : { eventId: uuid(raw.eventId) }) };
      if (undo.previous && undo.previous.wordId !== undo.wordId) fail();
    }
    const result: DailyPlan = { day: day(item.day), newIds: ids(item.newIds), reviewIds: ids(item.reviewIds),
      completed: integer(item.completed), sequence: integer(item.sequence), current: current(item.current),
      preferredNextId: item.preferredNextId === null ? null : wordId(item.preferredNextId), undo };
    unique([...result.newIds, ...result.reviewIds]);
    if (result.current && ![...result.newIds, ...result.reviewIds].includes(result.current.wordId)) fail();
    return result;
  };
  const raw = object(root.settings); const grading = object(raw.grading);
  if (raw.id !== 'app') fail();
  const settings: AppSettings = { id: 'app', newLimit: integer(raw.newLimit), reviewLimit: integer(raw.reviewLimit),
    grading: { easyMs: num(grading.easyMs), hardMs: num(grading.hardMs) }, autoSpeak: bool(raw.autoSpeak), accent: choice(raw.accent, ['en-GB', 'en-US']),
    createdAt: timestamp(raw.createdAt), lastExportAt: nullableTime(raw.lastExportAt), daily: daily(raw.daily),
    selectedWordlists: array(raw.selectedWordlists).map(str), ...(raw.syncTimeZone === undefined ? {} : { syncTimeZone: validateTimeZone(str(raw.syncTimeZone)) }) };
  validatePreferences(settings);
  const events = root.version === 2 ? array(root.syncEvents).map(parseEvent) : undefined;
  if (events) {
    const state = parseShared({ version: 1, profileId: 'ts-fsrs-5.4.2/one-word-1', reviews: logs.map(reviewFact), events });
    for (const event of state.events) if ('wordId' in event) wordId(event.wordId);
    return { cards, logs, settings, events: state.events };
  }
  return { cards, logs, settings };
}

export function backupWordIds(snapshot: Snapshot): string[] {
  const plan = snapshot.settings.daily;
  return [...new Set([
    ...snapshot.cards.map(card => card.wordId),
    ...snapshot.logs.flatMap(log => [log.wordId, ...(log.selectedId ? [log.selectedId] : [])]),
    ...(snapshot.events ?? []).flatMap(event => 'wordId' in event ? [event.wordId] : []),
    ...(plan ? [...plan.newIds, ...plan.reviewIds, ...(plan.preferredNextId ? [plan.preferredNextId] : []),
      ...(plan.undo ? [plan.undo.wordId] : []), ...(plan.current ? [plan.current.wordId, ...plan.current.optionIds] : [])] : []),
  ])];
}
