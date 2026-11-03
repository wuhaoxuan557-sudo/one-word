import type { Table } from 'dexie';
import type { VocabularyDatabase } from './database';
import type { Binding } from '../core/sync/github';

export interface SyncConfig {
  id: 'gist-sync'; enabled: boolean; token: string; status: string; lastSyncAt: number | null;
  failures: number; retryAt: number; lastAttempt: number; binding?: Binding;
}
export const defaultSyncConfig = (): SyncConfig => ({ id: 'gist-sync', enabled: false, token: '', status: '同步已关闭', lastSyncAt: null, failures: 0, retryAt: 0, lastAttempt: 0 });
export interface SyncStorage {
  read(): Promise<SyncConfig>;
  update(patch: Partial<SyncConfig>): Promise<SyncConfig>;
  deviceId(): Promise<string>;
  lock<T>(work: (renew: () => Promise<void>) => Promise<T>): Promise<T | undefined>;
}
export function createSyncStorage(db: VocabularyDatabase, useWebLocks = true): SyncStorage {
  const settings = db.table<SyncConfig, string>('settings');
  const leases: Table<{ id: string; holder: string; expiresAt: number }, string> = db.table('settings');
  const read = async () => ({ ...defaultSyncConfig(), ...await settings.get('gist-sync') });
  const update = (patch: Partial<SyncConfig>) => db.transaction('rw', settings, async () => {
    const config = { ...await read(), ...patch, id: 'gist-sync' as const }; await settings.put(config); return config;
  });
  return { read, update, deviceId: async () => { const local = await db.localSettings.get('sync-local'); if (!local) throw new Error('Local identity is unavailable.'); return local.deviceId; },
    lock: async work => {
      if (useWebLocks && typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('one-word-gist-sync', { ifAvailable: true }, lock => lock ? work(async () => {}) : undefined);
      const holder = crypto.randomUUID();
      const acquire = await db.transaction('rw', leases, async () => {
        const saved = await leases.get('gist-lock'); if (saved && saved.expiresAt > Date.now()) return false;
        await leases.put({ id: 'gist-lock', holder, expiresAt: Date.now() + 60_000 }); return true;
      });
      if (!acquire) return undefined;
      const renew = () => db.transaction('rw', leases, async () => {
        const saved = await leases.get('gist-lock'); if (saved?.holder !== holder || saved.expiresAt <= Date.now()) throw new Error('Sync lease was lost.');
        await leases.put({ ...saved, expiresAt: Date.now() + 60_000 });
      });
      try { return await work(renew); }
      finally { await db.transaction('rw', leases, async () => { if ((await leases.get('gist-lock'))?.holder === holder) await leases.delete('gist-lock'); }); }
    } };
}
