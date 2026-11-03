import { GithubGistClient, SyncError } from './github';
import { calendarDay, STUDY_TIME_ZONE } from './calendar';
import type { SharedState } from './model';
import type { SyncConfig, SyncStorage } from '../../storage/sync';
import { defaultSyncConfig } from '../../storage/sync';

interface Store { exportShared(): Promise<SharedState>; mergeShared(state: SharedState, now: number, timeZone: string): Promise<unknown> }
export type SyncView = SyncConfig & { busy: boolean };
export function createSyncController(store: Store, storage: SyncStorage, options: {
  fetch: (url: string, init: RequestInit) => Promise<Response>; online: () => boolean;
  onChange: (view: SyncView) => void; onMerge: () => void; now?: () => number; random?: () => number;
  onPersist?: () => void;
}) {
  const now = options.now ?? Date.now, random = options.random ?? Math.random;
  let config = defaultSyncConfig(), disposed = false, running = false, requested = false;
  let timer: ReturnType<typeof setTimeout> | undefined, abort: AbortController | undefined;
  const publish = () => { if (!disposed) options.onChange({ ...config, busy: running }); };
  const update = async (patch: Partial<SyncConfig>) => { config = await storage.update(patch); publish(); options.onPersist?.(); };
  const schedule = (delay: number) => { if (disposed) return; clearTimeout(timer); timer = setTimeout(() => { void execute('sync').catch(() => {}); }, Math.max(0, delay)); };
  const execute = async (kind: 'test' | 'sync', manual = false): Promise<void> => {
    if (disposed || running) return;
    config = await storage.read();
    if (disposed || running) return;
    if (!config.enabled) { publish(); return; }
    if (!config.token) { await update({ status: '请填写访问令牌' }); return; }
    if (!options.online()) { await update({ status: '离线，联网后自动重试' }); return; }
    if (config.retryAt > now()) { publish(); schedule(config.retryAt - now()); return; }
    if (!manual && now() - config.lastAttempt < 3000) { publish(); schedule(config.lastAttempt + 3000 - now()); return; }
    running = true; publish();
    let again = false, entered = false;
    try {
      await storage.lock(async renew => {
        entered = true;
        config = await storage.read();
        if (!config.enabled || !config.token) return;
        if (config.retryAt > now()) { schedule(config.retryAt - now()); return; }
        if (!manual && now() - config.lastAttempt < 3000) { schedule(config.lastAttempt + 3000 - now()); return; }
        const token = config.token; abort = new AbortController();
        const guard = async () => {
          const current = await storage.read();
          if (disposed || abort!.signal.aborted || !current.enabled || current.token !== token) throw new SyncError('同步已取消。');
          await renew();
        };
        await update({ lastAttempt: now(), status: kind === 'test' ? '正在测试连接…' : '正在同步…' });
        const client = new GithubGistClient(token, options.fetch, guard, abort.signal, now);
        try {
          const writer = await storage.deviceId();
          if (kind === 'test') {
            const found = await client.discover(writer, calendarDay(now()).slice(0, 7), config.binding);
            await guard(); await update({ failures: 0, retryAt: client.nextAllowedAt, status: found ? '连接正常，已找到同步库' : '连接正常，首次同步将创建同步库' });
          } else {
            again = await client.sync({ writer, binding: config.binding, readLocal: () => store.exportShared(),
              bind: async binding => { await guard(); await update({ binding }); },
              merge: async shared => { await guard(); await store.mergeShared(shared, now(), STUDY_TIME_ZONE); options.onMerge(); } });
            await guard(); await update({ lastSyncAt: now(), status: '同步成功', failures: 0, retryAt: client.nextAllowedAt });
          }
        } catch (error) {
          if (disposed || abort.signal.aborted) return;
          const current = await storage.read(); if (!current.enabled || current.token !== token) { config = current; return; }
          const failure = error instanceof SyncError ? error : new SyncError('本地合并暂未完成，稍后自动重试；现有数据已保留。', true);
          const failures = config.failures + 1;
          const delay = Math.min(900_000, 5000 * 2 ** Math.min(failures - 1, 8) * (0.8 + random() * 0.4));
          const retryAt = failure.retryable ? Math.max(failure.retryAt, client.nextAllowedAt, now() + delay) : 0;
          await update({ status: failure.message, failures, retryAt });
          if (retryAt) schedule(retryAt - now());
        }
      });
      if (!entered) schedule(3000);
      config = await storage.read();
    } catch { if (!disposed) await update({ status: '本机同步锁或存储暂不可用，稍后自动重试', retryAt: now() + 5000 }); schedule(5000); }
    finally { const canceled = abort?.signal.aborted; running = false; abort = undefined; publish();
      if (again || requested || canceled && config.enabled) schedule(Math.max(3000, config.retryAt - now())); requested = false; }
  };
  return {
    start: async () => { config = await storage.read(); publish(); schedule(500); },
    trigger: () => { if (disposed) return; if (running) requested = true; else schedule(500); },
    test: () => execute('test', true).catch(() => {}), sync: () => execute('sync', true).catch(() => {}),
    refresh: async () => {
      const current = await storage.read(); if (!current.enabled || current.token !== config.token) abort?.abort();
      config = current; publish();
    },
    configure: async (patch: Pick<SyncConfig, 'enabled'> | Pick<SyncConfig, 'token'>) => {
      abort?.abort(); clearTimeout(timer);
      await update({ ...patch, ...('token' in patch ? { token: patch.token.trim() } : {}), failures: 0,
        status: 'enabled' in patch && !patch.enabled ? '同步已关闭' : '设置已保存' });
      if (config.enabled) schedule(500);
    },
    dispose: () => { disposed = true; abort?.abort(); clearTimeout(timer); },
  };
}
export type SyncController = ReturnType<typeof createSyncController>;
