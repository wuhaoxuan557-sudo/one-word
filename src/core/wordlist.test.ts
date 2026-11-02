import { expect, it } from 'vitest';
import { parseWordlist, sortByFrequency } from './wordlist';
import { word } from './fixtures.test-helper';

it('loads generated fields without losing full definitions', () => {
  const item = word('test', { translationFull: '第一行\n第二行\n第三行\n第四行' });
  expect(parseWordlist([item])).toEqual([item]);
});

it('rejects broken or duplicate records with useful errors', () => {
  for (const value of [null, [], [null], [{}], [word('')], [word('x'), word('x')],
    [word('x', { frq: -1 })], [word('x', { collins: 6 })], [word('x', { oxford: 2 })],
    [word('x', { frq: NaN })], [word('x', { frq: 1.2 })]]) {
    expect(() => parseWordlist(value)).toThrow();
  }
});

it('orders known frequencies first, with zero/unknown last, without mutation', () => {
  const source = [word('z', { frq: 0 }), word('b', { frq: 10 }), word('a', { frq: 10 }), word('c', { frq: 1 })];
  expect(sortByFrequency(source).map(item => item.id)).toEqual(['c', 'a', 'b', 'z']);
  expect(source[0]?.id).toBe('z');
});
