import { useMemo, useState } from 'react';
import type { Snapshot } from '../types';

export function Wordbook({ snapshot, tab, onTab, onRemove, busy }: {
  snapshot: Snapshot; tab: 'bookmarked' | 'slashed'; onTab: (tab: 'bookmarked' | 'slashed') => void;
  onRemove: (id: string, tab: 'bookmarked' | 'slashed') => void; busy: boolean;
}) {
  const [query, setQuery] = useState('');
  const entries = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return snapshot.cards.filter(card => card[tab]).sort((a, b) =>
      (tab === 'slashed' ? (b.slashedAt ?? 0) - (a.slashedAt ?? 0) : (b.bookmarkedAt ?? 0) - (a.bookmarkedAt ?? 0)))
      .flatMap(card => { const word = card.wordSnapshot; return word && (!q || `${word.word} ${word.translationFull ?? word.translation}`.toLocaleLowerCase().includes(q)) ? [{ ...word, id: card.wordId }] : []; });
  }, [snapshot.cards, tab, query]);
  return <section className="page-main wordbook-main" aria-label="词本页">
    <h1>词本</h1>
    <div className="wordbook-tabs" role="tablist" aria-label="词本分类">{(['bookmarked', 'slashed'] as const).map((item, index) =>
      <button key={item} role="tab" id={`tab-${item}`} aria-selected={tab === item} aria-controls="wordbook-panel" tabIndex={tab === item ? 0 : -1}
        onClick={() => onTab(item)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const other = item === 'bookmarked' ? 'slashed' : 'bookmarked'; onTab(other); document.getElementById(`tab-${other}`)?.focus(); } }}>
        {index === 0 ? '生词本' : '已斩'} {snapshot.cards.filter(card => card[item]).length}
      </button>)}</div>
    <div className="wordbook-search"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
      <input type="search" aria-label="搜索单词或释义" placeholder="搜索单词或释义" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <p className="page-note">{tab === 'slashed' ? '按斩的时间排序 · 撤销后重新进入学习' : '按加入时间排序 · 未学词优先进入新词队列'}</p>
    <div className="wordbook-scroll" id="wordbook-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {entries.length ? <ul className="wordbook-list">{entries.map(word => <li key={word.id}>
        <div><span lang="en">{word.word}</span><p>{word.translation}</p></div>
        <button className="small-pill" disabled={busy} aria-label={`${tab === 'slashed' ? '撤销斩' : '移出生词本'} ${word.word}`} onClick={() => onRemove(word.id, tab)}>{tab === 'slashed' ? '撤销' : '移出'}</button>
      </li>)}</ul> : <p className="empty-list">{query ? '没有找到匹配的单词' : tab === 'slashed' ? '还没有已斩的单词' : '在单词详情页加入生词本'}</p>}
    </div>
  </section>;
}
