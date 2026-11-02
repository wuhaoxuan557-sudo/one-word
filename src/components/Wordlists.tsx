import { useState } from 'react';
import { WORDLISTS } from '../core/catalog';
import { selectionCount } from '../core/wordlistIndex';
import type { WordlistIndex } from '../core/wordlistIndex';
import { Icon } from './Study';

export function Wordlists({ selected, index, onSave, onBack, busy }: { selected: string[]; index: WordlistIndex | null; onSave: (ids: string[]) => void; onBack: () => void; busy: boolean }) {
  const [draft, setDraft] = useState(selected);
  return <section className="page-main settings-main wordlists-main" aria-label="词表选择页">
    <div className="wordlists-heading"><button className="exit-button" aria-label="返回首页" onClick={onBack}><Icon name="close" /></button><h1>学习词表</h1></div>
    <section className="settings-section"><h2>选择词表 · 可多选</h2><div className="settings-group">{WORDLISTS.map(list => <label key={list.id} className="wordlist-row">
      <span>{list.label}<small>{index ? `${index.counts[list.id]!.toLocaleString('zh-CN')} 词` : '加载中…'}</small></span>
      <input type="checkbox" aria-label={list.label} checked={draft.includes(list.id)} disabled={busy} onChange={event => setDraft(event.target.checked ? [...draft, list.id] : draft.filter(id => id !== list.id))} />
    </label>)}</div><p className="page-note">至少选择一个词表 · 重复单词只学习一次</p></section>
    <p className="wordlist-total">已选 {draft.length} 个词表 · {index ? `去重后 ${selectionCount(index, draft).toLocaleString('zh-CN')} 词` : '正在读取词数…'}</p>
    <button className="primary-button wordlists-save" disabled={busy || !draft.length} onClick={() => onSave(draft)}>保存选择</button>
  </section>;
}
