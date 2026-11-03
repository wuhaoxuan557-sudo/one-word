import type { Snapshot } from '../types';
import { localDay } from './queue';

export function statistics(snapshot: Snapshot, now: number) {
  const today = new Date(`${localDay(now)}T12:00:00Z`);
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(today.getTime() - (29 - i) * 86_400_000);
    return { day: date.toISOString().slice(0, 10), reviews: 0, firstCount: 0, firstCorrect: 0, accuracy: null as number | null };
  });
  const byDay = new Map(days.map(day => [day.day, day]));
  const first = new Set<string>();
  const history = snapshot.logs.filter(log => log.answeredAt <= now).slice().sort((a, b) => a.answeredAt - b.answeredAt || a.id.localeCompare(b.id));
  for (const log of history) {
    const day = byDay.get(localDay(log.answeredAt));
    if (!day) continue;
    day.reviews++;
    const key = `${day.day}:${log.wordId}`;
    if (!first.has(key)) { first.add(key); day.firstCount++; day.firstCorrect += Number(log.correct); }
  }
  for (const day of days) day.accuracy = day.firstCount ? day.firstCorrect / day.firstCount : null;
  const totalFirst = days.reduce((sum, day) => sum + day.firstCount, 0);
  return { days, learned: new Set(history.map(log => log.wordId)).size,
    slashed: snapshot.cards.filter(card => card.slashed).length, bookmarked: snapshot.cards.filter(card => card.bookmarked).length,
    dailyAverage: days.reduce((sum, day) => sum + day.reviews, 0) / 30,
    accuracy: totalFirst ? days.reduce((sum, day) => sum + day.firstCorrect, 0) / totalFirst : null };
}
