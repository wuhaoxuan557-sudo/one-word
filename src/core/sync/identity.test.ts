import { expect, it } from 'vitest';
import { uuid5, stableJson, isUuid } from './identity';
import { migrateSnapshot, snapshotShared } from './migration';
import { freshSnapshot, studyWords, studyTime } from '../study.test-helper';
import { prepareChoicePool } from '../choices';
import { studyTransition as transitionStudy } from '../study.test-helper';
import { calendarDay, calendarMidnight, STUDY_TIME_ZONE } from './calendar';
import { quotaUsage } from './quota';

it('matches the RFC UUIDv5 DNS namespace vector and canonicalises nested objects', () => {
  expect(uuid5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  expect(stableJson({ b: 2, a: [1, { d: 4, c: 3 }] })).toBe(stableJson({ a: [1, { c: 3, d: 4 }], b: 2 }));
});

it('deterministically migrates copied legacy history and current references without changing input', () => {
  const pool = prepareChoicePool(studyWords);
  const started = transitionStudy(freshSnapshot(), { type: 'start' }, studyWords, pool, studyTime);
  started.settings.daily!.current!.id = '2026-11-02:1';
  const oldId = started.settings.daily!.current!.id;
  const original = transitionStudy(started, { type: 'answer', presentationId: oldId, selectedId: 'apple', elapsedMs: 1000 }, studyWords, pool, studyTime + 1000);
  const before = structuredClone(original);
  const a = migrateSnapshot(original, crypto.randomUUID()); const b = migrateSnapshot(original, crypto.randomUUID());
  expect(a).toEqual(b); expect(original).toEqual(before);
  expect(isUuid(a.logs[0]!.id)).toBe(true);
  expect(a.settings.daily?.current?.id).toBe(a.logs[0]!.id);
  expect(a.settings.daily?.current?.answer?.id).toBe(a.logs[0]!.id);
  expect(migrateSnapshot(a, crypto.randomUUID())).toEqual(a);
  const completed = structuredClone(original); completed.logs[0]!.studyMs = 5000;
  expect(migrateSnapshot(completed, crypto.randomUUID()).logs[0]!.id).toBe(a.logs[0]!.id);
  const collision = structuredClone(original); collision.logs[0]!.answeredAt++;
  expect(migrateSnapshot(collision, crypto.randomUUID()).logs[0]!.id).not.toBe(a.logs[0]!.id);
  expect(snapshotShared(a).reviews[0]!.deviceId).toBe('00000000-0000-4000-8000-000000000000');
});

it('refuses a legacy card whose FSRS history is missing instead of resetting it', () => {
  const original = freshSnapshot();
  original.cards = [{ wordId: 'apple', fsrs: { due: new Date(studyTime), stability: 1, difficulty: 1, elapsed_days: 0, scheduled_days: 1, reps: 1, lapses: 0, state: 2, learning_steps: 0 },
    slashed: false, bookmarked: false, everWrong: false, introducedAt: studyTime, slashedAt: null }];
  expect(() => migrateSnapshot(original, crypto.randomUUID())).toThrow('历史不完整');
  expect(original.cards[0]!.fsrs.reps).toBe(1);
});
it('rebases old logs, feedback, quotas and local metadata to Beijing dates without changing answer timestamps or UUIDs', () => {
  const at = Date.parse('2026-11-03T15:30:00Z'); const pool = prepareChoicePool(studyWords);
  const started = transitionStudy(freshSnapshot(at), { type: 'start' }, studyWords, pool, at);
  const answered = transitionStudy(started, { type: 'answer', presentationId: started.settings.daily!.current!.id, selectedId: 'apple', elapsedMs: 1000 }, studyWords, pool, at + 1000);
  answered.settings.syncTimeZone = 'Asia/Tokyo'; answered.settings.daily!.day = '2026-11-04'; answered.logs[0]!.day = '2026-11-04';
  const id = answered.logs[0]!.id, timestamp = answered.logs[0]!.answeredAt;
  const migrated = migrateSnapshot(answered, crypto.randomUUID());
  expect(migrated.settings.syncTimeZone).toBe(STUDY_TIME_ZONE); expect(migrated.settings.daily?.day).toBe('2026-11-03');
  expect(migrated.logs[0]).toMatchObject({ day: '2026-11-03', id, answeredAt: timestamp });
  expect(migrated.settings.daily?.current?.answer?.day).toBe('2026-11-03');
  expect(quotaUsage(snapshotShared(migrated).reviews, [], at + 1000)).toMatchObject({ day: '2026-11-03', completed: 1 });
  expect(calendarDay(at)).toBe('2026-11-03'); expect(calendarMidnight(at)).toBe(Date.parse('2026-11-03T16:00:00Z'));
  expect(calendarDay(Date.parse('2026-11-03T16:00:00Z'))).toBe('2026-11-04');
});
it('keeps Beijing calendar boundaries when the device process timezone changes', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
      process.env.TZ = zone;
      const boundary = Date.parse('2026-11-03T16:00:00Z');
      expect(calendarDay(boundary - 1)).toBe('2026-11-03'); expect(calendarDay(boundary)).toBe('2026-11-04');
      expect(calendarMidnight(boundary - 1)).toBe(boundary);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
