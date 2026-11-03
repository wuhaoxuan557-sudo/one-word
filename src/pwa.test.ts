import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let storage: { match: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> };
let cache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules(); vi.stubEnv('PROD', true);
  vi.stubEnv('BASE_URL', '/one-word/');
  cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => {}) };
  storage = { match: vi.fn(async () => undefined), open: vi.fn(async () => cache) };
  network = vi.fn(async () => new Response('[]'));
  vi.stubGlobal('caches', storage); vi.stubGlobal('fetch', network);
  vi.stubGlobal('window', { caches: storage });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('reads a cached selected wordlist without network access and persists a first fetch', async () => {
  const { fetchOfflineResource } = await import('./pwa');
  const cached = new Response('cached'); cache.match.mockResolvedValueOnce(cached);
  expect(await fetchOfflineResource('/one-word/wordlists/cet4.json')).toBe(cached);
  expect(network).not.toHaveBeenCalled();
  await fetchOfflineResource('/one-word/wordlists/cet6.json');
  expect(cache.put).toHaveBeenCalledWith('/one-word/wordlists/cet6.json', expect.any(Response));
});

it('uses precached index data offline, reports an uncached list, and leaves failed responses out of cache', async () => {
  const { fetchOfflineResource } = await import('./pwa');
  const index = new Response('{}'); storage.match.mockResolvedValueOnce(index);
  expect(await fetchOfflineResource('/one-word/wordlists/index.json')).toBe(index);
  network.mockRejectedValueOnce(new TypeError('Offline'));
  await expect(fetchOfflineResource('/one-word/wordlists/gre.json')).rejects.toThrow('GRE 词表尚未缓存');
  network.mockResolvedValueOnce(new Response('missing', { status: 404 }));
  await fetchOfflineResource('/one-word/wordlists/gre.json');
  expect(cache.put).not.toHaveBeenCalled();
});

it('prefetches only selected lists under BASE_URL and reports cache quota failures', async () => {
  const { prefetchWordlists, fetchOfflineResource } = await import('./pwa');
  await prefetchWordlists(['cet4', 'cet6']);
  expect(network.mock.calls.map(([url]) => url)).toEqual(['/one-word/wordlists/cet4.json', '/one-word/wordlists/cet6.json']);
  cache.put.mockRejectedValueOnce(new Error('Quota exceeded'));
  await expect(fetchOfflineResource('/one-word/wordlists/gre.json')).rejects.toThrow('无法保存离线词表');
});

it('registers prompt updates, never reloads on installation, and activates only on explicit request', async () => {
  const sw = Object.assign(new EventTarget(), { controller: null as object | null, register: vi.fn() });
  const saved = Object.assign(new EventTarget(), { waiting: null as { postMessage: ReturnType<typeof vi.fn> } | null, update: vi.fn(async () => {}) });
  sw.register.mockResolvedValue(saved);
  const reload = vi.fn();
  const link = { href: '' };
  vi.stubGlobal('navigator', { serviceWorker: sw, onLine: true });
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setInterval: vi.fn() }));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { querySelector: () => link }));
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: true }));
  const { startPwa, applyPwaUpdate } = await import('./pwa');
  startPwa(); await Promise.resolve();
  expect(link.href).toBe('/one-word/manifest-dark.webmanifest');
  expect(sw.register).toHaveBeenCalledWith('/one-word/sw.js', { scope: '/one-word/', updateViaCache: 'none' });
  sw.controller = {}; sw.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  saved.waiting = { postMessage: vi.fn() };
  expect(saved.waiting.postMessage).not.toHaveBeenCalled();
  applyPwaUpdate();
  expect(saved.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  sw.dispatchEvent(new Event('controllerchange'));
  expect(reload).toHaveBeenCalledOnce();
});
