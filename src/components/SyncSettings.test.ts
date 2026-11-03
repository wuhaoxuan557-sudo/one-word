import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SyncSettings } from './SyncSettings';
import { defaultSyncConfig } from '../storage/sync';

it('renders a disabled-by-default sync section, password field and Beijing-time label', () => {
  const html = renderToStaticMarkup(createElement(SyncSettings, { view: { ...defaultSyncConfig(), busy: false },
    onEnabled: async () => {}, onToken: async () => {}, onTest: async () => {}, onSync: async () => {} }));
  expect(html).toContain('type="password"'); expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('计日时区：北京时间'); expect(html).toContain('尚未同步'); expect(html).not.toContain('<select');
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});
