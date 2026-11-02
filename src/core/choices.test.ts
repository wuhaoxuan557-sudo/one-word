import { describe, expect, it } from 'vitest';
import { generateOptions, meaningsOverlap, prepareChoicePool, primaryPos } from './choices';
import { word } from './fixtures.test-helper';

describe('primaryPos', () => {
  it('uses the largest ECDICT percentage and normalises aliases', () => {
    expect(primaryPos(word('fuse', { pos: 'n:46/v:54' }))).toBe('v');
    expect(primaryPos(word('quiet', { pos: 'j:92/n:8' }))).toBe('adj');
    expect(primaryPos(word('run', { pos: 'vi:100' }))).toBe('v');
  });
  it('falls back to a definition prefix, without inventing unknown POS', () => {
    expect(primaryPos(word('make', { pos: '', translation: 'vt. 制造' }))).toBe('v');
    expect(primaryPos(word('unknown', { pos: '', translation: '未知' }))).toBeNull();
  });
});

describe('meaningsOverlap', () => {
  it('rejects shared first senses, punctuation variants and substantial overlap', () => {
    expect(meaningsOverlap('n. 商店\nv. 储存', 'n. 商店\nv. 购物')).toBe(true);
    expect(meaningsOverlap('vt. 创造，制造', 'n. 制造; 生产')).toBe(true);
    expect(meaningsOverlap('v. 制造', 'v. 制造出来')).toBe(true);
    expect(meaningsOverlap('n. （正式）房子', 'n. 房子')).toBe(true);
  });
  it('allows distinct meanings and rejects empty meanings', () => {
    expect(meaningsOverlap('n. 苹果', 'n. 桌子')).toBe(false);
    expect(meaningsOverlap('', 'n. 桌子')).toBe(true);
  });
  it('compares displayed senses, ignoring later lines and senses beyond three', () => {
    expect(meaningsOverlap('n. 苹果, 水果, 果实, 桌子\nv. 摆放', 'n. 桌子\nv. 摆放')).toBe(false);
    expect(meaningsOverlap('n. 州, 状态, 情形, 国家', 'v. 情形, 说明')).toBe(true);
  });
  it('rejects identical shortened options even when hidden lines differ', () => {
    expect(meaningsOverlap('n. 苹果, 水果, 果实, 桌子\nv. 摆放', 'n. 苹果；水果；果实；河流\nv. 流动')).toBe(true);
  });
});

describe('generateOptions', () => {
  const target = word('apple', { translation: 'n. 苹果' });
  const pool = [target, word('table', { translation: 'n. 桌子', frq: 980 }), word('chair', { translation: 'n. 椅子', frq: 1050 }), word('river', { translation: 'n. 河流', frq: 1100 })];
  it('reuses a pure prepared index without changing results or inputs', () => {
    const before = structuredClone(pool);
    const index = prepareChoicePool(pool);
    expect(index.records).toHaveLength(pool.length);
    expect(generateOptions(target, index, () => 0.37)).toEqual(generateOptions(target, pool, () => 0.37));
    expect(generateOptions(target, index, () => 0.37)).toEqual(generateOptions(target, index, () => 0.37));
    expect(pool).toEqual(before);
  });
  it('has exactly one correct answer and three distinct comparable distractors', () => {
    const options = generateOptions(target, [...pool,
      word('verb', { pos: 'v:100', translation: 'v. 攀登' }),
      word('synonym', { translation: 'n. 苹果' }),
      word('rare', { frq: 90000, translation: 'n. 飞船' }),
      word('unknown-rank', { frq: 0, translation: 'n. 流星' }),
    ], () => 0.5);
    expect(options).toHaveLength(4);
    expect(new Set(options?.map(option => option.id))).toEqual(new Set(pool.map(option => option.id)));
    expect(options?.filter(option => option.id === target.id)).toHaveLength(1);
  });
  it('never pads small or ambiguous pools, nor mutates the source', () => {
    const before = [...pool];
    expect(generateOptions(target, pool.slice(0, 3))).toBeNull();
    expect(generateOptions(target, [target, ...pool.slice(1).map(item => ({ ...item, translation: 'n. 桌子' }))])).toBeNull();
    expect(generateOptions(word('mystery', { pos: '', translation: '未知' }), pool)).toHaveLength(4);
    expect(pool).toEqual(before);
  });
  it('deduplicates words case-insensitively and supports unknown-rank pools', () => {
    const unknown = pool.map(item => ({ ...item, frq: 0 }));
    const targetUnknown = unknown[0]!;
    expect(generateOptions(targetUnknown, unknown, () => 0)).toHaveLength(4);
    expect(generateOptions(target, [target, pool[1]!, { ...pool[1]!, id: 'duplicate', word: 'TABLE' }, pool[2]!])).toBeNull();
  });
  it('randomises the position of the correct choice', () => {
    expect(generateOptions(target, pool, () => 0)?.findIndex(item => item.id === target.id))
      .not.toBe(generateOptions(target, pool, () => 0.999)?.findIndex(item => item.id === target.id));
  });
  it('relaxes frequency before POS, keeping available close candidates', () => {
    const far = word('far', { translation: 'n. 河流', frq: 90000 });
    const options = generateOptions(target, [target, pool[1]!, pool[2]!, far,
      word('verb', { translation: 'v. 攀登', pos: 'v' })], () => 0.99)!;
    expect(new Set(options.map(item => item.id))).toEqual(new Set(['apple', 'table', 'chair', 'far']));
  });
  it('relaxes POS only when needed and never relaxes meaning separation', () => {
    const options = generateOptions(target, [target, pool[1]!,
      word('same-sense-far', { translation: 'n. 苹果', frq: 90000 }),
      word('same-sense-verb', { translation: 'v. 苹果', pos: 'v' }),
      word('climb', { translation: 'v. 攀登', pos: 'v', frq: 50000 }),
      word('blue', { translation: 'a. 蓝色的', pos: 'a', frq: 0 }),
    ], () => 0.99)!;
    expect(new Set(options.map(item => item.id))).toEqual(new Set(['apple', 'table', 'climb', 'blue']));
    for (let a = 0; a < options.length; a++) for (let b = a + 1; b < options.length; b++) {
      expect(meaningsOverlap(options[a]!.translation, options[b]!.translation)).toBe(false);
    }
  });
  it('searches alternative combinations instead of giving up after a blocking choice', () => {
    const options = generateOptions(target, [target, word('blocker', { translation: 'n. 桌子, 椅子, 河流' }), ...pool.slice(1)], () => 0.999)!;
    expect(options).toHaveLength(4);
    expect(options.some(item => item.id === 'blocker')).toBe(false);
  });
  it('uses shortened text in the prepared index and the standalone target path', () => {
    const hiddenOverlap = pool.map(item => ({ ...item, translation: `${item.translation}\nv. 共有隐藏释义` }));
    const index = prepareChoicePool(hiddenOverlap.slice(1));
    expect(generateOptions(hiddenOverlap[0]!, index, () => 0.37)).toHaveLength(4);
    const duplicate = word('duplicate', { translation: 'n. 苹果\nv. 另一个隐藏释义' });
    expect(generateOptions(hiddenOverlap[0]!, [...hiddenOverlap.slice(0, 3), duplicate])).toBeNull();
  });
});
