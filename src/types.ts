export interface Word {
  id: string;
  word: string;
  phonetic: string;
  translation: string;
  translationFull: string;
  definition: string;
  pos: string;
  collins: number;
  oxford: number;
  frq: number;
  exchange: string;
}

export interface Question {
  word: Word;
  options: Word[];
}

export interface Answer {
  wordId: string;
  selectedId: string | null;
  correct: boolean;
  elapsedMs: number;
  answeredAt: number;
}
