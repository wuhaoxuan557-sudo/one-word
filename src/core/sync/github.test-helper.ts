import { GIST_MARKER, META_FILE } from './github';
import { PROFILE_ID } from './model';
import { STUDY_TIME_ZONE } from './calendar';
import { uuid5 } from './identity';

export const response = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers });
export interface MockGist { id: string; description: string; public: boolean; truncated: boolean; files: Record<string, { content: string; truncated: boolean }> }
export function mockGithub() {
  const gists = new Map<string, MockGist>();
  const calls: { method: string; path: string; files: string[] }[] = [];
  let hook: ((url: URL, init: RequestInit) => Promise<Response | undefined> | Response | undefined) | undefined;
  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input), method = init.method ?? 'GET';
    if (url.origin !== 'https://api.github.com' || init.redirect !== 'error' || init.cache !== 'no-store' || init.credentials !== 'omit') throw new Error('Unexpected mock request.');
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ method, path: url.pathname + url.search, files: Object.keys(body.files ?? {}) });
    const overridden = await hook?.(url, init); if (overridden) return overridden;
    if (url.pathname === '/gists' && method === 'GET') return response([...gists.values()].map(gist => ({ id: gist.id, description: gist.description })));
    if (url.pathname === '/gists' && method === 'POST') {
      const id = (gists.size + 100).toString(16), gist: MockGist = { id, description: String(body.description), public: body.public === true, truncated: false, files: {} };
      for (const [name, file] of Object.entries(body.files as Record<string, { content: string }>)) gist.files[name] = { content: file.content, truncated: false };
      gists.set(id, gist); return response(gist, 201);
    }
    const gist = gists.get(url.pathname.split('/')[2]!); if (!gist) return response({}, 404);
    if (method === 'PATCH') for (const [name, file] of Object.entries(body.files as Record<string, { content: string }>)) gist.files[name] = { content: file.content, truncated: false };
    return response(gist);
  };
  const add = (id = 'a1') => { const gist: MockGist = { id, public: false, description: `${GIST_MARKER} fixture`, truncated: false,
    files: { [META_FILE]: { truncated: false, content: JSON.stringify({ app: 'one-word', version: 1, datasetId: uuid5(id), profileId: PROFILE_ID, timeZone: STUDY_TIME_ZONE }) } } }; gists.set(id, gist); return gist; };
  return { fetch, calls, gists, add, setHook: (next: typeof hook) => { hook = next; } };
}
