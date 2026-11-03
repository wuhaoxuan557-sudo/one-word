import { expect, it } from 'vitest';
import { projectSnapshot } from './project';
import { recordMutation } from './mutations';
import { migrateSnapshot, snapshotShared } from './migration';
import { mergeShared } from './merge';
import { emptyShared, PROFILE_ID } from './model';
import type { LocalSyncState } from './model';
import { devices, fact, slash } from './fixtures.test-helper';
import { freshSnapshot, studyWords as words, studyTime as now, studyTransition } from '../study.test-helper';
import { prepareChoicePool } from '../choices';
import { uuid5 } from './identity';
import { materializeShared } from './merge';
import { STUDY_TIME_ZONE } from './calendar';

const pool = prepareChoicePool(words);
const unanswered = () => migrateSnapshot(studyTransition(freshSnapshot(), { type: 'start' }, words, pool, now), crypto.randomUUID());
function project(local: ReturnType<typeof unanswered>, incoming: ReturnType<typeof emptyShared>) {
  return projectSnapshot(local, mergeShared(snapshotShared(local), incoming), words, now + 2000, STUDY_TIME_ZONE, true);
}
it('drops an unanswered question when a remote answer arrives and starts the rebuilt queue', () => {
  const local = unanswered();
  const projected = project(local, { ...emptyShared(), reviews: [fact('remote-answer', devices[1], now + 1000, { rating: 'Easy' })] });
  expect(projected.settings.daily?.current).toBeNull(); expect(projected.logs).toHaveLength(1);
  const next = studyTransition(projected, { type: 'start' }, words, pool, now + 2000);
  expect(next.settings.daily?.current?.wordId).toBe('table'); expect(next.logs).toHaveLength(1);
});
it.each(['feedback', 'details'] as const)('preserves an answered question in %s when remote facts arrive', phase => {
  const started = unanswered(), id = started.settings.daily!.current!.id;
  const local = studyTransition(started, { type: 'answer', presentationId: id, selectedId: 'apple', elapsedMs: 1000 }, words, pool, now + 1000);
  local.settings.daily!.current!.phase = phase;
  const projected = project(local, { ...emptyShared(), reviews: [fact('another-answer', devices[1], now + 1500)] });
  expect(projected.settings.daily?.current).toMatchObject({ id, phase, optionIds: started.settings.daily!.current!.optionIds, answer: local.logs[0] });
  expect(projected.logs).toHaveLength(2);
});
it('drops an unanswered question slashed by the remote device', () => {
  const projected = project(unanswered(), { ...emptyShared(), events: [slash('remote-slash', devices[1], now + 1000)] });
  expect(projected.settings.daily?.current).toBeNull();
  const next = studyTransition(projected, { type: 'start' }, words, pool, now + 2000);
  expect(next.settings.daily?.current?.wordId).toBe('table'); expect(next.logs).toHaveLength(0);
});
it('keeps the same unanswered question and options when remote facts concern another word', () => {
  const local = unanswered(), current = local.settings.daily!.current!;
  const projected = project(local, { ...emptyShared(), reviews: [fact('remote-table-only', devices[1], now + 1000, { wordId: 'table', selectedId: 'table' })] });
  expect(projected.settings.daily?.current).toMatchObject(current);
  expect(studyTransition(projected, { type: 'start' }, words, pool, now + 2000).settings.daily?.current?.id).toBe(current.id);
});
it.each([true, false])('drops an unanswered question for a newly received bookmark value %s even with an older timestamp', value => {
  const projected = project(unanswered(), { ...emptyShared(), events: [{ id: uuid5(`old-bookmark-${value}`), deviceId: devices[1],
    clock: [now - 1000, 0], at: now - 1000, type: 'bookmark', wordId: 'apple', value }] });
  expect(projected.settings.daily?.current).toBeNull();
});
it('ignores duplicate facts, duration completion and word snapshots unrelated to scheduling', () => {
  const learned = { ...emptyShared(), reviews: [fact('prior-learning', devices[0], now - 86_400_000, { rating: 'Again', selectedId: null, correct: false })] };
  const projected = project(unanswered(), learned);
  const local = studyTransition(projected, { type: 'start' }, words, pool, now + 2000);
  const id = local.settings.daily!.current!.id;
  const incoming = { ...learned, reviews: learned.reviews.map(log => ({ ...log, studyMs: 5000 })), events: [{ id: uuid5('display-snapshot'), deviceId: devices[1],
    clock: [now + 1000, 0] as const, at: now + 1000, type: 'word' as const, wordId: 'apple', value: { word: 'apple', translation: 'n. 苹果' } }] };
  expect(project(local, incoming).settings.daily?.current?.id).toBe(id);
});
it('detects an old saved question after its remote answer was already merged', () => {
  const local = unanswered(); delete local.settings.daily!.current!.factsVersion;
  const shared = mergeShared(snapshotShared(local), { ...emptyShared(), reviews: [fact('already-merged', devices[1], now + 1000, { rating: 'Easy' })] });
  const materialized = materializeShared(shared, STUDY_TIME_ZONE);
  const oldCache = { ...local, cards: materialized.cards, logs: materialized.logs, events: shared.events };
  expect(projectSnapshot(oldCache, shared, words, now + 2000, STUDY_TIME_ZONE).settings.daily?.current).toBeNull();
});

