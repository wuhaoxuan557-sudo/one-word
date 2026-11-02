import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Question, Snapshot, Word } from './types';
import type { StudyAction } from './core/session';
import { nextWakeAt, queueProgress, readyQueue, waitingSummary } from './core/queue';
import { formatDue } from './core/scheduler';
import { parseWordlist, sortByFrequency } from './core/wordlist';
import { createStudyStore } from './storage/database';
import type { StudyStore } from './storage/database';
import { speak, cancelSpeech } from './speech';
import { Home } from './components/Home';
import { DetailContent, DetailFooter, FeedbackFooter, QuizCard, StudyHeader, UndoToast } from './components/Study';

export default function App() {
  const [words, setWords] = useState<Word[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [now, setNow] = useState(Date.now);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(false);
  const [speechNotice, setSpeechNotice] = useState('');
  const store = useRef<StudyStore | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);
  const lastSpoken = useRef('');
  const current = snapshot?.settings.daily?.current;
  const byId = useMemo(() => new Map(words.map(word => [word.id, word])), [words]);
  const question = useMemo<Question | null>(() => {
    const word = current && byId.get(current.wordId);
    return word && current ? { word, options: current.optionIds.flatMap(id => byId.get(id) ?? []) } : null;
  }, [current, byId]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let opened: StudyStore | null = null;
    setLoading(true); setError('');
    fetch(`${import.meta.env.BASE_URL}wordlists/cet4.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(`词表加载失败（${response.status}）。`); return response.json() as Promise<unknown>; })
      .then(async data => {
        if (controller.signal.aborted) return;
        const loaded = sortByFrequency(parseWordlist(data));
        opened = createStudyStore(loaded);
        const saved = await opened.load();
        if (controller.signal.aborted) { opened.db.close(); return; }
        store.current = opened; setWords(loaded); setSnapshot(saved); setNow(Date.now());
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法打开本地学习数据。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    void navigator.storage?.persist?.().catch(() => false);
    return () => { mounted.current = false; controller.abort(); opened?.db.close(); store.current = null; cancelSpeech(); };
  }, [retry]);

  const run = useCallback(async (action: StudyAction) => {
    if (!store.current || locked.current) return null;
    locked.current = true; setBusy(true);
    try {
      const time = Date.now();
      const saved = await store.current.transact(action, time);
      if (mounted.current) { setSnapshot(saved); setNow(time); setError(''); }
      return saved;
    } catch (reason) {
      if (mounted.current) setError(`学习进度未保存，请重试：${reason instanceof Error ? reason.message : '本地数据库错误'}`);
      return null;
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }, []);

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
  const exit = () => { cancelSpeech(); setActive(false); setSpeechNotice(''); };
  const progress = snapshot ? queueProgress(snapshot, now) : { current: 0, total: 0 };
  const ratingText = current?.answer ? `${current.answer.rating} · ${formatDue(current.answer.dueAt, now)}` : '';
  const undo = snapshot?.settings.daily?.undo;
  const waiting = snapshot ? waitingSummary(snapshot, now) : { count: 0, minutes: 0 };
  const ready = snapshot ? readyQueue(snapshot, now).length > 0 : false;

  return <main className={`app-shell${!loading && !error && snapshot ? active && question ? ' study-shell' : !active ? ' home-shell' : '' : ''}`} aria-busy={busy}>
    {loading ? <section className="welcome" aria-busy="true"><p className="welcome-label">CET4</p><h1>正在准备词卡</h1></section>
      : error || !snapshot ? <section className="welcome"><h1>暂时无法继续</h1><p role="alert">{error || '本地数据未就绪。'}</p><button className="primary-button" onClick={() => setRetry(value => value + 1)}>重新加载</button></section>
      : !active ? <Home snapshot={snapshot} words={words} now={now} onStart={() => void begin()} busy={busy} />
      : !question || !current ? <section className="welcome"><p className="welcome-label">今日学习</p><h1>{ready ? '今天的队列已更新。' : waiting.count ? '这一轮先到这里。' : '今天的队列完成了。'}</h1><p>{ready ? '继续今天的学习。' : waiting.count ? `还有 ${waiting.count} 个词将在 ${waiting.minutes} 分钟后到期` : `已完成 ${snapshot.settings.daily?.completed ?? 0} 次学习`}</p><button className="primary-button" onClick={ready ? () => void begin() : exit}>{ready ? '继续学习' : '返回首页'}</button></section>
      : <>
        <StudyHeader current={progress.current} total={progress.total} onExit={exit} onSlash={() => action('slash')} />
        {current.phase === 'details' && current.answer ? <>
          <DetailContent word={question.word} onSpeak={pronounce} headingRef={headingRef} scrollRef={scrollRef} />
          <DetailFooter ratingText={ratingText} onNext={() => action('next')} />
        </> : <>
          <QuizCard question={question} answer={current.answer} onAnswer={answer} onSpeak={pronounce} headingRef={headingRef} scrollRef={scrollRef} status={current.kind === 'new' ? '新词' : `复习 · 第 ${current.reviewNumber} 次`} />
          <FeedbackFooter answer={current.answer} onContinue={continueCard} onDetails={() => action('details')} canAnswer={!busy && question.options.length === 4} ratingText={ratingText} />
        </>}
      </>}
    {speechNotice && active && <div className="speech-notice" role="status">{speechNotice}</div>}
    {undo && undo.expiresAt > now && !error && <UndoToast onUndo={() => void run({ type: 'undo', expiresAt: undo.expiresAt })} />}
  </main>;
}
