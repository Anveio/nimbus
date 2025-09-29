import type { CharsetId } from './state'

const DEC_SPECIAL_GRAPHICS: Record<string, string> = {
  '`': '◆',
  'a': '▒',
  'b': '␉',
  'c': '␌',
  'd': '␍',
  'e': '␊',
  'f': '°',
  'g': '±',
  'h': '␤',
  'i': '␋',
  'j': '┘',
  'k': '┐',
  'l': '┌',
  'm': '└',
  'n': '┼',
  'o': '⎺',
  'p': '⎻',
  'q': '─',
  'r': '⎼',
  's': '⎽',
  't': '├',
  'u': '┤',
  'v': '┴',
  'w': '┬',
  'x': '│',
  'y': '≤',
  'z': '≥',
  '{': 'π',
  '|': '≠',
  '}': '£',
  '~': '·',
};

export const translateGlyph = (input: string, charset: CharsetId): string => {
  if (charset !== 'dec_special') {
    return input;
  }
  if (input.length !== 1) {
    return input;
  }
  return DEC_SPECIAL_GRAPHICS[input] ?? input;
};

export const resolveCharset = (designator: string): CharsetId => {
  switch (designator) {
    case '0':
      return 'dec_special';
    case 'A':
    case 'B':
    default:
      return 'us_ascii';
  }
};
