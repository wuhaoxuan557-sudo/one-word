import { STUDY_TIME_ZONE, calendarDay } from './calendar';
import { decodeDeviceFile, encodeDeviceMonth } from './compact';
import { isUuid } from './identity';
import { mergeShared, record } from './merge';
import { emptyShared, PROFILE_ID } from './model';
import type { SharedState } from './model';

export const GIST_MARKER = '[one-word-sync:v1]';
export const META_FILE = 'one-word-meta.json';
export interface GistMeta { app: 'one-word'; version: 1; datasetId: string; timeZone: typeof STUDY_TIME_ZONE; profileId: string }
export interface Binding { gistId: string; datasetId: string }
export class SyncError extends Error {
  constructor(message: string, readonly retryable = false, readonly retryAt = 0) { super(message); }
}
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
type Gist = { id: string; meta: GistMeta; state: SharedState; ownMonth: SharedState };
const apiOrigin = 'https://api.github.com';
const invalid = (): never => { throw new SyncError('同步文件格式或版本不正确，已停止且未覆盖。'); };
const stopped = (): never => { throw new SyncError('同步文件被截断，已停止且未覆盖。'); };
const object = (value: unknown) => { try { return record(value); } catch { return invalid(); } };
function idValue(value: unknown): string { if (typeof value !== 'string' || !/^[a-f\d]+$/i.test(value)) return invalid(); return value; }
function parseMeta(value: unknown): GistMeta {
  const v = object(value);
  if (v.app !== 'one-word' || v.version !== 1 || typeof v.datasetId !== 'string' || !isUuid(v.datasetId) ||
    v.timeZone !== STUDY_TIME_ZONE || v.profileId !== PROFILE_ID) return invalid();
  return { app: 'one-word', version: 1, datasetId: v.datasetId, timeZone: STUDY_TIME_ZONE, profileId: PROFILE_ID };
}
function fileContent(value: unknown): string {
  const file = object(value);
  if (file.truncated === true) return stopped();
  if (typeof file.content !== 'string') return invalid();
  return file.content;
}
export function missingFacts(local: SharedState, remote: SharedState): SharedState {
  const reviews = new Map(remote.reviews.map(log => [log.id, log])); const events = new Set(remote.events.map(event => event.id));
  return { ...emptyShared(), reviews: local.reviews.filter(log => !reviews.has(log.id) || (log.studyMs ?? -1) > (reviews.get(log.id)!.studyMs ?? -1)),
    events: local.events.filter(event => !events.has(event.id)) };
}
export const hasFacts = (state: SharedState) => state.reviews.length + state.events.length > 0;

