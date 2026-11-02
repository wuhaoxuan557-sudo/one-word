import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FeedbackFooter } from './Study';
import type { Answer } from '../types';

it.each([
  [null, false, '没关系，记住它'],
  ['wrong', false, '选错了'],
  ['apple', true, '答对了 · 1.0 秒'],
] as const)('distinguishes the feedback for selectedId=%s', (selectedId, correct, text) => {
  const answer: Answer = { wordId: 'apple', selectedId, correct, elapsedMs: 1000, answeredAt: 0, rating: correct ? 'Easy' : 'Again' };
  const html = renderToStaticMarkup(createElement(FeedbackFooter, {
    answer, onContinue: () => {}, onDetails: () => {}, canAnswer: false, ratingText: `${answer.rating} · 1 分钟后`,
  }));
  expect(html).toContain(text);
  if (selectedId === null) expect(html).not.toContain('选错了');
});
