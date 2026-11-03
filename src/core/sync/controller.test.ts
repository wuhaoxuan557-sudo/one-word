import { afterEach, expect, it, vi } from 'vitest';
import { createSyncController } from './controller';
import { defaultSyncConfig } from '../../storage/sync';
import type { SyncConfig, SyncStorage } from '../../storage/sync';
import { mockGithub, response } from './github.test-helper';
import { devices, fact, state, time } from './fixtures.test-helper';
import { mergeShared } from './merge';

function memoryStorage(enabled = true) {
  let config: SyncConfig = { ...defaultSyncConfig(), enabled, token: 'FIXTURE_ONLY' }; let locked = false;
  const storage: SyncStorage = { read: async () => structuredClone(config), update: async patch => { config = { ...config, ...patch }; return structuredClone(config); },
    deviceId: async () => devices[0], lock: async work => { if (locked) return undefined; locked = true; try { return await work(async () => {}); } finally { locked = false; } } };
  return storage;
}
function setup(storage = memoryStorage(), api = mockGithub()) {
  let local = state([fact('a')]); let online = true;
  const onChange = vi.fn(), onMerge = vi.fn();
  const controller = createSyncController({ exportShared: async () => structuredClone(local), mergeShared: async shared => { local = mergeShared(local, shared); } }, storage,
    { fetch: api.fetch, online: () => online, onChange, onMerge, random: () => 0.5 });
  return { controller, storage, api, onChange, onMerge, offline: () => { online = false; } };
}
afterEach(() => vi.useRealTimers());
it('makes zero requests while disabled and after offline startup', async () => {
  vi.useFakeTimers(); vi.setSystemTime(time);
  const off = setup(memoryStorage(false)); await off.controller.start(); await vi.advanceTimersByTimeAsync(1000);
  await off.controller.test(); await off.controller.sync(); expect(off.api.calls).toHaveLength(0); off.controller.dispose();
  const offline = setup(); offline.offline(); await offline.controller.start(); await vi.advanceTimersByTimeAsync(1000);
  expect(offline.api.calls).toHaveLength(0); expect((await offline.storage.read()).status).toContain('离线'); offline.controller.dispose();
});
it('debounces startup, home and online triggers and tests connection without writing or merging', async () => {
  vi.useFakeTimers(); vi.setSystemTime(time);
  const test = setup(); await test.controller.test(); expect(test.api.calls.every(call => call.method === 'GET')).toBe(true); expect(test.onMerge).not.toHaveBeenCalled();
  expect((await test.storage.read()).lastSyncAt).toBeNull(); test.controller.dispose();
  const app = setup(); await app.controller.start(); app.controller.trigger(); app.controller.trigger();
  await vi.advanceTimersByTimeAsync(1000); expect(app.api.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  const count = app.api.calls.length; app.controller.trigger(); await vi.advanceTimersByTimeAsync(500); expect(app.api.calls).toHaveLength(count); app.controller.dispose();
});
it('shares one lock between controllers and does not block independent local answers', async () => {
  vi.useFakeTimers(); vi.setSystemTime(time);
  const storage = memoryStorage(), api = mockGithub();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
  api.setHook(async () => { entered(); await gate; return undefined; });
  const a = setup(storage, api), b = setup(storage, api);
  const pending = a.controller.sync(); await ready; await b.controller.sync();
  expect(api.calls).toHaveLength(1); expect((await storage.read()).status).toContain('正在同步');
  release(); await pending; expect(api.calls.filter(call => call.method === 'POST')).toHaveLength(1); a.controller.dispose(); b.controller.dispose();
});
it('persists exponential backoff, honors server deadlines and does not retry early on manual clicks', async () => {
  vi.useFakeTimers(); vi.setSystemTime(time);
  const app = setup(); app.api.setHook(() => { throw new Error('fixture-token-do-not-log'); });
  await app.controller.sync(); expect((await app.storage.read()).retryAt).toBe(time + 5000);
  await app.controller.sync(); expect(app.api.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5000); expect(app.api.calls).toHaveLength(2); expect((await app.storage.read()).retryAt).toBe(time + 15_000);
  app.controller.dispose();
  const limited = setup(); limited.api.setHook(() => response({}, 429, { 'retry-after': '120' }));
  await limited.controller.sync(); const deadline = (await limited.storage.read()).retryAt;
  expect(deadline).toBe(Date.now() + 120_000); await limited.controller.test(); expect(limited.api.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(119_999); expect(limited.api.calls).toHaveLength(1); limited.controller.dispose();
});
it('aborts before the next request if sync is switched off during discovery', async () => {
  vi.useFakeTimers(); vi.setSystemTime(time);
  const app = setup(); let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; }); let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
  app.api.setHook(async () => { entered(); await gate; return undefined; });
  const pending = app.controller.sync(); await ready; await app.controller.configure({ enabled: false }); finish(); await pending;
  expect(app.api.calls).toHaveLength(1); expect((await app.storage.read()).status).toBe('同步已关闭'); app.controller.dispose();
});
