import { expect, it } from 'vitest';
import { parseExchange } from './exchange';

it('parses all required forms, retaining irregular or comma-separated variants', () => {
  expect(parseExchange('p:went/d:gone/i:going/3:goes/s:children/r:better/t:best/0:go')).toEqual([
    { label: '过去式', value: 'went' }, { label: '过去分词', value: 'gone' },
    { label: '现在分词', value: 'going' }, { label: '第三人称单数', value: 'goes' },
    { label: '复数', value: 'children' }, { label: '比较级', value: 'better' },
    { label: '最高级', value: 'best' }, { label: '原形', value: 'go' },
  ]);
  expect(parseExchange('p:learned,learnt')).toEqual([{ label: '过去式', value: 'learned,learnt' }]);
});

it('ignores relation metadata, unknown keys, malformed, empty and duplicate forms', () => {
  expect(parseExchange('1:s/xyz:other/broken/s:/p:went/p:gone')).toEqual([{ label: '过去式', value: 'went' }]);
  expect(parseExchange('')).toEqual([]);
});
