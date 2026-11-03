import { expect, it } from 'vitest';
import { projectSnapshot } from './project';
import { recordMutation } from './mutations';
import { migrateSnapshot, snapshotShared } from './migration';
import { mergeShared } from './merge';
import { emptyShared, PROFILE_ID } from './model';
import type { LocalSyncState } from './model';
import { devices, fact } from './fixtures.test-helper';
import { freshSnapshot, studyWords as words, studyTime as now, studyTransition } from '../study.test-helper';
import { prepareChoicePool } from '../choices';
import { uuid5 } from './identity';

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
