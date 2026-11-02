function logicalLines(translation: string): string[] {
  return translation.replace(/\\r\\n|\\n|\r\n?/g, '\n').split('\n');
}

function formatLine(line: string, limit = Infinity): string {
  const text = line.trim();
  const prefix = /^((?:[a-z]+\.?\s*[,/&]\s*)*[a-z]+\.)\s*/i.exec(text);
  const body = prefix ? text.slice(prefix[0].length) : text;
  const senses: string[] = [];
  let current = '';
  let depth = 0;
  // Commas inside annotations belong to the sense, not to the sense list.
  for (const character of body) {
    if ('([（【'.includes(character)) depth++;
    if (')]）】'.includes(character)) depth = Math.max(0, depth - 1);
    if (depth === 0 && ',，;；、'.includes(character)) {
      if (current.trim()) senses.push(current.trim());
      current = '';
    } else current += character;
  }
  if (current.trim()) senses.push(current.trim());
  if (!senses.length) return '';
  return `${prefix ? `${prefix[1]} ` : ''}${senses.slice(0, limit).join('；')}`;
}

export function formatOptionTranslation(translation: string): string {
  return formatLine(logicalLines(translation)[0] ?? '', 3);
}

export function formatDetailTranslation(translation: string): string {
  return logicalLines(translation).map(line => formatLine(line)).join('\n');
}
