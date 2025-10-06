export const hashFrameBytes = (
  data: Uint8Array,
  width: number,
  height: number,
): string => {
  let hash = 0x811c9dc5
  const prime = 0x01000193

  const update = (value: number) => {
    hash ^= value & 0xff
    hash = Math.imul(hash, prime)
    hash >>>= 0
  }

  update(width & 0xff)
  update((width >> 8) & 0xff)
  update(height & 0xff)
  update((height >> 8) & 0xff)

  for (let index = 0; index < data.length; index += 1) {
    update(data[index]!)
  }

  const hex = hash.toString(16).padStart(8, '0')
  return `fnv1a32:${width}x${height}:${hex}`
}
