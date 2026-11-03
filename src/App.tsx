import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Question, Snapshot } from './types';
import { nextWakeAt, queueProgress, readyQueue, waitingSummary } from './core/queue';
import { formatDue } from './core/scheduler';
import { WORDLISTS, mergeWordlists, selectedWords } from './core/catalog';
import type { Catalog } from './core/catalog';
import { preferences } from './core/preferences';
import { serializeBackup } from './core/backup';
import { createStudyStore } from './storage/database';
import type { StudyStore, AppAction } from './storage/database';
import { createWordlistLoader } from './storage/wordlists';
import type { WordlistLoader } from './storage/wordlists';
import { membershipLists } from './core/wordlistIndex';
import type { WordlistIndex } from './core/wordlistIndex';
import { speak, cancelSpeech } from './speech';
import { Home, Navigation } from './components/Home';
import type { MainPage } from './components/Home';
import { Wordbook } from './components/Wordbook';
import { Stats } from './components/Stats';
import { Settings } from './components/Settings';
import { Wordlists } from './components/Wordlists';
import { ImportConfirmation } from './components/ImportConfirmation';
import { applyPwaUpdate, fetchOfflineResource, prefetchWordlists, usePwaUpdate } from './pwa';
import { DetailContent, DetailFooter, FeedbackFooter, QuizCard, StudyHeader, UndoToast } from './components/Study';
import { SyncSettings } from './components/SyncSettings';
import { createSyncStorage, defaultSyncConfig } from './storage/sync';
import { createSyncController } from './core/sync/controller';
import type { SyncController, SyncView } from './core/sync/controller';
import { calendarDay } from './core/sync/calendar';

