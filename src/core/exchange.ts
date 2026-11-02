const labels: Readonly<Record<string, string>> = {
  p: '过去式', d: '过去分词', i: '现在分词', '3': '第三人称单数',
  s: '复数', r: '比较级', t: '最高级', '0': '原形',
};

export interface WordForm { label: string; value: string }

export function parseExchange(exchange: string): WordForm[] {
  const forms: WordForm[] = [];
  const seen = new Set<string>();
  for (const part of exchange.split('/')) {
    const colon = part.indexOf(':');
    const key = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    const label = labels[key];
    // '1' describes a lemma relation, not a literal word form.
    if (colon < 1 || !label || !value || seen.has(key)) continue;
    forms.push({ label, value });
    seen.add(key);
  }
  return forms;
}
