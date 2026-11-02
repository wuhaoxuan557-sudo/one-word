import type { Word } from '../types';
import { formatOptionTranslation } from './translation.ts';

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

interface Sense { text: string; grams: ReadonlySet<string> }
interface PreparedWord { word: Word; meaning: Sense[]; pos: string | null }
export interface ChoicePool {
  records: readonly PreparedWord[];
  byId: ReadonlyMap<string, PreparedWord>;
}

function senses(translation: string): Sense[] {
  return formatOptionTranslation(translation).toLowerCase().split('\n').flatMap(line =>
    line.replace(/^\s*(?:(?:[a-z]+)\.?\s*[,/&]\s*)*[a-z]+\.\s*/i, '')
      .replace(/\[[^\]]*\]|【[^】]*】|\([^)]*\)|（[^）]*）/g, '')
      .split(/[,，;；、]/)
      .map(value => value.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean)
      .map(text => ({ text, grams: new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2))) })),
  );
}

export function prepareChoicePool(words: readonly Word[]): ChoicePool {
  const records = words.map(word => ({ word, meaning: senses(word.translation), pos: primaryPos(word) }));
  return { records, byId: new Map(records.map(record => [record.word.id, record])) };
}

export function meaningsOverlap(a: string, b: string): boolean {
  return overlap(senses(a), senses(b));
}

function overlap(left: Sense[], right: Sense[]): boolean {
  if (!left.length || !right.length) return true;
  return left.some(x => right.some(y => {
    if (x.text === y.text || (Math.min(x.text.length, y.text.length) >= 2 && (x.text.includes(y.text) || y.text.includes(x.text)))) return true;
    let common = 0;
    for (const gram of x.grams) if (y.grams.has(gram)) common++;
    return common > 0 && common / (x.grams.size + y.grams.size - common) >= 0.65;
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

export function generateOptions(target: Word, pool: readonly Word[] | ChoicePool, random: () => number = Math.random): Word[] | null {
  const prepared = 'records' in pool ? pool : prepareChoicePool(pool);
  const pos = prepared.byId.get(target.id)?.pos ?? primaryPos(target);
  if (!target.translation.trim()) return null;
  const targetSenses = prepared.byId.get(target.id)?.meaning ?? senses(target.translation);
  const distance = (word: Word) => target.frq > 0 && word.frq > 0 ? Math.abs(word.frq - target.frq) : Infinity;
  const seen = new Set([target.word.toLowerCase()]);
  const candidates = prepared.records.flatMap(record => {
    const { word, meaning } = record;
    const key = word.word.toLowerCase();
    if (word.id === target.id || seen.has(key) || !word.translation.trim()) return [];
    if (overlap(targetSenses, meaning)) return [];
    seen.add(key);
    const samePos = pos !== null && record.pos === pos;
    const near = (target.frq === 0 && word.frq === 0) || distance(word) <= Math.max(1000, target.frq * 0.75);
    return [{ word, meaning, tier: samePos ? near ? 0 : 1 : 2 }];
  });
  const nearest = candidates.filter(item => item.tier === 0).sort((a, b) => distance(a.word) - distance(b.word));
  const ordered = [
    ...shuffle(nearest.slice(0, 24), random), ...nearest.slice(24),
    ...shuffle(candidates.filter(item => item.tier === 1), random),
    ...shuffle(candidates.filter(item => item.tier === 2), random),
  ];
  // Search combinations, not just a greedy path: an early choice may block a valid trio.
  for (let tier = 0; tier <= 2; tier++) {
    const eligible = ordered.filter(item => item.tier <= tier);
    for (let a = 0; a < eligible.length - 2; a++) {
      const first = eligible[a]!;
      for (let b = a + 1; b < eligible.length - 1; b++) {
        const second = eligible[b]!;
        if (overlap(first.meaning, second.meaning)) continue;
        for (let c = b + 1; c < eligible.length; c++) {
          const third = eligible[c]!;
          if (!overlap(first.meaning, third.meaning) && !overlap(second.meaning, third.meaning)) {
            return shuffle([target, first.word, second.word, third.word], random);
          }
        }
      }
    }
  }
  return null;
}
