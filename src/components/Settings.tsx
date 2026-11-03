import { useRef } from 'react';
import type { AppSettings, Preferences } from '../types';
import { preferences } from '../core/preferences';

function Stepper({ value, onChange, minus, plus, label, disabled, min, max, step, format }: {
  value: number; onChange: (value: number) => void; minus: string; plus: string; label: string; disabled: boolean;
  min: number; max: number; step: number; format?: (value: number) => string;
}) {
  return <div className="stepper"><button aria-label={minus} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - step))}>−</button>
    <output aria-label={label}>{format ? format(value) : value}</output><button aria-label={plus} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + step))}>+</button></div>;
}
export function Settings({ settings, now, busy, onChange, onExport, onImport }: {
  settings: AppSettings; now: number; busy: boolean; onChange: (value: Preferences) => void;
  onExport: () => void; onImport: (file: File) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const patch = (value: Partial<Preferences>) => onChange({ ...preferences(settings), ...value });
  const backupDays = settings.lastExportAt === null ? null : Math.max(0, Math.floor((now - settings.lastExportAt) / 86_400_000));
  return <section className="page-main settings-main" aria-label="设置页">
    <h1>设置</h1>
    <section className="settings-section"><h2>学习</h2><div className="settings-group">
      <div className="settings-row"><span>每日新词</span><Stepper label="每日新词数量" value={settings.newLimit} min={0} max={10000} step={1} disabled={busy} minus="减少每日新词" plus="增加每日新词" onChange={newLimit => patch({ newLimit })} /></div>
      <div className="settings-row"><span>每日复习上限</span><Stepper label="每日复习上限数量" value={settings.reviewLimit} min={0} max={10000} step={10} disabled={busy} minus="减少复习上限" plus="增加复习上限" onChange={reviewLimit => patch({ reviewLimit })} /></div>
    </div></section>
    <section className="settings-section"><h2>发音</h2><div className="settings-group">
      <div className="settings-row speech-row"><span>出词时自动朗读</span><button className="speech-switch" aria-label="自动朗读" aria-pressed={settings.autoSpeak} disabled={busy} onClick={() => patch({ autoSpeak: !settings.autoSpeak })}><span><i /></span></button></div>
      <div className="settings-row accent-row"><span>口音</span><div className="accent-toggle" role="group" aria-label="口音">{(['en-GB', 'en-US'] as const).map((accent, i) => <button key={accent} aria-pressed={settings.accent === accent} disabled={busy} onClick={() => patch({ accent })}>{i === 0 ? '英音' : '美音'}</button>)}</div></div>
    </div></section>
    <section className="settings-section"><h2>评分阈值</h2><div className="settings-group">
      <div className="settings-row"><span className="setting-description">快速答对<small>记为 Easy</small></span><Stepper label="快速阈值" value={settings.grading.easyMs} min={0} max={Math.max(0, settings.grading.hardMs - 500)} step={500} disabled={busy}
        minus="缩短快速阈值" plus="延长快速阈值" format={value => `≤ ${(value / 1000).toFixed(1)} 秒`} onChange={easyMs => patch({ grading: { ...settings.grading, easyMs } })} /></div>
      <div className="settings-row"><span className="setting-description">慢速答对<small>记为 Hard</small></span><Stepper label="慢速阈值" value={settings.grading.hardMs} min={settings.grading.easyMs + 500} max={600000} step={500} disabled={busy}
        minus="缩短慢速阈值" plus="延长慢速阈值" format={value => `> ${(value / 1000).toFixed(1)} 秒`} onChange={hardMs => patch({ grading: { ...settings.grading, hardMs } })} /></div>
    </div><p className="page-note">介于两者之间记为 Good；选错或点“不认识”记为 Again</p></section>
    <section className="settings-section"><h2>数据</h2><div className="settings-group">
      <button className="data-row" disabled={busy} onClick={onExport}><BackupIcon /><span>导出备份</span><small>{backupDays === null ? '尚未备份' : backupDays === 0 ? '上次 今天' : `上次 ${backupDays} 天前`}</small></button>
      <button className="data-row" disabled={busy} onClick={() => file.current?.click()}><BackupIcon upload /><span>导入备份</span></button>
      <input ref={file} className="file-input" type="file" accept=".json,application/json" aria-label="备份 JSON 文件" onChange={event => { const selected = event.target.files?.[0]; if (selected) onImport(selected); event.target.value = ''; }} />
    </div><p className="page-note import-warning">导入会合并记录、词本及设置，已有历史会保留，操作前会再次确认</p></section>
  </section>;
}
function BackupIcon({ upload = false }: { upload?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={upload ? 'M12 15V4M7 9l5-5 5 5M5 20h14' : 'M12 4v11M7 10l5 5 5-5M5 20h14'} /></svg>;
}
