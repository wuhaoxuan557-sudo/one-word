const formatters = new Map<string, Intl.DateTimeFormat>();
export const STUDY_TIME_ZONE = 'Asia/Shanghai';
export function validateTimeZone(timeZone: string): string {
  try { new Intl.DateTimeFormat('en', { timeZone }).format(0); } catch { throw new Error('同步计日时区不正确。'); }
  return timeZone;
}
export function calendarDay(now: number, timeZone = STUDY_TIME_ZONE): string {
  let format = formatters.get(timeZone);
  if (!format) { format = new Intl.DateTimeFormat('en', { timeZone: validateTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }); formatters.set(timeZone, format); }
  const parts = format.formatToParts(now); const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
const midnights = new Map<string, number>();
export function calendarMidnight(now: number, timeZone = STUDY_TIME_ZONE): number {
  const today = calendarDay(now, timeZone); const key = `${timeZone}:${today}`;
  const saved = midnights.get(key); if (saved !== undefined) return saved;
  let low = Math.floor(now), high = low + 36 * 3_600_000;
  while (high - low > 1) { const middle = Math.floor((low + high) / 2); if (calendarDay(middle, timeZone) === today) low = middle; else high = middle; }
  midnights.set(key, high); return high;
}
