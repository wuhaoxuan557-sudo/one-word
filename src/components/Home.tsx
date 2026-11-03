import type { Snapshot, Word } from '../types';
import { homeSummary, readyQueue, waitingSummary } from '../core/queue';
import { formatDue } from '../core/scheduler';
import { Icon } from './Study';
import { wordlistLabel } from '../core/catalog';

export type MainPage = 'home' | 'wordbook' | 'stats' | 'settings';
export function Navigation({ page, onNavigate }: { page: MainPage; onNavigate: (page: MainPage) => void }) {
  return <nav className="home-nav" aria-label="主导航">{(['home', 'wordbook', 'stats', 'settings'] as const).map((item, index) =>
    <button key={item} aria-current={page === item ? 'page' : undefined} aria-label={['首页', '词本', '统计', '设置'][index]} onClick={() => onNavigate(item)}>
      {item === 'wordbook' ? <Icon name="bookmark" /> : <NavigationIcon name={item} />}{['学习', '词本', '统计', '设置'][index]}
    </button>)}</nav>;
}

function NavigationIcon({ name }: { name: 'home' | 'stats' | 'settings' }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name === 'home' ? <><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" /></>
      : name === 'stats' ? <><path d="M3 20h18M7 16v-5M12 16V5M17 16V9" /></>
      : <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>}
  </svg>;
}

export function Home({ snapshot, words, now, onStart, busy, onWordlists, onWordbook, onExport, updateAvailable, onUpdate }: {
  snapshot: Snapshot; words: Word[]; now: number; onStart: () => void; busy: boolean;
  onWordlists: () => void; onWordbook: (tab: 'bookmarked' | 'slashed') => void; onExport: () => void;
  updateAvailable?: boolean; onUpdate?: () => void;
}) {
  const summary = homeSummary(snapshot, words, now);
  const date = new Date(now);
  const dayText = `${date.getMonth() + 1}月${date.getDate()}日 · 周${'日一二三四五六'[date.getDay()]}`;
  const resumable = Boolean(snapshot.settings.daily?.current);
  const canStart = resumable || readyQueue(snapshot, now).length > 0;
  const waiting = waitingSummary(snapshot, now);
  const overdue = now - (snapshot.settings.lastExportAt ?? snapshot.settings.createdAt) > 14 * 86_400_000;
  return <>
    <section className="home-main" aria-label="学习首页">
      <div className="home-heading"><p>{dayText}</p><button className="wordlist-badge" aria-label="选择词表" onClick={onWordlists}>{wordlistLabel(snapshot.settings.selectedWordlists)}</button></div>
      <h1 className="home-title">今天要做的</h1>
      <div className="home-counts">
        <div><p className="home-number" aria-label={`待复习 ${summary.reviewCount}`}>{summary.reviewCount}</p><p>待复习</p></div>
        <div><p className="home-number" aria-label={`新词 ${summary.newCount}`}>{summary.newCount}</p><p>新词</p></div>
      </div>
      <div className="home-divider" />
      <section className="home-wordlist-progress" aria-label="词表进度">
        <div><h2>词表进度</h2><p>{summary.learned.toLocaleString('zh-CN')} / {words.length.toLocaleString('zh-CN')}</p></div>
        <div className="home-progress-track" role="progressbar" aria-label="当前词表已学习或已斩" aria-valuemin={0} aria-valuemax={words.length} aria-valuenow={summary.learned}><span style={{ width: `${words.length ? summary.learned / words.length * 100 : 0}%` }} /></div>
      </section>
      <div className="home-stat-cards">
        <button onClick={() => onWordbook('slashed')} aria-label={`已斩 ${summary.slashed}`}><span className="small-seal" aria-hidden="true">斩</span><span><strong>{summary.slashed}</strong><small>已斩</small></span></button>
        <button onClick={() => onWordbook('bookmarked')} aria-label={`生词本 ${summary.bookmarked}`}><Icon name="bookmark" /><span><strong>{summary.bookmarked}</strong><small>生词本</small></span></button>
      </div>
      <div className="home-spacer" />
      {updateAvailable && <button className="update-prompt" disabled={busy} onClick={onUpdate}>有新版本 · 点击更新</button>}
      {overdue && <div className="backup-reminder"><p>{snapshot.settings.lastExportAt ? `距上次备份已 ${summary.backupDays} 天` : `尚未备份 · 已使用 ${summary.backupDays} 天`}</p><button disabled={busy} onClick={onExport}>导出备份</button></div>}
      <button className="primary-button home-start" disabled={!canStart || busy} onClick={onStart}>
        {canStart ? resumable ? '继续学习' : '开始学习' : waiting.count ? '稍后再来' : '今日已完成'}
        <span>{canStart ? `约 ${summary.minutes} 分钟` : waiting.count ? formatDue(waiting.dueAt, now) : ''}</span>
      </button>
    </section>
  </>;
}
