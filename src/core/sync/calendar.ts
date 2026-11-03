const formatters = new Map<string, Intl.DateTimeFormat>();
export function validateTimeZone(timeZone: string): string {
  try { new Intl.DateTimeFormat('en', { timeZone }).format(0); } catch { throw new Error('同步计日时区不正确。'); }
  return timeZone;
}
export function calendarDay(now: number, timeZone?: string): string {
  if (!timeZone) {
    const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  let format = formatters.get(timeZone);
  if (!format) { format = new Intl.DateTimeFormat('en', { timeZone: validateTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }); formatters.set(timeZone, format); }
  const parts = format.formatToParts(now); const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
const midnights = new Map<string, number>();
export function calendarMidnight(now: number, timeZone?: string): number {
  if (!timeZone) { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); }
  const today = calendarDay(now, timeZone); const key = `${timeZone}:${today}`;
  const saved = midnights.get(key); if (saved !== undefined) return saved;
  let low = Math.floor(now), high = low + 36 * 3_600_000;
  while (high - low > 1) { const middle = Math.floor((low + high) / 2); if (calendarDay(middle, timeZone) === today) low = middle; else high = middle; }
  midnights.set(key, high); return high;
}
