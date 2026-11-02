import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Wordbook } from './Wordbook';
import { freshSnapshot, studyTime as now } from '../core/study.test-helper';
import { emptyCard } from '../core/scheduler';

it.each(['bookmarked', 'slashed'] as const)('renders %s entries from unselected lists without a wordlist prop', tab => {
  const snapshot = freshSnapshot(); snapshot.settings.selectedWordlists = ['cet4'];
  snapshot.cards = [{ ...emptyCard('ecdict:abnegation', now), [tab]: true,
    wordSnapshot: { word: 'abnegation', translation: 'n. 否认；放弃；自制' } }];
  const html = renderToStaticMarkup(createElement(Wordbook, { snapshot, tab, busy: false, onTab: () => {}, onRemove: () => {} }));
  expect(html).toContain('abnegation'); expect(html).toContain('n. 否认；放弃；自制');
  expect(html).toContain(tab === 'slashed' ? '撤销斩 abnegation' : '移出生词本 abnegation');
});
