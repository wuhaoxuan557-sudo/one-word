import { expect, it } from 'vitest';
import { parseBackup, serializeBackup } from './backup';
import { studyTransition as transitionStudy } from './study.test-helper';
import { prepareChoicePool } from './choices';
import { freshSnapshot, studyWords as words, studyTime as now } from './study.test-helper';
import { migrateSnapshot } from './sync/migration';

const pool = prepareChoicePool(words);
const start = transitionStudy(freshSnapshot(), { type: 'start' }, words, pool, now);
const current = start.settings.daily!.current!;
const saved = transitionStudy(start, { type: 'answer', presentationId: current.id, selectedId: current.wordId, elapsedMs: 1000 }, words, pool, now + 1000);
const known = new Set(words.map(word => word.id));

it('roundtrips complete cards, logs, settings and the current question with native dates', () => {
  const parsed = parseBackup(serializeBackup(saved, now + 2000), known);
  expect(parsed).toEqual({ cards: saved.cards, logs: saved.logs, settings: { ...saved.settings, lastExportAt: now + 2000 } });
  expect(parsed.cards[0]?.fsrs.due).toBeInstanceOf(Date);
  expect(parsed.logs[0]?.fsrsLog.review).toBeInstanceOf(Date);
  expect(parseBackup(serializeBackup(freshSnapshot(), now), known).cards).toEqual([]);
});

it.each(['', '  \n ', '{broken', 'null', '[]', '{}'])('rejects empty or malformed backups: %s', text => {
  expect(() => parseBackup(text, known)).toThrow();
});

it('rejects unsupported versions before touching data', () => {
  const data = JSON.parse(serializeBackup(saved, now)) as Record<string, unknown>;
  data.version = 999;
  expect(() => parseBackup(JSON.stringify(data), known)).toThrow('版本');
});

it('rejects broken dates, duplicate IDs, unknown words, invalid settings and mismatched resume data', () => {
  for (const mutate of [
    (data: typeof saved) => { data.cards[0]!.fsrs.due = new Date(NaN); },
    (data: typeof saved) => { data.cards.push(data.cards[0]!); },
    (data: typeof saved) => { data.logs.push(data.logs[0]!); },
    (data: typeof saved) => { data.cards[0]!.wordId = 'unknown'; },
    (data: typeof saved) => { data.settings.selectedWordlists = []; },
    (data: typeof saved) => { data.settings.grading.easyMs = data.settings.grading.hardMs; },
    (data: typeof saved) => { data.settings.daily!.current!.answer!.correct = false; },
    (data: typeof saved) => { data.cards[0]!.fsrs.stability = -1; },
  ]) {
    const copy = structuredClone(saved); mutate(copy);
    expect(() => parseBackup(serializeBackup(copy, now), known)).toThrow();
  }
});

it('roundtrips version 2 events and strips unknown credential fields at every export boundary', () => {
  const snapshot = migrateSnapshot(saved, crypto.randomUUID());
  Object.assign(snapshot.settings, { token: 'LOCAL_ONLY_SECRET' });
  Object.assign(snapshot.logs[0]!, { token: 'LOCAL_ONLY_SECRET' });
  Object.assign(snapshot.cards[0]!.fsrs, { token: 'LOCAL_ONLY_SECRET' });
  const backup = serializeBackup(snapshot, now);
  expect(backup).not.toContain('LOCAL_ONLY_SECRET');
  expect(JSON.parse(backup).version).toBe(2);
  expect(new Set(parseBackup(backup).events)).toEqual(new Set(snapshot.events));
});
