import { useEffect, useState } from 'react';
import type { SyncView } from '../core/sync/controller';
import { STUDY_TIME_ZONE } from '../core/sync/calendar';

export function SyncSettings({ view, onEnabled, onToken, onTest, onSync }: {
  view: SyncView; onEnabled: (enabled: boolean) => Promise<void>; onToken: (token: string) => Promise<void>;
  onTest: () => Promise<void>; onSync: () => Promise<void>;
}) {
  const [token, setToken] = useState(view.token);
  useEffect(() => setToken(view.token), [view.token]);
  const save = async () => { if (token.trim() !== view.token) await onToken(token); };
  const invoke = async (action: () => Promise<void>) => { await save(); await action(); };
  const last = view.lastSyncAt === null ? '尚未同步' : new Intl.DateTimeFormat('zh-CN', { timeZone: STUDY_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(view.lastSyncAt);
  return <section className="settings-section"><h2>同步</h2><div className="settings-group sync-group">
    <div className="settings-row speech-row"><span>GitHub Gist 同步</span><button className="speech-switch" aria-label="开启同步" aria-pressed={view.enabled}
      onClick={() => void onEnabled(!view.enabled)}><span><i /></span></button></div>
    <label className="settings-row sync-token"><span>访问令牌</span><input type="password" aria-label="GitHub 访问令牌" autoComplete="off" autoCapitalize="none" spellCheck={false}
      value={token} placeholder="仅保存在本设备" onChange={event => setToken(event.target.value)} onBlur={() => void save()} /></label>
    <button className="data-row" disabled={!view.enabled || !token.trim() || view.busy} onClick={() => void invoke(onTest)}><span>测试连接</span><small>只读取</small></button>
    <button className="data-row" disabled={!view.enabled || !token.trim() || view.busy} onClick={() => void invoke(onSync)}><span>立即同步</span><small>{view.busy ? '进行中…' : '↑↓'}</small></button>
    <div className="settings-row sync-info"><span>计日时区：北京时间</span></div>
    <div className="settings-row sync-info"><span>上次同步</span><small>{last}</small></div>
    <div className="settings-row sync-status" role="status"><span>{view.status}</span></div>
  </div><p className="page-note">默认关闭。令牌仅保存在本设备；学习数据以明文保存在 secret gist，请定期导出备份。</p></section>;
}
