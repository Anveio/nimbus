import type { RendererFontMetrics } from '../types'

export const fontString = (
  font: RendererFontMetrics,
  bold: boolean,
  italic: boolean,
): string =>
  `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${font.size}px ${font.family}`

