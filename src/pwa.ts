import { useSyncExternalStore } from 'react';

export const WORDLIST_CACHE = __WORDLIST_CACHE__;
let registration: ServiceWorkerRegistration | undefined;
let requestedUpdate = false;
let updateAvailable = false;
let controllerChanged = false;
const listeners = new Set<() => void>();
function publish() { updateAvailable = true; listeners.forEach(listener => listener()); }
export function usePwaUpdate() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => updateAvailable);
}
export function applyPwaUpdate() {
  if (!registration?.waiting) { if (controllerChanged) location.reload(); return; }
  requestedUpdate = true;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
}

export function startPwa() {
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const updateTheme = () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link) link.href = `${import.meta.env.BASE_URL}${dark.matches ? 'manifest-dark.webmanifest' : 'manifest.webmanifest'}`;
  };
  updateTheme(); dark.addEventListener('change', updateTheme);
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  let controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only the tab whose home-page button was clicked may reload.
    if (requestedUpdate) location.reload();
    else if (controlled) { controllerChanged = true; publish(); }
    controlled = true;
  });
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' }).then(saved => {
    registration = saved;
    if (saved.waiting) publish();
    saved.addEventListener('updatefound', () => {
      const installing = saved.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller && saved.waiting) publish();
      });
    });
    const check = () => { if (navigator.onLine) void saved.update().catch(() => {}); };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.setInterval(check, 60 * 60 * 1000);
  }).catch(() => { /* Network failure must not prevent local study. */ });
}

export async function fetchOfflineResource(url: string, signal?: AbortSignal): Promise<Response> {
  const wordlist = /\/wordlists\/(?!index\.json)[^/]+\.json$/.test(url);
  const canCache = import.meta.env.PROD && 'caches' in window;
  if (canCache) {
    const cached = wordlist ? await (await caches.open(WORDLIST_CACHE)).match(url) : await caches.match(url);
    if (cached) return cached;
  }
  let response: Response;
  try { response = await fetch(url, { signal }); }
  catch (error) {
    if (signal?.aborted) throw error;
    const id = url.split('/').pop()?.replace('.json', '').toUpperCase();
    throw new Error(`${id} 词表尚未缓存或网络不可用，请联网后重试。`);
  }
  if (canCache && wordlist && response.ok) {
    try { await (await caches.open(WORDLIST_CACHE)).put(url, response.clone()); }
    catch { throw new Error('无法保存离线词表，请检查浏览器存储空间后重试。'); }
  }
  return response;
}

export async function prefetchWordlists(ids: readonly string[]) {
  await Promise.all(ids.map(id => fetchOfflineResource(`${import.meta.env.BASE_URL}wordlists/${id}.json`)));
}
