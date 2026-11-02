import type { Question, Word } from '../types';

const aliases: Readonly<Record<string, string>> = {
  a: 'adj', j: 'adj', adj: 'adj', ad: 'adv', r: 'adv', adv: 'adv',
  vt: 'v', vi: 'v', v: 'v', n: 'n', p: 'prep', prep: 'prep',
  c: 'conj', conj: 'conj', pron: 'pron', u: 'pron', art: 'art',
  det: 'det', m: 'num', num: 'num', int: 'int', interj: 'int',
};

export function primaryPos(word: Pick<Word, 'pos' | 'translation'>): string | null {
  const parts = word.pos.toLowerCase().split('/').map(part => {
    const [raw = '', weight = '0'] = part.split(':');
    return { pos: aliases[raw.trim().replace(/\.$/, '')], weight: Number(weight) || 0 };
  }).filter((part): part is { pos: string; weight: number } => Boolean(part.pos));
  if (parts.length) return parts.sort((a, b) => b.weight - a.weight)[0]?.pos ?? null;
  const first = word.translation.match(/^\s*([a-z]+)\./i)?.[1]?.toLowerCase();
  return first ? aliases[first] ?? null : null;
}

function senses(translation: string): string[] {
  return translation.toLowerCase().split('\n').flatMap(line =>
    line.replace(/^\s*(?:(?:[a-z]+)\.?\s*[,/&]\s*)*[a-z]+\.\s*/i, '')
      .replace(/\[[^\]]*\]|【[^】]*】|\([^)]*\)|（[^）]*）/g, '')
      .split(/[,，;；、]/)
      .map(value => value.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean),
  );
}

export function meaningsOverlap(a: string, b: string): boolean {
  const left = senses(a);
  const right = senses(b);
  if (!left.length || !right.length) return true;
  return left.some(x => right.some(y => {
    if (x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x)))) return true;
    const grams = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)));
    const gx = grams(x);
    const gy = grams(y);
    const common = [...gx].filter(gram => gy.has(gram)).length;
    return common > 0 && common / (gx.size + gy.size - common) >= 0.65;
  }));
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    const a = result[i];
    const b = result[j];
    if (a !== undefined && b !== undefined) { result[i] = b; result[j] = a; }
  }
  return result;
}

export function generateOptions(target: Word, pool: readonly Word[], random: () => number = Math.random): Word[] | null {
  const pos = primaryPos(target);
  if (!pos || !target.translation.trim()) return null;
  const distance = (word: Word) => target.frq > 0 && word.frq > 0 ? Math.abs(word.frq - target.frq) : 0;
  const seen = new Set([target.word.toLowerCase()]);
  const candidates = pool.filter(word => {
    const key = word.word.toLowerCase();
    if (word.id === target.id || seen.has(key) || primaryPos(word) !== pos || !word.translation.trim()) return false;
    // Unknown ranks only pair with other unknown ranks. Never invent proximity.
    if ((target.frq === 0) !== (word.frq === 0)) return false;
    if (distance(word) > Math.max(1000, target.frq * 0.75)) return false;
    if (meaningsOverlap(target.translation, word.translation)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => distance(a) - distance(b)).slice(0, 24);
  const selected: Word[] = [];
  for (const candidate of shuffle(candidates, random)) {
    if (selected.every(word => !meaningsOverlap(word.translation, candidate.translation))) selected.push(candidate);
    if (selected.length === 3) return shuffle([target, ...selected], random);
  }
  // Small/ambiguous pools must not silently produce invalid or duplicate options.
  return null;
}

export function nextQuestion(words: readonly Word[], start: number, random: () => number = Math.random): { question: Question | null; cursor: number; skipped: number } {
  let skipped = 0;
  for (let cursor = start; cursor < words.length; cursor++) {
    const word = words[cursor];
    if (!word) continue;
    const options = generateOptions(word, words, random);
    if (options) return { question: { word, options }, cursor, skipped };
    skipped++;
  }
  return { question: null, cursor: words.length, skipped };
}
