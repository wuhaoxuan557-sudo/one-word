import type { Clock, SyncEvent } from './model';

export function advanceClock(local: Clock, now: number, received: Clock = [0, 0]): Clock {
  if (![now, ...local, ...received].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('HLC 时间或计数不正确。');
  const time = Math.max(Math.floor(now), local[0], received[0]);
  const count = time === local[0] && time === received[0] ? Math.max(local[1], received[1]) + 1
    : time === local[0] ? local[1] + 1 : time === received[0] ? received[1] + 1 : 0;
  if (!Number.isSafeInteger(count)) throw new Error('HLC 计数超出安全范围。');
  return [time, count];
}
export const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function compareEvents(a: Pick<SyncEvent, 'clock' | 'deviceId' | 'id'>, b: Pick<SyncEvent, 'clock' | 'deviceId' | 'id'>): number {
  return a.clock[0] - b.clock[0] || a.clock[1] - b.clock[1] || compareText(a.deviceId, b.deviceId) || compareText(a.id, b.id);
}
