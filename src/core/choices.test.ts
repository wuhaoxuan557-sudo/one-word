import { describe, expect, it } from 'vitest';
import { generateOptions, meaningsOverlap, nextQuestion, primaryPos } from './choices';
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
});

describe('generateOptions', () => {
  const target = word('apple', { translation: 'n. 苹果' });
  const pool = [target, word('table', { translation: 'n. 桌子', frq: 980 }), word('chair', { translation: 'n. 椅子', frq: 1050 }), word('river', { translation: 'n. 河流', frq: 1100 })];
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
    expect(generateOptions(word('mystery', { pos: '', translation: '未知' }), pool)).toBeNull();
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
  it('skips impossible questions and terminates at exhaustion', () => {
    const impossible = word('the', { pos: 'art', translation: 'art. 这' });
    const next = nextQuestion([impossible, ...pool], 0, () => 0.5);
    expect(next.cursor).toBe(1);
    expect(next.skipped).toBe(1);
    expect(next.question?.word.id).toBe(target.id);
    expect(nextQuestion([impossible], 0)).toEqual({ cursor: 1, skipped: 1, question: null });
    expect(nextQuestion([], 0)).toEqual({ cursor: 0, skipped: 0, question: null });
  });
});
