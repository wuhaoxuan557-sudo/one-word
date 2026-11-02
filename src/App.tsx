import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Word } from './types';
import { practiceReducer } from './core/session';
import { prepareChoicePool } from './core/choices';
import { parseWordlist, sortByFrequency } from './core/wordlist';
import { speak, cancelSpeech } from './speech';
import { DetailContent, DetailFooter, FeedbackFooter, QuizCard, StudyHeader, UndoToast } from './components/Study';

export default function App() {
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speechNotice, setSpeechNotice] = useState('');
  const choicePool = useMemo(() => prepareChoicePool(words), [words]);
  const [practice, dispatch] = useReducer((state: Parameters<typeof practiceReducer>[0], action: Parameters<typeof practiceReducer>[1]) => practiceReducer(state, action, words, choicePool), null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);
  const lastSpoken = useRef('');
  const slashToken = useRef(0);
  const question = practice?.question;
  const presentationKey = question ? `${practice.seed}:${question.word.id}` : '';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`${import.meta.env.BASE_URL}wordlists/cet4.json`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`词表加载失败（${response.status}），请重新构建 CET4 词表。`);
        return response.json() as Promise<unknown>;
      })
      .then(data => { if (!controller.signal.aborted) setWords(sortByFrequency(parseWordlist(data))); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '词表加载失败，请重试。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  useLayoutEffect(() => { startedAt.current = performance.now(); }, [presentationKey]);
  useLayoutEffect(() => {
    if (active) { headingRef.current?.focus({ preventScroll: true }); if (scrollRef.current) scrollRef.current.scrollTop = 0; }
  }, [presentationKey, practice?.phase, active]);

  const pronounce = useCallback(() => {
    if (!question) return;
    setSpeechNotice('');
    speak(question.word.word, result => {
      if (result === 'failed') setSpeechNotice('浏览器未能朗读，可点击发音重试。');
      if (result === 'unsupported') setSpeechNotice('此浏览器未提供朗读功能。');
    });
  }, [question]);

  useEffect(() => {
    if (active && question && lastSpoken.current !== presentationKey) {
      lastSpoken.current = presentationKey;
      setSpeechNotice('');
      if (autoSpeak) pronounce();
    }
  }, [active, question, presentationKey, autoSpeak, pronounce]);
  useEffect(() => () => cancelSpeech(), []);

  useEffect(() => {
    if (!practice?.undo) return;
    const { token, expiresAt } = practice.undo;
    const timer = window.setTimeout(() => dispatch({ type: 'expireUndo', token }), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [practice?.undo]);

  const answer = useCallback((selectedId: string | null) => {
    dispatch({ type: 'answer', selectedId, elapsedMs: performance.now() - startedAt.current, timestamp: Date.now() });
  }, []);
  const slash = useCallback(() => dispatch({ type: 'slash', now: Date.now(), token: ++slashToken.current }), []);
  const continueCard = useCallback(() => {
    if (!practice) return;
    if (practice.phase === 'recognise') answer(null);
    else if (practice.phase === 'feedback' && (practice.answer?.rating === 'Again' || practice.answer?.rating === 'Hard')) dispatch({ type: 'details' });
    else dispatch({ type: 'next' });
  }, [practice, answer]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active || !question || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target.tagName) ||
          (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type)))) return;
      const key = event.key.toLowerCase();
      if (key === 'r') { event.preventDefault(); pronounce(); }
      else if (key === 'x') { event.preventDefault(); slash(); }
      else if (practice?.phase === 'recognise' && /^[0-4]$/.test(key)) {
        const selected = key === '0' ? null : question.options[Number(key) - 1]?.id;
        if (selected !== undefined) { event.preventDefault(); answer(selected); }
      } else if ((event.code === 'Space' || key === 'enter') && practice?.phase !== 'recognise') {
        // Preserve native activation of focused controls, including exit and undo.
        if (target instanceof HTMLElement && target.closest('button, input, a')) return;
        event.preventDefault(); continueCard();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, practice, question, pronounce, slash, answer, continueCard]);

  const begin = () => { dispatch({ type: 'start', seed: Math.floor(Math.random() * 4294967296) }); setActive(true); };
  const exit = () => { cancelSpeech(); setActive(false); };
  const current = practice ? practice.total - practice.remainingIds.length + (question ? 1 : 0) : 0;

  return <main className={`app-shell${active && question ? ' study-shell' : ''}`}>
    {loading ? <section className="welcome" aria-busy="true"><p className="welcome-label">CET4</p><h1>正在准备词卡</h1></section>
      : error ? <section className="welcome"><h1>词表未就绪</h1><p role="alert">{error}</p><button className="primary-button" onClick={() => setRetry(value => value + 1)}>重新加载</button></section>
      : !active ? <section className="welcome">
        <p className="welcome-label">CET4 · {words.length.toLocaleString('zh-CN')} 词</p><h1>一次，一个词。</h1><p className="welcome-description">选出释义，再看详情。</p>
        <label className="auto-speech"><input type="checkbox" checked={autoSpeak} onChange={event => setAutoSpeak(event.target.checked)} />出词时自动朗读</label>
        <button className="primary-button" onClick={practice?.question ? () => setActive(true) : begin}>{practice?.question ? '继续学习' : '开始学习'}</button>
        <p className="session-note">本次进度保留在当前页面，刷新后重置。</p>
      </section>
      : !question || !practice ? <section className="welcome"><p className="welcome-label">本轮完成</p><h1>这一轮，记住了。</h1><p>已作答 {practice?.logs.length ?? 0} 词 · 已斩 {practice?.slashedIds.length ?? 0} 词</p><button className="primary-button" onClick={begin}>再练一轮</button><button className="text-button" onClick={exit}>返回</button></section>
      : <>
        <StudyHeader current={current} total={practice.total} onExit={exit} onSlash={slash} />
        {practice.phase === 'details' && practice.answer ? <>
          <DetailContent word={question.word} onSpeak={pronounce} headingRef={headingRef} scrollRef={scrollRef} />
          <DetailFooter answer={practice.answer} onNext={() => dispatch({ type: 'next' })} />
        </> : <>
          <QuizCard question={question} answer={practice.answer} onAnswer={answer} onSpeak={pronounce} headingRef={headingRef} scrollRef={scrollRef} />
          <FeedbackFooter answer={practice.answer} onContinue={continueCard} onDetails={() => dispatch({ type: 'details' })} canAnswer={question.options.length === 4} />
        </>}
      </>}
    {speechNotice && active && <div className="speech-notice" role="status">{speechNotice}</div>}
    {practice?.undo && <UndoToast onUndo={() => dispatch({ type: 'undo', now: Date.now() })} />}
  </main>;
}
