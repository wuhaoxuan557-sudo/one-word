import type { Preferences } from '../../types';
import { validateTimeZone } from './calendar';
import { integer, list, parseEvent, parseShared, record, text, timestamp, uuid } from './merge';
import { PROFILE_ID, preferenceKeys } from './model';
import type { SharedState, SyncEvent } from './model';

export const DEVICE_FILE_LIMIT = 512 * 1024;
const types = ['preference', 'slash', 'undo-slash', 'bookmark', 'word'] as const;
const ratings = ['Again', 'Hard', 'Good', 'Easy'] as const;
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export function compactReview(log: SharedState['reviews'][number], writerId: string): unknown[] {
  return [log.id, log.wordId, log.answeredAt, log.selectedId, ratings.indexOf(log.rating), log.elapsedMs,
    log.studyMs ?? null, log.clock[0] - log.answeredAt, log.clock[1], ...(log.deviceId === writerId ? [] : [log.deviceId])];
}
export function compactEvent(event: SyncEvent, writerId: string): unknown[] {
  let key: string | number; let value: unknown;
  if (event.type === 'preference') { key = preferenceKeys.indexOf(event.key); value = event.key === 'grading' ? [event.value.easyMs, event.value.hardMs] : event.value; }
  else {
    key = event.wordId;
    value = event.type === 'slash' ? [Number(event.value), event.quotaKind === 'new' ? 1 : event.quotaKind === 'review' ? 2 : 0, Number(event.resume)]
      : event.type === 'undo-slash' ? [event.targetId, Number(event.value)]
      : event.type === 'word' ? [event.value.word, event.value.translation, event.value.translationFull ?? null] : Number(event.value);
  }
  return [event.id, types.indexOf(event.type), event.at, event.clock[0] - event.at, event.clock[1], key, value,
    ...(event.deviceId === writerId ? [] : [event.deviceId])];
}
function monthValue(value: unknown): string { const month = text(value); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('同步月份不正确。'); return month; }
export interface DeviceFile { name: string; content: string; bytes: number }
export function encodeDeviceMonth(input: SharedState, deviceId: string, month: string, timeZone: string): DeviceFile[] {
  const state = parseShared(input); uuid(deviceId); monthValue(month); validateTimeZone(timeZone);
  const make = () => ({ v: 1, p: PROFILE_ID, d: deviceId, m: month, z: timeZone, r: [] as unknown[][], e: [] as unknown[][] });
  const files: DeviceFile[] = []; let payload = make(); let bytes = utf8Bytes(JSON.stringify(payload));
  const flush = () => { const content = JSON.stringify(payload); files.push({ name: `device-${deviceId}-${month}${files.length ? `-${files.length + 1}` : ''}.json`, content, bytes: utf8Bytes(content) }); payload = make(); bytes = utf8Bytes(JSON.stringify(payload)); };
  const append = (kind: 'r' | 'e', value: unknown[]) => {
    const size = utf8Bytes(JSON.stringify(value));
    if (bytes + size + Number(payload[kind].length > 0) > DEVICE_FILE_LIMIT && payload.r.length + payload.e.length > 0) flush();
    if (bytes + size > DEVICE_FILE_LIMIT) throw new Error('单条同步记录超过 512 KiB，已停止编码。');
    bytes += size + Number(payload[kind].length > 0); payload[kind].push(value);
  };
  for (const log of state.reviews) append('r', compactReview(log, deviceId));
  for (const event of state.events) append('e', compactEvent(event, deviceId));
  if (payload.r.length + payload.e.length || !files.length) flush();
  return files;
}
export function decodeDeviceFile(content: string, expectedDevice?: string, expectedMonth?: string, truncated = false): { state: SharedState; deviceId: string; month: string; timeZone: string } {
  if (truncated || utf8Bytes(content) > DEVICE_FILE_LIMIT) throw new Error('同步文件被截断或超过 512 KiB，现有数据未修改。');
  let raw: unknown; try { raw = JSON.parse(content); } catch { throw new Error('同步文件不是有效 JSON。'); }
  const v = record(raw); if (v.v !== 1 || v.p !== PROFILE_ID) throw new Error('不支持此同步文件版本。');
  const deviceId = uuid(v.d), month = monthValue(v.m), timeZone = validateTimeZone(text(v.z));
  if ((expectedDevice && deviceId !== expectedDevice) || (expectedMonth && month !== expectedMonth)) throw new Error('同步文件名与内容不一致。');
  const reviews = list(v.r).map(value => {
    const r = list(value); if (r.length !== 9 && r.length !== 10) throw new Error('同步作答数组长度不正确。');
    const answeredAt = timestamp(r[2]);
    if (typeof r[4] !== 'number' || !Number.isInteger(r[4])) throw new Error('同步作答评分不正确。');
    const rating = ratings[r[4]];
    return { id: r[0], wordId: r[1], answeredAt, selectedId: r[3], rating, correct: r[1] === r[3], elapsedMs: r[5],
      ...(r[6] === null ? {} : { studyMs: r[6] }), clock: [answeredAt + integer(r[7]), r[8]], deviceId: r[9] ?? deviceId, profileId: PROFILE_ID };
  });
  const events = list(v.e).map(value => {
    const e = list(value); if (e.length !== 7 && e.length !== 8) throw new Error('同步事件数组长度不正确。');
    if (typeof e[1] !== 'number' || !Number.isInteger(e[1])) throw new Error('同步事件类型不正确。');
    const type = types[e[1]]; const at = timestamp(e[2]);
    const base = { id: e[0], type, at, clock: [at + integer(e[3]), e[4]], deviceId: e[7] ?? deviceId };
    const bit = (value: unknown) => { if (value !== 0 && value !== 1) throw new Error('同步布尔值不正确。'); return value === 1; };
    if (type === 'preference') {
      if (typeof e[5] !== 'number' || !Number.isInteger(e[5])) throw new Error('同步设置键不正确。');
      const key = preferenceKeys[e[5]] as keyof Preferences | undefined;
      const pair = key === 'grading' ? list(e[6]) : null;
      if (pair && pair.length !== 2) throw new Error('同步阈值组不正确。');
      return parseEvent({ ...base, key, value: pair ? { easyMs: pair[0], hardMs: pair[1] } : e[6] });
    }
    if (type === 'bookmark') return parseEvent({ ...base, wordId: e[5], value: bit(e[6]) });
    const data = list(e[6]);
    if (type === 'slash') {
      if (data.length !== 3 || ![0, 1, 2].includes(data[1] as number)) throw new Error('同步斩词事件不正确。');
      return parseEvent({ ...base, wordId: e[5], value: bit(data[0]), quotaKind: data[1] === 0 ? null : data[1] === 1 ? 'new' : 'review', resume: bit(data[2]) });
    }
    if (type === 'undo-slash' && data.length === 2) return parseEvent({ ...base, wordId: e[5], targetId: data[0], value: bit(data[1]) });
    if (type === 'word' && data.length === 3) return parseEvent({ ...base, wordId: e[5], value: { word: data[0], translation: data[1], ...(data[2] === null ? {} : { translationFull: data[2] }) } });
    throw new Error('同步事件格式不正确。');
  });
  return { state: parseShared({ version: 1, profileId: PROFILE_ID, reviews, events }), deviceId, month, timeZone };
}
