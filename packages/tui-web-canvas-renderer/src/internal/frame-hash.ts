/**
 * Lightweight frame hashing utility used by diagnostics mode. We avoid pulling
 * in external crypto dependencies so unit tests and the Vite test harness can
 * import the module without additional stubbing.
 */
export const hashFrameBytes = (bytes: Uint8Array): string => {
  let hash = 0
  for (let index = 0; index < bytes.length; index += 1) {
    hash = (hash * 31 + bytes[index]!) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
