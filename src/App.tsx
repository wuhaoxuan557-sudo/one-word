import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Word } from './types';
import { nextQuestion } from './core/choices';
import { parseExchange } from './core/exchange';
import { recordAnswer } from './core/session';
import type { PracticeState } from './core/session';
import { parseWordlist, sortByFrequency } from './core/wordlist';
import { speak } from './speech';
import type { SpeechResult } from './speech';

const FAST_CORRECT_MS = 6000;

function SoundIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m11 4-6 5H2v6h3l6 5V4Z" strokeLinejoin="round" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" strokeLinecap="round" /></svg>;
}

export default function App() {
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [practice, setPractice] = useState<PracticeState | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speechResult, setSpeechResult] = useState<SpeechResult | null>(null);
  const startedAt = useRef(0);
  const lastSpoken = useRef('');
  const heading = useRef<HTMLHeadingElement>(null);
  const question = practice?.question;
  const currentId = question?.word.id;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`${import.meta.env.BASE_URL}wordlists/cet4.json`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`词表加载失败（${response.status}），请检查 public/wordlists/cet4.json。`);
        return response.json() as Promise<unknown>;
      })
      .then(data => { if (!controller.signal.aborted) setWords(sortByFrequency(parseWordlist(data))); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '词表加载失败，请重试。');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  useLayoutEffect(() => {
    startedAt.current = performance.now();
    if (currentId) heading.current?.focus();
  }, [currentId]);

  const pronounce = useCallback((word: string) => {
    setSpeechResult(null);
    speak(word, setSpeechResult);
  }, []);

  useEffect(() => {
    if (question && lastSpoken.current !== question.word.id) {
      lastSpoken.current = question.word.id;
      setSpeechResult(null);
      if (autoSpeak) pronounce(question.word.word);
    }
  }, [question, autoSpeak, pronounce]);

  useEffect(() => () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const begin = () => {
    const slashedIds = practice?.slashedIds ?? [];
    const next = nextQuestion(words, 0);
    // Continue to honour words slashed earlier in this page's lifetime.
    let available = next;
    while (available.question && slashedIds.includes(available.question.word.id)) {
      const following = nextQuestion(words, available.cursor + 1);
      available = { ...following, skipped: available.skipped + following.skipped };
    }
    lastSpoken.current = available.question?.word.id ?? '';
    if (autoSpeak && available.question) pronounce(available.question.word.word);
    setPractice({ ...available, phase: 'recognise', answer: null, logs: [], slashedIds });
  };

  const answer = useCallback((selectedId: string | null) => {
    const now = performance.now();
    const timestamp = Date.now();
    setPractice(previous => previous ? recordAnswer(previous, selectedId, startedAt.current, now, timestamp) : previous);
  }, []);

  const details = useCallback(() => {
    setPractice(previous => previous?.phase === 'feedback' ? { ...previous, phase: 'details' } : previous);
  }, []);

  const advance = useCallback((slash = false) => {
    setPractice(previous => {
      if (!previous?.question) return previous;
      const fastCorrect = previous.answer?.correct && previous.answer.elapsedMs <= FAST_CORRECT_MS;
      if (slash ? previous.phase !== 'recognise' : previous.phase !== 'details' && !(previous.phase === 'feedback' && fastCorrect)) return previous;
      const slashedIds = slash ? [...previous.slashedIds, previous.question.word.id] : previous.slashedIds;
      let next = nextQuestion(words, previous.cursor + 1);
      while (next.question && slashedIds.includes(next.question.word.id)) {
        const following = nextQuestion(words, next.cursor + 1);
        next = { ...following, skipped: next.skipped + following.skipped };
      }
      return { ...previous, ...next, skipped: previous.skipped + next.skipped, phase: 'recognise', answer: null, slashedIds };
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [words]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (!practice?.question) return;
      const key = event.key.toLowerCase();
      if (key === 'r') { event.preventDefault(); pronounce(practice.question.word.word); }
      if (practice.phase === 'recognise') {
        const index = Number(key) - 1;
        if (/^[1-4]$/.test(key)) {
          const option = practice.question.options[index];
          if (option) { event.preventDefault(); answer(option.id); }
        }
        if (key === '0') { event.preventDefault(); answer(null); }
        if (key === 'x') { event.preventDefault(); advance(true); }
      } else if (event.code === 'Space') {
        event.preventDefault();
        if (practice.phase === 'feedback' && !(practice.answer?.correct && practice.answer.elapsedMs <= FAST_CORRECT_MS)) details();
        else advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [practice, pronounce, answer, advance, details]);

  const correct = practice?.logs.filter(log => log.correct).length ?? 0;
  const completed = practice?.logs.length ?? 0;
  const result = practice?.answer;
  const isFastCorrect = Boolean(result?.correct && result.elapsedMs <= FAST_CORRECT_MS);
  const forms = question ? parseExchange(question.word.exchange) : [];
  const progress = practice ? Math.min(100, (practice.cursor / Math.max(1, words.length)) * 100) : 0;

  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="./" aria-label="一词首页"><span className="brand-mark">一</span><span>一词<span className="brand-caption">ONE AT A TIME</span></span></a>
      <span className="list-badge"><span className="status-dot" />CET4 词表</span>
    </header>

    {loading ? <main className="welcome" aria-busy="true"><span className="eyebrow">准备词卡</span><h1>稍等，正在载入词表。</h1></main>
      : error ? <main className="welcome"><span className="eyebrow">词表未就绪</span><h1>还差一步。</h1><p role="alert">{error}</p><button className="button primary" onClick={() => setRetry(value => value + 1)}>重新加载</button><p className="muted">也可以先运行 python scripts/build_wordlist.py，再刷新页面。</p></main>
      : !practice ? <main className="welcome">
        <span className="eyebrow">一点一点，记得更牢</span>
        <h1>把注意力，<br />留给眼前这个词。</h1>
        <p className="welcome-copy">先选释义，再看讲解。<br />认识的词，轻轻一斩。</p>
        <div className="list-summary"><span className="list-monogram">Aa</span><div><strong>大学英语四级</strong><span>{words.length.toLocaleString('zh-CN')} 个词 · ECDICT 词库</span></div><span className="list-arrow" aria-hidden="true">↗</span></div>
        <button className="button primary start-button" onClick={begin}>开始练习 <span aria-hidden="true">→</span></button>
        <p className="session-note">本次进度仅保留在当前页面，刷新后重置。</p>
      </main>
      : !question ? <main className="welcome completion">
        <span className="eyebrow">这一轮，到这里</span><h1>可用词卡已练完。</h1>
        <div className="completion-stats"><div><strong>{completed}</strong><span>已作答</span></div><div><strong>{correct}</strong><span>答对</span></div><div><strong>{practice.slashedIds.length}</strong><span>已斩</span></div></div>
        {practice.skipped > 0 && <p className="muted">有 {practice.skipped} 个词未能组成四个合规选项，已跳过。</p>}
        <button className="button primary start-button" onClick={begin}>再练一轮 <span aria-hidden="true">↻</span></button>
        <p className="session-note">当前页面内已斩的词不会再次出现。</p>
      </main>
      : <main className="practice" aria-label="单词练习">
        <div className="session-strip"><span>本次练习 <strong>{completed}</strong><span className="strip-divider">/</span>已斩 <strong>{practice.slashedIds.length}</strong></span><label className="auto-speech"><input type="checkbox" checked={autoSpeak} onChange={event => setAutoSpeak(event.target.checked)} /><span>自动发音</span></label></div>
        <div className="progress-track" role="progressbar" aria-label="词表进度" aria-valuemin={0} aria-valuemax={words.length} aria-valuenow={practice.cursor}><span style={{ width: `${progress}%` }} /></div>

        <section className="word-stage" aria-label="当前单词">
          <span className="eyebrow">{practice.phase === 'recognise' ? '选出它的中文释义' : practice.phase === 'feedback' ? '这一次，你记住了吗' : '多看一眼，记得更清楚'}</span>
          <h1 ref={heading} tabIndex={-1} className="word" lang="en">{question.word.word}</h1>
          <div className="pronunciation"><span lang="en">{question.word.phonetic ? `/${question.word.phonetic.replace(/^\/|\/$/g, '')}/` : '暂无音标'}</span><button className="sound-button" onClick={() => pronounce(question.word.word)} aria-label={`重播 ${question.word.word} 发音`} title="重播发音（R）"><SoundIcon /></button></div>
          {(speechResult === 'unavailable' || speechResult === 'blocked') && <p className="speech-notice" role="status">{speechResult === 'unavailable' ? '当前浏览器不支持朗读。' : '未能播放发音，可点击喇叭重试。'}</p>}
        </section>

        {practice.phase !== 'details' ? <>
          <div className="options" aria-label="中文释义选项">
            {question.options.map((option, index) => {
              const revealed = practice.phase === 'feedback';
              const isRight = option.id === question.word.id;
              const isChosen = result?.selectedId === option.id;
              const state = revealed ? isRight ? 'correct' : isChosen ? 'wrong' : 'dimmed' : '';
              return <button key={option.id} className={`option ${state}`} disabled={revealed} onClick={() => answer(option.id)} aria-label={`选项 ${index + 1}：${option.translation}${revealed && isRight ? '，正确答案' : revealed && isChosen ? '，所选答案错误' : ''}`}>
                <span className="option-number">{revealed && isRight ? '✓' : revealed && isChosen ? '×' : index + 1}</span><span className="option-meaning">{option.translation}</span>
              </button>;
            })}
          </div>
          {practice.phase === 'recognise' ? <div className="card-actions"><button className="button quiet" onClick={() => answer(null)}>不认识 <kbd>0</kbd></button><button className="button slash" onClick={() => advance(true)}><span aria-hidden="true">╱</span> 斩 · 已认识 <kbd>X</kbd></button></div>
            : <section className="feedback-panel" aria-live="polite">
              <div className={`feedback-copy ${result?.correct ? 'success' : 'incorrect'}`}><strong>{result?.correct ? '答对了，继续保持。' : '没关系，再认识一次。'}</strong><span>{result ? (result.elapsedMs / 1000).toFixed(1) : '0.0'} 秒{result?.selectedId === null ? ' · 选择了不认识' : ''}</span></div>
              <div className="feedback-actions"><button className="button primary" onClick={details}>查看详情 <span aria-hidden="true">↓</span></button>{isFastCorrect && <button className="button quiet" onClick={() => advance()}>跳过详情 <span aria-hidden="true">→</span></button>}</div>
            </section>}
        </> : <section className="details" aria-label="单词详情">
          <div className="definition-block"><h2>中文释义</h2><p className="full-translation">{question.word.translationFull || '暂无中文释义'}</p></div>
          <div className="definition-block"><h2>英文释义</h2><p className="english-definition" lang="en">{question.word.definition || '暂无英文释义'}</p></div>
          <div className="definition-block"><h2>词形变化</h2>{forms.length ? <dl className="word-forms">{forms.map(form => <div key={form.label}><dt>{form.label}</dt><dd lang="en">{form.value}</dd></div>)}</dl> : <p className="muted">暂无词形变化</p>}</div>
          <div className="collins-row"><span>柯林斯星级</span><span className="stars" aria-label={`柯林斯 ${question.word.collins} 星`}>{question.word.collins ? '★'.repeat(question.word.collins) + '☆'.repeat(5 - question.word.collins) : '暂无星级'}</span></div>
          <button className="button primary next-button" onClick={() => advance()}>下一个 <span aria-hidden="true">→</span></button>
        </section>}
        {practice.skipped > 0 && <p className="skip-note">已跳过 {practice.skipped} 个无法组成四个合规选项的词。</p>}
      </main>}

    <footer className="site-footer"><span>一次一个词。</span><span className="keyboard-help">1–4 选择 <i>·</i> 空格 继续 <i>·</i> X 斩 <i>·</i> R 发音</span><a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noreferrer">词库 ECDICT ↗</a></footer>
  </div>;
}