export class GithubGistClient {
  private resumeAt = 0;
  get nextAllowedAt() { return this.resumeAt; }
  constructor(private readonly token: string, private readonly fetcher: Fetcher,
    private readonly beforeRequest: () => Promise<void>, private readonly signal: AbortSignal,
    private readonly now: () => number = Date.now) {}
  private async request(path: string, method = 'GET', body?: unknown): Promise<{ value: unknown; next: string | null }> {
    const url = new URL(path, apiOrigin);
    if (url.origin !== apiOrigin || !/^\/gists(?:\/[a-f\d]+)?$/i.test(url.pathname) || url.username || url.password || url.hash) throw new SyncError('同步请求地址不受支持。');
    if (this.now() < this.resumeAt) throw new SyncError('GitHub 限流，稍后自动重试。', true, this.resumeAt);
    await this.beforeRequest();
    if (this.signal.aborted) throw new SyncError('同步已取消。');
    const controller = new AbortController(); const abort = () => controller.abort(); this.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 20_000);
    try {
      const response = await this.fetcher(url.href, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2026-03-10', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      const retry = response.headers.get('retry-after'); const reset = response.headers.get('x-ratelimit-reset');
      const retryAt = retry ? (/^\d+(?:\.\d+)?$/.test(retry) ? this.now() + Number(retry) * 1000 : Date.parse(retry)) : 0;
      const resetAt = response.headers.get('x-ratelimit-remaining') === '0' && reset ? Number(reset) * 1000 : 0;
      this.resumeAt = Math.max(this.resumeAt, Number.isFinite(retryAt) ? retryAt : 0, Number.isFinite(resetAt) ? resetAt : 0);
      let value: unknown; try { value = await response.json(); } catch { if (response.ok) throw new SyncError('GitHub 返回内容不完整，稍后自动重试。', true); value = {}; }
      if (!response.ok) {
        const limited = response.status === 429 || response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || this.resumeAt > this.now() || /rate limit|secondary limit|abuse/i.test(String(object(value).message ?? '')));
        if (limited) throw new SyncError('GitHub 限流，稍后自动重试。', true, Math.max(this.resumeAt, this.now() + 60_000));
        if (response.status === 401) throw new SyncError('令牌无效或已过期，请更新令牌。');
        if (response.status === 403) throw new SyncError('GitHub 拒绝访问，请检查 Gists 写权限。');
        if (response.status === 404) throw new SyncError('同步库不存在或无权访问，现有数据已保留。');
        throw new SyncError(`GitHub 请求失败（${response.status}）。`, response.status >= 500);
      }
      const next = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
      if (next) { const target = new URL(next); if (target.origin !== apiOrigin || target.pathname !== '/gists' || target.username || target.password) throw new SyncError('分页地址不受支持，已停止同步。'); }
      return { value, next };
    } catch (error) {
      if (error instanceof SyncError) throw error;
      if (this.signal.aborted) throw new SyncError('同步已取消。');
      throw new SyncError('网络中断或请求超时，稍后自动重试。', true);
    } finally { clearTimeout(timeout); this.signal.removeEventListener('abort', abort); }
  }
  private parseGist(value: unknown, writer: string, month: string): Gist {
    const gist = object(value); if (gist.truncated === true) return stopped();
    if (gist.public !== false || typeof gist.description !== 'string' || !gist.description.includes(GIST_MARKER)) return invalid();
    const files = object(gist.files); for (const file of Object.values(files)) if (object(file).truncated === true) return stopped();
    let meta: GistMeta; try { meta = parseMeta(JSON.parse(fileContent(files[META_FILE]))); } catch (error) { if (error instanceof SyncError) throw error; return invalid(); }
    let state = emptyShared(), ownMonth = emptyShared();
    for (const [name, file] of Object.entries(files)) {
      if (name === META_FILE) continue;
      const match = /^device-([a-f\d-]{36})-(\d{4}-\d{2})(?:-([2-9]\d*|1\d+))?\.json$/i.exec(name);
      if (!match) return invalid();
      try {
        const decoded = decodeDeviceFile(fileContent(file), match[1], match[2]);
        if (decoded.timeZone !== STUDY_TIME_ZONE) return invalid();
        state = mergeShared(state, decoded.state);
        if (decoded.deviceId === writer && decoded.month === month) ownMonth = mergeShared(ownMonth, decoded.state);
      } catch (error) { if (error instanceof SyncError) throw error; return invalid(); }
    }
    return { id: idValue(gist.id), meta, state, ownMonth };
  }
  async discover(writer: string, month: string, binding?: Binding): Promise<Gist | null> {
    let next: string | null = '/gists?per_page=100'; const visited = new Set<string>(), ids = new Set<string>();
    while (next) {
      if (visited.has(next) || visited.size >= 1000) throw new SyncError('Gist 分页异常，已停止同步。'); visited.add(next);
      const page = await this.request(next); if (!Array.isArray(page.value)) return invalid();
      for (const item of page.value) { const gist = object(item); if (gist.truncated === true) return stopped();
        if (typeof gist.description === 'string' && gist.description.includes(GIST_MARKER)) ids.add(idValue(gist.id)); }
      next = page.next;
    }
    const found: Gist[] = [];
    for (const id of ids) found.push(this.parseGist((await this.request(`/gists/${id}`)).value, writer, month));
    if (found.length > 1) throw new SyncError('发现多个有效同步库，无法确定使用哪一个；请先在 GitHub 处理重复库。');
    const result = found[0] ?? null;
    if (binding && (!result || result.id !== binding.gistId || result.meta.datasetId !== binding.datasetId)) {
      if (!result) await this.request(`/gists/${idValue(binding.gistId)}`);
      throw new SyncError('已绑定同步库未找到或已更换，请检查令牌账号；现有数据已保留。');
    }
    return result;
  }
  async sync(options: { writer: string; binding?: Binding; readLocal: () => Promise<SharedState>;
    bind: (binding: Binding) => Promise<void>; merge: (state: SharedState) => Promise<void> }): Promise<boolean> {
    const month = calendarDay(this.now()).slice(0, 7);
    let remote = await this.discover(options.writer, month, options.binding);
    if (!remote) {
      const meta: GistMeta = { app: 'one-word', version: 1, datasetId: crypto.randomUUID(), timeZone: STUDY_TIME_ZONE, profileId: PROFILE_ID };
      remote = this.parseGist((await this.request('/gists', 'POST', { description: `${GIST_MARKER} 一词同步`, public: false, files: { [META_FILE]: { content: JSON.stringify(meta) } } })).value, options.writer, month);
    }
    await options.bind({ gistId: remote.id, datasetId: remote.meta.datasetId });
    const local = await options.readLocal();
    // Validate UUID collisions before writing any remote file.
    mergeShared(local, remote.state);
    const delta = missingFacts(local, remote.state);
    const own = mergeShared(remote.ownMonth, delta);
    if (hasFacts(delta)) {
      const files = Object.fromEntries(encodeDeviceMonth(own, options.writer, month, STUDY_TIME_ZONE).map(file => [file.name, { content: file.content }]));
      this.parseGist((await this.request(`/gists/${remote.id}`, 'PATCH', { files })).value, options.writer, month);
    }
    const known = mergeShared(remote.state, own);
    await options.merge(known);
    return hasFacts(missingFacts(await options.readLocal(), known));
  }
}
