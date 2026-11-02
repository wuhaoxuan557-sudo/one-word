import { describe, expect, it } from 'vitest';
import { formatDetailTranslation, formatOptionTranslation } from './translation';

describe('formatOptionTranslation', () => {
  it('keeps the first logical line, POS prefix and first three senses', () => {
    expect(formatOptionTranslation('n. 州, 状态, 情形, 国家\na. 国家的\nvt. 说明'))
      .toBe('n. 州；状态；情形');
    expect(formatOptionTranslation('vt. 减轻, 缓和\\nvi. 改善')).toBe('vt. 减轻；缓和');
  });
  it('normalises separators without splitting combined POS or annotations', () => {
    expect(formatOptionTranslation('a., n. 英国的（人, 语），英国人; 英语、其他'))
      .toBe('a., n. 英国的（人, 语）；英国人；英语');
  });
  it('handles empty senses and missing POS without inventing text', () => {
    expect(formatOptionTranslation('  苹果, , 桌子；河流  ')).toBe('苹果；桌子；河流');
    expect(formatOptionTranslation('')).toBe('');
    expect(formatOptionTranslation('n. ')).toBe('');
    expect(formatOptionTranslation('\nvt. 隐藏行')).toBe('');
  });
});

describe('formatDetailTranslation', () => {
  it('retains every logical line and sense, including the fourth sense', () => {
    expect(formatDetailTranslation('n. 州, 状态, 情形, 国家\r\na. 国家的，正式的\n[计] 状态'))
      .toBe('n. 州；状态；情形；国家\na. 国家的；正式的\n[计] 状态');
  });
  it('is idempotent for already formatted text', () => {
    const text = 'v. 减轻；缓和\nn. 缓解';
    expect(formatDetailTranslation(text)).toBe(text);
    expect(formatOptionTranslation(formatOptionTranslation(text))).toBe('v. 减轻；缓和');
  });
});
