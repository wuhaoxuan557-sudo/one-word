import type { RefObject } from 'react';
import type { Answer, Question, Word } from '../types';
import { parseExchange } from '../core/exchange';
import { formatDetailTranslation, formatOptionTranslation } from '../core/translation';

type IconName = 'sound' | 'close' | 'bookmark' | 'check' | 'wrong';
export function Icon({ name }: { name: IconName }) {
  return <svg className={`icon icon-${name}`} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'check' || name === 'wrong' ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
    {name === 'sound' ? <><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>
      : name === 'bookmark' ? <path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      : name === 'check' ? <path d="m5 12.5 4.5 4.5L19 7" /> : <path d="m6 6 12 12M18 6 6 18" />}
  </svg>;
}

export function StudyHeader({ current, total, onExit, onSlash }: { current: number; total: number; onExit: () => void; onSlash: () => void }) {
  return <header className="study-header">
    <button className="exit-button" onClick={onExit} aria-label="退出学习"><Icon name="close" /></button>
    <div className="study-progress">
      <div className="progress-track" role="progressbar" aria-label="本轮词表进度" aria-valuemin={0} aria-valuemax={total} aria-valuenow={current}><span style={{ width: `${total ? current / total * 100 : 0}%` }} /></div>
      <p className="progress-caption">{current} / {total}</p>
    </div>
    <button className="seal" onClick={onSlash} aria-label="斩：标记为已掌握，不再出现">斩</button>
  </header>;
}

export function Pronunciation({ word, onSpeak, detail = false }: { word: Word; onSpeak: () => void; detail?: boolean }) {
  return <button className={`pronunciation${detail ? ' pronunciation-detail' : ''}`} onClick={onSpeak} aria-label={`重播 ${word.word} 发音`}>
    <Icon name="sound" /><span lang="en">{word.phonetic ? `/${word.phonetic.replace(/^\/|\/$/g, '')}/` : '播放发音'}</span>
  </button>;
}

interface CardProps {
  question: Question;
  answer: Answer | null;
  onAnswer: (id: string | null) => void;
  onSpeak: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
}

export function QuizCard({ question, answer, onAnswer, onSpeak, headingRef, scrollRef }: CardProps) {
  return <div className="quiz-body" ref={scrollRef}>
    <section className="word-stage" aria-label="当前单词">
      <p className="word-status">新词</p>
      <h1 className="quiz-word" ref={headingRef} tabIndex={-1} lang="en">{question.word.word}</h1>
      <Pronunciation word={question.word} onSpeak={onSpeak} />
    </section>
    {question.options.length === 4 ? <section className="options" aria-label="选择正确释义">
      {question.options.map((option, index) => {
        const correct = answer !== null && option.id === question.word.id;
        const wrong = answer !== null && option.id === answer.selectedId && !correct;
        const status = answer ? correct ? 'correct' : wrong ? 'wrong' : 'faded' : '';
        const translation = formatOptionTranslation(option.translation);
        return <button key={option.id} className={`option ${status}`} onClick={() => onAnswer(option.id)} disabled={answer !== null}
          aria-label={`选项 ${index + 1}：${translation}${correct ? '，正确答案' : wrong ? '，所选答案错误' : ''}`}>
          <span className="option-number">{index + 1}</span><span className="option-meaning">{translation}</span>
          {correct && <Icon name="check" />}{wrong && <Icon name="wrong" />}
        </button>;
      })}
    </section> : <p className="wordlist-error" role="alert">此词无法组成四个不重叠的选项，已保留当前单词。请补充词表后重新加载。</p>}
  </div>;
}

export function FeedbackFooter({ answer, onContinue, onDetails, canAnswer }: { answer: Answer | null; onContinue: () => void; onDetails: () => void; canAnswer: boolean }) {
  const fast = answer?.rating === 'Good' || answer?.rating === 'Easy';
  return <footer className="quiz-footer">
    {!answer ? <button className="unknown-button" disabled={!canAnswer} onClick={onContinue}>不认识</button> : <>
      <div className="result-row" role="status"><span className={answer.correct ? 'result-correct' : 'result-wrong'}>{answer.correct ? `答对了 · ${(answer.elapsedMs / 1000).toFixed(1)} 秒` : '选错了'}</span><span className="rating" aria-label={`评分 ${answer.rating}`}>{answer.rating}</span></div>
      <div className="feedback-actions"><button className="primary-button" onClick={onContinue}>{fast ? '下一个' : '看详情'}</button>{fast && <button className="text-button" onClick={onDetails}>看详情</button>}</div>
    </>}
  </footer>;
}

function DefinitionLine({ line }: { line: string }) {
  const match = /^(\s*[a-z]+\.)\s*(.*)$/i.exec(line);
  return <p className="chinese-definition">{match ? <><i className="part-of-speech">{match[1]}</i>{match[2]}</> : line}</p>;
}

export function DetailContent({ word, onSpeak, headingRef, scrollRef }: { word: Word; onSpeak: () => void; headingRef: RefObject<HTMLHeadingElement | null>; scrollRef: RefObject<HTMLDivElement | null> }) {
  const forms = parseExchange(word.exchange);
  return <div className="detail-content" ref={scrollRef} aria-label="单词详情">
    <div className="detail-word-block">
      <div className="detail-title-row"><h1 className="detail-word" lang="en" ref={headingRef} tabIndex={-1}>{word.word}</h1><p className="stars" role="img" aria-label={`柯林斯 ${word.collins} 星`}>{'★'.repeat(word.collins)}<span>{'★'.repeat(5 - word.collins)}</span></p></div>
      <div className="detail-pronunciation-row"><Pronunciation word={word} onSpeak={onSpeak} detail /><p className="word-tags">CET4</p></div>
    </div>
    <section className="definition-section"><h2>释义</h2><div>{formatDetailTranslation(word.translationFull || '暂无中文释义').split('\n').map((line, index) => <DefinitionLine key={index} line={line} />)}</div></section>
    <section className="definition-section"><h2>英文释义</h2><p className="english-definition" lang="en">{word.definition || '暂无英文释义'}</p></section>
    <section className="definition-section forms-section"><h2>词形变化</h2>{forms.length ? <dl className="word-forms">{forms.map(form => <div key={form.label}><dt>{form.label}</dt><dd lang="en">{form.value}</dd></div>)}</dl> : <p className="empty-forms">暂无词形变化</p>}</section>
  </div>;
}

export function DetailFooter({ answer, onNext }: { answer: Answer; onNext: () => void }) {
  return <footer className="detail-footer"><p className="detail-rating" aria-label={`评分 ${answer.rating}`}>{answer.rating}</p><div className="detail-actions">
    <button className="bookmark-button" disabled aria-label="生词本（稍后推出）"><Icon name="bookmark" /></button>
    <button className="primary-button" onClick={onNext}>下一个</button>
  </div></footer>;
}

export function UndoToast({ onUndo }: { onUndo: () => void }) {
  return <div className="undo-toast" role="status"><span>已斩 ·</span><button onClick={onUndo}>撤销</button></div>;
}
