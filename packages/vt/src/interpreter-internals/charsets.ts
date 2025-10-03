import type { CharsetId } from './state'

const DEC_SPECIAL_GRAPHICS: Record<string, string> = {
  '`': '◆',
  a: '▒',
  b: '␉',
  c: '␌',
  d: '␍',
  e: '␊',
  f: '°',
  g: '±',
  h: '␤',
  i: '␋',
  j: '┘',
  k: '┐',
  l: '┌',
  m: '└',
  n: '┼',
  o: '⎺',
  p: '⎻',
  q: '─',
  r: '⎼',
  s: '⎽',
  t: '├',
  u: '┤',
  v: '┴',
  w: '┬',
  x: '│',
  y: '≤',
  z: '≥',
  '{': 'π',
  '|': '≠',
  '}': '£',
  '~': '·',
}

const NRCS_TABLES: Record<
  Exclude<CharsetId, 'us_ascii' | 'dec_special'>,
  Record<string, string>
> = {
  dec_uk: {
    '#': '£',
  },
  dec_french: {
    '#': '£',
    '[': 'à',
    '\\': '°',
    ']': 'ç',
    '^': '§',
    '`': 'ù',
    '{': 'é',
    '|': 'ö',
    '}': 'ü',
    '~': '¨',
  },
  dec_german: {
    '@': '§',
    '[': 'Ä',
    '\\': 'Ö',
    ']': 'Ü',
    '^': '°',
    _: 'ß',
    '{': 'ä',
    '|': 'ö',
    '}': 'ü',
    '~': '¨',
  },
}

export const translateGlyph = (input: string, charset: CharsetId): string => {
  if (input.length !== 1) {
    return input
  }
  if (charset === 'dec_special') {
    return DEC_SPECIAL_GRAPHICS[input] ?? input
  }
  if (charset === 'us_ascii') {
    return input
  }
  const table = NRCS_TABLES[charset]
  return table?.[input] ?? input
}

export const resolveCharset = (designator: string): CharsetId => {
  switch (designator) {
    case '0':
      return 'dec_special'
    case 'A':
      return 'dec_uk'
    case 'R':
      return 'dec_french'
    case 'K':
      return 'dec_german'
    default:
      return 'us_ascii'
  }
}