export default function App() {
  const updateAvailable = usePwaUpdate();
  const [catalog, setCatalog] = useState<Catalog>({});
  const [wordlistIndex, setWordlistIndex] = useState<WordlistIndex | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [now, setNow] = useState(Date.now);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(false);
  const [page, setPage] = useState<MainPage | 'wordlists'>('home');
  const [wordbookTab, setWordbookTab] = useState<'bookmarked' | 'slashed'>('bookmarked');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [pendingImport, setPendingImport] = useState<{ text: string; name: string; cards: number; logs: number } | null>(null);
  const [speechNotice, setSpeechNotice] = useState('');
  const [syncView, setSyncView] = useState<SyncView>({ ...defaultSyncConfig(), busy: false });
  const sync = useRef<SyncController | null>(null);
  const refreshAfterSync = useRef<() => void>(() => {});
  const syncRefreshPending = useRef(false);
  const store = useRef<StudyStore | null>(null);
  const loader = useRef<WordlistLoader | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);
  const lastSpoken = useRef('');
  const current = snapshot?.settings.daily?.current;
  const allWords = useMemo(() => mergeWordlists(Object.values(catalog)), [catalog]);
  const words = useMemo(() => selectedWords(catalog, snapshot?.settings.selectedWordlists ?? ['cet4']), [catalog, snapshot?.settings.selectedWordlists]);
  const byId = useMemo(() => new Map(allWords.map(word => [word.id, word])), [allWords]);
  const question = useMemo<Question | null>(() => {
    const word = current && byId.get(current.wordId);
    return word && current ? { word, options: current.optionIds.flatMap(id => byId.get(id) ?? []) } : null;
  }, [current, byId]);

  useEffect(() => {
    mounted.current = true;
    let controllerDisposed = false;
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('one-word-sync-status');
    if (channel) channel.onmessage = event => { void sync.current?.refresh().catch(() => {}); if (event.data === 'merged') refreshAfterSync.current(); };
    const controller = new AbortController();
    const source = createWordlistLoader(url => fetchOfflineResource(url, controller.signal));
    const opened = createStudyStore([], undefined, source.catalog, source);
    loader.current = source;
    setLoading(true); setError('');
    opened.load().then(saved => {
        if (controller.signal.aborted) { opened.db.close(); return; }
        store.current = opened; setCatalog({ ...source.catalog }); setSnapshot(saved); setNow(Date.now());
        const syncController = createSyncController(opened, createSyncStorage(opened.db), {
          fetch: (url, init) => fetch(url, init), online: () => navigator.onLine,
          onChange: view => { if (!controllerDisposed) setSyncView(view); }, onMerge: () => { refreshAfterSync.current(); channel?.postMessage('merged'); },
          onPersist: () => channel?.postMessage('changed'),
        });
        sync.current = syncController; void syncController.start().catch(() => {});
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法打开本地学习数据。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    void navigator.storage?.persist?.().catch(() => false);
    const online = () => sync.current?.trigger(); window.addEventListener('online', online);
    const focus = () => { void sync.current?.refresh().catch(() => {}); }; window.addEventListener('focus', focus);
    return () => { controllerDisposed = true; mounted.current = false; sync.current?.dispose(); sync.current = null; channel?.close(); window.removeEventListener('online', online); window.removeEventListener('focus', focus); controller.abort(); opened.db.close(); store.current = null; loader.current = null; cancelSpeech(); };
  }, [retry]);

  const run = useCallback(async (action: AppAction) => {
    if (!store.current || locked.current) return null;
    locked.current = true; setBusy(true);
    try {
      const time = Date.now();
      const saved = await store.current.transact(action, time);
      if (mounted.current) { setCatalog({ ...loader.current?.catalog }); setSnapshot(saved); setNow(time); setError(''); }
      return saved;
    } catch (reason) {
      if (mounted.current) {
        const message = reason instanceof Error ? reason.message : '本地数据库错误';
        if (action.type === 'preferences') setNotice({ text: message, error: true });
        else setError(`学习进度未保存，请重试：${message}`);
      }
      return null;
    } finally { locked.current = false; if (mounted.current) setBusy(false); if (syncRefreshPending.current) { syncRefreshPending.current = false; refreshAfterSync.current(); } }
  }, []);
  refreshAfterSync.current = () => {
    if (locked.current) { syncRefreshPending.current = true; return; }
    void run({ type: 'tick' });
  };
  useEffect(() => { if (!loading && !active && page === 'home') sync.current?.trigger(); }, [loading, active, page]);

  useEffect(() => {
    if (!import.meta.env.PROD || !snapshot) return;
    void prefetchWordlists(snapshot.settings.selectedWordlists).catch(reason => {
      if (mounted.current) setNotice({ text: reason instanceof Error ? reason.message : '离线词表保存失败，请联网重试。', error: true });
    });
  }, [snapshot?.settings.selectedWordlists]);

  const navigate = (next: MainPage | 'wordlists') => { cancelSpeech(); setActive(false); setPage(next); setNotice(null); setSpeechNotice(''); };
  const exportData = async () => {
    if (!store.current || locked.current) return;
    locked.current = true; setBusy(true);
    try {
      const saved = await store.current.load(); const time = Date.now();
      const url = URL.createObjectURL(new Blob([serializeBackup(saved, time)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `one-word-${calendarDay(time)}.json`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSnapshot(await store.current.transact({ type: 'exported', at: time }, time)); setNow(time);
      setNotice({ text: '备份已生成，请保留下载的 JSON 文件。', error: false });
    } catch (reason) { setNotice({ text: reason instanceof Error ? reason.message : '导出失败，请重试。', error: true }); }
    finally { locked.current = false; setBusy(false); }
  };
  const readImport = async (file: File) => {
    if (!store.current || locked.current) return;
    locked.current = true; setBusy(true); setNotice(null);
    try {
      const text = await file.text(); const parsed = await store.current.prepareImport(text);
      setPendingImport({ text, name: file.name, cards: parsed.cards.length, logs: parsed.logs.length });
    } catch (reason) { setNotice({ text: reason instanceof Error ? reason.message : '备份格式不正确，现有数据未修改。', error: true }); }
    finally { locked.current = false; setBusy(false); }
  };
  const confirmImport = async () => {
    if (!store.current || !pendingImport || locked.current) return;
    locked.current = true; setBusy(true);
    try {
      const time = Date.now(); const imported = await store.current.importBackup(pendingImport.text, time);
      setCatalog({ ...loader.current?.catalog }); setSnapshot(imported); setNow(time);
      cancelSpeech(); setActive(false); lastSpoken.current = ''; setPendingImport(null);
      setNotice({ text: '备份已导入。', error: false });
    } catch (reason) { setPendingImport(null); setNotice({ text: reason instanceof Error ? reason.message : '导入失败，现有数据未修改。', error: true }); }
    finally { locked.current = false; setBusy(false); }
  };

  useEffect(() => {
    if (wordlistIndex || loading || (page !== 'wordlists' && !(active && current?.phase === 'details'))) return;
    let cancelled = false;
    void loader.current?.getIndex().then(index => { if (!cancelled) setWordlistIndex(index); })
      .catch(reason => { if (!cancelled) setNotice({ text: reason instanceof Error ? reason.message : '词表索引加载失败。', error: true }); });
    return () => { cancelled = true; };
  }, [wordlistIndex, loading, page, active, current?.phase]);

  useEffect(() => {
    if (!snapshot?.settings.autoSpeak) cancelSpeech();
  }, [snapshot?.settings.autoSpeak]);
  useEffect(() => {
    if (!snapshot || error) return;
    const refresh = () => { void run({ type: 'tick', startIfReady: active }); };
    const delay = Math.max(20, Math.min(60_000, nextWakeAt(snapshot, Date.now()) - Date.now()));
    const timer = window.setTimeout(refresh, delay);
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [snapshot, active, error, run]);

  useLayoutEffect(() => { startedAt.current = performance.now(); }, [current?.id, active]);
  useLayoutEffect(() => {
    if (active) { headingRef.current?.focus({ preventScroll: true }); if (scrollRef.current) scrollRef.current.scrollTop = 0; }
  }, [current?.id, current?.phase, active]);

  const pronounce = useCallback(() => {
    if (!question) return;
    setSpeechNotice('');
    speak(question.word.word, result => {
      if (result === 'failed') setSpeechNotice('浏览器未能朗读，可点击发音重试。');
      if (result === 'unsupported') setSpeechNotice('此浏览器未提供朗读功能。');
    }, snapshot?.settings.accent);
  }, [question, snapshot?.settings.accent]);
  useEffect(() => {
    if (active && current && question && lastSpoken.current !== current.id) {
      lastSpoken.current = current.id; setSpeechNotice('');
      if (snapshot?.settings.autoSpeak && !current.answer) pronounce();
    }
  }, [active, current, question, snapshot?.settings.autoSpeak, pronounce]);

  const answer = useCallback((selectedId: string | null) => {
    if (current) void run({ type: 'answer', presentationId: current.id, selectedId, elapsedMs: performance.now() - startedAt.current });
  }, [current, run]);
  const action = useCallback((type: 'next' | 'details' | 'slash') => { if (current) void run({ type, presentationId: current.id }); }, [current, run]);
  const continueCard = useCallback(() => {
    if (!current) return;
    if (current.phase === 'recognise') answer(null);
    else if (current.phase === 'feedback' && (current.answer?.rating === 'Again' || current.answer?.rating === 'Hard')) action('details');
    else action('next');
  }, [current, answer, action]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active || !question || busy || error || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target.tagName) ||
        (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type)))) return;
      const key = event.key.toLowerCase();
      if (key === 'r') { event.preventDefault(); pronounce(); }
      else if (key === 'x') { event.preventDefault(); action('slash'); }
      else if (current?.phase === 'recognise' && /^[0-4]$/.test(key)) {
        const selected = key === '0' ? null : question.options[Number(key) - 1]?.id;
        if (selected !== undefined) { event.preventDefault(); answer(selected); }
      } else if ((event.code === 'Space' || key === 'enter') && current?.phase !== 'recognise') {
        if (target instanceof HTMLElement && target.closest('button, input, a')) return;
        event.preventDefault(); continueCard();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, current, question, busy, error, pronounce, action, answer, continueCard]);

  const begin = async () => { if (await run({ type: 'start' })) setActive(true); };
  const exit = () => navigate('home');
  const progress = snapshot ? queueProgress(snapshot, now) : { current: 0, total: 0 };
  const ratingText = current?.answer ? `${current.answer.rating} · ${formatDue(current.answer.dueAt, now)}` : '';
  const undo = snapshot?.settings.daily?.undo;
  const waiting = snapshot ? waitingSummary(snapshot, now) : { count: 0, minutes: 0 };
  const ready = snapshot ? readyQueue(snapshot, now).length > 0 : false;
  const bookmarked = snapshot?.cards.find(card => card.wordId === current?.wordId)?.bookmarked ?? false;
  const wordTags = question ? WORDLISTS.filter(list => wordlistIndex ? membershipLists(wordlistIndex, question.word.id).includes(list.id)
    : catalog[list.id]?.some(word => word.id === question.word.id)).map(list => list.label).join(' · ') : '';

  return <main className={`app-shell${!loading && !error && snapshot ? active && question ? ' study-shell' : !active ? ' home-shell' : '' : ''}`} aria-busy={busy}>
    {loading ? <section className="welcome" aria-busy="true"><p className="welcome-label">CET4</p><h1>正在准备词卡</h1></section>
      : error || !snapshot ? <section className="welcome"><h1>暂时无法继续</h1><p role="alert">{error || '本地数据未就绪。'}</p><button className="primary-button" onClick={() => setRetry(value => value + 1)}>重新加载</button></section>
      : !active ? <>
        {page === 'home' ? <Home snapshot={snapshot} words={words} now={now} onStart={() => void begin()} busy={busy} onWordlists={() => navigate('wordlists')}
          onWordbook={tab => { setWordbookTab(tab); navigate('wordbook'); }} onExport={() => void exportData()}
          updateAvailable={updateAvailable} onUpdate={applyPwaUpdate} />
          : page === 'wordbook' ? <Wordbook snapshot={snapshot} tab={wordbookTab} onTab={setWordbookTab} busy={busy}
            onRemove={(wordId, tab) => { void run(tab === 'slashed' ? { type: 'unslash', wordId } : { type: 'bookmark', wordId, value: false }); }} />
          : page === 'stats' ? <Stats snapshot={snapshot} now={now} />
          : page === 'settings' ? <Settings settings={snapshot.settings} now={now} busy={busy} onChange={value => { void run({ type: 'preferences', value }); }} onExport={() => void exportData()} onImport={file => void readImport(file)}
            sync={<SyncSettings view={syncView} onEnabled={async enabled => { await sync.current?.configure({ enabled }); }} onToken={async token => { await sync.current?.configure({ token }); }}
              onTest={async () => { await sync.current?.test(); }} onSync={async () => { await sync.current?.sync(); }} />} />
          : <Wordlists selected={snapshot.settings.selectedWordlists} index={wordlistIndex} busy={busy} onBack={exit} onSave={ids => { void run({ type: 'preferences', value: { ...preferences(snapshot.settings), selectedWordlists: ids } }).then(saved => { if (saved) navigate('home'); }); }} />}
        {page !== 'wordlists' && <Navigation page={page} onNavigate={navigate} />}
      </>
      : !question || !current ? <section className="welcome"><p className="welcome-label">今日学习</p><h1>{ready ? '今天的队列已更新。' : waiting.count ? '这一轮先到这里。' : '今天的队列完成了。'}</h1><p>{ready ? '继续今天的学习。' : waiting.count ? `还有 ${waiting.count} 个词将在 ${waiting.minutes} 分钟后到期` : `已完成 ${snapshot.settings.daily?.completed ?? 0} 次学习`}</p><button className="primary-button" onClick={ready ? () => void begin() : exit}>{ready ? '继续学习' : '返回首页'}</button></section>
      : <>
        <StudyHeader current={progress.current} total={progress.total} onExit={exit} onSlash={() => action('slash')} />
        {current.phase === 'details' && current.answer ? <>
          <DetailContent word={question.word} onSpeak={pronounce} headingRef={headingRef} scrollRef={scrollRef} tags={wordTags} />
          <DetailFooter ratingText={ratingText} onNext={() => action('next')} bookmarked={bookmarked} busy={busy}
            onBookmark={() => { void run({ type: 'bookmark', wordId: question.word.id, value: !bookmarked }); }} />
        </> : <>
          <QuizCard question={question} answer={current.answer} onAnswer={answer} onSpeak={pronounce} headingRef={headingRef} scrollRef={scrollRef} status={current.kind === 'new' ? '新词' : `复习 · 第 ${current.reviewNumber} 次`} />
          <FeedbackFooter answer={current.answer} onContinue={continueCard} onDetails={() => action('details')} canAnswer={!busy && question.options.length === 4} ratingText={ratingText} />
        </>}
      </>}
    {speechNotice && active && <div className="speech-notice" role="status">{speechNotice}</div>}
    {undo && undo.expiresAt > now && !error && <UndoToast onUndo={() => void run({ type: 'undo', expiresAt: undo.expiresAt })} />}
    {notice && <div className="page-notice" role={notice.error ? 'alert' : 'status'}><p>{notice.text}</p><button aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></div>}
    {pendingImport && <ImportConfirmation fileName={pendingImport.name} cards={pendingImport.cards} logs={pendingImport.logs} busy={busy} onCancel={() => setPendingImport(null)} onConfirm={() => void confirmImport()} />}
  </main>;
}