it('rebuilds merged allowances and pins only the receiver current question', () => {
  const started = studyTransition(freshSnapshot(), { type: 'start' }, words, prepareChoicePool(words), now);
  const local = migrateSnapshot(started, crypto.randomUUID());
  const incoming = { ...emptyShared(), reviews: [fact('remote-table', devices[1], now, { wordId: 'table', selectedId: 'table' }),
    fact('remote-chair', devices[1], now + 1, { wordId: 'chair', selectedId: 'chair' })] };
  const shared = mergeShared(snapshotShared(local), incoming);
  const projected = projectSnapshot(local, shared, words.slice(1), now + 10, 'Asia/Tokyo', true);
  expect(projected.settings.daily?.current?.id).toBe(started.settings.daily?.current?.id);
  expect(projected.settings.daily?.current?.pinned).toBe(true);
  expect(projected.settings.daily?.completed).toBe(2);
  expect(projected.settings.daily?.newIds).toEqual(['chair', 'table', 'apple']);
  expect(snapshotShared(projected)).toEqual(shared);
});

it('records actual preference edits, answer provenance and duration completion without fake tick versions', () => {
  const local: LocalSyncState = { id: 'sync-local', version: 1, deviceId: devices[0], clock: [0, 0], timeZone: 'UTC' };
  const before = migrateSnapshot(freshSnapshot(), crypto.randomUUID());
  const tick = recordMutation(before, before, { type: 'tick' }, local, now, () => crypto.randomUUID());
  expect(tick.local.clock).toEqual(local.clock); expect(tick.snapshot.events).toEqual(before.events);
  const changed = { ...before, settings: { ...before.settings, autoSpeak: false } };
  const event = recordMutation(before, changed, { type: 'preferences', value: changed.settings }, local, now, () => crypto.randomUUID());
  expect(event.snapshot.events!.filter(e => e.type === 'preference' && e.key === 'autoSpeak')).toHaveLength(2);
  const started = studyTransition(before, { type: 'start' }, words, prepareChoicePool(words), now);
  const action = { type: 'answer' as const, presentationId: started.settings.daily!.current!.id, selectedId: 'apple', elapsedMs: 1000 };
  const answered = studyTransition(started, action, words, prepareChoicePool(words), now + 1000);
  const saved = recordMutation(started, answered, action, event.local, now + 1000, () => crypto.randomUUID());
  expect(saved.snapshot.logs[0]).toMatchObject({ deviceId: devices[0], profileId: PROFILE_ID, syncClock: [now + 1000, 0] });
  expect(saved.snapshot.settings.daily?.current?.answer?.deviceId).toBe(devices[0]);
});

it('keeps bookmark cancellation as a newer fact rather than deleting its history', () => {
  const before = migrateSnapshot(freshSnapshot(), crypto.randomUUID());
  const local: LocalSyncState = { id: 'sync-local', version: 1, deviceId: devices[0], clock: [0, 0], timeZone: 'UTC' };
  const after = recordMutation(before, before, { type: 'bookmark', wordId: 'apple', value: false }, local, now, () => uuid5('remove'));
  expect(after.snapshot.events?.find(e => e.id === uuid5('remove'))).toMatchObject({ type: 'bookmark', value: false, at: now });
});
