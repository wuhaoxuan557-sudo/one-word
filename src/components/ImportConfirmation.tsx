import { useEffect, useRef } from 'react';
export function ImportConfirmation({ fileName, cards, logs, busy, onCancel, onConfirm }: {
  fileName: string; cards: number; logs: number; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="import-dialog" aria-labelledby="import-title" aria-describedby="import-description" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="import-title">合并备份数据？</h2><p className="import-file-name">{fileName}</p>
    <p id="import-description">将合并 {cards} 张卡片、{logs} 条作答记录，保留已有历史和本机当前题；词本标记及设置按修改版本合并。确认后无法自动撤回。</p>
    <div><button className="text-button" disabled={busy} onClick={onCancel} autoFocus>取消</button><button className="primary-button" disabled={busy} onClick={onConfirm}>合并并导入</button></div>
  </dialog>;
}
