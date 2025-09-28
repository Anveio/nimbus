import { createCanvas } from 'canvas'
import pixelmatch from 'pixelmatch'
import { describe, expect, test } from 'vitest'

const hexToRgba = (hex: string): [number, number, number, number] => {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6 && normalized.length !== 8) {
    throw new Error(`Unsupported colour format: ${hex}`)
  }

  const parse = (slice: string) => Number.parseInt(slice, 16)
  const r = parse(normalized.slice(0, 2))
  const g = parse(normalized.slice(2, 4))
  const b = parse(normalized.slice(4, 6))
  const a = normalized.length === 8 ? parse(normalized.slice(6, 8)) : 255
  return [r, g, b, a]
}

describe('canvas renderer harness', () => {
  test('solid fill renders reproducibly and matches snapshot', () => {
    const width = 8
    const height = 6
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('failed to acquire 2d context')
    }

    const fill = '#112233'
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, width, height)

    const actual = ctx.getImageData(0, 0, width, height)
    const expected = ctx.createImageData(width, height)
    const [r, g, b, a] = hexToRgba(fill)

    for (let index = 0; index < expected.data.length; index += 4) {
      expected.data[index + 0] = r
      expected.data[index + 1] = g
      expected.data[index + 2] = b
      expected.data[index + 3] = a
    }

    const diff = new Uint8ClampedArray(actual.data.length)
    const mismatchedPixels = pixelmatch(
      actual.data,
      expected.data,
      diff,
      width,
      height,
      { threshold: 0 },
    )

    expect(mismatchedPixels).toBe(0)
    expect(Buffer.from(canvas.toBuffer('image/png')).toString('base64')).toMatchSnapshot()
  })
})
