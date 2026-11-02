import type { Snapshot } from '../types';
import { statistics } from '../core/statistics';

export function Stats({ snapshot, now }: { snapshot: Snapshot; now: number }) {
  const stats = statistics(snapshot, now);
  const max = Math.max(1, ...stats.days.map(day => day.reviews));
  const baseline = stats.days.some(day => day.accuracy !== null && day.accuracy < 0.6) ? 0 : 0.6;
  const start = stats.days[0]!.day.split('-');
  return <section className="page-main stats-main" aria-label="统计页">
    <h1>统计</h1>
    <div className="stats-counts">{[[stats.learned, '已学'], [stats.slashed, '已斩'], [stats.bookmarked, '生词本']].map(([count, label]) =>
      <div key={label}><p>{count}</p><span>{label}</span></div>)}</div>
    <section className="chart-section"><div className="chart-heading"><h2>每日复习量</h2><p>近 30 天 · 日均 {Number(stats.dailyAverage.toFixed(1))}</p></div>
      <div className="bar-chart volume-chart" role="img" aria-label={`近 30 天每日复习量，日均 ${stats.dailyAverage.toFixed(1)} 次，最高 ${max === 1 && !stats.days.some(day => day.reviews) ? 0 : max} 次`}>
        {stats.days.map((day, i) => <div key={day.day} className={i === 29 ? 'muted-bar' : ''} title={`${day.day}：${day.reviews} 次`} style={{ height: `${day.reviews / max * 124}px` }} />)}
      </div><div className="chart-axis"><span>{Number(start[1])}月{Number(start[2])}日</span><span>今天</span></div>
    </section>
    <section className="chart-section"><div className="chart-heading"><h2>首次作答正确率</h2><p>近 30 天 · <strong>{stats.accuracy === null ? '—' : `${Math.round(stats.accuracy * 100)}%`}</strong></p></div>
      <div className="bar-chart accuracy-chart" role="img" aria-label={`近 30 天每日首次作答正确率，整体${stats.accuracy === null ? '暂无记录' : `${Math.round(stats.accuracy * 100)}%`}`}>
        {stats.days.map(day => <div key={day.day} title={`${day.day}：${day.accuracy === null ? '无记录' : `${Math.round(day.accuracy * 100)}%`}`}
          style={{ height: day.accuracy === null ? 0 : `${Math.max(1, (day.accuracy - baseline) / (1 - baseline) * 68)}px` }} />)}
      </div><p className="page-note">纵轴从 {baseline * 100}% 起 · 没复习的日子留空</p>
    </section>
  </section>;
}
