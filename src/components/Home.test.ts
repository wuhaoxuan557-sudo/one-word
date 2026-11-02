import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Home } from './Home';
import { freshSnapshot, studyTime as now, studyWords as words } from '../core/study.test-helper';

it('shows the backup reminder only after fourteen days and clears it after export', () => {
  const snapshot = freshSnapshot();
  const render = (time: number) => renderToStaticMarkup(createElement(Home, {
    snapshot, words, now: time, busy: false, onStart: () => {}, onWordlists: () => {}, onWordbook: () => {}, onExport: () => {},
  }));
  expect(render(now + 14 * 86_400_000)).not.toContain('尚未备份');
  expect(render(now + 14 * 86_400_000 + 1)).toContain('尚未备份');
  snapshot.settings.lastExportAt = now + 14 * 86_400_000;
  expect(render(now + 14 * 86_400_000 + 1)).not.toContain('距上次备份');
  expect(render(now + 29 * 86_400_000)).toContain('距上次备份已');
});
