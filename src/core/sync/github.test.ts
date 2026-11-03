import { expect, it } from 'vitest';
import { GithubGistClient, META_FILE } from './github';
import { mockGithub, response } from './github.test-helper';
import { devices, fact, state, time } from './fixtures.test-helper';
import { mergeShared } from './merge';
import { decodeDeviceFile, DEVICE_FILE_LIMIT, utf8Bytes } from './compact';
import { STUDY_TIME_ZONE } from './calendar';

const client = (api: ReturnType<typeof mockGithub>, now = () => time) => new GithubGistClient('FIXTURE_ONLY', api.fetch, async () => {}, new AbortController().signal, now);
it('creates one secret gist, writes meta once, and a second device discovers and merges it', async () => {
  const api = mockGithub(); let local = state([fact('a')]); let binding: { gistId: string; datasetId: string } | undefined;
  const options = { writer: devices[0], readLocal: async () => local, bind: async (value: NonNullable<typeof binding>) => { binding = value; }, merge: async (value: typeof local) => { local = mergeShared(local, value); } };
  await client(api).sync(options);
  expect(api.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  const gist = [...api.gists.values()][0]!;
  expect(gist.public).toBe(false); expect(JSON.parse(gist.files[META_FILE]!.content).timeZone).toBe(STUDY_TIME_ZONE);
  expect(api.calls.filter(call => call.method === 'PATCH').every(call => call.files.every(name => name.startsWith(`device-${devices[0]}-`)))).toBe(true);
  await client(api).sync({ ...options, binding });
  let second = state([fact('b', devices[1])]);
  await client(api).sync({ writer: devices[1], readLocal: async () => second, bind: async () => {}, merge: async shared => { second = mergeShared(second, shared); } });
  expect(second.reviews).toHaveLength(2); expect(api.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  expect(api.calls.filter(call => call.method === 'PATCH').every(call => !call.files.includes(META_FILE))).toBe(true);
});
it('reports multiple marked gists and stops without creating, uploading or merging', async () => {
  const api = mockGithub(); api.add('a1'); api.add('a2');
  await expect(client(api).discover(devices[0], '2026-11')).rejects.toThrow('多个');
  expect(api.calls.every(call => call.method === 'GET')).toBe(true);
});
it.each([401, 403, 404])('handles HTTP %i without disclosing response text or creating a replacement', async status => {
  const api = mockGithub(); api.setHook(() => response({ message: 'FIXTURE_SECRET_NEVER_DISPLAY' }, status));
  await expect(client(api).discover(devices[0], '2026-11')).rejects.not.toThrow('FIXTURE_SECRET');
  expect(api.calls).toHaveLength(1);
});
it('does not create a new gist when a previously bound gist returns 404', async () => {
  const api = mockGithub();
  await expect(client(api).discover(devices[0], '2026-11', { gistId: 'a1', datasetId: devices[0] })).rejects.toThrow('不存在');
  expect(api.calls.every(call => call.method === 'GET')).toBe(true);
});
it.each(['top', 'meta', 'file', 'listing'])('stops on %s truncation before any remote or local writes', async mode => {
  const api = mockGithub(), gist = api.add();
  if (mode === 'top') gist.truncated = true;
  if (mode === 'meta') gist.files[META_FILE]!.truncated = true;
  if (mode === 'file') gist.files[`device-${devices[1]}-2026-11.json`] = { content: '{}', truncated: true };
  if (mode === 'listing') api.setHook(url => url.pathname === '/gists' ? response([{ id: gist.id, description: gist.description, truncated: true }]) : undefined);
  let writes = 0;
  await expect(client(api).sync({ writer: devices[0], readLocal: async () => state([fact('a')]), bind: async () => { writes++; }, merge: async () => { writes++; } })).rejects.toThrow('截断');
  expect(writes).toBe(0); expect(api.calls.every(call => call.method === 'GET')).toBe(true);
});
it('honors rate-limit headers on both error and successful responses', async () => {
  const api = mockGithub(); let at = time;
  api.setHook(() => response({}, 429, { 'retry-after': '120', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((time + 180_000) / 1000) }));
  await expect(client(api, () => at).discover(devices[0], '2026-11')).rejects.toMatchObject({ retryable: true, retryAt: time + 180_000 });
  api.setHook(url => url.pathname === '/gists' ? response([{ id: 'a1', description: '[one-word-sync:v1]' }], 200, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((time + 60_000) / 1000) }) : undefined);
  const c = client(api, () => at); await expect(c.discover(devices[0], '2026-11')).rejects.toMatchObject({ retryAt: time + 60_000 });
  at += 1000; const before = api.calls.length; await expect(c.discover(devices[0], '2026-11')).rejects.toThrow('限流'); expect(api.calls).toHaveLength(before);
});
it('classifies network failures safely and rejects pagination outside api.github.com', async () => {
  const api = mockGithub(); api.setHook(() => { throw new Error('FIXTURE_SECRET_NEVER_DISPLAY'); });
  await expect(client(api).discover(devices[0], '2026-11')).rejects.toMatchObject({ retryable: true, message: '网络中断或请求超时，稍后自动重试。' });
  api.setHook(() => response([], 200, { link: '<https://example.com/gists>; rel="next"' }));
  await expect(client(api).discover(devices[0], '2026-11')).rejects.toThrow('分页'); expect(api.calls.every(call => call.path.startsWith('/gists'))).toBe(true);
});
it('publishes imported past-month facts in current-month split files and preserves existing foreign files', async () => {
  const api = mockGithub(); const gist = api.add();
  const foreignName = `device-${devices[1]}-2026-11.json`;
  const foreign = { v: 1, p: 'ts-fsrs-5.4.2/one-word-1', d: devices[1], m: '2026-11', z: STUDY_TIME_ZONE, r: [], e: [] };
  gist.files[foreignName] = { content: JSON.stringify(foreign), truncated: false }; const old = gist.files[foreignName]!.content;
  const local = state(Array.from({ length: 6000 }, (_, i) => fact(`bulk-${i}`, devices[0], time - 40 * 86_400_000 + i,
    { wordId: 'ecdict:representative', selectedId: 'ecdict:representative', studyMs: 25000 })));
  await client(api).sync({ writer: devices[0], readLocal: async () => local, bind: async () => {}, merge: async () => {} });
  const own = Object.entries(gist.files).filter(([name]) => name.startsWith(`device-${devices[0]}-2026-11`));
  expect(own.length).toBeGreaterThan(1); expect(own.some(([name]) => name.endsWith('-2.json'))).toBe(true);
  expect(own.every(([, file]) => utf8Bytes(file.content) <= DEVICE_FILE_LIMIT)).toBe(true);
  expect(own.reduce((n, [, file]) => n + decodeDeviceFile(file.content).state.reviews.length, 0)).toBe(6000);
  expect(gist.files[foreignName]!.content).toBe(old);
});
it('retains answers created during upload and requests another pass', async () => {
  const api = mockGithub(); api.add(); let local = state([fact('a')]); let added = false;
  api.setHook((_url, init) => { if (init.method === 'PATCH' && !added) { local = mergeShared(local, state([fact('during-upload')])); added = true; } return undefined; });
  const options = { writer: devices[0], readLocal: async () => structuredClone(local), bind: async () => {}, merge: async (shared: typeof local) => { local = mergeShared(local, shared); } };
  expect(await client(api).sync(options)).toBe(true); expect(local.reviews).toHaveLength(2);
  expect(await client(api).sync(options)).toBe(false);
  const file = Object.values([...api.gists.values()][0]!.files).find(file => file.content.includes('"r":'))!;
  expect(decodeDeviceFile(file.content).state.reviews).toHaveLength(2);
});
it('recovers when a PATCH reached the server but its response was lost', async () => {
  const api = mockGithub(), gist = api.add(); const local = state([fact('a')]); let once = true;
  api.setHook((_url, init) => {
    if (init.method === 'PATCH' && once) { once = false;
      const body = JSON.parse(String(init.body)) as { files: Record<string, { content: string }> };
      for (const [name, file] of Object.entries(body.files)) gist.files[name] = { content: file.content, truncated: false };
      throw new Error('Connection interrupted after commit.');
    } return undefined;
  });
  const options = { writer: devices[0], readLocal: async () => local, bind: async () => {}, merge: async () => {} };
  await expect(client(api).sync(options)).rejects.toMatchObject({ retryable: true });
  await client(api).sync(options); expect(api.calls.filter(call => call.method === 'PATCH')).toHaveLength(1);
});
it('reports missing write permission at upload without replacing remote files or merging local state', async () => {
  const api = mockGithub(), gist = api.add(); let merged = false;
  api.setHook((_url, init) => init.method === 'PATCH' ? response({}, 403) : undefined);
  await expect(client(api).sync({ writer: devices[0], readLocal: async () => state([fact('a')]), bind: async () => {}, merge: async () => { merged = true; } })).rejects.toThrow('写权限');
  expect(Object.keys(gist.files)).toEqual([META_FILE]); expect(merged).toBe(false);
});
